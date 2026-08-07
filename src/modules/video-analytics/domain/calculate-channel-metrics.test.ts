import { describe, expect, it } from 'vitest';

import type { VideoFormat, YouTubeVideo, YouTubeVideoId } from '@/modules/youtube-collection';

import type { AnalyticsVideo } from './analytics-video';
import { calculateChannelMetrics } from './calculate-channel-metrics';
import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import { MS_PER_DAY } from './publication-timing';

const COLLECTED_AT = new Date('2026-08-06T12:00:00.000Z');

let sequence = 0;

function video(overrides: Partial<AnalyticsVideo> = {}): AnalyticsVideo {
  sequence += 1;
  return {
    id: `vid_${sequence}` as YouTubeVideoId,
    format: 'long',
    publishedAt: new Date(COLLECTED_AT.getTime() - 10 * MS_PER_DAY),
    viewCount: 100,
    ...overrides,
  };
}

function daysBefore(days: number): Date {
  return new Date(COLLECTED_AT.getTime() - days * MS_PER_DAY);
}

/** Videos longos com as visualizacoes dadas, todos com 10 dias de idade. */
function longVideosWithViews(views: readonly (number | null)[]): AnalyticsVideo[] {
  return views.map((viewCount) => video({ format: 'long', viewCount }));
}

describe('canal sem videos', () => {
  const metrics = calculateChannelMetrics({ videos: [], collectedAt: COLLECTED_AT });

  it('devolve os dois blocos de formato, ambos vazios', () => {
    expect(metrics.shorts.videoCount).toBe(0);
    expect(metrics.long.videoCount).toBe(0);
    expect(metrics.shorts.videos).toEqual([]);
    expect(metrics.long.videos).toEqual([]);
  });

  it('nao devolve zero no lugar de indisponivel', () => {
    // RN-08: um canal sem videos nao tem "media zero".
    expect(metrics.long.viewCount.average).toBeNull();
    expect(metrics.long.viewCount.median).toBeNull();
    expect(metrics.long.viewCount.total).toBeNull();
    expect(metrics.long.viewCount.minimum).toBeNull();
    expect(metrics.long.viewCount.maximum).toBeNull();
    expect(metrics.long.viewsPerDay.average).toBeNull();
    expect(metrics.long.publicationFrequency.medianIntervalDays).toBeNull();
  });

  it('zera as contagens, que sao numeros legitimos', () => {
    expect(metrics.long.outliers.count).toBe(0);
    expect(metrics.long.outliers.largeCount).toBe(0);
    expect(metrics.long.publicationFrequency.videosLast30Days).toBe(0);
    expect(metrics.totalVideoCount).toBe(0);
  });

  it('nao lanca erro', () => {
    expect(() => calculateChannelMetrics({ videos: [], collectedAt: COLLECTED_AT })).not.toThrow();
  });
});

