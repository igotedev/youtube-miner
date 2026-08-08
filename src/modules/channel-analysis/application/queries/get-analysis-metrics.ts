import type { InsightReport, InsightReportRepository } from '@/modules/ai-insights';
import type { UserId } from '@/modules/identity';
import type {
  AnalysisPeriod,
  AnalyticsResultRepository,
  AnalyzedPeriod,
  ChannelMetrics,
} from '@/modules/video-analytics';
import {
  calculateAnalyzedPeriod,
  calculateChannelMetrics,
  filterByPeriod,
} from '@/modules/video-analytics';
import type { CollectionRunRepository } from '@/modules/youtube-collection';
import { NotFoundError } from '@/shared/errors';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import type { AnalysisRepository } from '../ports/analysis-repository';

/**
 * Consulta: ler uma analise com as metricas ja calculadas.
 *
 * E uma CONSULTA, nao um comando: nao muda estado e nao avanca a analise.
 *
 * Poderia ser tentador fazer o caso de uso de calculo devolver as metricas
 * junto. Nao devolve de proposito: ele tambem termina em `failed`, e nesse
 * caminho nao ha metrica nenhuma. Separar leitura de escrita mantem os dois
 * contratos honestos.
 *
 * ---------------------------------------------------------------------------
 * O FILTRO DE PERIODO E APLICADO AQUI, E NAO NO MOTOR. A RAZAO E UM BUG.
 *
 * `video_analytics_results` e um artefato GLOBAL, reaproveitado entre usuarios
 * pela chave `(collection_run_id, algorithm_version)` — e o que faz a RN-10
 * valer tambem para o calculo.
 *
 * Se o periodo entrasse no motor e o resultado filtrado fosse persistido, o
 * usuario que pedisse "ultimos 90 dias" receberia o resultado que outra pessoa
 * calculou para "ultimos 7 dias", porque a chave nao distingue os dois. Numeros
 * plausiveis, silenciosamente errados, atribuidos ao periodo errado.
 *
 * Entao: o artefato persistido continua sendo o da COLETA INTEIRA, sem filtro, e
 * o recorte por periodo e uma VISAO derivada, calculada na leitura. O motor
 * segue puro e inalterado, a chave de reuso segue correta, e nao ha migracao.
 *
 * Sem periodo, o caminho e exatamente o de antes: le o resultado persistido.
 * ---------------------------------------------------------------------------
 */

export interface GetAnalysisMetricsInput {
  readonly analysisId: AnalysisId;
  /** Dono da analise. A leitura e sempre escopada. */
  readonly requestedBy: UserId;
  /**
   * Recorte opcional. Ausente significa "a coleta inteira" — o comportamento
   * que existia antes deste campo, preservado sem mudanca.
   */
  readonly period?: AnalysisPeriod;
}

/**
 * Cobertura da coleta, para a tela poder explicar um resultado vazio.
 *
 * Sem isto, pedir janeiro de 2026 em um canal cuja coleta comeca em fevereiro
 * devolveria "nenhum video" e pareceria que o canal nao publicou. A verdade e
 * outra: a coleta traz os uploads mais recentes e nao alcanca aquele periodo.
 */
export interface CollectionCoverage {
  /** Videos que a coleta trouxe, antes de qualquer filtro. */
  readonly videoCount: number;
  /** Intervalo coberto por esses videos. */
  readonly period: AnalyzedPeriod;
}

export interface AnalysisMetricsView {
  readonly analysis: Analysis;
  /**
   * `null` quando a analise ainda nao calculou, ou falhou antes de calcular.
   *
   * Ausencia de metricas NAO e um conjunto de zeros (RN-08): significa que o
   * numero nao existe, e quem exibe precisa poder dizer isso.
   *
   * Com periodo, um `ChannelMetrics` de zeros e resultado VALIDO: quer dizer
   * "nenhum video neste intervalo", que e diferente de "nao ha metricas".
   */
  readonly metrics: ChannelMetrics | null;
  /** Quando o calculo rodou. `null` junto com `metrics`. */
  readonly calculatedAt: Date | null;
  /** Eco do que foi pedido. `null` quando nao houve recorte. */
  readonly requestedPeriod: AnalysisPeriod | null;
  /** `null` quando nao houve recorte — sem filtro, nao ha o que explicar. */
  readonly coverage: CollectionCoverage | null;
  /**
   * Relatorio de IA, quando existe.
   *
   * `null` cobre tres casos que a TELA precisa distinguir e este tipo nao
   * distingue: sem chave configurada, geracao falhou, ou ainda nao foi pedida.
   * A consulta nao inventa o motivo — quem exibe sabe se a composicao tem chave
   * e se a analise passou pela etapa.
   *
   * RN-05: vem em campo proprio, ao lado de `metrics` e nunca dentro delas.
   * Interpretacao e dado calculado sao coisas diferentes e chegam separadas.
   */
  readonly insight: InsightReport | null;
}

