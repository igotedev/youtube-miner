import type { AnalysisId } from '@/modules/channel-analysis';
import type { UserId } from '@/modules/identity';

import type {
  InsightFailure,
  InsightReportRepository,
} from '../../application/ports/insight-report-repository';
import type { InsightReport } from '../../domain/insight-report';

/**
 * `InsightReportRepository` em memoria, para teste.
 *
 * Espelha a garantia que importa: `findByAnalysis` devolve apenas relatorio
 * CONCLUIDO. Tentativas que falharam ficam guardadas e nao voltam por ali — se
 * o fake fosse mais permissivo que o banco, um teste passaria com uma tentativa
 * falha sendo exibida como relatorio.
 */
export class InMemoryInsightReportRepository implements InsightReportRepository {
  private readonly reports = new Map<AnalysisId, InsightReport>();
  private readonly owners = new Map<AnalysisId, UserId>();
  private readonly failures: InsightFailure[] = [];

  /**
   * Espelha o filtro por dono do adaptador real, que o resolve pelo `join` com
   * `channel_analyses`. Aqui o dono e registrado por `setOwner`.
   *
   * ANALISE SEM DONO REGISTRADO DEVOLVE `null`, e nao o relatorio. E o mesmo que
   * o banco faz com uma analise inexistente — e um fake mais permissivo que o
   * banco esconde defeito ate a producao.
   */
  findByAnalysis(analysisId: AnalysisId, ownerId: UserId): Promise<InsightReport | null> {
    if (this.owners.get(analysisId) !== ownerId) return Promise.resolve(null);
    return Promise.resolve(this.reports.get(analysisId) ?? null);
  }

  /**
   * Declara de quem e a analise.
   *
   * Fora do contrato da porta de proposito: no adaptador real esse vinculo vem
   * da chave estrangeira, nao de uma chamada. Existe aqui para que o fake
   * consiga aplicar o mesmo filtro — mesma escolha de
   * `InMemoryChannelDirectory.setSummary`.
   */
  setOwner(analysisId: AnalysisId, ownerId: UserId): void {
    this.owners.set(analysisId, ownerId);
  }

  save(report: InsightReport): Promise<void> {
    this.reports.set(report.analysisId, report);
    return Promise.resolve();
  }

  saveFailure(failure: InsightFailure): Promise<void> {
    this.failures.push(failure);
    return Promise.resolve();
  }

  /**
   * Tentativas falhas registradas.
   *
   * Fora do contrato da porta de proposito: serve para um teste afirmar que a
   * falha foi AUDITADA, e nao apenas engolida.
   */
  get recordedFailures(): readonly InsightFailure[] {
    return this.failures;
  }

  get size(): number {
    return this.reports.size;
  }
}
