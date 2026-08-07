import type { SupabaseClient } from '@supabase/supabase-js';

import { NotFoundError } from '@/shared/errors';
import {
  isNoRowsReturned,
  isUniqueViolation,
  translatePostgresError,
} from '@/shared/infrastructure/persistence/postgres-errors';
import { toJsonObject } from '@/shared/infrastructure/persistence/row-mappers';

import type {
  CollectionRunRepository,
  CollectionSnapshot,
} from '../../application/ports/collection-run-repository';
import { ACTIVE_COLLECTION_RUN_STATUSES } from '../../domain/collection-run';
import type { CollectionRun, CollectionRunId } from '../../domain/collection-run';
import { ConcurrentCollectionRunError } from '../../domain/errors/concurrent-collection-run';
import type { YouTubeChannelId } from '../../domain/youtube-channel';
import {
  SOURCE_SCHEMA_VERSION,
  fromCollectionRun,
  fromYouTubeChannel,
  fromYouTubeVideo,
  toCollectionRun,
  toYouTubeChannel,
  toYouTubeVideo,
  type CollectionRunRow,
  type VideoSnapshotRow,
} from './collection-run-row';

/**
 * Adaptador Supabase de `CollectionRunRepository`.
 *
 * As quatro tabelas que ele toca sao GLOBAIS: sem `user_id`, sem policy para
 * `authenticated`. So funciona com o cliente administrativo, e nada do que le
 * vai cru ao navegador (ADR-005).
 *
 * ---------------------------------------------------------------------------
 * DOIS IDENTIFICADORES, E CONFUNDI-LOS SERIA DESASTROSO.
 *
 * O dominio conhece o canal por `UC...` (RN-01). As chaves estrangeiras usam o
 * `uuid` interno de `youtube_channels`. Toda consulta por canal precisa
 * atravessar essa fronteira, e e por isso que existe `resolveInternalChannelId`.
 * ---------------------------------------------------------------------------
 */

const RUN_COLUMNS = `
  id, status, requested_at, started_at, captured_at, completed_at, failed_at,
  reusable_until, invalidated_at, error_code,
  youtube_channels ( youtube_channel_id )
`;

