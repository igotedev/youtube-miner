import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';

import type { Analysis, AnalysisId } from '../../domain/analysis';

/**
 * Porta de persistencia das analises.
 *
 * R7: a tabela `channel_analyses` pertence a este modulo. Watchlists e demais
 * modulos consultam analises por este contrato, nunca por SQL proprio.
 *
 * Toda leitura e ESCOPADA POR USUARIO. Nao existe `findById(id)` sem dono: a
 * assinatura torna impossivel buscar a analise de outra pessoa por engano, e o
 * RLS no banco e a segunda barreira, nao a unica.
 */
export interface AnalysisRepository {
  findById(id: AnalysisId, ownerId: UserId): Promise<Analysis | null>;

  /**
   * Analise ja existente para esta chave de idempotencia, se houver.
   *
   * Chamado ANTES de criar: se devolver algo, a solicitacao e uma repeticao e o
   * caso de uso devolve a analise existente em vez de criar outra.
   */
  findByIdempotencyKey(ownerId: UserId, idempotencyKey: string): Promise<Analysis | null>;

  /** Analises do usuario para um canal, da mais recente para a mais antiga. */
  listByChannel(ownerId: UserId, channelId: YouTubeChannelId): Promise<readonly Analysis[]>;

  /**
   * @throws {ConflictError} `idempotencyKey` ja usada por este usuario. A
   *   deteccao vem do indice unico no banco: entre consultar e inserir cabe
   *   outra requisicao.
   */
  create(analysis: Analysis): Promise<void>;

  save(analysis: Analysis): Promise<void>;
}
