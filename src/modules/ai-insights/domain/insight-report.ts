import type { Brand } from '@/shared/domain';

export type InsightReportId = Brand<string, 'InsightReportId'>;

/**
 * Relatorio textual produzido por IA.
 *
 * RN-05: fica SEPARADO dos dados objetivos. Um relatorio e interpretacao, e o
 * produto nunca pode apresenta-lo como dado oficial (RN-07). Por isso o tipo
 * carrega a procedencia — modelo e data de geracao — junto com o texto: a
 * interface tem a obrigacao de exibir essa origem.
 *
 * RN-14: proibido pedir a IA qualquer numero que o sistema saiba calcular.
 * Media, mediana, frequencia e outlier vem de video-analytics e sao ENTREGUES
 * prontos a IA; ela escreve sobre eles, nao os produz.
 */
export interface InsightReport {
  readonly id: InsightReportId;
  readonly model: string;
  readonly generatedAt: Date;
  readonly summary: string;
  readonly likelyNiche: string | null;
  readonly likelySubNiche: string | null;
  readonly titlePatterns: readonly string[];
  readonly contentOpportunities: readonly string[];
  readonly viralDependencyNotes: string | null;
  /** Custo, para o controle de gasto exigido pelo modulo. */
  readonly inputTokens: number;
  readonly outputTokens: number;
}
