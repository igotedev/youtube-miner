import type { VideoFormat } from '@/modules/youtube-collection';

/**
 * Contrato das metricas objetivas — SEM implementacao nesta etapa.
 *
 * O formato do tipo ja codifica tres regras de negocio, para que seja
 * impossivel viola-las depois sem mudar o contrato:
 *
 *  - RN-06: `shorts` e `long` sao blocos separados. Nao existe campo de media
 *    ou mediana no nivel do canal;
 *  - RN-08: todo agregado e `number | null`. Ausencia de dado se representa
 *    como `null`, jamais como `0`;
 *  - RN-04: este tipo descreve METRICAS CALCULADAS. Os dados brutos coletados
 *    ficam em outro campo da analise, e o relatorio de IA em um terceiro.
 */

/** Metricas de um unico formato. Nunca misture dois formatos aqui. */
export interface FormatMetrics {
  readonly format: VideoFormat;
  /** Quantidade de videos considerados. Este campo e contagem, entao 0 e valido. */
  readonly videoCount: number;
  /** Videos descartados do calculo por nao terem contagem de visualizacoes. */
  readonly videosWithoutViewCount: number;
  readonly averageViews: number | null;
  readonly medianViews: number | null;
  readonly minViews: number | null;
  readonly maxViews: number | null;
  /** Media de visualizacoes por dia desde a publicacao. */
  readonly averageViewsPerDay: number | null;
  /** Intervalo medio, em dias, entre publicacoes consecutivas. */
  readonly averageDaysBetweenUploads: number | null;
}

/**
 * Metricas de um canal em uma coleta.
 *
 * `collectedAt` acompanha as metricas (RN-12): um numero sem a data em que foi
 * apurado nao pode ser apresentado ao usuario.
 */
export interface ChannelMetrics {
  readonly collectedAt: Date;
  readonly analyzedVideoCount: number;
  readonly shorts: FormatMetrics;
  readonly long: FormatMetrics;
}

/**
 * Assinatura reservada. Sera implementada na SPEC-003 como funcao pura:
 * mesmas entradas produzem sempre a mesma saida, sem relogio interno nem I/O.
 */
export type CalculateChannelMetrics = (input: {
  readonly videos: readonly {
    readonly publishedAt: Date;
    readonly format: VideoFormat;
    readonly viewCount: number | null;
  }[];
  readonly collectedAt: Date;
}) => ChannelMetrics;
