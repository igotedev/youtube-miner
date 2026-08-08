import type { UserId } from '@/modules/identity';
import type { AnalyticsResult, AnalyticsResultRepository } from '@/modules/video-analytics';
import { ANALYTICS_ALGORITHM_VERSION, calculateChannelMetrics } from '@/modules/video-analytics';
import type { CollectionRunRepository } from '@/modules/youtube-collection';
import type { AnalyticsResultId } from '@/modules/video-analytics';
import type { Clock, UuidGenerator } from '@/shared/domain';
import { AppError, DomainError, NotFoundError } from '@/shared/errors';
import type { Logger } from '@/shared/observability';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import type { AnalysisStatus } from '../../domain/analysis-status';
import { canCalculateMetrics, isTerminalStatus } from '../../domain/analysis-status';
import type { AnalysisRepository } from '../ports/analysis-repository';

/**
 * Caso de uso: calcular e persistir as metricas de uma analise.
 *
 * Fecha o vao entre a SPEC-003 (motor de metricas, puro) e a SPEC-004
 * (esquema). Ate aqui o motor existia e o esquema existia, mas nada os ligava:
 * `StartChannelAnalysis` parava em `collecting_videos` e nenhuma metrica chegava
 * ao banco.
 *
 * Percorre `collecting_videos` -> `calculating_metrics` -> `partially_completed`.
 *
 * POR QUE TERMINA EM `partially_completed`, E NAO EM `completed`.
 * A SPEC-001 define `partially_completed` como "dados objetivos validos,
 * relatorio de IA ausente ou invalido" (RN-09). E exatamente esta situacao: as
 * metricas estao corretas e ainda nao ha relatorio. Marcar `completed` afirmaria
 * que um relatorio foi produzido.
 *
 * Desde a SPEC-011 o relatorio existe, e `GenerateAnalysisInsight` continua
 * daqui. Este caso de uso NAO passou a terminar em `generating_insights`: um
 * estado nao terminal deixaria pendente para sempre a analise cujo relatorio
 * nunca fosse pedido. Cada caso de uso encerra em estado valido por conta
 * propria.
 */

export interface CalculateAnalysisMetricsInput {
  readonly analysisId: AnalysisId;
  /** Dono da analise. A busca e sempre escopada: nao ha como calcular a de outro. */
  readonly requestedBy: UserId;
}

export interface CalculateAnalysisMetricsDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ids: UuidGenerator;
  readonly analyses: AnalysisRepository;
  readonly collectionRuns: CollectionRunRepository;
  readonly analyticsResults: AnalyticsResultRepository;
}

export class CalculateAnalysisMetrics {
  constructor(private readonly deps: CalculateAnalysisMetricsDependencies) {}

  async execute(input: CalculateAnalysisMetricsInput): Promise<Analysis> {
    const { logger, analyses } = this.deps;

    let analysis = await analyses.findById(input.analysisId, input.requestedBy);
    if (analysis === null) {
      // Analise de outro usuario tambem cai aqui: para quem pergunta, ela nao
      // existe. Um erro de permissao ja revelaria que ela existe.
      throw new NotFoundError('Analise nao encontrada.', { analysisId: input.analysisId });
    }

    // Reentrante: chamar de novo uma analise ja encerrada devolve o que ha, sem
    // recalcular e sem trocar de estado.
    if (isTerminalStatus(analysis.status)) {
      logger.info('analise ja encerrada; nada a calcular', {
        analysisId: analysis.id,
        status: analysis.status,
      });
      return analysis;
    }

    if (!canCalculateMetrics(analysis.status)) {
      throw new DomainError('A coleta desta analise ainda nao terminou.', {
        analysisId: analysis.id,
        status: analysis.status,
      });
    }

    const collectionRunId = analysis.collectionRunId;
    if (collectionRunId === null) {
      throw new DomainError('A analise nao esta vinculada a nenhuma coleta.', {
        analysisId: analysis.id,
      });
    }

    const advance = async (status: AnalysisStatus, patch: Partial<Analysis> = {}) => {
      analysis = { ...(analysis as Analysis), ...patch, status };
      await analyses.save(analysis);
      logger.info('analise avancou de estado', { analysisId: analysis.id, status });
    };

    await advance('calculating_metrics');

    try {
      const result = await this.resolveResult(collectionRunId);

      await advance('partially_completed', {
        analyticsResultId: result.id,
        completedAt: this.deps.clock.now(),
      });

      return analysis;
    } catch (error) {
      // Falha no calculo e falha OBJETIVA: diferente da falha da IA, que degrada
      // para partially_completed sem invalidar nada (RN-09). Sem metricas nao ha
      // analise.
      await advance('failed', {
        failedAt: this.deps.clock.now(),
        errorCode: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR',
      });
      throw error;
    }
  }

  /**
   * Devolve o resultado desta coleta na versao atual do algoritmo, calculando
   * apenas se ainda nao existir.
   *
   * REUSO ENTRE USUARIOS. O motor da SPEC-003 e deterministico: mesma coleta e
   * mesma versao produzem sempre o mesmo resultado. Se a analise de outra pessoa
   * ja calculou aquela coleta, recalcular queimaria CPU para chegar a um valor
   * identico. E o mesmo raciocinio da RN-10 aplicado ao calculo, e o par unico
   * (collection_run_id, algorithm_version) no banco existe para isto.
   */
  private async resolveResult(
    collectionRunId: NonNullable<Analysis['collectionRunId']>,
  ): Promise<AnalyticsResult> {
    const { clock, ids, logger, collectionRuns, analyticsResults } = this.deps;

    const existing = await analyticsResults.findByCollectionRunAndVersion(
      collectionRunId,
      ANALYTICS_ALGORITHM_VERSION,
    );
    if (existing !== null) {
      logger.info('reaproveitando metricas ja calculadas', {
        collectionRunId,
        algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
      });
      return existing;
    }

    const snapshot = await collectionRuns.findSnapshot(collectionRunId);
    if (snapshot === null) {
      throw new NotFoundError('A coleta desta analise nao tem dados guardados.', {
        collectionRunId,
      });
    }

    const capturedAt = snapshot.run.capturedAt;
    if (capturedAt === null) {
      // Uma execucao sem `capturedAt` nao passou pela API. Calcular metricas
      // temporais sobre ela produziria idades erradas.
      throw new DomainError('A coleta nao registrou o instante da captura.', {
        collectionRunId,
      });
    }

    // RN-12: as metricas sao carimbadas com o instante em que os dados foram
    // LIDOS da API, nao com o momento do calculo.
    const metrics = calculateChannelMetrics({
      videos: snapshot.videos,
      collectedAt: capturedAt,
    });

    const result: AnalyticsResult = {
      id: ids.next() as AnalyticsResultId,
      collectionRunId,
      algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
      calculatedAt: clock.now(),
      metrics,
    };

    await analyticsResults.save(result);
    return result;
  }
}
