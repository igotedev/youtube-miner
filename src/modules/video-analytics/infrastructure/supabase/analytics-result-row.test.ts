import { describe, expect, it } from 'vitest';

import type { YouTubeVideoId } from '@/modules/youtube-collection';
import type { CollectionRunId } from '@/modules/youtube-collection';
import { CorruptedPersistedDataError } from '@/shared/errors';

import type { AnalyticsVideo } from '../../domain/analytics-video';
import type { AnalyticsResult, AnalyticsResultId } from '../../domain/analytics-result';
import { ANALYTICS_ALGORITHM_VERSION } from '../../domain/analytics-result';
import { calculateChannelMetrics } from '../../domain/calculate-channel-metrics';
import { MS_PER_DAY } from '../../domain/publication-timing';
import {
  fromAnalyticsResult,
  toAnalyticsResult,
  type AnalyticsResultRow,
} from './analytics-result-row';

const RESULT_UUID = '11111111-1111-4111-8111-111111111111';
const RUN_UUID = '22222222-2222-4222-8222-222222222222';
const COLLECTED_AT = new Date('2026-08-06T12:00:00.000Z');
const CALCULATED_AT = new Date('2026-08-06T12:05:00.000Z');

function videos(): AnalyticsVideo[] {
  return [
    {
      id: 'vid_1' as YouTubeVideoId,
      format: 'long',
      publishedAt: new Date(COLLECTED_AT.getTime() - 10 * MS_PER_DAY),
      viewCount: 100,
    },
    {
      id: 'vid_2' as YouTubeVideoId,
      format: 'short',
      publishedAt: new Date(COLLECTED_AT.getTime() - 3 * MS_PER_DAY),
      // Ausente de proposito: o percurso nao pode transformar em zero.
      viewCount: null,
    },
  ];
}

function result(): AnalyticsResult {
  return {
    id: RESULT_UUID as AnalyticsResultId,
    collectionRunId: RUN_UUID as CollectionRunId,
    algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
    calculatedAt: CALCULATED_AT,
    metrics: calculateChannelMetrics({ videos: videos(), collectedAt: COLLECTED_AT }),
  };
}

function row(overrides: Partial<AnalyticsResultRow> = {}): AnalyticsResultRow {
  const insert = fromAnalyticsResult(result());
  return { ...insert, ...overrides };
}

describe('percurso de ida e volta', () => {
  it('reconstroi o resultado identico ao original', () => {
    const original = result();
    expect(toAnalyticsResult(row())).toEqual(original);
  });

  it('reconstroi as datas como Date, inclusive a de dentro do jsonb', () => {
    const restored = toAnalyticsResult(row());

    expect(restored.calculatedAt).toBeInstanceOf(Date);
    expect(restored.metrics.collectedAt).toBeInstanceOf(Date);
    expect(restored.metrics.collectedAt).toEqual(COLLECTED_AT);
  });

  it('mantem calculatedAt distinto de metrics.collectedAt', () => {
    // Um e quando o calculo rodou; o outro, quando os dados foram lidos da API.
    const restored = toAnalyticsResult(row());

    expect(restored.calculatedAt).toEqual(CALCULATED_AT);
    expect(restored.metrics.collectedAt).toEqual(COLLECTED_AT);
    expect(restored.calculatedAt).not.toEqual(restored.metrics.collectedAt);
  });

  it('sobrevive a um percurso por texto, como no driver', () => {
    const original = result();
    const throughWire = JSON.parse(JSON.stringify(row())) as AnalyticsResultRow;

    expect(toAnalyticsResult(throughWire)).toEqual(original);
  });

  it('preserva ausencia de contagem sem virar zero (RN-08)', () => {
    const restored = toAnalyticsResult(row());

    expect(restored.metrics.shorts.videosWithoutViewCount).toBe(1);
    expect(restored.metrics.shorts.viewCount.median).toBeNull();
    expect(restored.metrics.shorts.viewCount.median).not.toBe(0);
  });
});

describe('recusa de linha corrompida', () => {
  it.each([
    ['id nao-UUID', { id: 'lixo' }],
    ['collection_run_id nao-UUID', { collection_run_id: 'lixo' }],
    ['calculated_at invalido', { calculated_at: 'nao-e-data' }],
    ['metrics em array', { metrics: [] }],
    ['metrics nulo', { metrics: null }],
    ['metrics vazio', { metrics: {} }],
  ])('recusa %s', (_name, overrides) => {
    expect(() => toAnalyticsResult(row(overrides))).toThrow(CorruptedPersistedDataError);
  });

  it.each([
    ['v1', 'v1'],
    ['1.0', '1.0'],
    ['sem versao', ''],
  ])('recusa versao de algoritmo "%s"', (_name, algorithm_version) => {
    expect(() => toAnalyticsResult(row({ algorithm_version }))).toThrow(
      CorruptedPersistedDataError,
    );
  });

  it('aceita outra versao valida do algoritmo', () => {
    // Duas versoes convivem para a mesma coleta — e assim que se compara o
    // efeito de uma mudanca de regra sem recoletar.
    const restored = toAnalyticsResult(row({ algorithm_version: '2.1.3' }));
    expect(restored.algorithmVersion).toBe('2.1.3');
  });
});

describe('fromAnalyticsResult', () => {
  it('serializa datas como ISO em UTC', () => {
    const insert = fromAnalyticsResult(result());
    expect(insert.calculated_at).toBe('2026-08-06T12:05:00.000Z');
  });

  it('grava metrics como objeto, nao como texto', () => {
    const insert = fromAnalyticsResult(result());

    expect(typeof insert.metrics).toBe('object');
    expect(Array.isArray(insert.metrics)).toBe(false);
  });
});
