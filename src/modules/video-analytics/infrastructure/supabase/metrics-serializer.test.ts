import { describe, expect, it } from 'vitest';

import type { VideoFormat, YouTubeVideoId } from '@/modules/youtube-collection';
import { CorruptedPersistedDataError } from '@/shared/errors';

import type { AnalyticsVideo } from '../../domain/analytics-video';
import { calculateChannelMetrics } from '../../domain/calculate-channel-metrics';
import { MS_PER_DAY } from '../../domain/publication-timing';
import { deserializeChannelMetrics, serializeChannelMetrics } from './metrics-serializer';

const COLLECTED_AT = new Date('2026-08-06T12:00:00.000Z');

let sequence = 0;
function video(overrides: Partial<AnalyticsVideo> = {}): AnalyticsVideo {
  sequence += 1;
  return {
    id: `vid_${sequence}` as YouTubeVideoId,
    format: 'long' as VideoFormat,
    publishedAt: new Date(COLLECTED_AT.getTime() - 10 * MS_PER_DAY),
    viewCount: 100,
    ...overrides,
  };
}

/** Métricas com os quatro estados que o percurso nao pode confundir. */
function richMetrics() {
  return calculateChannelMetrics({
    videos: [
      // zero conhecido
      video({ format: 'long', viewCount: 0 }),
      // indisponivel
      video({ format: 'long', viewCount: null }),
      video({ format: 'long', viewCount: 100 }),
      video({ format: 'long', viewCount: 900 }),
      // formato desconhecido, fora dos blocos
      video({ format: 'unknown', viewCount: 50 }),
      // `shorts` fica com array vazio
    ],
    collectedAt: COLLECTED_AT,
  });
}

describe('percurso de ida e volta', () => {
  it('reconstroi metricas identicas as originais', () => {
    const original = richMetrics();

    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored).toEqual(original);
  });

  it('reconstroi collectedAt como Date, e nao como string', () => {
    const original = richMetrics();

    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored.collectedAt).toBeInstanceOf(Date);
    expect(restored.collectedAt.getTime()).toBe(COLLECTED_AT.getTime());
  });

  it('sobrevive a um percurso por texto, como acontece no driver', () => {
    const original = richMetrics();
    const throughWire: unknown = JSON.parse(JSON.stringify(serializeChannelMetrics(original)));

    expect(deserializeChannelMetrics(throughWire)).toEqual(original);
  });

  it('reconstroi as datas do periodo analisado como Date', () => {
    // `JSON.stringify` transforma `Date` em string ISO e ela NAO volta sozinha.
    // Sem o schema reconstruindo, a tela receberia texto e a formatacao falharia
    // longe daqui, na apresentacao.
    const original = richMetrics();

    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored.long.analyzedPeriod.firstPublishedAt).toBeInstanceOf(Date);
    expect(restored.long.analyzedPeriod.lastPublishedAt).toBeInstanceOf(Date);
    expect(restored.long.analyzedPeriod).toEqual(original.long.analyzedPeriod);
  });

  it('mantem o periodo indisponivel de um formato sem videos', () => {
    // `shorts` nao tem nenhum video no fixture. As duas pontas precisam voltar
    // `null`, e nao virar epoch — que e o que `new Date(null)` produziria.
    const restored = deserializeChannelMetrics(serializeChannelMetrics(richMetrics()));

    expect(restored.shorts.videoCount).toBe(0);
    expect(restored.shorts.analyzedPeriod.firstPublishedAt).toBeNull();
    expect(restored.shorts.analyzedPeriod.lastPublishedAt).toBeNull();
    expect(restored.shorts.analyzedPeriod.spanInDays).toBeNull();
  });
});

describe('preservacao dos quatro estados', () => {
  it('mantem zero distinto de indisponivel', () => {
    const original = richMetrics();
    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    const views = restored.long.videos.map((v) => v.viewsPerDay);
    expect(views).toContain(0); // zero conhecido
    expect(views).toContain(null); // indisponivel
    // A distincao e o ponto: se uma virasse a outra, o produto exibiria
    // "0 visualizacoes" para um video com contagem oculta.
    expect(restored.long.videosWithoutViewCount).toBe(1);
  });

  it('mantem agregado indisponivel como null, nunca como zero', () => {
    const original = richMetrics();
    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored.shorts.viewCount.median).toBeNull();
    expect(restored.shorts.viewCount.median).not.toBe(0);
    expect(restored.shorts.publicationFrequency.medianIntervalDays).toBeNull();
  });

  it('mantem array vazio como array vazio, nao como ausente nem null', () => {
    const original = richMetrics();
    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored.shorts.videos).toEqual([]);
    expect(Array.isArray(restored.shorts.videos)).toBe(true);
  });

  it('mantem contagem zero como numero', () => {
    const original = richMetrics();
    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored.shorts.videoCount).toBe(0);
    expect(restored.shorts.outliers.count).toBe(0);
  });

  it('mantem outlierBand null distinto de uma faixa', () => {
    const original = richMetrics();
    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    const bands = restored.long.videos.map((v) => v.outlierBand);
    expect(bands).toContain(null);
  });

  it('preserva o contador de videos nao classificados', () => {
    const original = richMetrics();
    const restored = deserializeChannelMetrics(serializeChannelMetrics(original));

    expect(restored.unclassifiedVideoCount).toBe(1);
  });
});

describe('recusa de dado persistido invalido', () => {
  it.each([
    ['objeto vazio', {}],
    ['null', null],
    ['array', []],
    ['escalar', 'texto'],
  ])('recusa %s', (_name, value) => {
    expect(() => deserializeChannelMetrics(value)).toThrow(CorruptedPersistedDataError);
  });

  it('recusa collectedAt invalido', () => {
    const payload = serializeChannelMetrics(richMetrics());
    const broken = { ...payload, collectedAt: 'nao-e-data' };

    expect(() => deserializeChannelMetrics(broken)).toThrow(CorruptedPersistedDataError);
  });

  it('recusa bloco de formato faltando em vez de devolver metricas parciais', () => {
    const withoutShorts: Record<string, unknown> = { ...serializeChannelMetrics(richMetrics()) };
    delete withoutShorts['shorts'];

    expect(() => deserializeChannelMetrics(withoutShorts)).toThrow(CorruptedPersistedDataError);
  });

  it('recusa faixa de outlier desconhecida', () => {
    const payload = JSON.parse(JSON.stringify(serializeChannelMetrics(richMetrics()))) as {
      long: { videos: { outlierBand: string }[] };
    };
    const first = payload.long.videos[0];
    if (first !== undefined) first.outlierBand = 'gigantic';

    expect(() => deserializeChannelMetrics(payload)).toThrow(CorruptedPersistedDataError);
  });

  it('reporta o caminho do campo invalido sem expor o valor', () => {
    const payload = serializeChannelMetrics(richMetrics());
    const broken = { ...payload, collectedAt: 'segredo-que-nao-deve-vazar' };

    try {
      deserializeChannelMetrics(broken);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      const corrupted = error as CorruptedPersistedDataError;
      expect(JSON.stringify(corrupted.context)).toContain('collectedAt');
      expect(JSON.stringify(corrupted.context)).not.toContain('segredo-que-nao-deve-vazar');
    }
  });
});