describe('separacao por formato', () => {
  it('canal somente com Shorts deixa o bloco de longos vazio, mas presente', () => {
    const metrics = calculateChannelMetrics({
      videos: [video({ format: 'short' }), video({ format: 'short' })],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.shorts.videoCount).toBe(2);
    expect(metrics.long.videoCount).toBe(0);
    expect(metrics.long.viewCount.median).toBeNull();
    expect(metrics.long.format).toBe('long');
  });

  it('canal somente com videos longos deixa o bloco de Shorts vazio', () => {
    const metrics = calculateChannelMetrics({
      videos: [video({ format: 'long' })],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videoCount).toBe(1);
    expect(metrics.shorts.videoCount).toBe(0);
    expect(metrics.shorts.viewCount.average).toBeNull();
  });

  it('canal com os dois formatos separa as medianas (RN-06)', () => {
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'short', viewCount: 1000 }),
        video({ format: 'short', viewCount: 3000 }),
        video({ format: 'long', viewCount: 10 }),
        video({ format: 'long', viewCount: 30 }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.shorts.viewCount.median).toBe(2000);
    expect(metrics.long.viewCount.median).toBe(20);
  });

  it('classifica outliers com a mediana do proprio formato, nunca a do outro', () => {
    // Sem separacao, o Short de 3000 seria comparado a uma mediana mista e o
    // longo de 30 pareceria irrelevante.
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'short', viewCount: 1000 }),
        video({ format: 'short', viewCount: 1000 }),
        video({ format: 'short', viewCount: 6000 }),
        video({ format: 'long', viewCount: 10 }),
        video({ format: 'long', viewCount: 10 }),
        video({ format: 'long', viewCount: 60 }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.shorts.viewCount.median).toBe(1000);
    expect(metrics.long.viewCount.median).toBe(10);
    // Cada formato tem exatamente um grande outlier, com escalas muito
    // diferentes de visualizacoes.
    expect(metrics.shorts.outliers.largeCount).toBe(1);
    expect(metrics.long.outliers.largeCount).toBe(1);
  });

  it('videos com formato unknown ficam fora dos dois blocos', () => {
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'short' }),
        video({ format: 'long' }),
        video({ format: 'unknown' }),
        video({ format: 'unknown' }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.unclassifiedVideoCount).toBe(2);
    expect(metrics.shorts.videoCount).toBe(1);
    expect(metrics.long.videoCount).toBe(1);
  });

  it('mantem a invariante de contagem', () => {
    const videos: AnalyticsVideo[] = [
      video({ format: 'short' }),
      video({ format: 'short' }),
      video({ format: 'long' }),
      video({ format: 'unknown' }),
    ];
    const metrics = calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });

    expect(
      metrics.shorts.videoCount + metrics.long.videoCount + metrics.unclassifiedVideoCount,
    ).toBe(metrics.totalVideoCount);
  });
});

describe('agregados de visualizacoes', () => {
  it('calcula total, media, mediana, minimo e maximo', () => {
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([10, 20, 60]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.viewCount.total).toBe(90);
    expect(metrics.long.viewCount.average).toBe(30);
    expect(metrics.long.viewCount.median).toBe(20);
    expect(metrics.long.viewCount.minimum).toBe(10);
    expect(metrics.long.viewCount.maximum).toBe(60);
  });

  it('exclui dos agregados os videos sem contagem, sem trata-los como zero', () => {
    // Com null virando 0, a media cairia de 20 para 10.
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([10, 30, null]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videoCount).toBe(3);
    expect(metrics.long.videosWithoutViewCount).toBe(1);
    expect(metrics.long.viewCount.average).toBe(20);
    expect(metrics.long.viewCount.minimum).toBe(10);
  });

  it('preserva a ausencia de dado no video individual', () => {
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([100, null]),
      collectedAt: COLLECTED_AT,
    });

    const semDado = metrics.long.videos[1];
    expect(semDado?.viewsPerDay).toBeNull();
    expect(semDado?.outlierScore).toBeNull();
    expect(semDado?.outlierBand).toBeNull();
  });

  it('trata zero visualizacoes como fato, nao como ausencia', () => {
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([0, 100, 200]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videosWithoutViewCount).toBe(0);
    expect(metrics.long.viewCount.minimum).toBe(0);
    expect(metrics.long.videos[0]?.viewsPerDay).toBe(0);
    expect(metrics.long.videos[0]?.outlierBand).toBe('normal');
  });

  it('quando nenhum video tem contagem, todos os agregados sao indisponiveis', () => {
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([null, null]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videoCount).toBe(2);
    expect(metrics.long.videosWithoutViewCount).toBe(2);
    expect(metrics.long.viewCount.median).toBeNull();
    expect(metrics.long.outliers.unavailableCount).toBe(2);
    expect(metrics.long.outliers.count).toBe(0);
  });
});

