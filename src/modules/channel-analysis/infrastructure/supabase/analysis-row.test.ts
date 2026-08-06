import { describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { AnalyticsResultId } from '@/modules/video-analytics';
import type { CollectionRunId, YouTubeChannelId } from '@/modules/youtube-collection';
import { CorruptedPersistedDataError } from '@/shared/errors';

import { ANALYSIS_STATUSES } from '../../domain/analysis-status';
import type { Analysis, AnalysisId } from '../../domain/analysis';
import { fromAnalysis, toAnalysis, type AnalysisRow } from './analysis-row';

const ANALYSIS_UUID = '11111111-1111-4111-8111-111111111111';
const USER_UUID = '22222222-2222-4222-8222-222222222222';
const RUN_UUID = '33333333-3333-4333-8333-333333333333';
const RESULT_UUID = '44444444-4444-4444-8444-444444444444';
const INTERNAL_CHANNEL_UUID = '55555555-5555-4555-8555-555555555555';
const OFFICIAL_CHANNEL_ID = 'UCabcdefghijklmnopqrstuv';

function row(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    id: ANALYSIS_UUID,
    user_id: USER_UUID,
    youtube_channel_id: OFFICIAL_CHANNEL_ID,
    requested_url: 'https://www.youtube.com/@canal-de-exemplo',
    status: 'collecting_videos',
    collection_run_id: RUN_UUID,
    analytics_result_id: null,
    idempotency_key: null,
    requested_at: '2026-08-06T10:30:00.000Z',
    started_at: '2026-08-06T10:30:01.000Z',
    completed_at: null,
    failed_at: null,
    error_code: null,
    ...overrides,
  };
}

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    id: ANALYSIS_UUID as AnalysisId,
    requestedBy: USER_UUID as UserId,
    channelId: OFFICIAL_CHANNEL_ID as YouTubeChannelId,
    requestedUrl: 'https://www.youtube.com/@canal-de-exemplo',
    status: 'collecting_videos',
    collectionRunId: RUN_UUID as CollectionRunId,
    analyticsResultId: null,
    idempotencyKey: null,
    requestedAt: new Date('2026-08-06T10:30:00.000Z'),
    startedAt: new Date('2026-08-06T10:30:01.000Z'),
    completedAt: null,
    failedAt: null,
    errorCode: null,
    ...overrides,
  };
}

describe('toAnalysis', () => {
  it('reconstroi a entidade a partir da linha', () => {
    expect(toAnalysis(row())).toEqual(analysis());
  });

  it('ancora a analise no ID oficial, nao no UUID interno do canal', () => {
    // RN-01: `channel_analyses.channel_id` guarda o UUID interno, mas o dominio
    // nunca o ve — o join traz o `UC...`.
    const restored = toAnalysis(row());

    expect(restored.channelId).toBe(OFFICIAL_CHANNEL_ID);
    expect(String(restored.channelId)).not.toBe(INTERNAL_CHANNEL_UUID);
  });

  it('reconstroi datas como Date', () => {
    const restored = toAnalysis(row());

    expect(restored.requestedAt).toBeInstanceOf(Date);
    expect(restored.requestedAt.toISOString()).toBe('2026-08-06T10:30:00.000Z');
  });

  it('preserva null nas colunas opcionais, sem inventar valores', () => {
    const restored = toAnalysis(
      row({ collection_run_id: null, analytics_result_id: null, started_at: null }),
    );

    expect(restored.collectionRunId).toBeNull();
    expect(restored.analyticsResultId).toBeNull();
    expect(restored.startedAt).toBeNull();
    expect(restored.completedAt).toBeNull();
  });

  it.each(ANALYSIS_STATUSES)('preserva o estado %s', (status) => {
    // `failed` exige carimbo no banco; aqui interessa so o mapeamento.
    const restored = toAnalysis(row({ status }));
    expect(restored.status).toBe(status);
  });

  it('preserva o vinculo com o resultado de metricas quando existe', () => {
    const restored = toAnalysis(row({ analytics_result_id: RESULT_UUID }));
    expect(restored.analyticsResultId).toBe(RESULT_UUID as AnalyticsResultId);
  });
});

describe('recusa de linha corrompida', () => {
  it.each([
    ['id nao-UUID', { id: 'nao-e-uuid' }],
    ['user_id nulo', { user_id: null }],
    ['status desconhecido', { status: 'archived' }],
    ['status nulo', { status: null }],
    ['data invalida', { requested_at: 'nao-e-data' }],
    ['data ausente', { requested_at: null }],
    ['URL vazia', { requested_url: '' }],
    ['ID de canal ausente', { youtube_channel_id: null }],
    ['collection_run_id nao-UUID', { collection_run_id: 'lixo' }],
  ])('recusa %s em vez de produzir entidade silenciosamente valida', (_name, overrides) => {
    expect(() => toAnalysis(row(overrides))).toThrow(CorruptedPersistedDataError);
  });

  it('nao expoe o valor corrompido na mensagem', () => {
    try {
      toAnalysis(row({ id: 'token-secreto' }));
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      const corrupted = error as CorruptedPersistedDataError;
      expect(corrupted.message).not.toContain('token-secreto');
      expect(JSON.stringify(corrupted.context)).not.toContain('token-secreto');
    }
  });
});

describe('fromAnalysis', () => {
  it('grava o UUID interno do canal, e nao o ID oficial', () => {
    const insert = fromAnalysis(analysis(), INTERNAL_CHANNEL_UUID);

    expect(insert.channel_id).toBe(INTERNAL_CHANNEL_UUID);
    expect(insert.requested_url).toBe('https://www.youtube.com/@canal-de-exemplo');
  });

  it('serializa datas como ISO em UTC', () => {
    const insert = fromAnalysis(analysis(), INTERNAL_CHANNEL_UUID);

    expect(insert.requested_at).toBe('2026-08-06T10:30:00.000Z');
    expect(insert.completed_at).toBeNull();
  });

  it('preserva a chave de idempotencia quando presente', () => {
    const insert = fromAnalysis(analysis({ idempotencyKey: 'req-abc' }), INTERNAL_CHANNEL_UUID);
    expect(insert.idempotency_key).toBe('req-abc');
  });

  it('faz o percurso de ida e volta sem perder informacao', () => {
    const original = analysis({
      analyticsResultId: RESULT_UUID as AnalyticsResultId,
      idempotencyKey: 'req-abc',
      status: 'completed',
      completedAt: new Date('2026-08-06T10:35:00.000Z'),
    });

    const insert = fromAnalysis(original, INTERNAL_CHANNEL_UUID);
    const restored = toAnalysis({
      ...insert,
      youtube_channel_id: OFFICIAL_CHANNEL_ID,
    } as unknown as AnalysisRow);

    expect(restored).toEqual(original);
  });
});