export class SupabaseCollectionRunRepository implements CollectionRunRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: CollectionRunId): Promise<CollectionRun | null> {
    const { data, error } = await this.client
      .from('youtube_collection_runs')
      .select(RUN_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'collectionRun.findById');
    }
    if (data === null) return null;

    return toCollectionRun(data as unknown as CollectionRunRow);
  }

  /**
   * RN-10. Todos os criterios sao aplicados NO BANCO, e nao filtrando em
   * memoria depois: uma coleta expirada nao deve nem sair do Postgres.
   *
   * `referenceTime` chega por parametro — o repositorio nao le o relogio (R9).
   */
  async findReusableForChannel(
    channelId: YouTubeChannelId,
    referenceTime: Date,
  ): Promise<CollectionRun | null> {
    const internalId = await this.findInternalChannelId(channelId);
    if (internalId === null) return null;

    const { data, error } = await this.client
      .from('youtube_collection_runs')
      .select(RUN_COLUMNS)
      .eq('channel_id', internalId)
      .eq('status', 'completed')
      .is('invalidated_at', null)
      .not('reusable_until', 'is', null)
      .gte('reusable_until', referenceTime.toISOString())
      .order('captured_at', { ascending: false })
      .limit(1);

    if (error !== null) throw translatePostgresError(error, 'collectionRun.findReusable');

    const rows = (data ?? []) as unknown as CollectionRunRow[];
    const first = rows[0];
    if (first === undefined) return null;

    const run = toCollectionRun(first);

    // A porta exige snapshot presente. Uma execucao `completed` sem snapshot
    // seria reaproveitada e devolveria nada — vale a consulta extra para nao
    // servir vazio no lugar de coletar.
    const snapshot = await this.findSnapshot(run.id);
    return snapshot === null ? null : run;
  }

  async findActiveForChannel(channelId: YouTubeChannelId): Promise<CollectionRun | null> {
    const internalId = await this.findInternalChannelId(channelId);
    if (internalId === null) return null;

    const { data, error } = await this.client
      .from('youtube_collection_runs')
      .select(RUN_COLUMNS)
      .eq('channel_id', internalId)
      .in('status', [...ACTIVE_COLLECTION_RUN_STATUSES])
      .limit(1);

    if (error !== null) throw translatePostgresError(error, 'collectionRun.findActive');

    const rows = (data ?? []) as unknown as CollectionRunRow[];
    const first = rows[0];
    return first === undefined ? null : toCollectionRun(first);
  }

  /**
   * Cria a execucao, registrando o canal se ele ainda nao existir.
   *
   * A protecao contra coleta simultanea vem do INDICE UNICO PARCIAL
   * `uniq_active_run_per_channel`, e nao de um `SELECT` previo. Entre consultar
   * e inserir cabe outra requisicao; entre o `INSERT` e o indice, nao cabe nada.
   */
  async startRun(run: CollectionRun): Promise<CollectionRun> {
    const internalId = await this.ensureChannel(run.channelId);

    const { error } = await this.client.from('youtube_collection_runs').insert({
      id: run.id,
      channel_id: internalId,
      ...fromCollectionRun(run),
    });

    if (error !== null) {
      if (isUniqueViolation(error)) {
        throw new ConcurrentCollectionRunError(run.channelId);
      }
      throw translatePostgresError(error, 'collectionRun.startRun');
    }

    return run;
  }

  async save(run: CollectionRun): Promise<void> {
    const { error } = await this.client
      .from('youtube_collection_runs')
      .update(fromCollectionRun(run))
      .eq('id', run.id);

    if (error !== null) throw translatePostgresError(error, 'collectionRun.save');
  }

  /**
   * Conclui a execucao e grava os snapshots em UMA transacao.
   *
   * Delegado a funcao `complete_collection_run` no Postgres. O cliente do
   * Supabase nao abre transacao, e fazer isto em quatro chamadas deixaria, numa
   * falha no meio, uma execucao `completed` sem videos — que a RN-10 depois
   * serviria a outro usuario como se fosse um canal vazio.
   */
  async completeWithSnapshot(snapshot: CollectionSnapshot): Promise<void> {
    const { run, channel, videos } = snapshot;

    if (run.capturedAt === null || run.completedAt === null) {
      // O banco tambem recusaria (`youtube_collection_runs_completed_stamp`),
      // mas falhar aqui diz o que faltou.
      throw new NotFoundError('Execucao sem carimbo de captura ou conclusao.', {
        collectionRunId: run.id,
      });
    }

    const { error } = await this.client.rpc('complete_collection_run', {
      p_run_id: run.id,
      p_captured_at: run.capturedAt.toISOString(),
      p_completed_at: run.completedAt.toISOString(),
      p_reusable_until: run.reusableUntil?.toISOString() ?? null,
      p_source_schema_version: SOURCE_SCHEMA_VERSION,
      p_channel_payload: fromYouTubeChannel(channel),
      p_channel_title: channel.title,
      p_channel_handle: channel.handle,
      p_channel_country: channel.country,
      p_channel_published_at: channel.publishedAt.toISOString(),
      p_videos: videos.map(fromYouTubeVideo),
    });

    if (error !== null) {
      throw translatePostgresError(error, 'collectionRun.completeWithSnapshot');
    }
  }

  async findSnapshot(runId: CollectionRunId): Promise<CollectionSnapshot | null> {
    const run = await this.findById(runId);
    if (run === null) return null;

    const { data: channelRow, error: channelError } = await this.client
      .from('youtube_channel_snapshots')
      .select('raw_payload')
      .eq('collection_run_id', runId)
      .maybeSingle();

    if (channelError !== null && !isNoRowsReturned(channelError)) {
      throw translatePostgresError(channelError, 'collectionRun.findSnapshot.channel');
    }
    // Sem snapshot de canal nao ha snapshot nenhum. Devolver os videos sozinhos
    // seria entregar meia coleta como se fosse inteira.
    if (channelRow === null) return null;

    const payload = toJsonObject(
      (channelRow as Record<string, unknown>)['raw_payload'],
      'channelSnapshot.rawPayload',
    );

    const { data: videoRows, error: videoError } = await this.client
      .from('youtube_video_snapshots')
      .select(
        'youtube_video_id, title, published_at, duration_seconds, format, view_count, like_count, comment_count',
      )
      .eq('collection_run_id', runId)
      .order('published_at', { ascending: false });

    if (videoError !== null) {
      throw translatePostgresError(videoError, 'collectionRun.findSnapshot.videos');
    }

    return {
      run,
      channel: toYouTubeChannel(payload, run.channelId),
      videos: ((videoRows ?? []) as unknown as VideoSnapshotRow[]).map((row) =>
        toYouTubeVideo(row, run.channelId),
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Travessia entre `UC...` e o uuid interno
  // -------------------------------------------------------------------------

  private async findInternalChannelId(channelId: YouTubeChannelId): Promise<string | null> {
    const { data, error } = await this.client
      .from('youtube_channels')
      .select('id')
      .eq('youtube_channel_id', channelId)
      .maybeSingle();

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'collectionRun.findInternalChannelId');
    }
    if (data === null) return null;

    return (data as Record<string, unknown>)['id'] as string;
  }

  /**
   * Devolve o uuid interno do canal, criando a linha se ela nao existir.
   *
   * `upsert` com `ignoreDuplicates` em vez de "consultar e depois inserir": duas
   * analises do mesmo canal novo chegando juntas violariam o UNIQUE de
   * `youtube_channel_id`, e isso nao e conflito de negocio — e a mesma coisa
   * sendo registrada duas vezes.
   */
  private async ensureChannel(channelId: YouTubeChannelId): Promise<string> {
    const existing = await this.findInternalChannelId(channelId);
    if (existing !== null) return existing;

    const { error } = await this.client
      .from('youtube_channels')
      .upsert(
        { youtube_channel_id: channelId },
        { onConflict: 'youtube_channel_id', ignoreDuplicates: true },
      );

    if (error !== null) throw translatePostgresError(error, 'collectionRun.ensureChannel');

    const created = await this.findInternalChannelId(channelId);
    if (created === null) {
      throw new NotFoundError('Canal nao pode ser registrado.', { channelId });
    }
    return created;
  }
}