describe('outliers no canal', () => {
  it('conta outliers e grandes outliers separadamente', () => {
    // Mediana 100. Scores: 1, 1, 1.6, 3, 8.
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([100, 100, 160, 300, 800]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.viewCount.median).toBe(160);
    const bands = metrics.long.videos.map((v) => v.outlierBand);
    expect(bands).toEqual(['normal', 'normal', 'normal', 'above_normal', 'large_outlier']);
    expect(metrics.long.outliers.count).toBe(1);
    expect(metrics.long.outliers.largeCount).toBe(1);
  });

  it('count inclui as faixas outlier e large_outlier', () => {
    // Mediana 100. Scores: 1, 1, 1, 1, 3 (outlier), 6 (large_outlier).
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([100, 100, 100, 100, 300, 600]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.viewCount.median).toBe(100);
    expect(metrics.long.videos.map((v) => v.outlierBand)).toEqual([
      'normal',
      'normal',
      'normal',
      'normal',
      'outlier',
      'large_outlier',
    ]);
    // `count` soma as duas faixas; `largeCount` isola a mais extrema.
    expect(metrics.long.outliers.count).toBe(2);
    expect(metrics.long.outliers.largeCount).toBe(1);
  });

  it('mediana zero torna todos os scores indisponiveis, sem Infinity', () => {
    const metrics = calculateChannelMetrics({
      videos: longVideosWithViews([0, 0, 5000]),
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.viewCount.median).toBe(0);
    expect(metrics.long.videos.map((v) => v.outlierScore)).toEqual([null, null, null]);
    expect(metrics.long.videos.map((v) => v.outlierBand)).toEqual([null, null, null]);
    expect(metrics.long.outliers.unavailableCount).toBe(3);
    expect(metrics.long.outliers.largeCount).toBe(0);
  });
});

describe('metricas temporais', () => {
  it('calcula idade e visualizacoes por dia a partir de collectedAt', () => {
    const metrics = calculateChannelMetrics({
      videos: [video({ publishedAt: daysBefore(10), viewCount: 1000 })],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videos[0]?.ageInDays).toBe(10);
    expect(metrics.long.videos[0]?.viewsPerDay).toBe(100);
  });

  it('aplica o piso de um dia a video recem-publicado', () => {
    const metrics = calculateChannelMetrics({
      videos: [video({ publishedAt: daysBefore(0.25), viewCount: 100 })],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videos[0]?.ageInDays).toBe(0.25);
    expect(metrics.long.videos[0]?.viewsPerDay).toBe(100);
  });

  it('mudar collectedAt altera apenas as metricas temporais', () => {
    const videos = longVideosWithViews([100, 200, 300]);
    const depois = new Date(COLLECTED_AT.getTime() + 30 * MS_PER_DAY);

    const a = calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });
    const b = calculateChannelMetrics({ videos, collectedAt: depois });

    // Visualizacoes nao mudam: sao um retrato, nao dependem de quando se olha.
    expect(b.long.viewCount).toEqual(a.long.viewCount);
    expect(b.long.videos.map((v) => v.outlierBand)).toEqual(
      a.long.videos.map((v) => v.outlierBand),
    );

    // Idade e visualizacoes por dia mudam.
    expect(b.long.videos[0]?.ageInDays).toBe(40);
    expect(a.long.videos[0]?.ageInDays).toBe(10);
    expect(b.long.publicationFrequency.videosLast30Days).toBe(0);
    expect(a.long.publicationFrequency.videosLast30Days).toBe(3);
  });

  it('registra collectedAt na saida (RN-12)', () => {
    const metrics = calculateChannelMetrics({ videos: [], collectedAt: COLLECTED_AT });
    expect(metrics.collectedAt).toEqual(COLLECTED_AT);
  });

  it('calcula frequencia separadamente por formato', () => {
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'short', publishedAt: daysBefore(4) }),
        video({ format: 'short', publishedAt: daysBefore(2) }),
        video({ format: 'long', publishedAt: daysBefore(40) }),
        video({ format: 'long', publishedAt: daysBefore(20) }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.shorts.publicationFrequency.medianIntervalDays).toBe(2);
    expect(metrics.long.publicationFrequency.medianIntervalDays).toBe(20);
    expect(metrics.shorts.publicationFrequency.videosLast30Days).toBe(2);
    expect(metrics.long.publicationFrequency.videosLast30Days).toBe(1);
  });
});

