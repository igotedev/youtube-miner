import { AppError } from '@/shared/errors';

import type { YouTubeChannelId } from '../youtube-channel';

/**
 * Ja existe uma coleta ativa para este canal.
 *
 * Nao e defeito: e a corrida normal entre dois usuarios pedindo analise do mesmo
 * canal ao mesmo tempo. A deteccao vem do indice unico parcial no banco, e nao
 * de um `SELECT` previo — entre consultar e inserir cabe outra requisicao.
 *
 * O caso de uso deve tratar isto aguardando ou reaproveitando a execucao em
 * andamento, nunca iniciando uma segunda coleta: cada coleta duplicada gasta
 * quota da YouTube Data API por um dado que ja esta sendo buscado.
 */
export class ConcurrentCollectionRunError extends AppError {
  readonly code = 'CONFLICT' as const;

  constructor(channelId: YouTubeChannelId) {
    super('Ja existe uma coleta em andamento para este canal.', { channelId });
  }
}
