import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';

import type {
  NewWatchlist,
  NewWatchlistItem,
  Watchlist,
  WatchlistId,
  WatchlistSummary,
} from '../../domain/watchlist';

/**
 * Porta de persistencia das listas.
 *
 * R7: o modulo `watchlists` e dono das suas tabelas. Nenhum outro modulo le ou
 * escreve nelas diretamente — a unica via e este contrato, exposto pelo barrel
 * do modulo.
 *
 * ---------------------------------------------------------------------------
 * TODO METODO EXIGE O DONO, E ISSO NASCEU DE UM ACHADO.
 *
 * Ate a auditoria de 2026-08-08 esta porta declarava `findById(id)`, sem dono —
 * o mesmo formato do achado P2-2, que em `ai-insights` fazia a seguranca
 * depender da ORDEM DAS CHAMADAS em vez do tipo. La foi correcao; aqui deu para
 * nascer certo, porque a porta nunca teve implementacao.
 *
 * Nenhum metodo aqui aceita busca ou escrita sem dono. Nao ha como esquecer.
 * ---------------------------------------------------------------------------
 *
 * METODOS EXPLICITOS, E NAO UM `save(watchlist)`. Um save do agregado inteiro
 * obrigaria o adaptador a reconciliar itens — descobrir o que entrou, o que
 * saiu, o que mudou — em duas tabelas, sem transacao declarada. Cada metodo
 * abaixo corresponde a UMA acao do usuario e a UMA instrucao SQL.
 */
export interface WatchlistRepository {
  /** A lista COM os itens. `null` tambem quando ela e de outra pessoa. */
  findById(id: WatchlistId, ownerId: UserId): Promise<Watchlist | null>;

  /**
   * As listas do usuario, SEM os itens, da mais recente para a mais antiga.
   *
   * `itemCount` vem do banco. Carregar os itens para conta-los traria dado que
   * a tela de indice nao usa (SPEC-012, secao 5).
   */
  listByOwner(ownerId: UserId): Promise<readonly WatchlistSummary[]>;

  /**
   * @throws {ConflictError} Ja existe lista com este nome — comparacao
   *   ignorando maiusculas, como o indice `(user_id, lower(name))`.
   */
  create(watchlist: NewWatchlist): Promise<void>;

  /** @throws {ConflictError} Mesmo motivo de `create`. */
  rename(id: WatchlistId, ownerId: UserId, name: string): Promise<void>;

  remove(id: WatchlistId, ownerId: UserId): Promise<void>;

  /**
   * Salva um canal na lista.
   *
   * IDEMPOTENTE: salvar duas vezes o mesmo canal e o mesmo que salvar uma. Um
   * duplo clique nao e erro do usuario, e a constraint
   * `unique (watchlist_id, channel_id)` ja recusa a duplicata no banco.
   *
   * @throws {NotFoundError} A lista nao existe, nao e sua, ou o canal nunca foi
   *   registrado — so da para salvar canal ja analisado (SPEC-012, secao 2).
   */
  addItem(id: WatchlistId, ownerId: UserId, item: NewWatchlistItem): Promise<void>;

  /** Remover o que nao esta la nao e erro: o resultado desejado ja vale. */
  removeItem(id: WatchlistId, ownerId: UserId, channelId: YouTubeChannelId): Promise<void>;
}
