import type { SupabaseClient } from '@supabase/supabase-js';

import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import { ConflictError, NotFoundError } from '@/shared/errors';
import {
  isNoRowsReturned,
  isUniqueViolation,
  translatePostgresError,
} from '@/shared/infrastructure/persistence/postgres-errors';

import type { AnalysisRepository } from '../../application/ports/analysis-repository';
import type { Analysis, AnalysisId } from '../../domain/analysis';
import { fromAnalysis, toAnalysis, type AnalysisRow } from './analysis-row';

/**
 * Adaptador Supabase de `AnalysisRepository`.
 *
 * Camada FINA de proposito: toda conversao e validacao vive em
 * `analysis-row.ts`, que e puro e testado. O que sobra aqui e construcao de
 * consulta — a parte que so uma execucao contra um PostgreSQL de verdade pode
 * verificar, e que os testes pgTAP e a integracao local cobrem.
 *
 * Nenhum tipo do Supabase atravessa a fronteira: os metodos recebem e devolvem
 * apenas tipos de dominio.
 */

/**
 * Colunas lidas, com o ID oficial trazido pelo join.
 *
 * `channel_analyses.channel_id` e o UUID interno; o dominio fala `UC...`. O
 * embed do PostgREST resolve isso em uma unica ida ao banco.
 */
const SELECT_COLUMNS = `
  id,
  user_id,
  requested_url,
  status,
  collection_run_id,
  analytics_result_id,
  idempotency_key,
  requested_at,
  started_at,
  completed_at,
  failed_at,
  error_code,
  youtube_channels!inner ( youtube_channel_id )
`;

interface JoinedRow {
  readonly youtube_channels: { readonly youtube_channel_id: unknown } | null;
  readonly [key: string]: unknown;
}

function flatten(row: JoinedRow): AnalysisRow {
  // Cast por `unknown`: a linha vem do driver como `Record<string, unknown>` e
  // NENHUM campo e confiavel ate `toAnalysis` valida-lo um a um. O tipo aqui e
  // so o formato esperado; a garantia esta no mapeador.
  return {
    ...row,
    youtube_channel_id: row.youtube_channels?.youtube_channel_id,
  } as unknown as AnalysisRow;
}

export class SupabaseAnalysisRepository implements AnalysisRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: AnalysisId, ownerId: UserId): Promise<Analysis | null> {
    const { data, error } = await this.client
      .from('channel_analyses')
      .select(SELECT_COLUMNS)
      // Filtro por dono NO CODIGO, mesmo com RLS ativo: o repositorio pode ser
      // construido com o cliente administrativo, que ignora RLS. Confiar apenas
      // na policy deixaria o isolamento dependente de qual cliente foi injetado.
      .eq('id', id)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'analysis.findById');
    }
    if (data === null) return null;

    return toAnalysis(flatten(data as unknown as JoinedRow));
  }

  async findByIdempotencyKey(ownerId: UserId, idempotencyKey: string): Promise<Analysis | null> {
    const { data, error } = await this.client
      .from('channel_analyses')
      .select(SELECT_COLUMNS)
      .eq('user_id', ownerId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'analysis.findByIdempotencyKey');
    }
    if (data === null) return null;

    return toAnalysis(flatten(data as unknown as JoinedRow));
  }

  async listByChannel(ownerId: UserId, channelId: YouTubeChannelId): Promise<readonly Analysis[]> {
    const { data, error } = await this.client
      .from('channel_analyses')
      .select(SELECT_COLUMNS)
      .eq('user_id', ownerId)
      .eq('youtube_channels.youtube_channel_id', channelId)
      .order('requested_at', { ascending: false });

    if (error !== null) {
      throw translatePostgresError(error, 'analysis.listByChannel');
    }

    return (data ?? []).map((row) => toAnalysis(flatten(row as unknown as JoinedRow)));
  }

  async create(analysis: Analysis): Promise<void> {
    const internalChannelId = await this.resolveInternalChannelId(analysis.channelId);

    const { error } = await this.client
      .from('channel_analyses')
      .insert(fromAnalysis(analysis, internalChannelId));

    if (error !== null) {
      // `uniq_analysis_idempotency_key`: outra requisicao chegou primeiro. E a
      // corrida normal de um duplo clique, nao um defeito.
      if (isUniqueViolation(error)) {
        throw new ConflictError('Chave de idempotencia ja usada por este usuario.', {
          operation: 'analysis.create',
        });
      }
      throw translatePostgresError(error, 'analysis.create');
    }
  }

  async save(analysis: Analysis): Promise<void> {
    const internalChannelId = await this.resolveInternalChannelId(analysis.channelId);

    const { error } = await this.client
      .from('channel_analyses')
      .update(fromAnalysis(analysis, internalChannelId))
      .eq('id', analysis.id)
      .eq('user_id', analysis.requestedBy);

    if (error !== null) {
      throw translatePostgresError(error, 'analysis.save');
    }
  }

  /**
   * ID oficial (`UC...`) -> UUID interno de `youtube_channels`.
   *
   * A tabela pertence a `youtube-collection`, e uma leitura direta daqui seria
   * violacao de R7. O canal ja existe neste ponto: a coleta o registra antes de
   * qualquer analise apontar para ele.
   *
   * NOTA DE DIVIDA: esta consulta e o unico ponto em que este modulo toca uma
   * tabela alheia, e esta registrado como tal na SPEC-004, secao 5. A remocao
   * correta e uma porta `ChannelDirectory` exposta por `youtube-collection`,
   * que sera criada quando o adaptador de coleta real existir.
   */
  private async resolveInternalChannelId(channelId: YouTubeChannelId): Promise<string> {
    const { data, error } = await this.client
      .from('youtube_channels')
      .select('id')
      .eq('youtube_channel_id', channelId)
      .maybeSingle();

    if (error !== null) {
      throw translatePostgresError(error, 'analysis.resolveChannel');
    }
    if (data === null) {
      throw new NotFoundError('Canal ainda nao registrado.', {
        operation: 'analysis.resolveChannel',
      });
    }

    return String((data as { id: unknown }).id);
  }
}
