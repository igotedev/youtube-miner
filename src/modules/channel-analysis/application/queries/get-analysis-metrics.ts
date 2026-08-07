import type { UserId } from '@/modules/identity';
import type { AnalyticsResultRepository, ChannelMetrics } from '@/modules/video-analytics';
import { NotFoundError } from '@/shared/errors';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import type { AnalysisRepository } from '../ports/analysis-repository';

/**
 * Consulta: ler uma analise com as metricas ja calculadas.
 *
 * E uma CONSULTA, nao um comando: nao muda estado, nao avanca a analise e nao
 * calcula nada. Existe porque `CalculateAnalysisMetrics` devolve a `Analysis` —
 * que carrega apenas a REFERENCIA ao resultado — e quem vai exibir precisa dos
 * numeros.
 *
 * Poderia ser tentador fazer o caso de uso de calculo devolver as metricas
 * junto. Nao devolve de proposito: ele tambem termina em `failed`, e nesse
 * caminho nao ha metrica nenhuma. Separar leitura de escrita mantem os dois
 * contratos honestos.
 */

export interface GetAnalysisMetricsInput {
  readonly analysisId: AnalysisId;
  /** Dono da analise. A leitura e sempre escopada. */
  readonly requestedBy: UserId;
}

export interface AnalysisMetricsView {
  readonly analysis: Analysis;
  /**
   * `null` quando a analise ainda nao calculou, ou falhou antes de calcular.
   *
   * Ausencia de metricas NAO e um conjunto de zeros (RN-08): significa que o
   * numero nao existe, e quem exibe precisa poder dizer isso.
   */
  readonly metrics: ChannelMetrics | null;
  /** Quando o calculo rodou. `null` junto com `metrics`. */
  readonly calculatedAt: Date | null;
}

export interface GetAnalysisMetricsDependencies {
  readonly analyses: AnalysisRepository;
  readonly analyticsResults: AnalyticsResultRepository;
}

export class GetAnalysisMetrics {
  constructor(private readonly deps: GetAnalysisMetricsDependencies) {}

  async execute(input: GetAnalysisMetricsInput): Promise<AnalysisMetricsView> {
    const { analyses, analyticsResults } = this.deps;

    const analysis = await analyses.findById(input.analysisId, input.requestedBy);
    if (analysis === null) {
      // Analise de outro usuario cai aqui tambem: para quem pergunta, ela nao
      // existe. Mesma escolha de `CalculateAnalysisMetrics`.
      throw new NotFoundError('Analise nao encontrada.', { analysisId: input.analysisId });
    }

    const resultId = analysis.analyticsResultId;
    if (resultId === null) {
      return { analysis, metrics: null, calculatedAt: null };
    }

    const result = await analyticsResults.findById(resultId);
    if (result === null) {
      // A analise aponta para um resultado que sumiu. Nao invento zeros: quem
      // exibe recebe `null` e diz que a metrica nao esta disponivel.
      return { analysis, metrics: null, calculatedAt: null };
    }

    return { analysis, metrics: result.metrics, calculatedAt: result.calculatedAt };
  }
}
