import {
  ANALYZABLE_FORMATS,
  type AnalyticsVideo,
  type AnalyzableVideoFormat,
  type CalculateChannelMetricsInput,
} from './analytics-video';
import type { ChannelMetrics, FormatMetrics, VideoMetrics } from './channel-metrics';
import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import { calculateOutlierScore, classifyOutlier, OUTLIER_THRESHOLDS } from './outlier';
import {
  assertValidCollectedAt,
  calculateAnalyzedPeriod,
  calculatePublicationFrequency,
  calculateVideoAgeInDays,
  calculateViewsPerDay,
} from './publication-timing';
import {
  calculateMean,
  calculateMedian,
  calculateSum,
  findMaximum,
  findMinimum,
} from './statistics';

/**
 * Motor de metricas do canal.
 *
 * Funcao PURA: mesma entrada produz sempre a mesma saida. Sem rede, sem banco,
 * sem `process.env`, sem relogio — `collectedAt` chega por parametro. Nao
 * modifica a entrada: onde ha ordenacao, ela ocorre sobre copia.
 *
 * RN-14: nada aqui pode ser delegado a IA. Media, mediana, frequencia e outlier
 * sao aritmetica; um modelo generativo devolveria um numero plausivel, diferente
 * a cada chamada e impossivel de verificar.
 *
 * @throws {InvalidVideoAnalyticsInputError} Entrada invalida. O `reason` diz
 *   qual regra foi violada e o contexto traz o video responsavel.
 */
export function calculateChannelMetrics(input: CalculateChannelMetricsInput): ChannelMetrics {
  const { videos, collectedAt } = input;

  assertValidCollectedAt(collectedAt);
  assertNoDuplicateIds(videos);

  const byFormat = new Map<AnalyzableVideoFormat, AnalyticsVideo[]>([
    ['short', []],
    ['long', []],
  ]);
  let unclassifiedVideoCount = 0;

  videos.forEach((video, index) => {
    validateVideo(video, index, collectedAt);

    if (video.format === 'unknown') {
      unclassifiedVideoCount += 1;
      return;
    }

    byFormat.get(video.format)?.push(video);
  });

  const [shorts, long] = ANALYZABLE_FORMATS.map((format) =>
    buildFormatMetrics(format, byFormat.get(format) ?? [], collectedAt),
  );

  /* c8 ignore next 3 -- ANALYZABLE_FORMATS tem exatamente dois elementos; o
     compilador nao sabe disso porque `map` devolve um array de tamanho livre. */
  if (shorts === undefined || long === undefined) {
    throw new InvalidVideoAnalyticsInputError('unsupported_video_format');
  }

  return {
    collectedAt,
    totalVideoCount: videos.length,
    unclassifiedVideoCount,
    shorts,
    long,
  };
}

// ---------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------

/**
 * IDs duplicados sao RECUSADOS, nao deduplicados em silencio.
 *
 * Deduplicar esconderia um defeito da coleta — paginacao repetindo uma pagina,
 * por exemplo — e o canal apareceria com metricas plausiveis calculadas sobre
 * dados errados. Falhar alto e a unica forma de esse defeito ser corrigido.
 */
function assertNoDuplicateIds(videos: readonly AnalyticsVideo[]): void {
  const seen = new Set<string>();

  videos.forEach((video, index) => {
    if (seen.has(video.id)) {
      throw new InvalidVideoAnalyticsInputError('duplicate_video', {
        videoId: video.id,
        index,
      });
    }
    seen.add(video.id);
  });
}

function validateVideo(video: AnalyticsVideo, index: number, collectedAt: Date): void {
  const context = { videoId: video.id, index };

  if (video.format !== 'short' && video.format !== 'long' && video.format !== 'unknown') {
    throw new InvalidVideoAnalyticsInputError('unsupported_video_format', context);
  }

  if (video.viewCount !== null && (!Number.isFinite(video.viewCount) || video.viewCount < 0)) {
    throw new InvalidVideoAnalyticsInputError('invalid_view_count', context);
  }

  // Valida data e publicacao futura, inclusive para videos `unknown`: um dado
  // corrompido nao deixa de ser corrompido por ficar fora dos agregados.
  calculateVideoAgeInDays(video.publishedAt, collectedAt, context);
}

// ---------------------------------------------------------------------------
// Agregacao por formato
// ---------------------------------------------------------------------------

function buildFormatMetrics(
  format: AnalyzableVideoFormat,
  videos: readonly AnalyticsVideo[],
  collectedAt: Date,
): FormatMetrics {
  // Apenas contagens DISPONIVEIS entram nos agregados (RN-08). Um video com
  // visualizacoes ocultas nao pode puxar a media para baixo como se fosse zero.
  const availableViews = videos
    .map((video) => video.viewCount)
    .filter((count): count is number => count !== null);

  const medianViews = calculateMedian(availableViews);

  const videoMetrics: VideoMetrics[] = videos.map((video) => {
    const ageInDays = calculateVideoAgeInDays(video.publishedAt, collectedAt, {
      videoId: video.id,
    });
    const outlierScore = calculateOutlierScore(video.viewCount, medianViews);

    return {
      videoId: video.id,
      ageInDays,
      viewsPerDay: calculateViewsPerDay(video.viewCount, ageInDays),
      outlierScore,
      outlierBand: classifyOutlier(outlierScore),
    };
  });

  const availableViewsPerDay = videoMetrics
    .map((metrics) => metrics.viewsPerDay)
    .filter((value): value is number => value !== null);

  const scores = videoMetrics.map((metrics) => metrics.outlierScore);

  // Sobre TODOS os videos do formato, inclusive os sem contagem: eles tem data
  // de publicacao e fazem parte do conjunto analisado. A exclusao da RN-08 vale
  // para os agregados de visualizacoes, nao para a extensao temporal.
  const publishedDates = videos.map((video) => video.publishedAt);

  return {
    format,
    videoCount: videos.length,
    videosWithoutViewCount: videos.length - availableViews.length,

    analyzedPeriod: calculateAnalyzedPeriod(publishedDates),

    viewCount: {
      total: calculateSum(availableViews),
      average: calculateMean(availableViews),
      median: medianViews,
      minimum: findMinimum(availableViews),
      maximum: findMaximum(availableViews),
    },

    viewsPerDay: {
      average: calculateMean(availableViewsPerDay),
      median: calculateMedian(availableViewsPerDay),
    },

    publicationFrequency: calculatePublicationFrequency(publishedDates, collectedAt),

    outliers: {
      count: scores.filter((score) => score !== null && score >= OUTLIER_THRESHOLDS.outlier).length,
      largeCount: scores.filter(
        (score) => score !== null && score >= OUTLIER_THRESHOLDS.largeOutlier,
      ).length,
      unavailableCount: scores.filter((score) => score === null).length,
    },

    // Ordem de entrada preservada: a saida pode ser cruzada com a lista original
    // por indice, sem que o chamador precise reordenar nada.
    videos: videoMetrics,
  };
}
