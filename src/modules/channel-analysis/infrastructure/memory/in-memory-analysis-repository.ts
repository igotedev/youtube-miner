import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import { ConflictError } from '@/shared/errors';

import type { AnalysisRepository } from '../../application/ports/analysis-repository';
import type { Analysis, AnalysisId } from '../../domain/analysis';

/**
 * Implementacao em memoria de `AnalysisRepository`.
 *
 * Espelha as duas garantias que o banco oferece — isolamento por usuario e
 * unicidade de `idempotency_key` por usuario — para que a semantica do contrato
 * seja testavel sem Docker. Nao e adaptador de producao.
 */
export class InMemoryAnalysisRepository implements AnalysisRepository {
  private readonly analyses = new Map<AnalysisId, Analysis>();

  findById(id: AnalysisId, ownerId: UserId): Promise<Analysis | null> {
    const found = this.analyses.get(id);
    // Espelha o RLS: analise de outro usuario simplesmente nao existe para quem
    // pergunta. Nao devolve erro de permissao, que ja vazaria a existencia dela.
    if (found === undefined || found.requestedBy !== ownerId) return Promise.resolve(null);
    return Promise.resolve(found);
  }

  findByIdempotencyKey(ownerId: UserId, idempotencyKey: string): Promise<Analysis | null> {
    const found = [...this.analyses.values()].find(
      (analysis) => analysis.requestedBy === ownerId && analysis.idempotencyKey === idempotencyKey,
    );
    return Promise.resolve(found ?? null);
  }

  listByChannel(ownerId: UserId, channelId: YouTubeChannelId): Promise<readonly Analysis[]> {
    const found = [...this.analyses.values()]
      .filter((analysis) => analysis.requestedBy === ownerId && analysis.channelId === channelId)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    return Promise.resolve(found);
  }

  create(analysis: Analysis): Promise<void> {
    if (analysis.idempotencyKey !== null) {
      // Espelha `uniq_analysis_idempotency_key`.
      const duplicate = [...this.analyses.values()].some(
        (existing) =>
          existing.requestedBy === analysis.requestedBy &&
          existing.idempotencyKey === analysis.idempotencyKey,
      );
      if (duplicate) {
        return Promise.reject(
          new ConflictError('Chave de idempotencia ja usada por este usuario.', {
            analysisId: analysis.id,
          }),
        );
      }
    }

    this.analyses.set(analysis.id, analysis);
    return Promise.resolve();
  }

  save(analysis: Analysis): Promise<void> {
    this.analyses.set(analysis.id, analysis);
    return Promise.resolve();
  }
}
