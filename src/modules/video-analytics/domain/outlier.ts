/**
 * Regra de outliers — primeira versao, definida na SPEC-001 e implementada na
 * SPEC-003.
 *
 *   outlierScore = visualizacoes do video / mediana de visualizacoes do formato
 *
 * Duas condicoes de contorno que o motor respeita:
 *  - RN-06: Shorts e videos longos usam medianas SEPARADAS. A mediana chega por
 *    parametro justamente para tornar impossivel usar a do outro formato;
 *  - RN-08: video sem contagem de visualizacoes nao recebe score 0; recebe
 *    `null` e fica fora do calculo da mediana.
 */

export type OutlierBand = 'normal' | 'above_normal' | 'outlier' | 'large_outlier';

/**
 * Limites INFERIORES de cada faixa:
 *  - score < 1.5          -> normal
 *  - 1.5 <= score < 2.5   -> above_normal
 *  - 2.5 <= score < 5.0   -> outlier
 *  - score >= 5.0         -> large_outlier
 */
export const OUTLIER_THRESHOLDS = {
  aboveNormal: 1.5,
  outlier: 2.5,
  largeOutlier: 5,
} as const;

/**
 * Razao entre as visualizacoes do video e a mediana do seu formato.
 *
 * Devolve `null` — indisponivel, nunca `0` nem `Infinity` — quando:
 *  - `viewCount` e `null`: o dado nao existe;
 *  - `median` e `null`: nenhum video do formato tem contagem;
 *  - `median` e `0`: ver a nota abaixo.
 *
 * MEDIANA ZERO. A tentacao e dizer que um video com 100 visualizacoes contra uma
 * mediana 0 e um outlier gigantesco. Mas a regra atual mede "quantas vezes o
 * tipico" — e quando o tipico e zero, nao ha razao definida: qualquer valor
 * positivo daria `Infinity`, e a classificacao deixaria de significar alguma
 * coisa. Devolver `null` e a leitura honesta: a regra nao se aplica a esse
 * canal. Uma estrategia alternativa (media, percentil, suavizacao) exige SPEC
 * propria e nao foi inventada aqui.
 */
export function calculateOutlierScore(
  viewCount: number | null,
  medianViews: number | null,
): number | null {
  if (viewCount === null || medianViews === null || medianViews === 0) {
    return null;
  }
  return viewCount / medianViews;
}

/**
 * Faixa de um score.
 *
 * O score NAO e arredondado antes da comparacao: 1.4999 e `normal`, e nao
 * `above_normal`. Arredondar antes moveria a fronteira e tornaria a
 * classificacao dependente do numero de casas escolhido para exibir.
 *
 * `null` (indisponivel) permanece `null` — nao existe faixa "sem dado", e
 * inventar uma obrigaria todo consumidor a tratar um valor que nao e uma faixa.
 */
export function classifyOutlier(outlierScore: number | null): OutlierBand | null {
  if (outlierScore === null) return null;

  if (outlierScore >= OUTLIER_THRESHOLDS.largeOutlier) return 'large_outlier';
  if (outlierScore >= OUTLIER_THRESHOLDS.outlier) return 'outlier';
  if (outlierScore >= OUTLIER_THRESHOLDS.aboveNormal) return 'above_normal';
  return 'normal';
}
