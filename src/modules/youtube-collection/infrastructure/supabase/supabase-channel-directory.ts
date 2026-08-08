import type { SupabaseClient } from '@supabase/supabase-js';

import { translatePostgresError } from '@/shared/infrastructure/persistence/postgres-errors';
import { toNullableText, toText } from '@/shared/infrastructure/persistence/row-mappers';

import type { ChannelDirectory, ChannelSummary } from '../../application/ports/channel-directory';
import type { YouTubeChannelId } from '../../domain/youtube-channel';
import { ensureChannelRegistered } from './channel-registration';

/**
 * Adaptador Supabase de `ChannelDirectory`.
 *
 * `youtube_channels` e tabela GLOBAL: sem `user_id`, sem policy para
 * `authenticated`. So funciona com o cliente administrativo (ADR-005).
 *
 * Camada fina de proposito — a logica de registro esta em
 * `channel-registration.ts`, compartilhada com o repositorio de coletas.
 */
export class SupabaseChannelDirectory implements ChannelDirectory {
  constructor(private readonly client: SupabaseClient) {}

  async ensureRegistered(channelId: YouTubeChannelId): Promise<void> {
    // O UUID interno e descartado de proposito: ele e detalhe de persistencia e
    // nao atravessa a porta.
    await ensureChannelRegistered(this.client, channelId, 'channelDirectory.ensureRegistered');
  }

  async findSummaries(channelIds: readonly YouTubeChannelId[]): Promise<readonly ChannelSummary[]> {
    // Lista vazia nem chega ao banco. `in ()` com conjunto vazio e sintaxe
    // invalida em alguns dialetos e ida perdida em todos.
    if (channelIds.length === 0) return [];

    const { data, error } = await this.client
      .from('youtube_channels')
      .select('youtube_channel_id, title, handle')
      .in('youtube_channel_id', [...new Set(channelIds)]);

    if (error !== null) {
      throw translatePostgresError(error, 'channelDirectory.findSummaries');
    }

    return (data ?? []).map((row) => toChannelSummary(row as Record<string, unknown>));
  }
}

/**
 * Linha -> `ChannelSummary`, com cada campo validado.
 *
 * `title` e `handle` sao NULAVEIS na tabela e continuam nulaveis aqui: a linha
 * do canal nasce so com o ID, e a coleta preenche o resto depois. Um `toText`
 * neles transformaria o caso comum em erro de dado corrompido.
 */
function toChannelSummary(row: Record<string, unknown>): ChannelSummary {
  return {
    id: toText(
      row['youtube_channel_id'],
      'youtube_channels.youtube_channel_id',
    ) as YouTubeChannelId,
    title: toNullableText(row['title'], 'youtube_channels.title'),
    handle: toNullableText(row['handle'], 'youtube_channels.handle'),
  };
}
