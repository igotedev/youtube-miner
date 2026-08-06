import type { CollectionRunId } from '@/modules/youtube-collection';
import {
  fromDate,
  toDate,
  toJsonObject,
  toText,
  toUuid,
} from '@/shared/infrastructure/persistence/row-mappers';
import { CorruptedPersistedDataError } from '@/shared/errors';

import type { AnalyticsResult, AnalyticsResultId } from '../../domain/analytics-result';
import { deserializeChannelMetrics, serializeChannelMetrics } from './metrics-serializer';

/**
 * Mapeamento entre a linha de `video_analytics_results` e `AnalyticsResult`.
 *
 * Toda a parte delicada — reconstruir os `Date` de dentro do `jsonb` e nao
 * confundir `0`, `null` e `[]` — vive em `metrics-serializer.ts`. Aqui ficam
 * apenas as colunas de fora.
 */

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface AnalyticsResultRow {
  readonly id: unknown;
  readonly collection_run_id: unknown;
  readonly algorithm_version: unknown;
  readonly calculated_at: unknown;
  readonly metrics: unknown;
}

export function toAnalyticsResult(row: AnalyticsResultRow): AnalyticsResult {
  const version = toText(row.algorithm_version, 'video_analytics_results.algorithm_version');
  if (!VERSION_PATTERN.test(version)) {
    // O banco tem a mesma CHECK. A duplicata existe porque o mapeador tambem
    // roda sobre linhas gravadas antes da constraint, ou por outra via.
    throw new CorruptedPersistedDataError('Versao de algoritmo em formato invalido.', {
      field: 'video_analytics_results.algorithm_version',
    });
  }

  return {
    id: toUuid(row.id, 'video_analytics_results.id') as AnalyticsResultId,
    collectionRunId: toUuid(
      row.collection_run_id,
      'video_analytics_results.collection_run_id',
    ) as CollectionRunId,
    algorithmVersion: version,
    calculatedAt: toDate(row.calculated_at, 'video_analytics_results.calculated_at'),
    metrics: deserializeChannelMetrics(
      toJsonObject(row.metrics, 'video_analytics_results.metrics'),
    ),
  };
}

export interface AnalyticsResultInsert {
  readonly id: string;
  readonly collection_run_id: string;
  readonly algorithm_version: string;
  readonly calculated_at: string;
  readonly metrics: Record<string, unknown>;
}

export function fromAnalyticsResult(result: AnalyticsResult): AnalyticsResultInsert {
  return {
    id: result.id,
    collection_run_id: result.collectionRunId,
    algorithm_version: result.algorithmVersion,
    calculated_at: fromDate(result.calculatedAt, 'calculatedAt'),
    metrics: serializeChannelMetrics(result.metrics),
  };
}