describe('periodo efetivamente analisado', () => {
  it('cobre da publicacao mais antiga a mais recente do formato', () => {
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'long', publishedAt: daysBefore(50) }),
        video({ format: 'long', publishedAt: daysBefore(30) }),
        video({ format: 'long', publishedAt: daysBefore(5) }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.analyzedPeriod.firstPublishedAt).toEqual(daysBefore(50));
    expect(metrics.long.analyzedPeriod.lastPublishedAt).toEqual(daysBefore(5));
    expect(metrics.long.analyzedPeriod.spanInDays).toBe(45);
  });

  it('cada formato tem o seu periodo, sem contaminar o outro (RN-06)', () => {
    // O caso que motivou o campo: os mesmos "50 videos" podem cobrir sete
    // semanas de Shorts e quatro anos de videos longos.
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'short', publishedAt: daysBefore(9) }),
        video({ format: 'short', publishedAt: daysBefore(2) }),
        video({ format: 'long', publishedAt: daysBefore(400) }),
        video({ format: 'long', publishedAt: daysBefore(100) }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.shorts.analyzedPeriod.spanInDays).toBe(7);
    expect(metrics.long.analyzedPeriod.spanInDays).toBe(300);
    expect(metrics.shorts.analyzedPeriod.firstPublishedAt).toEqual(daysBefore(9));
    expect(metrics.long.analyzedPeriod.firstPublishedAt).toEqual(daysBefore(400));
  });

  it('inclui videos sem contagem de views', () => {
    // Eles ficam fora dos agregados de visualizacoes (RN-08), mas tem data de
    // publicacao e fazem parte do conjunto analisado. Exclui-los encolheria o
    // periodo e faria a tela descrever menos videos do que a analise usou.
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'long', publishedAt: daysBefore(60), viewCount: null }),
        video({ format: 'long', publishedAt: daysBefore(10), viewCount: 500 }),
      ],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videosWithoutViewCount).toBe(1);
    expect(metrics.long.analyzedPeriod.firstPublishedAt).toEqual(daysBefore(60));
    expect(metrics.long.analyzedPeriod.spanInDays).toBe(50);
  });

  it('formato sem videos tem periodo indisponivel, nao zero dias', () => {
    const metrics = calculateChannelMetrics({
      videos: [video({ format: 'long', publishedAt: daysBefore(10) })],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.shorts.videoCount).toBe(0);
    expect(metrics.shorts.analyzedPeriod.firstPublishedAt).toBeNull();
    expect(metrics.shorts.analyzedPeriod.spanInDays).toBeNull();
  });

  it('videos `unknown` ficam de fora do periodo dos dois formatos', () => {
    const metrics = calculateChannelMetrics({
      videos: [
        video({ format: 'long', publishedAt: daysBefore(20) }),
        video({ format: 'long', publishedAt: daysBefore(10) }),
        video({ format: 'unknown', publishedAt: daysBefore(900) }),
      ],
      collectedAt: COLLECTED_AT,
    });

    // Sem isto, um video sem duracao conhecida esticaria o periodo de um formato
    // ao qual ele nao pertence.
    expect(metrics.long.analyzedPeriod.firstPublishedAt).toEqual(daysBefore(20));
    expect(metrics.long.analyzedPeriod.spanInDays).toBe(10);
    expect(metrics.shorts.analyzedPeriod.spanInDays).toBeNull();
    expect(metrics.unclassifiedVideoCount).toBe(1);
  });

  it('nao depende de collectedAt', () => {
    // O periodo descreve o conjunto de videos, nao a distancia ate a coleta.
    const videos = [
      video({ format: 'long', publishedAt: daysBefore(30) }),
      video({ format: 'long', publishedAt: daysBefore(3) }),
    ];
    const depois = new Date(COLLECTED_AT.getTime() + 90 * MS_PER_DAY);

    const a = calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });
    const b = calculateChannelMetrics({ videos, collectedAt: depois });

    expect(b.long.analyzedPeriod).toEqual(a.long.analyzedPeriod);
  });
});

