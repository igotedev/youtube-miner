import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import type { Brand } from '@/shared/domain';

export type WatchlistId = Brand<string, 'WatchlistId'>;

/**
 * Canal salvo em uma lista.
 *
 * RN-01: o item guarda o ID oficial do canal, nao a URL digitada. A URL e
 * apenas o que o usuario informou uma vez; o ID e o que sobrevive a mudanca de
 * handle.
 */
export interface WatchlistItem {
  readonly channelId: YouTubeChannelId;
  readonly addedAt: Date;
  readonly note: string | null;
}

export interface Watchlist {
  readonly id: WatchlistId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly createdAt: Date;
  readonly items: readonly WatchlistItem[];
}
