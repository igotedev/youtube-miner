import type { YouTubeVideoId } from '@/modules/youtube-collection';

import type { AnalyzableVideoFormat } from './analytics-video';
import type { OutlierBand } from './outlier';
import type { PublicationFrequency } from './publication-timing';

/**
 * Modelo de saida do motor de metricas.
 *
 * O formato do tipo codifica tres regras de negocio, para que nao seja possivel
 * viola-las sem mudar o contrato:
 *
 *  - RN-06: `shorts` e `long` sao blocos separados. NAO existe media, mediana ou
 *    outlier no nivel do canal — nenhum campo permite misturar os dois;
 *  - RN-08: todo agregado e `number | null`. Ausencia se representa como `null`,
 *    jamais como `0`. Contagens de itens sao `number`, onde `0` e legitimo;
 *  - RN-04: este tipo descreve METRICAS CALCULADAS. Os dados brutos ficam em
 *    `Analysis.rawSnapshot` e o relatorio de IA em `Analysis.insight`.
 */

/** Metricas de um unico video, dentro do bloco do seu formato. */
export interface VideoMetrics {
  readonly videoId: YouTubeVideoId;
  /** Dias fracionarios entre a publicacao e a coleta. */
  readonly ageInDays: number;
  /** `null` quando `viewCount` e `null`. */
  readonly viewsPerDay: number | null;
  /** `null` quando falta a contagem ou a mediana do formato nao serve de base. */
  readonly outlierScore: number | null;
  /** `null` significa "nao classificavel", e nao uma quinta faixa. */
  readonly outlierBand: OutlierBand | null;
}

/** Metricas de UM formato. Nunca contem dados do outro. */
export interface FormatMetrics {
  readonly format: AnalyzableVideoFormat;
  /** Quantidade de videos do formato. Contagem: `0` e valido. */
  readonly videoCount: number;
  /** Videos excluidos dos agregados por nao terem contagem de visualizacoes. */
  readonly videosWithoutViewCount: number;

  readonly viewCount: {
    /** Soma das contagens disponiveis. */
    readonly total: number | null;
    readonly average: number | null;
    /** Base do score de outlier deste formato. */
    readonly median: number | null;
    readonly minimum: number | null;
    readonly maximum: number | null;
  };

  readonly viewsPerDay: {
    readonly average: number | null;
    readonly median: number | null;
  };

  readonly publicationFrequency: PublicationFrequency;

  readonly outliers: {
    /** Videos com score >= 2.5 — faixas `outlier` e `large_outlier`. */
    readonly count: number;
    /** Videos com score >= 5 — faixa `large_outlier`. */
    readonly largeCount: number;
    /**
     * Videos sem score: sem contagem, ou com mediana indisponivel/zero.
     *
     * Existe por causa da RN-08. Sem este campo, `count: 0` em um canal onde
     * NADA pode ser classificado seria indistinguivel de um canal sem nenhum
     * outlier — duas afirmacoes completamente diferentes.
     */
    readonly unavailableCount: number;
  };

  /** Um item por video, na MESMA ORDEM em que os videos chegaram na entrada. */
  readonly videos: readonly VideoMetrics[];
}

/**
 * Metricas de um canal em uma coleta.
 *
 * `collectedAt` acompanha as metricas (RN-12): um numero sem a data em que foi
 * apurado nao pode ser apresentado ao usuario.
 *
 * Invariante: `shorts.videoCount + long.videoCount + unclassifiedVideoCount`
 * e sempre igual a `totalVideoCount`.
 */
export interface ChannelMetrics {
  readonly collectedAt: Date;
  /** Videos recebidos na entrada, incluindo os nao classificados. */
  readonly totalVideoCount: number;
  /**
   * Videos com `format: 'unknown'`, fora dos dois blocos.
   *
   * Nao sao erro: a coleta usa `'unknown'` quando a duracao nao pode ser obtida,
   * justamente para nao chutar um formato e contaminar a mediana do outro
   * (RN-06). Ficam contados aqui para que a ausencia deles seja visivel.
   */
  readonly unclassifiedVideoCount: number;
  readonly shorts: FormatMetrics;
  readonly long: FormatMetrics;
}
