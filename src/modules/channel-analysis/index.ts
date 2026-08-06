/** Superficie publica do modulo `channel-analysis`. */
export {
  ANALYSIS_STATUSES,
  TERMINAL_ANALYSIS_STATUSES,
  isReusableStatus,
  isTerminalStatus,
  type AnalysisStatus,
} from './domain/analysis-status';
export type { Analysis, AnalysisId, RawSnapshot } from './domain/analysis';
export type {
  AnalysisIdGenerator,
  AnalysisRepository,
} from './application/ports/analysis-repository';
export {
  StartChannelAnalysis,
  type StartChannelAnalysisDependencies,
  type StartChannelAnalysisInput,
} from './application/use-cases/start-channel-analysis';
