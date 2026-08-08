import type {
  InsightGenerator,
  InsightReport,
  InsightReportId,
  InsightReportRepository,
} from '@/modules/ai-insights';
import type { UserId } from '@/modules/identity';
import type { AnalyticsResultRepository } from '@/modules/video-analytics';
import type { CollectionRunRepository } from '@/modules/youtube-collection';
import type { Clock, UuidGenerator } from '@/shared/domain';
import { AppError, DomainError, NotFoundError } from '@/shared/errors';
import type { Logger } from '@/shared/observability';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { canGenerateInsight } from '../../domain/analysis-status';
import type { AnalysisRepository } from '../ports/analysis-repository';

/**
 * Caso de uso: gerar o relatorio de IA de uma analise (SPEC-011).
 *
 * Fecha a decima capacidade do MVP e torna `completed` alcancavel pela primeira
 * vez. Ate aqui toda analise terminava em `partially_completed`, que existe
 * exatamente para dizer "os numeros estao certos, o relatorio nao veio".
 *
 * `partially_completed` -> `generating_insights` -> `completed`
 *                                               -> `partially_completed`
 *
 * ---------------------------------------------------------------------------
 * O PIOR CASO E O COMPORTAMENTO DE HOJE.
 *
 * Erro, recusa, tempo esgotado ou resposta que nao valida levam a analise de
 * volta a `partially_completed` — de onde ela veio. As metricas continuam
 * corretas e visiveis. Ligar esta etapa nao pode piorar nada (RN-09).
 *
 * E por isso que a falha da IA NAO leva a `failed`, diferente do calculo: sem
 * metricas nao ha analise, mas sem relatorio ha.
 * ---------------------------------------------------------------------------
 */

export interface GenerateAnalysisInsightInput {
  readonly analysisId: AnalysisId;
  /** Dono da analise. A busca e sempre escopada. */
  readonly requestedBy: UserId;
}

export interface GenerateAnalysisInsightResult {
  readonly analysis: Analysis;
  /** `null` quando a geracao falhou. A analise continua valida. */
  readonly report: InsightReport | null;
}

export interface GenerateAnalysisInsightDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ids: UuidGenerator;
  readonly analyses: AnalysisRepository;
  readonly analyticsResults: AnalyticsResultRepository;
  /** Necessario para o titulo e a descricao do canal, e os titulos dos videos. */
  readonly collectionRuns: CollectionRunRepository;
  readonly insights: InsightGenerator;
  readonly insightReports: InsightReportRepository;
}

export class GenerateAnalysisInsight {
  constructor(private readonly deps: GenerateAnalysisInsightDependencies) {}

