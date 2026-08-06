import type { UserId } from '@/modules/identity';

import type { Watchlist, WatchlistId } from '../../domain/watchlist';

/**
 * Porta de persistencia das listas.
 *
 * R7: o modulo `watchlists` e dono das suas tabelas. Nenhum outro modulo le ou
 * escreve nelas diretamente — a unica via e este contrato, exposto pelo barrel
 * do modulo.
 */
export interface WatchlistRepository {
  findById(id: WatchlistId): Promise<Watchlist | null>;
  listByOwner(ownerId: UserId): Promise<readonly Watchlist[]>;
  save(watchlist: Watchlist): Promise<void>;
}
