import type { Brand } from '@/shared/domain';

import type { YouTubeChannelId } from './youtube-channel';

export type YouTubeVideoId = Brand<string, 'YouTubeVideoId'>;

/**
 * Formato do video.
 *
 * RN-06: Shorts e videos longos nunca compartilham metricas. Este discriminante
 * e o que permite ao modulo video-analytics manter medianas separadas.
 *
 * `unknown` e um terceiro estado legitimo: quando a duracao nao pode ser obtida,
 * classificar o video como "long" por padrao contaminaria a mediana. O criterio
 * exato de classificacao sera definido na SPEC de coleta.
 */
export type VideoFormat = 'short' | 'long' | 'unknown';

/**
 * Os tres formatos possiveis, para validar o que vem de fora.
 *
 * Espelha a constraint `youtube_video_snapshots_format` no banco. Se um dia um
 * quarto formato existir, os dois precisam mudar juntos.
 */
export const VIDEO_FORMATS = ['short', 'long', 'unknown'] as const;

/**
 * Dados publicos de um video, como vieram da API.
 *
 * Assim como no canal, contadores ausentes sao `null` (RN-08). Comentarios e
 * curtidas podem estar desativados — isso nao e zero.
 */
export interface YouTubeVideo {
  readonly id: YouTubeVideoId;
  readonly channelId: YouTubeChannelId;
  readonly title: string;
  readonly publishedAt: Date;
  /** Duracao em segundos. `null` quando a API nao informou. */
  readonly durationSeconds: number | null;
  readonly format: VideoFormat;
  readonly viewCount: number | null;
  readonly likeCount: number | null;
  readonly commentCount: number | null;
}
