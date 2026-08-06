import type { Brand } from '@/shared/domain';

import type { YouTubeChannelId } from './youtube-channel';

export type CollectionRunId = Brand<string, 'CollectionRunId'>;

/**
 * Estados de uma execucao de coleta.
 *
 * Sao MENOS estados que os de `Analysis` (SPEC-001), e de proposito: uma coleta
 * termina quando os dados publicos foram capturados. Calcular metricas e gerar
 * relatorio sao etapas da ANALISE de um usuario, nao da coleta global.
 */
export const COLLECTION_RUN_STATUSES = [
  'pending',
  'collecting_channel',
  'collecting_videos',
  'completed',
  'failed',
] as const;

export type CollectionRunStatus = (typeof COLLECTION_RUN_STATUSES)[number];

/**
 * Estados em que a execucao ainda esta em andamento.
 *
 * Sustentam a protecao de concorrencia: o banco impede mais de uma execucao
 * ativa por canal, por indice unico parcial. Ver SPEC-004, secao 15.
 */
export const ACTIVE_COLLECTION_RUN_STATUSES = [
  'pending',
  'collecting_channel',
  'collecting_videos',
] as const satisfies readonly CollectionRunStatus[];

const ACTIVE = new Set<CollectionRunStatus>(ACTIVE_COLLECTION_RUN_STATUSES);

/** Funcao pura. */
export function isActiveCollectionRunStatus(status: CollectionRunStatus): boolean {
  return ACTIVE.has(status);
}

/**
 * Execucao de coleta dos dados publicos de um canal.
 *
 * ARTEFATO GLOBAL. Nao pertence a nenhum usuario: dados publicos do YouTube sao
 * os mesmos para todo mundo, e uma coleta recente pode servir a varias analises
 * (RN-10). Ver ADR-005.
 *
 * `capturedAt` e o instante em que os dados foram efetivamente lidos da API —
 * e ele, e nao `completedAt`, que carimba as metricas (RN-12).
 */
export interface CollectionRun {
  readonly id: CollectionRunId;
  readonly channelId: YouTubeChannelId;
  readonly status: CollectionRunStatus;
  readonly requestedAt: Date;
  readonly startedAt: Date | null;
  readonly capturedAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
  /**
   * Ate quando esta execucao pode ser reaproveitada (RN-10).
   *
   * Sempre `null` em execucao nao concluida. A duracao NAO e decidida no
   * dominio: quem chama calcula a partir de configuracao da aplicacao
   * (`ANALYSIS_FRESHNESS_HOURS`) e entrega o instante pronto.
   */
  readonly reusableUntil: Date | null;
  /** Codigo estavel de erro. Nunca mensagem bruta de terceiro. */
  readonly errorCode: string | null;
  /**
   * Marcacao administrativa: dados suspeitos que nao devem mais servir de
   * cache, mesmo dentro da validade.
   */
  readonly invalidatedAt: Date | null;
}

/**
 * Uma execucao pode ser reaproveitada?
 *
 * Funcao pura, com o instante de referencia recebido por parametro (R9). O
 * repositorio aplica os mesmos criterios em SQL; esta funcao existe para que a
 * regra seja testavel sem banco e para que a aplicacao possa reconferir um
 * resultado antes de confiar nele.
 */
export function isReusableCollectionRun(run: CollectionRun, referenceTime: Date): boolean {
  if (run.status !== 'completed') return false;
  if (run.invalidatedAt !== null) return false;
  if (run.reusableUntil === null) return false;
  // Fronteira inclusiva: expira exatamente em `reusableUntil`.
  return run.reusableUntil.getTime() >= referenceTime.getTime();
}
