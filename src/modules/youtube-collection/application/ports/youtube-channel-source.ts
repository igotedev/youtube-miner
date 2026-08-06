import type { YouTubeChannel, YouTubeChannelId } from '../../domain/youtube-channel';
import type { YouTubeVideo } from '../../domain/youtube-video';

/** Teto do MVP: no maximo 50 videos recentes por analise. Ver SPEC-001. */
export const MAX_RECENT_VIDEOS = 50;

/**
 * Porta de coleta de dados publicos do YouTube.
 *
 * Tudo que envolve a YouTube Data API — chave, quota, paginacao, cache, formato
 * de resposta — fica do lado do adaptador. Quem chama ve apenas tipos de
 * dominio. Ver ADR-004.
 */
export interface YouTubeChannelSource {
  /**
   * @throws {NotFoundError} Canal inexistente ou removido.
   * @throws {QuotaExceededError} Teto diario de quota atingido.
   * @throws {ExternalServiceError} Qualquer outra falha da API.
   */
  fetchChannel(channelId: YouTubeChannelId): Promise<YouTubeChannel>;

  /**
   * Videos publicos mais recentes, do mais novo para o mais antigo.
   *
   * Pode devolver menos que `limit` — inclusive uma lista vazia, para canais
   * sem videos publicos. Lista vazia e um resultado valido, nao um erro.
   */
  fetchRecentVideos(channelId: YouTubeChannelId, limit: number): Promise<readonly YouTubeVideo[]>;
}
