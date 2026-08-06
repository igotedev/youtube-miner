import type { UserId } from '@/modules/identity';
import type { AnalyticsResultId } from '@/modules/video-analytics';
import type { CollectionRunId, YouTubeChannelId } from '@/modules/youtube-collection';
import type { Brand } from '@/shared/domain';

import type { AnalysisStatus } from './analysis-status';

export type AnalysisId = Brand<string, 'AnalysisId'>;

/**
 * Uma analise de um canal, solicitada por um usuario.
 *
 * PERTENCE A UM USUARIO — diferente da coleta e das metricas, que sao artefatos
 * globais. Esta e a divisao central do ADR-005.
 *
 * RN-03: um mesmo canal pode ter varias analises em datas diferentes; por isso
 * `id` e a chave, nao `channelId`.
 *
 * A analise APONTA para os artefatos, em vez de contê-los. Antes da SPEC-004
 * ela embutia o snapshot bruto; isso impedia que duas analises compartilhassem
 * a mesma coleta e obrigava a gastar quota da API por usuario. Agora:
 *
 *  - `collectionRunId`   -> o que o YouTube devolveu (RN-04), global e reutilizavel
 *  - `analyticsResultId` -> o que o sistema calculou (RN-04), global
 *
 * Os dois sao `null` ate a etapa correspondente terminar.
 *
 * O relatorio de IA NAO aparece aqui, e de proposito: a chave estrangeira vai
 * no sentido `ai_insight_reports.analysis_id -> channel_analyses.id`. Guardar
 * tambem o caminho inverso criaria dois lugares para a mesma verdade, e o
 * relatorio e opcional por definicao (RN-09) — uma analise valida existe sem
 * ele. Quem precisa do relatorio o busca pela porta do modulo `ai-insights`.
 */
export interface Analysis {
  readonly id: AnalysisId;
  readonly requestedBy: UserId;
  readonly channelId: YouTubeChannelId;
  /** URL que o usuario digitou. Rastreabilidade apenas, nunca chave (RN-02). */
  readonly requestedUrl: string;
  readonly status: AnalysisStatus;

  readonly collectionRunId: CollectionRunId | null;
  readonly analyticsResultId: AnalyticsResultId | null;

  /**
   * Chave de idempotencia fornecida pelo cliente.
   *
   * Impede que um duplo clique ou um retry de rede crie duas analises do mesmo
   * canal. Unica por usuario quando presente; `null` e sempre aceito. O banco
   * nunca a gera — quem chama e responsavel por ela (SPEC-004, secao 16).
   */
  readonly idempotencyKey: string | null;

  readonly requestedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;

  /** Codigo estavel, nunca mensagem bruta de terceiro. */
  readonly errorCode: string | null;
}
