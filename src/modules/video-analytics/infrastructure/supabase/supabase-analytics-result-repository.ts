import type { SupabaseClient } from '@supabase/supabase-js';

import type { CollectionRunId } from '@/modules/youtube-collection';
import { ConflictError } from '@/shared/errors';
import {
  isNoRowsReturned,
  isUniqueViolation,
  translatePostgresError,
} from '@/shared/infrastructure/persistence/postgres-errors';

import type { AnalyticsResultRepository } from '../../application/ports/analytics-result-repository';
import type { AnalyticsResult, AnalyticsResultId } from '../../domain/analytics-result';
import {
  fromAnalyticsResult,
  toAnalyticsResult,
  type AnalyticsResultRow,
} from './analytics-result-row';

/**
 * Adaptador Supabase de `AnalyticsResultRepository`.
 *
 * `video_analytics_results` e tabela GLOBAL: sem `user_id`, sem policy para
 * `authenticated`. Este adaptador so funciona com o cliente administrativo, e o
 * resultado nunca vai cru ao navegador — a apresentacao monta um DTO
 * (ADR-005).
 */
const SELECT_COLUMNS = 'id, collection_run_id, algorithm_version, calculated_at, metrics';

export class SupabaseAnalyticsResultRepository implements AnalyticsResultRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: AnalyticsResultId): Promise<AnalyticsResult | null> {
    const { data, error } = await this.client
      .from('video_analytics_results')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'analyticsResult.findById');
    }
    if (data === null) return null;

    return toAnalyticsResult(data as unknown as AnalyticsResultRow);
  }

  async findByCollectionRunAndVersion(
    collectionRunId: CollectionRunId,
    algorithmVersion: string,
  ): Promise<AnalyticsResult | null> {
    const { data, error } = await this.client
      .from('video_analytics_results')
      .select(SELECT_COLUMNS)
      .eq('collection_run_id', collectionRunId)
      .eq('algorithm_version', algorithmVersion)
      .maybeSingle();

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'analyticsResult.findByVersion');
    }
    if (data === null) return null;

    return toAnalyticsResult(data as unknown as AnalyticsResultRow);
  }

  async save(result: AnalyticsResult): Promise<void> {
    const { error } = await this.client
      .from('video_analytics_results')
      .insert(fromAnalyticsResult(result));

    if (error !== null) {
      // `video_analytics_results_unique_per_version`: dois calculos simultaneos
      // da mesma coleta. Nao e defeito — o resultado e identico, porque o motor
      // e deterministico. Quem chama deve reler em vez de sobrescrever.
      if (isUniqueViolation(error)) {
        throw new ConflictError('Ja existe resultado para esta coleta e versao.', {
          operation: 'analyticsResult.save',
        });
      }
      throw translatePostgresError(error, 'analyticsResult.save');
    }
  }
}
