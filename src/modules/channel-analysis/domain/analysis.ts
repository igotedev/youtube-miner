import type { UserId } from '@/modules/identity';
import type { InsightReport } from '@/modules/ai-insights';
import type { ChannelMetrics } from '@/modules/video-analytics';
import type { YouTubeChannel, YouTubeChannelId, YouTubeVideo } from '@/modules/youtube-collection';
import type { Brand } from '@/shared/domain';

import type { AnalysisStatus } from './analysis-status';

export type AnalysisId = Brand<string, 'AnalysisId'>;

/**
 * Dados publicos exatamente como foram coletados, sem transformacao.
 *
 * RN-04: separado das metricas. Se a regra de calculo mudar amanha, o snapshot
 * permite recalcular sem gastar quota da API de novo.
 */
export interface RawSnapshot {
  readonly channel: YouTubeChannel;
  readonly videos: readonly YouTubeVideo[];
  readonly collectedAt: Date;
}

/**
 * Uma analise de um canal em um instante.
 *
 * RN-03: um mesmo canal pode ter varias analises em datas diferentes; por isso
 * `channelId` nao e a chave, `id` e.
 *
 * Os tres corpos de dados sao campos IRMAOS e independentes, e essa separacao e
 * intencional:
 *  - `rawSnapshot` — o que o YouTube devolveu (RN-04);
 *  - `metrics`     — o que o sistema calculou (RN-04, RN-13);
 *  - `insight`     — o que a IA escreveu (RN-05).
 *
 * Cada um e `null` ate a sua etapa terminar. `insight` pode permanecer `null`
 * em uma analise valida (RN-09).
 */
export interface Analysis {
  readonly id: AnalysisId;
  readonly requestedBy: UserId;
  readonly channelId: YouTubeChannelId;
  /** URL que o usuario digitou. Guardada por rastreabilidade, nunca como chave (RN-02). */
  readonly requestedUrl: string;
  readonly status: AnalysisStatus;
  readonly createdAt: Date;
  readonly rawSnapshot: RawSnapshot | null;
  readonly metrics: ChannelMetrics | null;
  readonly insight: InsightReport | null;
  /** Preenchido apenas quando `status` e `failed` ou `partially_completed`. */
  readonly failureReason: string | null;
}