  async execute(input: GenerateAnalysisInsightInput): Promise<GenerateAnalysisInsightResult> {
    const { logger, analyses, insightReports } = this.deps;

    let analysis = await analyses.findById(input.analysisId, input.requestedBy);
    if (analysis === null) {
      // Analise de outro usuario cai aqui tambem: para quem pergunta, ela nao
      // existe. Um erro de permissao ja revelaria que ela existe.
      throw new NotFoundError('Analise nao encontrada.', { analysisId: input.analysisId });
    }

    /**
     * IDEMPOTENCIA, E AQUI ELA CUSTA DINHEIRO.
     *
     * Um duplo clique na coleta desperdica quota; aqui desperdica dinheiro de
     * verdade. A consulta acontece ANTES de qualquer chamada, e antes mesmo de
     * verificar o estado — uma analise ja `completed` devolve o relatorio que
     * tem, sem gastar um token.
     */
    const existing = await insightReports.findByAnalysis(analysis.id);
    if (existing !== null) {
      logger.info('relatorio ja existe; nada a gerar', { analysisId: analysis.id });
      return { analysis, report: existing };
    }

    if (!canGenerateInsight(analysis.status)) {
      throw new DomainError('Esta analise nao esta em ponto de gerar relatorio.', {
        analysisId: analysis.id,
        status: analysis.status,
      });
    }

    const analyticsResultId = analysis.analyticsResultId;
    if (analyticsResultId === null) {
      // Sem metricas nao ha sobre o que escrever, e pedir a IA que descreva o
      // nada produziria texto plausivel sobre um canal inexistente.
      throw new DomainError('A analise nao tem metricas calculadas.', {
        analysisId: analysis.id,
      });
    }

    const save = async (status: Analysis['status'], patch: Partial<Analysis> = {}) => {
      analysis = { ...(analysis as Analysis), ...patch, status };
      await analyses.save(analysis);
      logger.info('analise avancou de estado', { analysisId: analysis.id, status });
    };

    /**
     * O estado e gravado ANTES da chamada externa.
     *
     * E o que permite saber, olhando o banco, que uma analise parou no meio da
     * chamada. Sem isso, um processo derrubado deixaria a analise em
     * `partially_completed`, indistinguivel de uma que nunca tentou.
     */
    await save('generating_insights');

    try {
      const report = await this.generate(analysis, analyticsResultId);
      await insightReports.save(report);
      await save('completed', { completedAt: this.deps.clock.now() });

      return { analysis, report };
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';
      await this.recordFailure(analysis.id, errorCode);

      logger.warn('relatorio de IA nao pode ser gerado', {
        analysisId: analysis.id,
        errorCode,
      });

      // Degradacao, nao falha: volta ao estado de onde veio, com os numeros
      // intactos. O erro NAO e relancado — quem chamou nao precisa tratar uma
      // falha que, por desenho, nao invalida nada.
      await save('partially_completed', { completedAt: this.deps.clock.now() });

      return { analysis, report: null };
    }
  }

  /** Monta o pedido a partir do snapshot e das metricas ja calculadas. */
  private async generate(
    analysis: Analysis,
    analyticsResultId: NonNullable<Analysis['analyticsResultId']>,
  ): Promise<InsightReport> {
    const { clock, ids, analyticsResults, collectionRuns, insights } = this.deps;

    const result = await analyticsResults.findById(analyticsResultId);
    if (result === null) {
      throw new NotFoundError('As metricas desta analise nao foram encontradas.', {
        analysisId: analysis.id,
      });
    }

    const collectionRunId = analysis.collectionRunId;
    if (collectionRunId === null) {
      throw new DomainError('A analise nao esta vinculada a nenhuma coleta.', {
        analysisId: analysis.id,
      });
    }

    const snapshot = await collectionRuns.findSnapshot(collectionRunId);
    if (snapshot === null) {
      throw new NotFoundError('A coleta desta analise nao tem dados guardados.', {
        collectionRunId,
      });
    }

    /**
     * O que atravessa a fronteira: metricas JA CALCULADAS e titulos.
     *
     * A lista de visualizacoes por video NAO vai. E a RN-14 no formato da
     * entrada: sem os numeros brutos nao ha o que somar, e a regra deixa de
     * depender de o prompt pedir bem.
     */
    const generated = await insights.generate({
      channelTitle: snapshot.channel.title,
      channelDescription: snapshot.channel.description,
      metrics: result.metrics,
      recentTitles: snapshot.videos.map((video) => video.title),
    });

    return {
      id: ids.next() as InsightReportId,
      analysisId: analysis.id,
      generatedAt: clock.now(),
      ...generated,
    };
  }

  /**
   * Grava a tentativa falha para auditoria.
   *
   * NAO pode derrubar o caminho de degradacao: se ate a auditoria falhar, o que
   * importa e a analise voltar a um estado valido com as metricas intactas. O
   * erro e registrado em log e engolido aqui, e so aqui.
   */
  private async recordFailure(analysisId: AnalysisId, errorCode: string): Promise<void> {
    try {
      // A procedencia vem da porta, e nao de literais: saber QUAL modelo
      // falhou e o que faz esta linha valer alguma coisa.
      const { provider, model, promptVersion } = this.deps.insights.identity;

      await this.deps.insightReports.saveFailure({
        analysisId,
        provider,
        model,
        promptVersion,
        failedAt: this.deps.clock.now(),
        errorCode,
      });
    } catch {
      this.deps.logger.warn('nao foi possivel registrar a tentativa falha', { analysisId });
    }
  }
}
