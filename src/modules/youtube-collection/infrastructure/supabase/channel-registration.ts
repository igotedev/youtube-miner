import type { SupabaseClient } from '@supabase/supabase-js';

import { NotFoundError } from '@/shared/errors';
import { translatePostgresError } from '@/shared/infrastructure/persistence/postgres-errors';

import type { YouTubeChannelId } from '../../domain/youtube-channel';

/**
 * Registro de canais em `youtube_channels`.
 *
 * Mora em um arquivo proprio porque tem DOIS chamadores — o repositorio de
 * coletas e o `SupabaseChannelDirectory` — e duas copias da mesma logica de
 * "insere se nao existir" divergiriam na primeira correcao.
 *
 * ---------------------------------------------------------------------------
 * DOIS IDENTIFICADORES.
 *
 * O dominio conhece o canal por `UC...` (RN-01). As chaves estrangeiras usam o
 * `uuid` interno. A travessia entre os dois acontece aqui e nao vaza para cima.
 * ---------------------------------------------------------------------------
 */

/** UUID interno do canal, ou `null` se ele ainda nao foi registrado. */
export async function findInternalChannelId(
  client: SupabaseClient,
  channelId: YouTubeChannelId,
  operation: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('youtube_channels')
    .select('id')
    .eq('youtube_channel_id', channelId)
    .maybeSingle();

  if (error !== null) throw translatePostgresError(error, operation);
  if (data === null) return null;

  return String((data as { id: unknown }).id);
}

/**
 * Devolve o UUID interno do canal, criando o registro se ele nao existir.
 *
 * `upsert` com `ignoreDuplicates` em vez de "consultar e depois inserir": entre
 * a consulta e a insercao cabe outra requisicao, e duas analises do mesmo canal
 * novo chegando juntas violariam o UNIQUE de `youtube_channel_id`. Isso nao e
 * conflito de negocio — e a mesma coisa sendo registrada duas vezes, e a
 * segunda deve ser silenciosa.
 */
export async function ensureChannelRegistered(
  client: SupabaseClient,
  channelId: YouTubeChannelId,
  operation: string,
): Promise<string> {
  const existing = await findInternalChannelId(client, channelId, operation);
  if (existing !== null) return existing;

  const { error } = await client
    .from('youtube_channels')
    .upsert(
      { youtube_channel_id: channelId },
      { onConflict: 'youtube_channel_id', ignoreDuplicates: true },
    );

  if (error !== null) throw translatePostgresError(error, operation);

  const created = await findInternalChannelId(client, channelId, operation);
  if (created === null) {
    // Nao deveria acontecer: o upsert nao falhou e o registro nao esta la.
    // Falhar alto e melhor que devolver um id inventado.
    throw new NotFoundError('Canal nao pode ser registrado.', { operation });
  }
  return created;
}
