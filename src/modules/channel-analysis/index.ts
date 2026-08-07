/** Superficie publica do modulo `channel-analysis`. */
export {
  ANALYSIS_STATUSES,
  TERMINAL_ANALYSIS_STATUSES,
  canCalculateMetrics,
  isReusableStatus,
  isTerminalStatus,
  type AnalysisStatus,
} from './domain/analysis-status';
export type { Analysis, AnalysisId } from './domain/analysis';
export type { AnalysisRepository } from './application/ports/analysis-repository';
export {
  StartChannelAnalysis,
  type StartChannelAnalysisDependencies,
  type StartChannelAnalysisInput,
} from './application/use-cases/start-channel-analysis';
export {
  CalculateAnalysisMetrics,
  type CalculateAnalysisMetricsDependencies,
  type CalculateAnalysisMetricsInput,
} from './application/use-cases/calculate-analysis-metrics';
export {
  GetAnalysisMetrics,
  type AnalysisMetricsView,
  type GetAnalysisMetricsDependencies,
  type GetAnalysisMetricsInput,
} from './application/queries/get-analysis-metrics';
