import { describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import { ANALYTICS_ALGORITHM_VERSION } from '@/modules/video-analytics';
import { InMemoryAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/memory/in-memory-analytics-result-repository';
import type { CollectionRunId } from '@/modules/youtube-collection';
import {
  createFakeChannelResolver,
  createFakeYouTubeChannelSource,
  fakeFixture,
} from '@/modules/youtube-collection/infrastructure/fake/fake-youtube-source';
import { InMemoryCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/memory/in-memory-collection-run-repository';
import type { Clock, UuidGenerator } from '@/shared/domain';
import { DomainError, NotFoundError } from '@/shared/errors';
import { noopLogger } from '@/shared/observability';

import { InMemoryAnalysisRepository } from '../../infrastructure/memory/in-memory-analysis-repository';
import type { AnalysisId } from '../../domain/analysis';
import { CalculateAnalysisMetrics } from './calculate-analysis-metrics';
import { StartChannelAnalysis } from './start-channel-analysis';

const FIXED_NOW = new Date('2026-08-06T10:30:00.000Z');
const MS_PER_HOUR = 3_600_000;

function sequentialIds(): UuidGenerator {
  let n = 0;
  return { next: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}

/** Monta os dois casos de uso sobre os mesmos repositorios. */
function buildPipeline() {
  let current = FIXED_NOW;
  const clock: Clock = { now: () => current };

  const analyses = new InMemoryAnalysisRepository();
  const collectionRuns = new InMemoryCollectionRunRepository();
  const analyticsResults = new InMemoryAnalyticsResultRepository();
  const ids = sequentialIds();

  const start = new StartChannelAnalysis({
    clock,
    logger: noopLogger,
    ids,
    channelResolver: createFakeChannelResolver(),
    channelSource: createFakeYouTubeChannelSource(),
    analyses,
    collectionRuns,
    analysisFreshnessHours: 24,
  });

  const calculate = new CalculateAnalysisMetrics({
    clock,
    logger: noopLogger,
    ids,
    analyses,
    collectionRuns,
    analyticsResults,
  });

  return {
    start,
    calculate,
    analyses,
    collectionRuns,
    analyticsResults,
    advanceHours: (hours: number) => {
      current = new Date(current.getTime() + hours * MS_PER_HOUR);
    },
  };
}

const OWNER = 'user_1' as UserId;
const INPUT = { requestedBy: OWNER, channelUrl: 'https://www.youtube.com/@canal-de-exemplo' };

describe('pipeline completo', () => {
  it('leva a analise de collecting_videos ate partially_completed', async () => {
    const { start, calculate } = buildPipeline();

    const started = await start.execute(INPUT);
    expect(started.status).toBe('collecting_videos');

    const finished = await calculate.execute({
      analysisId: started.id,
      requestedBy: OWNER,
    });

    // `partially_completed`, nao `completed`: os numeros estao corretos e nao ha
    // relatorio de IA, que e exatamente a definicao do estado na SPEC-001.
    expect(finished.status).toBe('partially_completed');
    expect(finished.analyticsResultId).not.toBeNull();
    expect(finished.completedAt).toEqual(FIXED_NOW);
  });

  it('persiste as metricas ligadas a coleta e a versao do algoritmo', async () => {
    const { start, calculate, analyticsResults } = buildPipeline();

    const started = await start.execute(INPUT);
    const finished = await calculate.execute({ analysisId: started.id, requestedBy: OWNER });

    const result = await analyticsResults.findByCollectionRunAndVersion(
      started.collectionRunId as CollectionRunId,
      ANALYTICS_ALGORITHM_VERSION,
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe(finished.analyticsResultId);
    expect(result?.algorithmVersion).toBe(ANALYTICS_ALGORITHM_VERSION);
  });

  it('carimba as metricas com o instante da captura, nao com o do calculo', async () => {
    // RN-12: as metricas descrevem o canal como ele estava quando os dados foram
    // lidos da API. Usar o momento do calculo produziria idades erradas.
    const { start, calculate, analyticsResults, advanceHours } = buildPipeline();

    const started = await start.execute(INPUT);
    advanceHours(5);
    const finished = await calculate.execute({ analysisId: started.id, requestedBy: OWNER });

    const result = await analyticsResults.findById(
      finished.analyticsResultId as NonNullable<typeof finished.analyticsResultId>,
    );

    expect(result?.metrics.collectedAt).toEqual(FIXED_NOW);
    expect(result?.calculatedAt).toEqual(new Date(FIXED_NOW.getTime() + 5 * MS_PER_HOUR));
  });

  it('separa Shorts e videos longos no resultado persistido (RN-06)', async () => {
    const { start, calculate, analyticsResults } = buildPipeline();

    const started = await start.execute(INPUT);
    const finished = await calculate.execute({ analysisId: started.id, requestedBy: OWNER });
    const result = await analyticsResults.findById(
      finished.analyticsResultId as NonNullable<typeof finished.analyticsResultId>,
    );

    const shorts = result?.metrics.shorts.videoCount ?? 0;
    const long = result?.metrics.long.videoCount ?? 0;
    const unclassified = result?.metrics.unclassifiedVideoCount ?? 0;

    expect(shorts).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(0);
    expect(shorts + long + unclassified).toBe(fakeFixture.videos.length);
  });

  it('preserva a ausencia de contagem sem transformar em zero (RN-08)', async () => {
    // O fixture tem um video sem viewCount.
    const { start, calculate, analyticsResults } = buildPipeline();

    const started = await start.execute(INPUT);
    const finished = await calculate.execute({ analysisId: started.id, requestedBy: OWNER });
    const result = await analyticsResults.findById(
      finished.analyticsResultId as NonNullable<typeof finished.analyticsResultId>,
    );

    const allVideos = [
      ...(result?.metrics.shorts.videos ?? []),
      ...(result?.metrics.long.videos ?? []),
    ];
    expect(allVideos.map((v) => v.viewsPerDay)).toContain(null);
  });
});

describe('reuso do calculo entre usuarios', () => {
  it('nao recalcula quando outro usuario ja calculou a mesma coleta', async () => {
    // O motor e deterministico: mesma coleta e mesma versao dao resultado
    // identico. Recalcular queimaria CPU para chegar ao mesmo numero.
    const { start, calculate, analyticsResults } = buildPipeline();

    const first = await start.execute(INPUT);
    await calculate.execute({ analysisId: first.id, requestedBy: OWNER });
    expect(analyticsResults.saveCount).toBe(1);

    const other = 'user_2' as UserId;
    const second = await start.execute({ ...INPUT, requestedBy: other });
    const finished = await calculate.execute({ analysisId: second.id, requestedBy: other });

    expect(analyticsResults.saveCount).toBe(1);
    expect(finished.status).toBe('partially_completed');
  });

  it('as duas analises apontam para o mesmo resultado', async () => {
    const { start, calculate } = buildPipeline();
    const other = 'user_2' as UserId;

    const a = await calculate.execute({
      analysisId: (await start.execute(INPUT)).id,
      requestedBy: OWNER,
    });
    const b = await calculate.execute({
      analysisId: (await start.execute({ ...INPUT, requestedBy: other })).id,
      requestedBy: other,
    });

    expect(b.analyticsResultId).toBe(a.analyticsResultId);
    expect(b.id).not.toBe(a.id);
  });
});

describe('reentrancia e isolamento', () => {
  it('chamar de novo uma analise encerrada nao recalcula nem muda o estado', async () => {
    const { start, calculate, analyticsResults } = buildPipeline();

    const started = await start.execute(INPUT);
    const first = await calculate.execute({ analysisId: started.id, requestedBy: OWNER });
    const second = await calculate.execute({ analysisId: started.id, requestedBy: OWNER });

    expect(second).toEqual(first);
    expect(analyticsResults.saveCount).toBe(1);
  });

  it('nao calcula a analise de outro usuario', async () => {
    const { start, calculate } = buildPipeline();

    const started = await start.execute(INPUT);

    await expect(
      calculate.execute({ analysisId: started.id, requestedBy: 'user_2' as UserId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recusa uma analise inexistente', async () => {
    const { calculate } = buildPipeline();

    await expect(
      calculate.execute({
        analysisId: '00000000-0000-4000-8000-999999999999' as AnalysisId,
        requestedBy: OWNER,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('etapas fora de ordem', () => {
  it('recusa calcular antes de a coleta terminar', async () => {
    const { calculate, analyses } = buildPipeline();

    await analyses.create({
      id: 'analysis_pendente' as AnalysisId,
      requestedBy: OWNER,
      channelId: fakeFixture.channelId,
      requestedUrl: INPUT.channelUrl,
      status: 'pending',
      collectionRunId: null,
      analyticsResultId: null,
      idempotencyKey: null,
      requestedAt: FIXED_NOW,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorCode: null,
    });

    await expect(
      calculate.execute({ analysisId: 'analysis_pendente' as AnalysisId, requestedBy: OWNER }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('recusa analise em collecting_videos sem coleta vinculada', async () => {
    const { calculate, analyses } = buildPipeline();

    await analyses.create({
      id: 'analysis_orfa' as AnalysisId,
      requestedBy: OWNER,
      channelId: fakeFixture.channelId,
      requestedUrl: INPUT.channelUrl,
      status: 'collecting_videos',
      collectionRunId: null,
      analyticsResultId: null,
      idempotencyKey: null,
      requestedAt: FIXED_NOW,
      startedAt: FIXED_NOW,
      completedAt: null,
      failedAt: null,
      errorCode: null,
    });

    await expect(
      calculate.execute({ analysisId: 'analysis_orfa' as AnalysisId, requestedBy: OWNER }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('falha no calculo', () => {
  it('marca a analise como failed e registra o codigo do erro', async () => {
    // Coleta concluida mas sem snapshot guardado: o calculo nao tem sobre o que
    // trabalhar. Falha objetiva, diferente da falha da IA (RN-09).
    const { calculate, analyses, collectionRuns } = buildPipeline();
    const runId = 'run_sem_snapshot' as CollectionRunId;

    await collectionRuns.startRun({
      id: runId,
      channelId: fakeFixture.channelId,
      status: 'pending',
      requestedAt: FIXED_NOW,
      startedAt: FIXED_NOW,
      capturedAt: null,
      completedAt: null,
      failedAt: null,
      reusableUntil: null,
      errorCode: null,
      invalidatedAt: null,
    });

    const analysisId = 'analysis_falha' as AnalysisId;
    await analyses.create({
      id: analysisId,
      requestedBy: OWNER,
      channelId: fakeFixture.channelId,
      requestedUrl: INPUT.channelUrl,
      status: 'collecting_videos',
      collectionRunId: runId,
      analyticsResultId: null,
      idempotencyKey: null,
      requestedAt: FIXED_NOW,
      startedAt: FIXED_NOW,
      completedAt: null,
      failedAt: null,
      errorCode: null,
    });

    await expect(calculate.execute({ analysisId, requestedBy: OWNER })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const failed = await analyses.findById(analysisId, OWNER);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('NOT_FOUND');
    expect(failed?.failedAt).toEqual(FIXED_NOW);
    // Nao inventa um vinculo com metricas que nao existem.
    expect(failed?.analyticsResultId).toBeNull();
  });
});
