import { beforeEach, describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { AnalyticsResult, AnalyticsResultId, ChannelMetrics } from '@/modules/video-analytics';
import { ANALYTICS_ALGORITHM_VERSION } from '@/modules/video-analytics';
import { InMemoryAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/memory/in-memory-analytics-result-repository';
import type { CollectionRunId } from '@/modules/youtube-collection';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { InMemoryAnalysisRepository } from '../../infrastructure/memory/in-memory-analysis-repository';
import { GetAnalysisMetrics } from './get-analysis-metrics';

const OWNER = 'user-owner' as UserId;
const STRANGER = 'user-stranger' as UserId;
const ANALYSIS_ID = 'analysis-1' as AnalysisId;
const RESULT_ID = 'result-1' as AnalyticsResultId;
const RUN_ID = 'run-1' as CollectionRunId;

const COLLECTED_AT = new Date('2026-07-30T12:00:00.000Z');
const CALCULATED_AT = new Date('2026-07-30T18:30:00.000Z');

/** Metricas minimas: o que importa aqui e o roteamento, nao os numeros. */
const EMPTY_FORMAT = {
  videoCount: 0,
  videosWithoutViewCount: 0,
  analyzedPeriod: { firstPublishedAt: null, lastPublishedAt: null, spanInDays: null },
  viewCount: { total: null, average: null, median: null, minimum: null, maximum: null },
  viewsPerDay: { average: null, median: null },
  publicationFrequency: {
    medianIntervalDays: null,
    averageIntervalDays: null,
    videosLast30Days: 0,
  },
  outliers: { count: 0, largeCount: 0, unavailableCount: 0 },
  videos: [],
} as const;

const METRICS: ChannelMetrics = {
  collectedAt: COLLECTED_AT,
  totalVideoCount: 0,
  unclassifiedVideoCount: 0,
  shorts: { format: 'short', ...EMPTY_FORMAT },
  long: { format: 'long', ...EMPTY_FORMAT },
};

function buildAnalysis(patch: Partial<Analysis> = {}): Analysis {
  return {
    id: ANALYSIS_ID,
    requestedBy: OWNER,
    channelId: 'UC_fixture_channel_00000' as Analysis['channelId'],
    requestedUrl: 'https://www.youtube.com/@canal-de-exemplo',
    status: 'partially_completed',
    collectionRunId: RUN_ID,
    analyticsResultId: RESULT_ID,
    idempotencyKey: null,
    requestedAt: COLLECTED_AT,
    startedAt: COLLECTED_AT,
    completedAt: CALCULATED_AT,
    failedAt: null,
    errorCode: null,
    ...patch,
  };
}

const RESULT: AnalyticsResult = {
  id: RESULT_ID,
  collectionRunId: RUN_ID,
  algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
  calculatedAt: CALCULATED_AT,
  metrics: METRICS,
};

let analyses: InMemoryAnalysisRepository;
let analyticsResults: InMemoryAnalyticsResultRepository;
let query: GetAnalysisMetrics;

beforeEach(() => {
  analyses = new InMemoryAnalysisRepository();
  analyticsResults = new InMemoryAnalyticsResultRepository();
  query = new GetAnalysisMetrics({ analyses, analyticsResults });
});

describe('GetAnalysisMetrics', () => {
  it('devolve a analise com as metricas e a data do calculo', async () => {
    await analyses.create(buildAnalysis());
    await analyticsResults.save(RESULT);

    const view = await query.execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    expect(view.analysis.id).toBe(ANALYSIS_ID);
    expect(view.metrics).toEqual(METRICS);
    expect(view.calculatedAt).toEqual(CALCULATED_AT);
  });

  it('mantem as duas datas distintas: coleta e calculo', async () => {
    await analyses.create(buildAnalysis());
    await analyticsResults.save(RESULT);

    const view = await query.execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    expect(view.metrics?.collectedAt).toEqual(COLLECTED_AT);
    expect(view.calculatedAt).toEqual(CALCULATED_AT);
    expect(view.calculatedAt).not.toEqual(view.metrics?.collectedAt);
  });

  it('devolve `null` — nao zeros — quando a analise ainda nao calculou', async () => {
    await analyses.create(buildAnalysis({ status: 'collecting_videos', analyticsResultId: null }));

    const view = await query.execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    expect(view.metrics).toBeNull();
    expect(view.calculatedAt).toBeNull();
    expect(view.analysis.status).toBe('collecting_videos');
  });

  it('devolve `null` quando o resultado apontado nao existe', async () => {
    // Vinculo apontando para o vazio: nao invento metricas nem estouro.
    await analyses.create(buildAnalysis());

    const view = await query.execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    expect(view.metrics).toBeNull();
    expect(view.calculatedAt).toBeNull();
  });

  it('trata a analise de outro usuario como inexistente', async () => {
    await analyses.create(buildAnalysis());
    await analyticsResults.save(RESULT);

    // NotFound, e nao erro de permissao: este ultimo ja revelaria que ela existe.
    await expect(query.execute({ analysisId: ANALYSIS_ID, requestedBy: STRANGER })).rejects.toThrow(
      'Analise nao encontrada.',
    );
  });

  it('recusa analise inexistente', async () => {
    await expect(
      query.execute({ analysisId: 'nao-existe' as AnalysisId, requestedBy: OWNER }),
    ).rejects.toThrow('Analise nao encontrada.');
  });
});
