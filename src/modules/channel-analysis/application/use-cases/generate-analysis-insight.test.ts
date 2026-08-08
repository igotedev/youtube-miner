import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeneratedInsight, InsightGenerator } from '@/modules/ai-insights';
import { createFakeInsightGenerator } from '@/modules/ai-insights/infrastructure/fake/fake-insight-generator';
import { InMemoryInsightReportRepository } from '@/modules/ai-insights/infrastructure/memory/in-memory-insight-report-repository';
import type { UserId } from '@/modules/identity';
import type { AnalyticsResult, AnalyticsResultId } from '@/modules/video-analytics';
import { ANALYTICS_ALGORITHM_VERSION, calculateChannelMetrics } from '@/modules/video-analytics';
import { InMemoryAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/memory/in-memory-analytics-result-repository';
import type {
  CollectionRunId,
  YouTubeChannelId,
  YouTubeVideo,
  YouTubeVideoId,
} from '@/modules/youtube-collection';
import { InMemoryCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/memory/in-memory-collection-run-repository';
import { ExternalServiceError } from '@/shared/errors';
import { noopLogger } from '@/shared/observability';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { InMemoryAnalysisRepository } from '../../infrastructure/memory/in-memory-analysis-repository';
import { GenerateAnalysisInsight } from './generate-analysis-insight';

/**
 * O relatorio de IA (SPEC-011).
 *
 * O que estes testes travam nao e o texto — e o COMPORTAMENTO EM VOLTA dele:
 * a ordem dos estados, o fato de a falha nao destruir as metricas, e a
 * idempotencia, que aqui protege dinheiro e nao so quota.
 */

const OWNER = 'user-owner' as UserId;
const STRANGER = 'user-stranger' as UserId;
const ANALYSIS_ID = 'analysis-1' as AnalysisId;
const RESULT_ID = 'result-1' as AnalyticsResultId;
const RUN_ID = 'run-1' as CollectionRunId;
const CHANNEL_ID = 'UC_fixture_channel_00000' as YouTubeChannelId;

const COLLECTED_AT = new Date('2026-07-30T12:00:00.000Z');
const FIXED_NOW = new Date('2026-08-01T09:00:00.000Z');

const clock = { now: () => FIXED_NOW };

function sequentialIds() {
  let next = 0;
  return {
    next: () => {
      next += 1;
      return `id-${next}`;
    },
  };
}

const VIDEO: YouTubeVideo = {
  id: 'vid-1' as YouTubeVideoId,
  channelId: CHANNEL_ID,
  title: 'Um titulo qualquer',
  publishedAt: new Date('2026-07-20T12:00:00.000Z'),
  durationSeconds: 600,
  format: 'long',
  viewCount: 100,
  likeCount: null,
  commentCount: null,
};

function buildAnalysis(patch: Partial<Analysis> = {}): Analysis {
  return {
    id: ANALYSIS_ID,
    requestedBy: OWNER,
    channelId: CHANNEL_ID,
    requestedUrl: 'https://www.youtube.com/@canal-de-exemplo',
    status: 'partially_completed',
    collectionRunId: RUN_ID,
    analyticsResultId: RESULT_ID,
    idempotencyKey: null,
    requestedAt: COLLECTED_AT,
    startedAt: COLLECTED_AT,
    completedAt: COLLECTED_AT,
    failedAt: null,
    errorCode: null,
    ...patch,
  };
}

const RESULT: AnalyticsResult = {
  id: RESULT_ID,
  collectionRunId: RUN_ID,
  algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
  calculatedAt: COLLECTED_AT,
  metrics: calculateChannelMetrics({ videos: [VIDEO], collectedAt: COLLECTED_AT }),
};

/** Gerador que sempre falha, para exercitar a degradacao. */
function failingGenerator(error: Error = new ExternalServiceError('provedor fora do ar')) {
  const fake = createFakeInsightGenerator();
  return {
    identity: fake.identity,
    generate: () => Promise.reject(error),
  } satisfies InsightGenerator;
}

let analyses: InMemoryAnalysisRepository;
let analyticsResults: InMemoryAnalyticsResultRepository;
let collectionRuns: InMemoryCollectionRunRepository;
let insightReports: InMemoryInsightReportRepository;

async function saveSnapshot(): Promise<void> {
  const base = {
    id: RUN_ID,
    channelId: CHANNEL_ID,
    requestedAt: COLLECTED_AT,
    startedAt: COLLECTED_AT,
    failedAt: null,
    reusableUntil: null,
    invalidatedAt: null,
    errorCode: null,
  };

  await collectionRuns.startRun({
    ...base,
    status: 'pending',
    capturedAt: null,
    completedAt: null,
  });
  await collectionRuns.completeWithSnapshot({
    run: { ...base, status: 'completed', capturedAt: COLLECTED_AT, completedAt: COLLECTED_AT },
    channel: {
      id: CHANNEL_ID,
      title: 'Canal',
      handle: '@canal',
      description: 'Descricao',
      publishedAt: new Date('2020-01-01T00:00:00.000Z'),
      country: 'BR',
      subscriberCount: 1000,
      hiddenSubscriberCount: false,
      videoCount: 1,
      viewCount: 5000,
    },
    videos: [VIDEO],
  });
}

function buildUseCase(insights: InsightGenerator = createFakeInsightGenerator()) {
  return new GenerateAnalysisInsight({
    clock,
    logger: noopLogger,
    ids: sequentialIds(),
    analyses,
    analyticsResults,
    collectionRuns,
    insights,
    insightReports,
  });
}

beforeEach(async () => {
  analyses = new InMemoryAnalysisRepository();
  analyticsResults = new InMemoryAnalyticsResultRepository();
  collectionRuns = new InMemoryCollectionRunRepository();
  insightReports = new InMemoryInsightReportRepository();
  // O fake aplica o mesmo filtro por dono que o adaptador real resolve pelo
  // join. Sem declarar o dono, ele devolve null — como o banco faria.
  insightReports.setOwner(ANALYSIS_ID, OWNER);

  await analyticsResults.save(RESULT);
  await saveSnapshot();
});

describe('GenerateAnalysisInsight — caminho feliz', () => {
  it('leva a analise a completed com o relatorio gravado', async () => {
    await analyses.create(buildAnalysis());

    const { analysis, report } = await buildUseCase().execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
    });

    // `completed` era inalcancavel antes desta SPEC.
    expect(analysis.status).toBe('completed');
    expect(report).not.toBeNull();
    expect(await insightReports.findByAnalysis(ANALYSIS_ID, OWNER)).not.toBeNull();
  });

  it('carimba a procedencia — modelo, versao do prompt e instante', async () => {
    await analyses.create(buildAnalysis());

    const { report } = await buildUseCase().execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
    });

    // A interface e obrigada a exibir a origem; ela precisa existir no dado.
    expect(report?.provider).toBe('fake');
    expect(report?.promptVersion).not.toBe('');
    expect(report?.generatedAt).toEqual(FIXED_NOW);
    expect(report?.analysisId).toBe(ANALYSIS_ID);
  });

  it('passa a IA as metricas prontas, e nunca a lista bruta de visualizacoes', async () => {
    await analyses.create(buildAnalysis());

    const generator = createFakeInsightGenerator();
    const spy = vi.spyOn(generator, 'generate');
    await buildUseCase(generator).execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    const request = spy.mock.calls[0]?.[0];

    // RN-14 no formato da entrada: sem numeros brutos nao ha o que somar. Se
    // este teste falhar, alguem abriu caminho para a IA calcular.
    expect(request).toBeDefined();
    expect(Object.keys(request ?? {}).sort()).toEqual([
      'channelDescription',
      'channelTitle',
      'metrics',
      'recentTitles',
    ]);
    expect(request?.recentTitles).toEqual([VIDEO.title]);
  });
});

