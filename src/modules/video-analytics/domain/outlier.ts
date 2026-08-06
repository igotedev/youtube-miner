/**
 * Contrato da regra de outliers — SEM implementacao nesta etapa.
 *
 * A SPEC define a primeira versao como:
 *
 *   outlierScore = visualizacoes do video / mediana de visualizacoes do formato
 *
 * Duas condicoes que a implementacao futura tera de respeitar:
 *  - RN-06: Shorts e videos longos usam medianas SEPARADAS. Nunca uma mediana
 *    unica do canal;
 *  - RN-08: video sem contagem de visualizacoes nao recebe score 0; recebe
 *    `null` e fica fora do calculo da mediana.
 *
 * O calculo em si sera escrito na SPEC-003, como funcao pura e testada.
 */

export type OutlierBand = 'normal' | 'above_normal' | 'outlier' | 'large_outlier';

/**
 * Limites inferiores de cada faixa, conforme a SPEC:
 *  - score < 1.5            -> normal
 *  - 1.5 <= score < 2.5     -> above_normal
 *  - 2.5 <= score < 5.0     -> outlier
 *  - score >= 5.0           -> large_outlier
 */
export const OUTLIER_THRESHOLDS = {
  aboveNormal: 1.5,
  outlier: 2.5,
  largeOutlier: 5,
} as const;

/**
 * Assinatura reservada. Sera implementada na SPEC-003 como funcao pura.
 *
 * @param outlierScore razao entre as visualizacoes do video e a mediana do seu
 *   formato. Deve ser finito e nao negativo.
 */
export type ClassifyOutlier = (outlierScore: number) => OutlierBand;
