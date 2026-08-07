import type { UserId } from '@/modules/identity';
import type {
  ChannelDirectory,
  ChannelResolver,
  CollectionRun,
  CollectionRunId,
  YouTubeChannelId,
  YouTubeChannelSource,
} from '@/modules/youtube-collection';
import { MAX_RECENT_VIDEOS } from '@/modules/youtube-collection';
import type { CollectionRunRepository } from '@/modules/youtube-collection';
import type { Clock, UuidGenerator } from '@/shared/domain';
import type { Logger } from '@/shared/observability';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import type { AnalysisStatus } from '../../domain/analysis-status';
import type { AnalysisRepository } from '../ports/analysis-repository';

/**
 * Caso de uso: iniciar a analise de um canal.
 *
 * ESCOPO ATUAL — leia antes de mexer.
 *
 * Percorre `pending` -> `collecting_channel` -> `collecting_videos` e PARA.
 * Nao vai ate `completed` de proposito: `calculating_metrics` precisa que o
 * resultado da SPEC-003 seja persistido pelo caso de uso de metricas, e
 * `generating_insights` depende do adaptador Claude, que nao existe.
 *
 * O que a SPEC-004 acrescentou aqui e a RN-10: antes de coletar, o caso de uso
 * procura uma coleta recente do MESMO canal, feita para qualquer usuario. Se
 * encontrar, reaproveita e nao gasta uma unidade de quota sequer.
 */

export interface StartChannelAnalysisInput {
  readonly requestedBy: UserId;
  readonly channelUrl: string;
  /** Fornecida por quem chama; impede duplicar a analise em um retry. */
  readonly idempotencyKey?: string;
}

export interface StartChannelAnalysisDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ids: UuidGenerator;
  readonly channelResolver: ChannelResolver;
  readonly channelSource: YouTubeChannelSource;
  readonly analyses: AnalysisRepository;
  readonly collectionRuns: CollectionRunRepository;
  /**
   * Garante que o canal existe antes de a analise apontar para ele.
   *
   * Ver a chamada em `execute` para o motivo — que e uma chave estrangeira
   * real, e nao simetria de desenho.
   */
  readonly channelDirectory: ChannelDirectory;
  /**
   * Por quantas horas uma coleta concluida serve de cache (RN-10).
   *
   * Chega como numero puro, vindo de `ANALYSIS_FRESHNESS_HOURS`. O dominio nao
   * le configuracao (R8): quem monta o caso de uso resolve o valor.
   */
  readonly analysisFreshnessHours: number;
}

const MS_PER_HOUR = 3_600_000;

export class StartChannelAnalysis {
  constructor(private readonly deps: StartChannelAnalysisDependencies) {}

  async execute(input: StartChannelAnalysisInput): Promise<Analysis> {
    const { clock, logger, ids, channelResolver, analyses, collectionRuns, channelDirectory } =
      this.deps;

    // Idempotencia antes de qualquer trabalho: um retry de rede nao pode virar
    // uma segunda analise nem uma segunda coleta.
    if (input.idempotencyKey !== undefined) {
      const existing = await analyses.findByIdempotencyKey(input.requestedBy, input.idempotencyKey);
      if (existing !== null) {
        logger.info('solicitacao repetida; devolvendo analise existente', {
          analysisId: existing.id,
        });
        return existing;
      }
    }

    const channelId = await channelResolver.resolveChannelId(input.channelUrl);
    const startedAt = clock.now();

    /**
     * O canal precisa existir ANTES de a analise apontar para ele.
     *
     * Nao e simetria de desenho: `channel_analyses.channel_id` referencia
     * `youtube_channels`, e sem esta linha a primeira analise de um canal novo
     * falha com violacao de chave estrangeira. Quem registrava o canal era a
     * coleta, la embaixo em `collect()` — depois de `analyses.create`.
     *
     * O defeito ficou invisivel enquanto a persistencia era em memoria: o
     * repositorio falso aceita qualquer identificador de canal. Apareceu na
     * primeira execucao contra o PostgreSQL.
     */
    await channelDirectory.ensureRegistered(channelId);

    let analysis: Analysis = {
      id: ids.next() as AnalysisId,
      requestedBy: input.requestedBy,
      channelId,
      requestedUrl: input.channelUrl,
      status: 'pending',
      collectionRunId: null,
      analyticsResultId: null,
      idempotencyKey: input.idempotencyKey ?? null,
      requestedAt: startedAt,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorCode: null,
    };
    await analyses.create(analysis);

    const advance = async (status: AnalysisStatus, patch: Partial<Analysis> = {}) => {
      analysis = { ...analysis, ...patch, status };
      await analyses.save(analysis);
      logger.info('analise avancou de estado', { analysisId: analysis.id, status });
    };

    // RN-10: coleta recente de qualquer usuario serve para este canal.
    const reusable = await collectionRuns.findReusableForChannel(channelId, startedAt);

    if (reusable !== null) {
      logger.info('reaproveitando coleta recente', {
        analysisId: analysis.id,
        collectionRunId: reusable.id,
      });
      await advance('collecting_videos', {
        startedAt,
        collectionRunId: reusable.id,
      });
      return analysis;
    }

    await advance('collecting_channel', { startedAt });
    const run = await this.collect(channelId, startedAt);

    await advance('collecting_videos', { collectionRunId: run.id });
    return analysis;
  }

  /** Executa uma coleta nova e a conclui com o snapshot. */
  private async collect(channelId: YouTubeChannelId, startedAt: Date): Promise<CollectionRun> {
    const { clock, ids, channelSource, collectionRuns, analysisFreshnessHours } = this.deps;

    const pending = await collectionRuns.startRun({
      id: ids.next() as CollectionRunId,
      channelId,
      status: 'pending',
      requestedAt: startedAt,
      startedAt,
      capturedAt: null,
      completedAt: null,
      failedAt: null,
      reusableUntil: null,
      errorCode: null,
      invalidatedAt: null,
    });

    const channel = await channelSource.fetchChannel(channelId);
    const videos = await channelSource.fetchRecentVideos(channelId, MAX_RECENT_VIDEOS);

    // RN-12: `capturedAt` e o instante em que os dados foram lidos da API, e e
    // ele que carimba as metricas depois.
    const capturedAt = clock.now();
    const completed: CollectionRun = {
      ...pending,
      status: 'completed',
      capturedAt,
      completedAt: capturedAt,
      reusableUntil: new Date(capturedAt.getTime() + analysisFreshnessHours * MS_PER_HOUR),
    };

    await collectionRuns.completeWithSnapshot({ run: completed, channel, videos });
    return completed;
  }
}
