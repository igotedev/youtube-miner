import { ConflictError } from '@/shared/errors';

import type {
  CollectionRunRepository,
  CollectionSnapshot,
} from '../../application/ports/collection-run-repository';
import {
  isActiveCollectionRunStatus,
  isReusableCollectionRun,
  type CollectionRun,
  type CollectionRunId,
} from '../../domain/collection-run';
import { ConcurrentCollectionRunError } from '../../domain/errors/concurrent-collection-run';
import type { YouTubeChannelId } from '../../domain/youtube-channel';

/**
 * Implementacao em memoria de `CollectionRunRepository`.
 *
 * Existe para que a SEMANTICA do contrato — reuso, concorrencia, snapshot
 * obrigatorio — seja testavel sem banco, sem Docker e sem rede. As mesmas
 * regras estao no SQL da migration (indice unico parcial, filtros de reuso); os
 * testes pgTAP verificam o lado do banco, estes verificam o lado do contrato.
 *
 * NAO e um adaptador de producao e nao e reexportado pelo barrel do modulo.
 */
export class InMemoryCollectionRunRepository implements CollectionRunRepository {
  private readonly runs = new Map<CollectionRunId, CollectionRun>();
  private readonly snapshots = new Map<CollectionRunId, CollectionSnapshot>();

  findById(id: CollectionRunId): Promise<CollectionRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  findReusableForChannel(
    channelId: YouTubeChannelId,
    referenceTime: Date,
  ): Promise<CollectionRun | null> {
    const candidates = [...this.runs.values()]
      .filter((run) => run.channelId === channelId)
      .filter((run) => isReusableCollectionRun(run, referenceTime))
      // Sem snapshot, uma execucao "concluida" devolveria nada a quem a
      // reaproveitasse. O SQL aplica o mesmo filtro por EXISTS.
      .filter((run) => this.snapshots.has(run.id))
      .sort((a, b) => (b.capturedAt?.getTime() ?? 0) - (a.capturedAt?.getTime() ?? 0));

    return Promise.resolve(candidates[0] ?? null);
  }

  findActiveForChannel(channelId: YouTubeChannelId): Promise<CollectionRun | null> {
    const active = [...this.runs.values()].find(
      (run) => run.channelId === channelId && isActiveCollectionRunStatus(run.status),
    );
    return Promise.resolve(active ?? null);
  }

  startRun(run: CollectionRun): Promise<CollectionRun> {
    // Espelha o indice unico parcial `uniq_active_run_per_channel`.
    const active = [...this.runs.values()].some(
      (existing) =>
        existing.channelId === run.channelId && isActiveCollectionRunStatus(existing.status),
    );
    if (active) {
      return Promise.reject(new ConcurrentCollectionRunError(run.channelId));
    }

    this.runs.set(run.id, run);
    return Promise.resolve(run);
  }

  save(run: CollectionRun): Promise<void> {
    if (!this.runs.has(run.id)) {
      return Promise.reject(new ConflictError('Execucao inexistente.', { runId: run.id }));
    }
    this.runs.set(run.id, run);
    return Promise.resolve();
  }

  completeWithSnapshot(snapshot: CollectionSnapshot): Promise<void> {
    this.runs.set(snapshot.run.id, snapshot.run);
    this.snapshots.set(snapshot.run.id, snapshot);
    return Promise.resolve();
  }

  findSnapshot(runId: CollectionRunId): Promise<CollectionSnapshot | null> {
    return Promise.resolve(this.snapshots.get(runId) ?? null);
  }
}
