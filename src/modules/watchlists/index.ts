/** Superficie publica do modulo `watchlists`. */
export type {
  NewWatchlist,
  NewWatchlistItem,
  Watchlist,
  WatchlistId,
  WatchlistItem,
  WatchlistSummary,
} from './domain/watchlist';
export {
  MAX_WATCHLIST_NAME_LENGTH,
  MAX_WATCHLIST_NOTE_LENGTH,
  isSameWatchlistName,
  normalizeWatchlistName,
  normalizeWatchlistNote,
} from './domain/watchlist';
export {
  InvalidWatchlistError,
  type InvalidWatchlistReason,
} from './domain/errors/invalid-watchlist';
export type { WatchlistRepository } from './application/ports/watchlist-repository';
export {
  ManageWatchlists,
  type ManageWatchlistsDependencies,
} from './application/use-cases/manage-watchlists';
export {
  GetWatchlist,
  type GetWatchlistDependencies,
  type GetWatchlistInput,
  type WatchlistEntry,
  type WatchlistView,
} from './application/queries/get-watchlist';
