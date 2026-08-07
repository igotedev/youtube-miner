import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import { calculateMean, calculateMedian } from './statistics';

/**
 * Metricas dependentes do tempo.
 *
 * Nenhuma funcao aqui chama `new Date()`, `Date.now()` ou relogio global. O
 * instante de referencia chega SEMPRE por parametro (`collectedAt`) — RN-12 e
 * RN-13. Sem isso, o mesmo conjunto de videos produziria numeros diferentes a
 * cada execucao e nada disso seria testavel.
 *
 * Toda aritmetica e feita em milissegundos e convertida para dias. Milissegundos
 * sao imunes a horario de verao e a fuso: `getTime()` e um instante absoluto.
 * Contar "dias de calendario" introduziria dias de 23 e 25 horas e quebraria o
 * determinismo.
 */

export const MS_PER_DAY = 86_400_000;

/**
 * Denominador minimo, em dias, para visualizacoes por dia.
 *
 * Decisao registrada na SPEC-003, secao 9. Um video publicado ha 6 minutos com
 * 100 visualizacoes produziria 24.000 visualizacoes/dia — um artefato do
 * denominador minusculo, nao um sinal sobre o canal. Esse valor dominaria
 * qualquer media ou mediana do formato.
 */
export const MIN_EFFECTIVE_AGE_DAYS = 1;

/** Janela usada por `videosLast30Days`. */
export const RECENT_WINDOW_DAYS = 30;

function assertValidDate(
  value: Date,
  reason: 'invalid_collected_at' | 'invalid_published_at',
): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidVideoAnalyticsInputError(reason);
  }
}

export function assertValidCollectedAt(collectedAt: Date): void {
  assertValidDate(collectedAt, 'invalid_collected_at');
}

/**
 * Idade do video em dias FRACIONARIOS.
 *
 * Fracionario de proposito: um video de 36 horas tem 1,5 dia, e truncar para 1
 * inflaria visualizacoes por dia em 50%. O arredondamento pertence a
 * apresentacao.
 *
 * `publishedAt === collectedAt` devolve `0`, que e valido — o video foi
 * publicado no instante da coleta. Quem divide por essa idade usa
 * `MIN_EFFECTIVE_AGE_DAYS`.
 *
 * @throws {InvalidVideoAnalyticsInputError} Data invalida ou publicacao futura.
 */
export function calculateVideoAgeInDays(
  publishedAt: Date,
  collectedAt: Date,
  context: { videoId?: string; index?: number } = {},
): number {
  assertValidDate(publishedAt, 'invalid_published_at');
  assertValidCollectedAt(collectedAt);

  const elapsedMs = collectedAt.getTime() - publishedAt.getTime();

  if (elapsedMs < 0) {
    // Nao e um caso a tolerar: significa relogio errado ou dado corrompido na
    // coleta. Seguir em frente produziria idade negativa e metricas sem sentido.
    throw new InvalidVideoAnalyticsInputError('future_publication_date', context);
  }

  return elapsedMs / MS_PER_DAY;
}

/**
 * Visualizacoes por dia.
 *
 * `viewCount` ausente devolve `null`, nunca `0` (RN-08): visualizacoes ocultas
 * nao sao zero visualizacoes.
 *
 * O denominador e `max(ageInDays, 1)`. Consequencia assumida: para videos com
 * menos de 24 horas o resultado e um PISO — mede o que foi acumulado ate agora
 * espalhado por um dia inteiro, e portanto subestima. Preferivel ao contrario,
 * que colocaria todo video recem-publicado no topo do ranking.
 */
export function calculateViewsPerDay(viewCount: number | null, ageInDays: number): number | null {
  if (viewCount === null) return null;

  if (!Number.isFinite(viewCount) || viewCount < 0) {
    throw new InvalidVideoAnalyticsInputError('invalid_view_count');
  }
  if (!Number.isFinite(ageInDays) || ageInDays < 0) {
    throw new InvalidVideoAnalyticsInputError('invalid_numeric_value');
  }

  return viewCount / Math.max(ageInDays, MIN_EFFECTIVE_AGE_DAYS);
}

/**
 * Extensao temporal do conjunto de videos efetivamente analisado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA SER EXIBIDO.
 *
 * A selecao de videos NAO tem filtro por data: a coleta pega os `MAX_RECENT_VIDEOS`
 * uploads mais recentes, e o periodo resultante e consequencia de quanto o canal
 * publica. Cinquenta videos de um canal diario cobrem sete semanas; de um canal
 * mensal, quatro anos.
 *
 * Sem este campo, os dois casos aparecem na tela como "50 videos analisados" e
 * parecem comparaveis. Nao sao.
 * ---------------------------------------------------------------------------
 */
