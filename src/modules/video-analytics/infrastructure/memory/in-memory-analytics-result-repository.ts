import type { CollectionRunId } from '@/modules/youtube-collection';
import { ConflictError } from '@/shared/errors';

import type { AnalyticsResultRepository } from '../../application/ports/analytics-result-repository';
import type { AnalyticsResult, AnalyticsResultId } from '../../domain/analytics-result';

/**
 * Implementacao em memoria de `AnalyticsResultRepository`.
 *
 * Espelha a unicidade de `(collection_run_id, algorithm_version)` que o banco
 * garante, para que a semantica de reuso e de imutabilidade seja testavel sem
 * Docker. Nao e adaptador de producao.
 */
export class InMemoryAnalyticsResultRepository implements AnalyticsResultRepository {
  private readonly results = new Map<AnalyticsResultId, AnalyticsResult>();

  /** Quantas vezes um resultado foi efetivamente gravado. Usado em teste. */
  saveCount = 0;

  findById(id: AnalyticsResultId): Promise<AnalyticsResult | null> {
    return Promise.resolve(this.results.get(id) ?? null);
  }

  findByCollectionRunAndVersion(
    collectionRunId: CollectionRunId,
    algorithmVersion: string,
  ): Promise<AnalyticsResult | null> {
    const found = [...this.results.values()].find(
      (result) =>
        result.collectionRunId === collectionRunId && result.algorithmVersion === algorithmVersion,
    );
    return Promise.resolve(found ?? null);
  }

  save(result: AnalyticsResult): Promise<void> {
    const duplicate = [...this.results.values()].some(
      (existing) =>
        existing.collectionRunId === result.collectionRunId &&
        existing.algorithmVersion === result.algorithmVersion,
    );
    if (duplicate) {
      // Recalcular a mesma versao deve ser no-op, nunca sobrescrita silenciosa:
      // apagaria a possibilidade de comparar versoes do algoritmo.
      return Promise.reject(
        new ConflictError('Ja existe resultado para esta coleta e versao.', {
          collectionRunId: result.collectionRunId,
          algorithmVersion: result.algorithmVersion,
        }),
      );
    }

    this.results.set(result.id, result);
    this.saveCount += 1;
    return Promise.resolve();
  }
}