describe('GenerateAnalysisInsight — falha e degradacao', () => {
  it('volta a partially_completed sem tocar nas metricas', async () => {
    await analyses.create(buildAnalysis());

    const { analysis, report } = await buildUseCase(failingGenerator()).execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
    });

    // RN-09: o pior caso e o comportamento de antes desta SPEC.
    expect(analysis.status).toBe('partially_completed');
    expect(report).toBeNull();
    expect(analysis.analyticsResultId).toBe(RESULT_ID);
    expect(await analyticsResults.findById(RESULT_ID)).not.toBeNull();
  });

  it('nao relanca o erro — a falha da IA nao e falha da analise', async () => {
    await analyses.create(buildAnalysis());

    // Quem chama nao precisa tratar uma excecao que, por desenho, nao invalida
    // nada. Se este teste falhar, a Server Action passa a poder quebrar a tela.
    await expect(
      buildUseCase(failingGenerator()).execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER }),
    ).resolves.toBeDefined();
  });

  it('registra a tentativa falha com o modelo que falhou', async () => {
    await analyses.create(buildAnalysis());

    await buildUseCase(failingGenerator()).execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
    });

    const [failure] = insightReports.recordedFailures;

    // Saber QUAL modelo falhou e o que faz a linha de auditoria valer algo.
    expect(failure?.model).toBe('fixture');
    expect(failure?.errorCode).toBe('EXTERNAL_SERVICE_ERROR');
  });

  it('uma falha nao vira relatorio legivel', async () => {
    await analyses.create(buildAnalysis());

    await buildUseCase(failingGenerator()).execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
    });

    // A tentativa fica gravada para auditoria e NAO volta como resultado. Se
    // voltasse, a tela exibiria um bloco vazio como se fosse relatorio.
    expect(await insightReports.findByAnalysis(ANALYSIS_ID, OWNER)).toBeNull();
  });

  it('erro nao previsto tambem degrada, e nao derruba', async () => {
    await analyses.create(buildAnalysis());

    const { analysis } = await buildUseCase(
      failingGenerator(new Error('algo que ninguem previu')),
    ).execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    expect(analysis.status).toBe('partially_completed');
    expect(insightReports.recordedFailures[0]?.errorCode).toBe('UNEXPECTED_ERROR');
  });
});

