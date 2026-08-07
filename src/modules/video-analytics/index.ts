/**
 * Superficie publica do modulo `video-analytics`.
 *
 * Exporta o motor, os tipos de entrada e saida e o erro publico. As funcoes
 * estatisticas (`calculateMean`, `calculateMedian`) e as de tempo permanecem
 * INTERNAS: nenhum outro modulo tem caso de uso para elas, e exporta-las
 * transformaria detalhe de implementacao em contrato.
 */

// --- Motor ---
export { calculateChannelMetrics } from './domain/calculate-channel-metrics';

// --- Entrada ---
export {
  ANALYZABLE_FORMATS,
  type AnalyticsVideo,
  type AnalyzableVideoFormat,
  type CalculateChannelMetricsInput,
} from './domain/analytics-video';

// --- Saida ---
export type { ChannelMetrics, FormatMetrics, VideoMetrics } from './domain/channel-metrics';
export { calculateAnalyzedPeriod } from './domain/publication-timing';
export type { AnalyzedPeriod, PublicationFrequency } from './domain/publication-timing';

// --- Periodo pedido (SPEC-003, secao 11-B) ---
export {
  createAnalysisPeriod,
  filterByPeriod,
  isWithinPeriod,
  periodLengthInDays,
  type AnalysisPeriod,
} from './domain/analysis-period';

// --- Resultado persistivel (SPEC-004) ---
export {
  ANALYTICS_ALGORITHM_VERSION,
  type AnalyticsResult,
  type AnalyticsResultId,
} from './domain/analytics-result';
export type { AnalyticsResultRepository } from './application/ports/analytics-result-repository';

// --- Regra de outliers ---
export { OUTLIER_THRESHOLDS, classifyOutlier, type OutlierBand } from './domain/outlier';

// --- Erro ---
export {
  InvalidVideoAnalyticsInputError,
  type InvalidVideoAnalyticsInputReason,
} from './domain/errors/invalid-video-analytics-input';
