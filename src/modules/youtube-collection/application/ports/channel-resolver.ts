import type { YouTubeChannelId } from '../../domain/youtube-channel';

/**
 * Porta de resolucao de URL para ID oficial.
 *
 * Uma URL pode chegar em varias formas (`/channel/UC...`, `/@handle`, `/c/nome`,
 * `/user/nome`, com query, com barra final). Nem todas podem ser resolvidas sem
 * consultar o YouTube — por isso resolucao e assincrona e mora atras de uma
 * porta, e nao de uma funcao pura.
 *
 * A parte pura e testavel offline ja existe: `parseYouTubeChannelReference`
 * (SPEC-002) normaliza a entrada e devolve uma `YouTubeChannelReference`
 * discriminada. O adaptador desta porta devera usa-la primeiro e so ir a rede
 * quando o `kind` NAO for `channel_id` — nesse caso o ID ja esta em maos e
 * nenhuma unidade de quota precisa ser gasta.
 */
export interface ChannelResolver {
  /**
   * @throws {InvalidChannelReferenceError} Entrada nao reconhecida como
   *   referencia de canal. Detectavel offline, antes de qualquer chamada.
   * @throws {NotFoundError} Referencia valida, mas sem canal correspondente.
   * @throws {ExternalServiceError} Falha ao consultar o YouTube.
   */
  resolveChannelId(rawUrl: string): Promise<YouTubeChannelId>;
}
