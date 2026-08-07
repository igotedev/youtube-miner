import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChannelDirectory } from '../../application/ports/channel-directory';
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
}
