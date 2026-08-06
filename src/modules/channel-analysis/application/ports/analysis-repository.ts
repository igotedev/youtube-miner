import type { YouTubeChannelId } from '@/modules/youtube-collection';

import type { Analysis, AnalysisId } from '../../domain/analysis';

/**
 * Porta de persistencia das analises.
 *
 * R7: as tabelas de analise pertencem a este modulo. Watchlists e demais
 * modulos consultam analises por este contrato, nunca por SQL proprio.
 */
export interface AnalysisRepository {
  findById(id: AnalysisId): Promise<Analysis | null>;

  /**
   * Analise reaproveitavel mais recente do canal (RN-10).
   *
   * @param notOlderThan limite de idade; analises anteriores a este instante
   *   sao ignoradas. O chamador calcula a data a partir de
   *   ANALYSIS_FRESHNESS_HOURS — o repositorio nao conhece o relogio.
   */
  findLatestReusable(channelId: YouTubeChannelId, notOlderThan: Date): Promise<Analysis | null>;

  save(analysis: Analysis): Promise<void>;
}

/** Gerador de identificadores. Injetado para manter os casos de uso deterministicos. */
export interface AnalysisIdGenerator {
  next(): AnalysisId;
}
