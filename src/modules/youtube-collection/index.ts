/**
 * Superficie publica do modulo `youtube-collection`.
 *
 * Os adaptadores falsos NAO sao reexportados: quem precisa deles importa o
 * caminho interno explicitamente, e apenas em teste ou na raiz de composicao.
 * Ver R5 em docs/architecture/dependency-rules.md.
 */
export type { YouTubeChannel, YouTubeChannelId } from './domain/youtube-channel';
export type { VideoFormat, YouTubeVideo, YouTubeVideoId } from './domain/youtube-video';
export type { ChannelResolver } from './application/ports/channel-resolver';
export {
  MAX_RECENT_VIDEOS,
  type YouTubeChannelSource,
} from './application/ports/youtube-channel-source';