describe('GenerateAnalysisInsight — o que recusa', () => {
  it('nao gera duas vezes, e a segunda nao chama o provedor', async () => {
    await analyses.create(buildAnalysis());
    await buildUseCase().execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    const generator = createFakeInsightGenerator();
    const spy = vi.spyOn(generator, 'generate');
    const { report } = await buildUseCase(generator).execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
    });

    // Aqui a idempotencia protege DINHEIRO, nao quota. Um duplo clique nao pode
    // gerar dois relatorios pagos.
    expect(spy).not.toHaveBeenCalled();
    expect(report).not.toBeNull();
  });

  it('recusa analise sem metricas calculadas', async () => {
    await analyses.create(buildAnalysis({ analyticsResultId: null }));

    // Pedir a IA que descreva o nada produziria texto plausivel sobre um canal
    // inexistente.
    await expect(
      buildUseCase().execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER }),
    ).rejects.toThrow();
  });

  it('recusa analise em estado que ainda nao calculou', async () => {
    await analyses.create(buildAnalysis({ status: 'collecting_videos' }));

    await expect(
      buildUseCase().execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER }),
    ).rejects.toThrow();
  });

  it('analise de outro usuario nao existe para quem pergunta', async () => {
    await analyses.create(buildAnalysis());

    // NotFound, e nunca erro de permissao — este ja revelaria que ela existe.
    await expect(
      buildUseCase().execute({ analysisId: ANALYSIS_ID, requestedBy: STRANGER }),
    ).rejects.toThrow();
    expect(insightReports.size).toBe(0);
  });
});

describe('GenerateAnalysisInsight — o gerador falso', () => {
  it('anuncia que e exemplo e nao gasta token', async () => {
    const generated: GeneratedInsight = await createFakeInsightGenerator().generate({
      channelTitle: 'Canal',
      channelDescription: '',
      metrics: RESULT.metrics,
      recentTitles: [],
    });

    // Um fixture que se passasse por relatorio real enganaria quem estivesse
    // trabalhando na tela — a mesma razao do fixture da coleta.
    expect(generated.summary).toContain('EXEMPLO');
    expect(generated.inputTokens).toBe(0);
    expect(generated.outputTokens).toBe(0);
  });
});
