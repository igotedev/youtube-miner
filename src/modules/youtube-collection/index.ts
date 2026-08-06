/**
 * Superficie publica do modulo `youtube-collection`.
 *
 * Os adaptadores falsos NAO sao reexportados: quem precisa deles importa o
 * caminho interno explicitamente, e apenas em teste ou na raiz de composicao.
 * Ver R5 em docs/architecture/dependency-rules.md.
 */
export type { YouTubeChannel, YouTubeChannelId } from './domain/youtube-channel';
export type { VideoFormat, YouTubeVideo, YouTubeVideoId } from './domain/youtube-video';

// --- Referencia de canal (SPEC-002) ---
export {
  ALLOWED_HOSTNAMES,
  CHANNEL_ID_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_LEGACY_IDENTIFIER_LENGTH,
  parseYouTubeChannelReference,
  type YouTubeChannelReference,
  type YouTubeChannelReferenceKind,
} from './domain/youtube-channel-reference';
export {
  InvalidChannelReferenceError,
  type InvalidChannelReferenceReason,
} from './domain/errors/invalid-channel-reference';

// --- Portas ---
export type { ChannelResolver } from './application/ports/channel-resolver';
export {
  MAX_RECENT_VIDEOS,
  type YouTubeChannelSource,
} from './application/ports/youtube-channel-source';