export interface AnalyzedPeriod {
  /** Publicacao mais antiga do conjunto. `null` quando nao ha video. */
  readonly firstPublishedAt: Date | null;
  /** Publicacao mais recente do conjunto. `null` quando nao ha video. */
  readonly lastPublishedAt: Date | null;
  /**
   * Dias fracionarios entre a primeira e a ultima publicacao.
   *
   * Com UM video o valor e `0`, e isso e um fato, nao uma ausencia: um unico
   * ponto no tempo abrange zero dias. Diferente de `medianIntervalDays`, que e
   * `null` com um video porque nao existe intervalo algum para medir.
   */
  readonly spanInDays: number | null;
}

/**
 * Periodo coberto por um conjunto de publicacoes.
 *
 * Nao recebe `collectedAt`: o periodo descreve o CONJUNTO DE VIDEOS, e nao a
 * distancia ate a coleta. Um video antigo continua no conjunto independentemente
 * de quando alguem resolveu analisar o canal.
 *
 * O array recebido nao e modificado e nao ha ordenacao — um unico percurso basta
 * para achar os extremos. As datas devolvidas sao INSTANCIAS NOVAS: `Date` e
 * mutavel, e devolver as do chamador deixaria a saida do motor alteravel por
 * quem mexesse na entrada depois.
 */
export function calculateAnalyzedPeriod(publishedDates: readonly Date[]): AnalyzedPeriod {
  for (const date of publishedDates) {
    assertValidDate(date, 'invalid_published_at');
  }

  if (publishedDates.length === 0) {
    // Conjunto vazio devolve `null`, nunca datas inventadas nem `0` dias (RN-08).
    return { firstPublishedAt: null, lastPublishedAt: null, spanInDays: null };
  }

  let firstMs = Number.POSITIVE_INFINITY;
  let lastMs = Number.NEGATIVE_INFINITY;

  for (const date of publishedDates) {
    const time = date.getTime();
    if (time < firstMs) firstMs = time;
    if (time > lastMs) lastMs = time;
  }

  return {
    firstPublishedAt: new Date(firstMs),
    lastPublishedAt: new Date(lastMs),
    spanInDays: (lastMs - firstMs) / MS_PER_DAY,
  };
}

export interface PublicationFrequency {
  /**
   * Mediana dos intervalos, em dias. METRICA PRINCIPAL de frequencia: uma pausa
   * extraordinaria de seis meses desloca a media, mas quase nao move a mediana.
   */
  readonly medianIntervalDays: number | null;
  /** Media dos intervalos, em dias. Auxiliar. */
  readonly averageIntervalDays: number | null;
  /** Videos publicados na janela de 30 dias que termina em `collectedAt`. */
  readonly videosLast30Days: number;
}

/**
 * Frequencia de publicacao de UM formato.
 *
 * Com 0 ou 1 video nao existe intervalo algum, e os dois agregados sao `null` —
 * nao `0`. Um canal com um unico video nao publica "a cada zero dias".
 *
 * O array recebido nao e modificado: a ordenacao acontece sobre uma copia.
 */
export function calculatePublicationFrequency(
  publishedDates: readonly Date[],
  collectedAt: Date,
): PublicationFrequency {
  assertValidCollectedAt(collectedAt);

  for (const date of publishedDates) {
    assertValidDate(date, 'invalid_published_at');
  }

  const ascending = [...publishedDates].sort((a, b) => a.getTime() - b.getTime());

  const intervals: number[] = [];
  for (let i = 1; i < ascending.length; i += 1) {
    const previous = ascending[i - 1];
    const current = ascending[i];
    if (previous === undefined || current === undefined) continue;
    // Dois videos no mesmo instante produzem intervalo 0, que e valido.
    intervals.push((current.getTime() - previous.getTime()) / MS_PER_DAY);
  }

  const windowStartMs = collectedAt.getTime() - RECENT_WINDOW_DAYS * MS_PER_DAY;
  const videosLast30Days = ascending.filter((date) => {
    const time = date.getTime();
    // Fronteira inclusiva nos dois lados: exatamente 30 dias entra.
    return time >= windowStartMs && time <= collectedAt.getTime();
  }).length;

  return {
    medianIntervalDays: calculateMedian(intervals),
    averageIntervalDays: calculateMean(intervals),
    videosLast30Days,
  };
}
