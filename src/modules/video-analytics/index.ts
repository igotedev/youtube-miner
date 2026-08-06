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
export type { PublicationFrequency } from './domain/publication-timing';

// --- Regra de outliers ---
export { OUTLIER_THRESHOLDS, classifyOutlier, type OutlierBand } from './domain/outlier';

// --- Erro ---
export {
  InvalidVideoAnalyticsInputError,
  type InvalidVideoAnalyticsInputReason,
} from './domain/errors/invalid-video-analytics-input';
