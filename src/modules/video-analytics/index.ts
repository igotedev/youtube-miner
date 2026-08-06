/**
 * Superficie publica do modulo `video-analytics`.
 *
 * So contratos nesta etapa. O motor de calculo chega na SPEC-003.
 */
export { OUTLIER_THRESHOLDS, type ClassifyOutlier, type OutlierBand } from './domain/outlier';
export type {
  CalculateChannelMetrics,
  ChannelMetrics,
  FormatMetrics,
} from './domain/channel-metrics';
