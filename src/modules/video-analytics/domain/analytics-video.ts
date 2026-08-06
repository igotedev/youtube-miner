import type { VideoFormat, YouTubeVideoId } from '@/modules/youtube-collection';

/** Formatos que o motor sabe agregar. `unknown` fica fora dos dois blocos. */
export type AnalyzableVideoFormat = Exclude<VideoFormat, 'unknown'>;

export const ANALYZABLE_FORMATS = [
  'short',
  'long',
] as const satisfies readonly AnalyzableVideoFormat[];

/**
 * Entrada do motor de metricas.
 *
 * E um SUBCONJUNTO ESTRUTURAL de `YouTubeVideo`: um `readonly YouTubeVideo[]`
 * pode ser passado direto, sem mapeamento. O tipo existe mesmo assim por dois
 * motivos:
 *
 *  1. declara o que o motor realmente le. `YouTubeVideo` carrega titulo,
 *     canal, duracao e thumbnails — nada disso participa de nenhum calculo, e
 *     depender do tipo inteiro sugeriria o contrario;
 *  2. mantem o motor testavel com objetos minimos, sem inventar titulo e ID de
 *     canal em cada caso de teste.
 *
 * `likeCount` e `commentCount` NAO estao aqui. Nenhuma metrica desta versao os
 * usa, e campo que nenhuma funcao le e peso morto. Quando uma SPEC futura
 * precisar deles (taxa de engajamento, por exemplo), o tipo cresce junto com
 * ela.
 */
export interface AnalyticsVideo {
  readonly id: YouTubeVideoId;
  /** Ja classificado pela coleta. O motor NAO infere formato. */
  readonly format: VideoFormat;
  readonly publishedAt: Date;
  /** `null` quando a contagem nao esta disponivel. Nunca use `0` para isso. */
  readonly viewCount: number | null;
}

/** Entrada completa. `collectedAt` e a unica referencia de tempo do motor. */
export interface CalculateChannelMetricsInput {
  readonly videos: readonly AnalyticsVideo[];
  /** Instante da coleta. Toda metrica temporal usa este valor (RN-12, RN-13). */
  readonly collectedAt: Date;
}
