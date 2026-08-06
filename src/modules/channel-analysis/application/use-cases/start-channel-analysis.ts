import type { UserId } from '@/modules/identity';
import type { ChannelResolver, YouTubeChannelSource } from '@/modules/youtube-collection';
import { MAX_RECENT_VIDEOS } from '@/modules/youtube-collection';
import type { Clock } from '@/shared/domain';
import type { Logger } from '@/shared/observability';

import type { Analysis } from '../../domain/analysis';
import type { AnalysisStatus } from '../../domain/analysis-status';
import type { AnalysisIdGenerator, AnalysisRepository } from '../ports/analysis-repository';

/**
 * Caso de uso: iniciar a analise de um canal.
 *
 * ESCOPO DESTA ETAPA — leia antes de mexer.
 *
 * Este e o fluxo vertical que valida a arquitetura em execucao: presentation
 * chamaria este caso de uso, que so conhece PORTAS, e adaptadores concretos
 * (reais ou falsos) sao injetados de fora. Nada aqui importa a YouTube Data
 * API, Supabase ou Claude.
 *
 * Ele percorre `pending` -> `collecting_channel` -> `collecting_videos` e PARA.
 * Nao vai ate `completed` de proposito: `calculating_metrics` depende do motor
 * de metricas (SPEC-003) e `generating_insights` depende do adaptador Claude —
 * nenhum dos dois existe. Fingir que passou por essas etapas produziria uma
 * analise mentirosa.
 *
 * Quando a SPEC-003 chegar, as etapas seguintes entram aqui, e a falha da IA
 * devera levar a `partially_completed`, nunca a `failed` (RN-09).
 */

export interface StartChannelAnalysisInput {
  readonly requestedBy: UserId;
  readonly channelUrl: string;
}

export interface StartChannelAnalysisDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ids: AnalysisIdGenerator;
  readonly channelResolver: ChannelResolver;
  readonly channelSource: YouTubeChannelSource;
  readonly analyses: AnalysisRepository;
}

export class StartChannelAnalysis {
  constructor(private readonly deps: StartChannelAnalysisDependencies) {}

  async execute(input: StartChannelAnalysisInput): Promise<Analysis> {
    const { clock, logger, ids, channelResolver, channelSource, analyses } = this.deps;

    const channelId = await channelResolver.resolveChannelId(input.channelUrl);

    // RN-12: o carimbo vem do relogio injetado, nunca de `new Date()`.
    const startedAt = clock.now();
    const id = ids.next();

    let analysis: Analysis = {
      id,
      requestedBy: input.requestedBy,
      channelId,
      requestedUrl: input.channelUrl,
      status: 'pending',
      createdAt: startedAt,
      rawSnapshot: null,
      metrics: null,
      insight: null,
      failureReason: null,
    };

    const advance = async (status: AnalysisStatus, patch: Partial<Analysis> = {}) => {
      analysis = { ...analysis, ...patch, status };
      await analyses.save(analysis);
      logger.info('analise avancou de estado', { analysisId: id, status });
    };

    await advance('pending');

    await advance('collecting_channel');
    const channel = await channelSource.fetchChannel(channelId);

    const videos = await channelSource.fetchRecentVideos(channelId, MAX_RECENT_VIDEOS);
    await advance('collecting_videos', {
      // RN-04: o bruto entra em `rawSnapshot`. `metrics` continua null — nao ha
      // calculo nesta etapa, e null aqui significa "ainda nao apurado", nao zero.
      rawSnapshot: { channel, videos, collectedAt: clock.now() },
    });

    return analysis;
  }
}
