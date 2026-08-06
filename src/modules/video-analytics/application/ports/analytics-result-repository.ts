import type { CollectionRunId } from '@/modules/youtube-collection';

import type { AnalyticsResult, AnalyticsResultId } from '../../domain/analytics-result';

/**
 * Porta de persistencia dos resultados de metricas.
 *
 * R7: a tabela `video_analytics_results` pertence a este modulo.
 *
 * Nao existe `update`: um resultado e imutavel. Recalcular com regra nova
 * produz uma LINHA NOVA, com outra `algorithmVersion` — e o par
 * (`collectionRunId`, `algorithmVersion`) e unico no banco. Sobrescrever
 * apagaria a possibilidade de comparar versoes.
 */
export interface AnalyticsResultRepository {
  findById(id: AnalyticsResultId): Promise<AnalyticsResult | null>;

  /** Resultado de uma coleta em uma versao especifica do algoritmo. */
  findByCollectionRunAndVersion(
    collectionRunId: CollectionRunId,
    algorithmVersion: string,
  ): Promise<AnalyticsResult | null>;

  /**
   * @throws {ConflictError} Ja existe resultado para este par
   *   (coleta, versao). Recalcular a mesma versao deve ser no-op, nao
   *   sobrescrita silenciosa.
   */
  save(result: AnalyticsResult): Promise<void>;
}
