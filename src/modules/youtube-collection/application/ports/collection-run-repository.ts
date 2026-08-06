import type { CollectionRun, CollectionRunId } from '../../domain/collection-run';
import type { YouTubeChannel, YouTubeChannelId } from '../../domain/youtube-channel';
import type { YouTubeVideo } from '../../domain/youtube-video';

/**
 * Dados capturados em uma execucao concluida.
 *
 * RN-04: o payload BRUTO fica no banco, em `jsonb`, separado das metricas. Este
 * tipo e a forma ja traduzida para o dominio — o que o adaptador devolve depois
 * de validar as linhas. O bruto nunca chega ao navegador (ADR-005).
 */
export interface CollectionSnapshot {
  readonly run: CollectionRun;
  readonly channel: YouTubeChannel;
  readonly videos: readonly YouTubeVideo[];
}

/**
 * Porta de persistencia das execucoes de coleta.
 *
 * R7: as tabelas `youtube_channels`, `youtube_collection_runs`,
 * `youtube_channel_snapshots` e `youtube_video_snapshots` pertencem a este
 * modulo. Nenhum outro modulo as consulta; a via e este contrato.
 *
 * Nenhum metodo le o relogio: todo instante chega por parametro (R9).
 */
export interface CollectionRunRepository {
  findById(id: CollectionRunId): Promise<CollectionRun | null>;

  /**
   * Execucao concluida e ainda dentro da validade para este canal (RN-10).
   *
   * Devolve a mais recente que satisfaca TODOS os criterios:
   *  - mesmo canal oficial;
   *  - `status === 'completed'`;
   *  - `reusableUntil !== null` e `reusableUntil >= referenceTime`;
   *  - nao invalidada;
   *  - com snapshot de canal e de videos presentes.
   *
   * @param referenceTime instante de comparacao, fornecido pela aplicacao.
   *   O repositorio NUNCA chama `new Date()` (R9): usar o relogio aqui tornaria
   *   a consulta nao reproduzivel e o teste impossivel de fixar.
   */
  findReusableForChannel(
    channelId: YouTubeChannelId,
    referenceTime: Date,
  ): Promise<CollectionRun | null>;

  /**
   * Execucao ainda em andamento para este canal, se houver.
   *
   * Consulta de leitura. A garantia real contra coleta duplicada e o indice
   * unico parcial no banco — ver `startRun`.
   */
  findActiveForChannel(channelId: YouTubeChannelId): Promise<CollectionRun | null>;

  /**
   * Cria uma execucao em `pending`, registrando o canal se ele ainda nao existir.
   *
   * @throws {ConcurrentCollectionRunError} Ja existe execucao ativa para o
   *   canal. A deteccao vem do banco, nao de uma consulta previa: entre o
   *   `SELECT` e o `INSERT` cabe outra requisicao. Ver SPEC-004, secao 15.
   */
  startRun(run: CollectionRun): Promise<CollectionRun>;

  /** Atualiza estado e carimbos de uma execucao existente. */
  save(run: CollectionRun): Promise<void>;

  /**
   * Grava os dados capturados e conclui a execucao, em uma unica operacao.
   *
   * Snapshot e conclusao andam juntos de proposito: uma execucao `completed`
   * sem snapshot seria reaproveitada e devolveria nada.
   */
  completeWithSnapshot(snapshot: CollectionSnapshot): Promise<void>;

  /** Recupera os dados capturados por uma execucao concluida. */
  findSnapshot(runId: CollectionRunId): Promise<CollectionSnapshot | null>;
}
