import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import { ConflictError, NotFoundError } from '@/shared/errors';

import type { WatchlistRepository } from '../../application/ports/watchlist-repository';
import type {
  NewWatchlist,
  NewWatchlistItem,
  Watchlist,
  WatchlistId,
  WatchlistItem,
  WatchlistSummary,
} from '../../domain/watchlist';
import { isSameWatchlistName } from '../../domain/watchlist';

/**
 * `WatchlistRepository` em memoria, para teste.
 *
 * ---------------------------------------------------------------------------
 * ESPELHA AS GARANTIAS DO BANCO, INCLUSIVE AS QUE INCOMODAM.
 *
 *  - nome unico por usuario IGNORANDO MAIUSCULAS, como o indice
 *    `(user_id, lower(name))` da SPEC-012;
 *  - o mesmo canal nao entra duas vezes na mesma lista;
 *  - so da para salvar canal REGISTRADO — a chave estrangeira com
 *    `youtube_channels` e o que garante isso no banco, e aqui o conjunto
 *    `registeredChannels` faz o mesmo papel;
 *  - lista de outro usuario simplesmente nao existe.
 *
 * Um fake mais permissivo que o banco esconde defeito ate a producao. Foi assim
 * que a analise apontando para canal nao registrado sobreviveu ate a SPEC-009.
 * ---------------------------------------------------------------------------
 */
export class InMemoryWatchlistRepository implements WatchlistRepository {
  private readonly lists = new Map<WatchlistId, Watchlist>();
  private readonly registeredChannels = new Set<string>();

  /**
   * Declara que o canal existe no registro global.
   *
   * Fora do contrato da porta de proposito: no banco esse vinculo e a chave
   * estrangeira, nao uma chamada. Existe aqui para o fake conseguir recusar o
   * que o banco recusaria — mesma escolha de `InMemoryChannelDirectory.setSummary`.
   */
  registerChannel(channelId: YouTubeChannelId): void {
    this.registeredChannels.add(channelId);
  }

  findById(id: WatchlistId, ownerId: UserId): Promise<Watchlist | null> {
    const found = this.lists.get(id);
    if (found === undefined || found.ownerId !== ownerId) return Promise.resolve(null);
    return Promise.resolve(found);
  }

  listByOwner(ownerId: UserId): Promise<readonly WatchlistSummary[]> {
    const found = [...this.lists.values()]
      .filter((list) => list.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((list): WatchlistSummary => ({
        id: list.id,
        ownerId: list.ownerId,
        name: list.name,
        createdAt: list.createdAt,
        itemCount: list.items.length,
      }));

    return Promise.resolve(found);
  }

  create(watchlist: NewWatchlist): Promise<void> {
    if (this.nameTaken(watchlist.ownerId, watchlist.name, null)) {
      return Promise.reject(
        new ConflictError('Ja existe uma lista com este nome.', { watchlistId: watchlist.id }),
      );
    }

    this.lists.set(watchlist.id, { ...watchlist, items: [] });
    return Promise.resolve();
  }

  async rename(id: WatchlistId, ownerId: UserId, name: string): Promise<void> {
    const list = await this.owned(id, ownerId);

    if (this.nameTaken(ownerId, name, id)) {
      throw new ConflictError('Ja existe uma lista com este nome.', { watchlistId: id });
    }

    this.lists.set(id, { ...list, name });
  }

  async remove(id: WatchlistId, ownerId: UserId): Promise<void> {
    await this.owned(id, ownerId);
    this.lists.delete(id);
  }

  async addItem(id: WatchlistId, ownerId: UserId, item: NewWatchlistItem): Promise<void> {
    const list = await this.owned(id, ownerId);

    if (!this.registeredChannels.has(item.channelId)) {
      // No banco isto e a chave estrangeira com `youtube_channels`. So da para
      // salvar canal ja analisado (SPEC-012, secao 2).
      throw new NotFoundError('Canal nao registrado.', { channelId: item.channelId });
    }

    // Idempotente: salvar de novo nao duplica e nao e erro.
    if (list.items.some((existing) => existing.channelId === item.channelId)) return;

    const entry: WatchlistItem = {
      channelId: item.channelId,
      addedAt: item.addedAt,
      note: item.note,
    };
    this.lists.set(id, { ...list, items: [...list.items, entry] });
  }

  async removeItem(id: WatchlistId, ownerId: UserId, channelId: YouTubeChannelId): Promise<void> {
    const list = await this.owned(id, ownerId);

    // Remover o que nao esta la nao e erro: o resultado desejado ja vale.
    this.lists.set(id, {
      ...list,
      items: list.items.filter((item) => item.channelId !== channelId),
    });
  }

  get size(): number {
    return this.lists.size;
  }

  private async owned(id: WatchlistId, ownerId: UserId): Promise<Watchlist> {
    const list = await this.findById(id, ownerId);
    if (list === null) throw new NotFoundError('Lista nao encontrada.', { watchlistId: id });
    return list;
  }

  /** `exceptId` permite renomear uma lista para o proprio nome sem conflito. */
  private nameTaken(ownerId: UserId, name: string, exceptId: WatchlistId | null): boolean {
    return [...this.lists.values()].some(
      (list) =>
        list.ownerId === ownerId && list.id !== exceptId && isSameWatchlistName(list.name, name),
    );
  }
}
