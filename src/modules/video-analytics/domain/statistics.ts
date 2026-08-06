import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';

/**
 * Estatistica descritiva. Funcoes puras, internas ao modulo.
 *
 * Todas as grandezas tratadas aqui sao CONTAGENS (visualizacoes) ou DURACOES
 * (dias entre publicacoes). Nenhuma delas pode ser negativa, e por isso a
 * guarda recusa negativos: um numero negativo nesta posicao e sintoma de
 * defeito na coleta, nao um valor a propagar.
 *
 * Nenhuma funcao arredonda. Arredondamento e responsabilidade da apresentacao —
 * arredondar aqui perderia precisao em cadeia (media de medias, score de
 * outlier) sem que ninguem percebesse.
 */

/** Recusa NaN, Infinity e negativos. */
export function assertCountable(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidVideoAnalyticsInputError('invalid_numeric_value');
  }
}

/**
 * Media aritmetica.
 *
 * Conjunto vazio devolve `null`, nunca `0` (RN-08): "nenhum video" e
 * "media zero" sao afirmacoes diferentes sobre o canal.
 */
export function calculateMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  let sum = 0;
  for (const value of values) {
    assertCountable(value);
    sum += value;
  }

  return sum / values.length;
}

/**
 * Mediana.
 *
 * Quantidade impar: valor central. Quantidade par: media dos dois centrais.
 * Conjunto vazio devolve `null`.
 *
 * O array recebido NAO e modificado — `sort` opera sobre uma copia. Ordenar o
 * array do chamador seria um efeito colateral invisivel, e a ordem original dos
 * videos e significativa para o resto do motor.
 */
export function calculateMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  for (const value of values) {
    assertCountable(value);
  }

  // Comparador numerico explicito: o `sort` padrao ordena como texto, e
  // [10, 9, 100] viraria [10, 100, 9].
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;

  return (lower + upper) / 2;
}

/** Soma. Conjunto vazio devolve `null` pelo mesmo motivo da media. */
export function calculateSum(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  let sum = 0;
  for (const value of values) {
    assertCountable(value);
    sum += value;
  }

  return sum;
}

/** Menor valor, ou `null` para conjunto vazio. */
export function findMinimum(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  for (const value of values) assertCountable(value);
  return Math.min(...values);
}

/** Maior valor, ou `null` para conjunto vazio. */
export function findMaximum(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  for (const value of values) assertCountable(value);
  return Math.max(...values);
}
