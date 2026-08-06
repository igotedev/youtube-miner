import type { UserId } from '@/modules/identity';
import type { AnalyticsResultId } from '@/modules/video-analytics';
import type { CollectionRunId, YouTubeChannelId } from '@/modules/youtube-collection';
import {
  fromDate,
  fromNullableDate,
  toDate,
  toEnumValue,
  toNullableDate,
  toNullableText,
  toText,
  toUuid,
} from '@/shared/infrastructure/persistence/row-mappers';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { ANALYSIS_STATUSES } from '../../domain/analysis-status';

/**
 * Mapeamento entre a linha de `channel_analyses` e a entidade `Analysis`.
 *
 * Uma linha corrompida FALHA aqui. Nenhum `as Analysis` sobre o objeto
 * inteiro: cada campo passa por um conversor que valida.
 *
 * Detalhe do esquema que nao vaza para o dominio: a tabela guarda
 * `channel_id` como UUID INTERNO de `youtube_channels`, enquanto o dominio fala
 * `YouTubeChannelId` (`UC...`). A leitura vem sempre acompanhada do join que
 * traz o ID oficial; a escrita recebe o UUID ja resolvido pelo repositorio.
 * Trocar o dominio para o UUID interno seria acomodar o banco (proibido pela
 * decisao arquitetural desta SPEC).
 */

/** Colunas lidas, ja com o ID oficial do canal vindo do join. */
export interface AnalysisRow {
  readonly id: unknown;
  readonly user_id: unknown;
  readonly youtube_channel_id: unknown;
  readonly requested_url: unknown;
  readonly status: unknown;
  readonly collection_run_id: unknown;
  readonly analytics_result_id: unknown;
  readonly idempotency_key: unknown;
  readonly requested_at: unknown;
  readonly started_at: unknown;
  readonly completed_at: unknown;
  readonly failed_at: unknown;
  readonly error_code: unknown;
}

export function toAnalysis(row: AnalysisRow): Analysis {
  return {
    id: toUuid(row.id, 'channel_analyses.id') as AnalysisId,
    requestedBy: toUuid(row.user_id, 'channel_analyses.user_id') as UserId,
    channelId: toText(
      row.youtube_channel_id,
      'youtube_channels.youtube_channel_id',
    ) as YouTubeChannelId,
    requestedUrl: toText(row.requested_url, 'channel_analyses.requested_url'),
    status: toEnumValue(row.status, ANALYSIS_STATUSES, 'channel_analyses.status'),
    collectionRunId: nullableUuid(
      row.collection_run_id,
      'channel_analyses.collection_run_id',
    ) as CollectionRunId | null,
    analyticsResultId: nullableUuid(
      row.analytics_result_id,
      'channel_analyses.analytics_result_id',
    ) as AnalyticsResultId | null,
    idempotencyKey: toNullableText(row.idempotency_key, 'channel_analyses.idempotency_key'),
    requestedAt: toDate(row.requested_at, 'channel_analyses.requested_at'),
    startedAt: toNullableDate(row.started_at, 'channel_analyses.started_at'),
    completedAt: toNullableDate(row.completed_at, 'channel_analyses.completed_at'),
    failedAt: toNullableDate(row.failed_at, 'channel_analyses.failed_at'),
    errorCode: toNullableText(row.error_code, 'channel_analyses.error_code'),
  };
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return toUuid(value, field);
}

/** Colunas gravadas. `channel_id` ja resolvido para o UUID interno. */
export interface AnalysisInsert {
  readonly id: string;
  readonly user_id: string;
  readonly channel_id: string;
  readonly requested_url: string;
  readonly status: string;
  readonly collection_run_id: string | null;
  readonly analytics_result_id: string | null;
  readonly idempotency_key: string | null;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly failed_at: string | null;
  readonly error_code: string | null;
}

export function fromAnalysis(analysis: Analysis, internalChannelId: string): AnalysisInsert {
  return {
    id: analysis.id,
    user_id: analysis.requestedBy,
    channel_id: internalChannelId,
    requested_url: analysis.requestedUrl,
    status: analysis.status,
    collection_run_id: analysis.collectionRunId,
    analytics_result_id: analysis.analyticsResultId,
    idempotency_key: analysis.idempotencyKey,
    requested_at: fromDate(analysis.requestedAt, 'requestedAt'),
    started_at: fromNullableDate(analysis.startedAt, 'startedAt'),
    completed_at: fromNullableDate(analysis.completedAt, 'completedAt'),
    failed_at: fromNullableDate(analysis.failedAt, 'failedAt'),
    error_code: analysis.errorCode,
  };
}
