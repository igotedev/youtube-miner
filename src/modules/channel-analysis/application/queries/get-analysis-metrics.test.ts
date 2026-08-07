import { beforeEach, describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { AnalyticsResult, AnalyticsResultId, ChannelMetrics } from '@/modules/video-analytics';
import { ANALYTICS_ALGORITHM_VERSION } from '@/modules/video-analytics';
import { createAnalysisPeriod } from '@/modules/video-analytics';
import { InMemoryAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/memory/in-memory-analytics-result-repository';
import type {
  CollectionRunId,
  YouTubeChannelId,
  YouTubeVideo,
  YouTubeVideoId,
} from '@/modules/youtube-collection';
import { InMemoryCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/memory/in-memory-collection-run-repository';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { InMemoryAnalysisRepository } from '../../infrastructure/memory/in-memory-analysis-repository';
import { GetAnalysisMetrics } from './get-analysis-metrics';

const OWNER = 'user-owner' as UserId;
const STRANGER = 'user-stranger' as UserId;
const ANALYSIS_ID = 'analysis-1' as AnalysisId;
const RESULT_ID = 'result-1' as AnalyticsResultId;
const RUN_ID = 'run-1' as CollectionRunId;
const CHANNEL_ID = 'UC_fixture_channel_00000' as YouTubeChannelId;

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
let collectionRuns: InMemoryCollectionRunRepository;
let query: GetAnalysisMetrics;

/** Videos do snapshot, espalhados em torno de janeiro de 2026. */
function snapshotVideo(iso: string, patch: Partial<YouTubeVideo> = {}): YouTubeVideo {
  return {
    id: `vid_${iso}` as YouTubeVideoId,
    channelId: CHANNEL_ID,
    title: `Video de ${iso}`,
    publishedAt: new Date(iso),
    durationSeconds: 600,
    format: 'long',
    viewCount: 100,
    likeCount: null,
    commentCount: null,
    ...patch,
  };
}

/**
 * Grava uma coleta concluida com os videos dados.
 *
 * O periodo so pode ser aplicado sobre o snapshot — o resultado ja agregado nao
 * carrega video nenhum.
 */
async function saveSnapshot(videos: readonly YouTubeVideo[]): Promise<void> {
  const run = {
    id: RUN_ID,
    channelId: CHANNEL_ID,
    status: 'completed' as const,
    requestedAt: COLLECTED_AT,
    startedAt: COLLECTED_AT,
    capturedAt: COLLECTED_AT,
    completedAt: COLLECTED_AT,
    failedAt: null,
    reusableUntil: null,
    invalidatedAt: null,
    errorCode: null,
  };

  await collectionRuns.startRun({ ...run, status: 'pending', capturedAt: null, completedAt: null });
  await collectionRuns.completeWithSnapshot({
    run,
    channel: {
      id: CHANNEL_ID,
      title: 'Canal',
      handle: '@canal',
      description: '',
      publishedAt: new Date('2020-01-01T00:00:00.000Z'),
      country: 'BR',
      subscriberCount: 1000,
      hiddenSubscriberCount: false,
      videoCount: videos.length,
      viewCount: 5000,
    },
    videos,
  });
}

beforeEach(() => {
  analyses = new InMemoryAnalysisRepository();
  analyticsResults = new InMemoryAnalyticsResultRepository();
  collectionRuns = new InMemoryCollectionRunRepository();
  query = new GetAnalysisMetrics({ analyses, analyticsResults, collectionRuns });
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

describe('recorte por periodo', () => {
  /** Janeiro de 2026 inteiro, como a interface o produz. */
  const JANEIRO = createAnalysisPeriod(
    new Date('2026-01-01T00:00:00.000Z'),
    new Date('2026-01-31T23:59:59.999Z'),
  );

  /** Cinco videos: um antes, tres dentro (incluindo as duas bordas), um depois. */
  const VIDEOS = [
    snapshotVideo('2025-12-31T23:59:59.999Z', { viewCount: 999 }),
    snapshotVideo('2026-01-01T00:00:00.000Z', { viewCount: 100 }),
    snapshotVideo('2026-01-15T10:00:00.000Z', { viewCount: 200 }),
    snapshotVideo('2026-01-31T23:59:59.999Z', { viewCount: 300 }),
    snapshotVideo('2026-02-01T00:00:00.000Z', { viewCount: 888 }),
  ];

  beforeEach(async () => {
    await analyses.create(buildAnalysis());
    await analyticsResults.save(RESULT);
    await saveSnapshot(VIDEOS);
  });

  it('sem periodo, devolve o resultado persistido sem recalcular nada', async () => {
    // O comportamento anterior ao filtro, preservado exatamente.
    const view = await query.execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER });

    expect(view.metrics).toEqual(METRICS);
    expect(view.requestedPeriod).toBeNull();
    expect(view.coverage).toBeNull();
  });

  it('com periodo, calcula somente sobre os videos do intervalo', async () => {
    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    // Tres videos dentro; os de 31/12 e 01/02 ficam de fora.
    expect(view.metrics?.totalVideoCount).toBe(3);
    expect(view.metrics?.long.viewCount.total).toBe(600);
    expect(view.metrics?.long.viewCount.average).toBe(200);
    expect(view.metrics?.long.viewCount.median).toBe(200);
    expect(view.metrics?.long.viewCount.minimum).toBe(100);
    expect(view.metrics?.long.viewCount.maximum).toBe(300);
  });

  it('inclui o video publicado exatamente na data inicial', async () => {
    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    expect(view.metrics?.long.analyzedPeriod.firstPublishedAt).toEqual(
      new Date('2026-01-01T00:00:00.000Z'),
    );
  });

  it('inclui o video publicado exatamente na data final', async () => {
    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    expect(view.metrics?.long.analyzedPeriod.lastPublishedAt).toEqual(
      new Date('2026-01-31T23:59:59.999Z'),
    );
  });

  it('NAO persiste o recorte: o artefato global continua sem filtro', async () => {
    /**
     * O ponto central do desenho. Se o recorte fosse gravado, a chave
     * `(collection_run_id, algorithm_version)` devolveria o resultado de um
     * periodo para quem pedisse outro — numeros plausiveis e errados.
     */
    await query.execute({ analysisId: ANALYSIS_ID, requestedBy: OWNER, period: JANEIRO });

    const persistido = await analyticsResults.findById(RESULT_ID);
    expect(persistido?.metrics).toEqual(METRICS);
  });

  it('dois periodos diferentes sobre a mesma coleta nao se contaminam', async () => {
    const semana = createAnalysisPeriod(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-07T23:59:59.999Z'),
    );

    const janeiro = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });
    const primeiraSemana = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: semana,
    });

    expect(janeiro.metrics?.totalVideoCount).toBe(3);
    expect(primeiraSemana.metrics?.totalVideoCount).toBe(1);
  });

  it('um intervalo de sete dias seleciona so a primeira semana', async () => {
    const semana = createAnalysisPeriod(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-07T23:59:59.999Z'),
    );

    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: semana,
    });

    expect(view.metrics?.totalVideoCount).toBe(1);
    expect(view.metrics?.long.viewCount.total).toBe(100);
  });

  it('um intervalo de trinta dias respeita a borda inicial', async () => {
    const trinta = createAnalysisPeriod(
      new Date('2026-01-02T00:00:00.000Z'),
      new Date('2026-01-31T23:59:59.999Z'),
    );

    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: trinta,
    });

    // O de 01/01 sai: o intervalo comeca no dia 2.
    expect(view.metrics?.totalVideoCount).toBe(2);
  });

  it('um unico dia seleciona apenas os videos daquele dia', async () => {
    const diaUnico = createAnalysisPeriod(
      new Date('2026-01-15T00:00:00.000Z'),
      new Date('2026-01-15T23:59:59.999Z'),
    );

    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: diaUnico,
    });

    expect(view.metrics?.totalVideoCount).toBe(1);
    expect(view.metrics?.long.viewCount.total).toBe(200);
  });

  it('periodo vazio devolve metricas zeradas, e nao erro nem `null`', async () => {
    /**
     * "Nenhum video no intervalo" e uma RESPOSTA. Devolver `null` faria a tela
     * dizer "nao foi possivel calcular", que e outra coisa.
     */
    const vazio = createAnalysisPeriod(
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-31T23:59:59.999Z'),
    );

    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: vazio,
    });

    expect(view.metrics).not.toBeNull();
    expect(view.metrics?.totalVideoCount).toBe(0);
    expect(view.metrics?.long.viewCount.total).toBeNull();
    expect(view.metrics?.long.viewCount.average).toBeNull();
  });

  it('informa a cobertura da coleta, para a tela explicar um resultado vazio', async () => {
    const vazio = createAnalysisPeriod(
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-31T23:59:59.999Z'),
    );

    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: vazio,
    });

    // Sem isto, "nenhum video" pareceria "o canal nao publicou".
    expect(view.coverage?.videoCount).toBe(5);
    expect(view.coverage?.period.firstPublishedAt).toEqual(new Date('2025-12-31T23:59:59.999Z'));
    expect(view.coverage?.period.lastPublishedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('ecoa o periodo pedido', async () => {
    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    expect(view.requestedPeriod).toEqual(JANEIRO);
  });

  it('mantem `calculatedAt` do resultado persistido', async () => {
    // O recorte nao e uma coleta nova; carimbar "agora" sugeriria que foi.
    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    expect(view.calculatedAt).toEqual(CALCULATED_AT);
  });

  it('carimba as metricas com o instante da CAPTURA, nao o da leitura (RN-12)', async () => {
    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    expect(view.metrics?.collectedAt).toEqual(COLLECTED_AT);
  });

  it('continua tratando a analise de outro usuario como inexistente', async () => {
    await expect(
      query.execute({ analysisId: ANALYSIS_ID, requestedBy: STRANGER, period: JANEIRO }),
    ).rejects.toThrow('Analise nao encontrada.');
  });
});

describe('recorte por periodo com os dois formatos', () => {
  const JANEIRO = createAnalysisPeriod(
    new Date('2026-01-01T00:00:00.000Z'),
    new Date('2026-01-31T23:59:59.999Z'),
  );

  it('separa Shorts de longos dentro do periodo (RN-06)', async () => {
    await analyses.create(buildAnalysis());
    await analyticsResults.save(RESULT);
    await saveSnapshot([
      snapshotVideo('2026-01-10T00:00:00.000Z', { format: 'short', viewCount: 50 }),
      snapshotVideo('2026-01-20T00:00:00.000Z', { format: 'long', viewCount: 200 }),
      snapshotVideo('2026-03-01T00:00:00.000Z', { format: 'long', viewCount: 700 }),
    ]);

    const view = await query.execute({
      analysisId: ANALYSIS_ID,
      requestedBy: OWNER,
      period: JANEIRO,
    });

    expect(view.metrics?.shorts.videoCount).toBe(1);
    expect(view.metrics?.long.videoCount).toBe(1);
    expect(view.metrics?.shorts.viewCount.total).toBe(50);
    expect(view.metrics?.long.viewCount.total).toBe(200);
  });
});
