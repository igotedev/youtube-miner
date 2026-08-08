import type { AnalysisId } from '@/modules/channel-analysis';

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
  private readonly failures: InsightFailure[] = [];

  findByAnalysis(analysisId: AnalysisId): Promise<InsightReport | null> {
    return Promise.resolve(this.reports.get(analysisId) ?? null);
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
