import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import { MS_PER_DAY } from './publication-timing';

/**
 * Intervalo de tempo escolhido por quem pede a analise.
 *
 * ---------------------------------------------------------------------------
 * NAO CONFUNDIR COM `AnalyzedPeriod`.
 *
 *  - `AnalysisPeriod`  — o que foi PEDIDO. Entra na consulta, filtra videos.
 *  - `AnalyzedPeriod`  — o que foi ENCONTRADO. Sai do motor, descreve os videos
 *                        que sobraram.
 *
 * Sao coisas diferentes e precisam aparecer separadas na tela: pedir janeiro
 * inteiro e encontrar videos so entre os dias 5 e 28 e normal, e fundir os dois
 * faria o usuario achar que o canal publicou no dia 1o.
 * ---------------------------------------------------------------------------
 *
 * As duas bordas sao INSTANTES ABSOLUTOS, nao datas de calendario. Quem recebe
 * `2026-01-31` da interface e responsavel por transformar em fim do dia antes de
 * chegar aqui — o dominio nao conhece formato de entrada nem fuso do leitor.
 */
export interface AnalysisPeriod {
  readonly start: Date;
  readonly end: Date;
}

function assertValidBoundary(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidVideoAnalyticsInputError('invalid_analysis_period');
  }
}

/**
 * Constroi um periodo valido.
 *
 * @throws {InvalidVideoAnalyticsInputError} Borda invalida, ou inicio depois do
 *   fim. Um intervalo invertido nao seleciona nada, e devolver "nenhum video
 *   encontrado" esconderia um erro de digitacao do usuario atras de um resultado
 *   que parece legitimo.
 */
export function createAnalysisPeriod(start: Date, end: Date): AnalysisPeriod {
  assertValidBoundary(start);
  assertValidBoundary(end);

  if (start.getTime() > end.getTime()) {
    throw new InvalidVideoAnalyticsInputError('invalid_analysis_period');
  }

  // Copias: `Date` e mutavel, e um periodo que muda depois de validado nao e um
  // periodo validado.
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/**
 * O instante esta dentro do periodo?
 *
 * FRONTEIRA INCLUSIVA NOS DOIS LADOS, seguindo a regra que a janela de 30 dias
 * ja usa (`calculatePublicationFrequency`). Um video publicado exatamente na
 * data inicial ou na final ENTRA — que e o que qualquer pessoa espera ao digitar
 * `01/01 a 31/01`.
 */
export function isWithinPeriod(instant: Date, period: AnalysisPeriod): boolean {
  const time = instant.getTime();
  return time >= period.start.getTime() && time <= period.end.getTime();
}

/**
 * Duracao do periodo em dias fracionarios.
 *
 * Um periodo de um unico dia — `00:00:00.000` a `23:59:59.999` — mede
 * 0,99999 dia, e nao 1. Quem exibe arredonda; o dominio nao inventa precisao que
 * nao tem.
 */
export function periodLengthInDays(period: AnalysisPeriod): number {
  return (period.end.getTime() - period.start.getTime()) / MS_PER_DAY;
}

/**
 * Videos publicados dentro do periodo, preservando a ordem de entrada.
 *
 * `publishedAt` e o campo que decide, porque e o unico dado temporal que a
 * coleta tem por video — ver a nota em `YouTubeVideo`. Nao existe "data de
 * visualizacao" nem historico: um video de 2019 dentro do periodo entra com o
 * `viewCount` ACUMULADO de toda a vida dele, e a tela precisa dizer isso.
 */
export function filterByPeriod<T extends { readonly publishedAt: Date }>(
  videos: readonly T[],
  period: AnalysisPeriod,
): readonly T[] {
  return videos.filter((video) => isWithinPeriod(video.publishedAt, period));
}