describe('validacao de entrada', () => {
  it('recusa IDs duplicados em vez de deduplicar em silencio', () => {
    const duplicated = video({ viewCount: 100 });

    try {
      calculateChannelMetrics({
        videos: [duplicated, video(), duplicated],
        collectedAt: COLLECTED_AT,
      });
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      const invalid = error as InvalidVideoAnalyticsInputError;
      expect(invalid.reason).toBe('duplicate_video');
      // O contexto aponta o video e a posicao, para tornar o defeito de coleta
      // investigavel.
      expect(invalid.context).toMatchObject({ videoId: duplicated.id, index: 2 });
    }
  });

  it('recusa publicacao posterior a coleta', () => {
    const futuro = new Date(COLLECTED_AT.getTime() + MS_PER_DAY);

    try {
      calculateChannelMetrics({
        videos: [video({ publishedAt: futuro })],
        collectedAt: COLLECTED_AT,
      });
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('future_publication_date');
    }
  });

  it('recusa data de coleta invalida', () => {
    try {
      calculateChannelMetrics({ videos: [], collectedAt: new Date('nao-e-data') });
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_collected_at');
    }
  });

  const invalidViewCounts: readonly (readonly [string, number])[] = [
    ['negativo', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];

  it.each(invalidViewCounts)('recusa viewCount %s', (_name, viewCount) => {
    try {
      calculateChannelMetrics({ videos: [video({ viewCount })], collectedAt: COLLECTED_AT });
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_view_count');
    }
  });

  it('recusa formato desconhecido pelo motor', () => {
    const corrompido = video({ format: 'vertical' as VideoFormat });

    try {
      calculateChannelMetrics({ videos: [corrompido], collectedAt: COLLECTED_AT });
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('unsupported_video_format');
    }
  });

  it('valida tambem os videos de formato unknown', () => {
    // Dado corrompido nao deixa de ser corrompido por ficar fora dos agregados.
    const futuro = new Date(COLLECTED_AT.getTime() + MS_PER_DAY);

    expect(() =>
      calculateChannelMetrics({
        videos: [video({ format: 'unknown', publishedAt: futuro })],
        collectedAt: COLLECTED_AT,
      }),
    ).toThrow(InvalidVideoAnalyticsInputError);
  });
});

describe('pureza e determinismo', () => {
  it('nao modifica o array de entrada nem os videos', () => {
    const videos = [
      video({ format: 'long', publishedAt: daysBefore(30), viewCount: 10 }),
      video({ format: 'short', publishedAt: daysBefore(2), viewCount: 900 }),
      video({ format: 'long', publishedAt: daysBefore(15), viewCount: 50 }),
    ];
    const snapshot = JSON.stringify(videos);

    calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });

    expect(JSON.stringify(videos)).toBe(snapshot);
  });

  it('a mesma entrada produz sempre a mesma saida', () => {
    const videos = [
      video({ format: 'short', viewCount: 500, publishedAt: daysBefore(3) }),
      video({ format: 'long', viewCount: 120, publishedAt: daysBefore(9) }),
      video({ format: 'long', viewCount: 900, publishedAt: daysBefore(1) }),
    ];

    const first = calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });
    const second = calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });

    expect(second).toEqual(first);
  });

  it('preserva a ordem original dos videos na saida', () => {
    const videos = [
      video({ format: 'long', publishedAt: daysBefore(1) }),
      video({ format: 'long', publishedAt: daysBefore(50) }),
      video({ format: 'long', publishedAt: daysBefore(20) }),
    ];

    const metrics = calculateChannelMetrics({ videos, collectedAt: COLLECTED_AT });

    // A ordenacao por data acontece apenas dentro do calculo de frequencia.
    expect(metrics.long.videos.map((v) => v.videoId)).toEqual(videos.map((v) => v.id));
  });
});

describe('compatibilidade com o modulo de coleta', () => {
  it('aceita um YouTubeVideo sem nenhum mapeamento', () => {
    // `AnalyticsVideo` e um subconjunto estrutural de `YouTubeVideo`, entao o
    // adaptador de coleta passa a lista adiante sem converter nada.
    const collected: YouTubeVideo = {
      id: 'vid_from_collection' as YouTubeVideoId,
      channelId: 'UCabcdefghijklmnopqrstuv' as YouTubeVideo['channelId'],
      title: 'Titulo qualquer',
      publishedAt: daysBefore(5),
      durationSeconds: 600,
      format: 'long',
      viewCount: 250,
      likeCount: null,
      commentCount: null,
    };

    const metrics = calculateChannelMetrics({
      videos: [collected],
      collectedAt: COLLECTED_AT,
    });

    expect(metrics.long.videoCount).toBe(1);
    expect(metrics.long.videos[0]?.videoId).toBe(collected.id);
  });
});