export interface GetAnalysisMetricsDependencies {
  readonly analyses: AnalysisRepository;
  readonly analyticsResults: AnalyticsResultRepository;
  /**
   * Necessario apenas para o recorte por periodo: o filtro precisa dos videos,
   * e eles vivem no snapshot da coleta, nao no resultado ja agregado.
   */
  readonly collectionRuns: CollectionRunRepository;
  /** R7: o relatorio vem pelo contrato de `ai-insights`, nunca por SQL proprio. */
  readonly insightReports: InsightReportRepository;
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

    /**
     * O relatorio e lido SEMPRE, inclusive quando nao ha metricas.
     *
     * Sao dois eixos independentes: uma analise pode ter numeros sem relatorio,
     * e o contrario nao acontece hoje mas nao e este ponto que deve decidir
     * isso. Ler junto tambem evita uma segunda consulta na tela.
     */
    const insight = await this.deps.insightReports.findByAnalysis(analysis.id);

    const empty = {
      analysis,
      metrics: null,
      calculatedAt: null,
      requestedPeriod: input.period ?? null,
      coverage: null,
      insight,
    } as const;

    const resultId = analysis.analyticsResultId;
    if (resultId === null) return empty;

    const result = await analyticsResults.findById(resultId);
    if (result === null) {
      // A analise aponta para um resultado que sumiu. Nao invento zeros: quem
      // exibe recebe `null` e diz que a metrica nao esta disponivel.
      return empty;
    }

    if (input.period === undefined) {
      return {
        analysis,
        metrics: result.metrics,
        calculatedAt: result.calculatedAt,
        requestedPeriod: null,
        coverage: null,
        insight,
      };
    }

    return this.buildPeriodView(analysis, result.calculatedAt, input.period, insight);
  }

  /**
   * Recalcula as metricas sobre os videos do periodo.
   *
   * Recalcular e barato e puro: sao no maximo `MAX_RECENT_VIDEOS` videos ja em
   * memoria, sem rede, sem banco alem da leitura do snapshot, sem quota.
   *
   * `calculatedAt` continua sendo o do resultado persistido, e nao o instante
   * desta leitura: e a mesma funcao deterministica, na mesma versao do
   * algoritmo, sobre um subconjunto do mesmo snapshot. Carimbar "agora" daria a
   * entender que houve uma coleta nova.
   */
  private async buildPeriodView(
    analysis: Analysis,
    calculatedAt: Date,
    period: AnalysisPeriod,
    insight: InsightReport | null,
  ): Promise<AnalysisMetricsView> {
    const collectionRunId = analysis.collectionRunId;
    if (collectionRunId === null) {
      return {
        analysis,
        metrics: null,
        calculatedAt: null,
        requestedPeriod: period,
        coverage: null,
        insight,
      };
    }

    const snapshot = await this.deps.collectionRuns.findSnapshot(collectionRunId);
    if (snapshot === null) {
      return {
        analysis,
        metrics: null,
        calculatedAt: null,
        requestedPeriod: period,
        coverage: null,
        insight,
      };
    }

    const capturedAt = snapshot.run.capturedAt;
    if (capturedAt === null) {
      // Sem instante de captura nao ha idade nem visualizacoes por dia. Mesma
      // guarda que `CalculateAnalysisMetrics` aplica antes de calcular.
      return {
        analysis,
        metrics: null,
        calculatedAt: null,
        requestedPeriod: period,
        coverage: null,
        insight,
      };
    }

    const coverage: CollectionCoverage = {
      videoCount: snapshot.videos.length,
      period: calculateAnalyzedPeriod(snapshot.videos.map((video) => video.publishedAt)),
    };

    // RN-12: as metricas continuam carimbadas com o instante da CAPTURA, e nao
    // com o momento da leitura.
    const metrics = calculateChannelMetrics({
      videos: filterByPeriod(snapshot.videos, period),
      collectedAt: capturedAt,
    });

    return { analysis, metrics, calculatedAt, requestedPeriod: period, coverage, insight };
  }
}
