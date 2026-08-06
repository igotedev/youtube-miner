import type { YouTubeChannelId } from '../../domain/youtube-channel';

/**
 * Porta de resolucao de URL para ID oficial.
 *
 * Uma URL pode chegar em varias formas (`/channel/UC...`, `/@handle`, `/c/nome`,
 * `/user/nome`, com query, com barra final). Nem todas podem ser resolvidas sem
 * consultar o YouTube — por isso resolucao e assincrona e mora atras de uma
 * porta, e nao de uma funcao pura.
 *
 * A normalizacao sintatica da URL (a parte que E pura e testavel offline) sera
 * uma funcao de dominio deste modulo, definida na SPEC-002. Nesta etapa de
 * fundacao ela nao foi implementada de proposito.
 */
export interface ChannelResolver {
  /**
   * @throws {ValidationError} URL sintaticamente invalida ou de outro dominio.
   * @throws {NotFoundError} URL valida, mas sem canal correspondente.
   * @throws {ExternalServiceError} Falha ao consultar o YouTube.
   */
  resolveChannelId(rawUrl: string): Promise<YouTubeChannelId>;
}
