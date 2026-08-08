import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import {
  toDate,
  toNullableText,
  toText,
  toUuid,
} from '@/shared/infrastructure/persistence/row-mappers';

import type {
  Watchlist,
  WatchlistId,
  WatchlistItem,
  WatchlistSummary,
} from '../../domain/watchlist';

/**
 * Mapeamento entre as linhas do banco e o dominio de `watchlists`.
 *
 * Puro e testado, para que o adaptador fique fino. Uma linha corrompida FALHA
 * aqui: nenhum `as Watchlist` sobre o objeto inteiro — cada campo passa por um
 * conversor que valida.
 *
 * ---------------------------------------------------------------------------
 * O ITEM NAO VEM DE UM `SELECT`, VEM DE UMA FUNCAO.
 *
 * `watchlist_items.channel_id` e o uuid INTERNO; o dominio fala `UC...`. Um
 * `select` aninhado resolveria — e seria `watchlists` lendo `youtube_channels`,
 * o exemplo que R7 proibe com todas as letras. A traducao acontece dentro de
 * `list_watchlist_items` (SPEC-012, secao 4-A), e o que chega aqui ja e a forma
 * do dominio.
 * ---------------------------------------------------------------------------
 */

/** Linha devolvida por `list_watchlist_items`. */
export interface WatchlistItemRow {
  readonly channel_id: unknown;
  readonly added_at: unknown;
  readonly note: unknown;
}

export interface WatchlistHeaderRow {
  readonly id: unknown;
  readonly user_id: unknown;
  readonly name: unknown;
  readonly created_at: unknown;
}

/** Linha do indice: os itens vem apenas como contagem agregada. */
export interface WatchlistSummaryRow extends WatchlistHeaderRow {
  readonly watchlist_items: unknown;
}

export function toWatchlistItem(row: WatchlistItemRow): WatchlistItem {
  return {
    // O formato do identificador nao e revalidado aqui: quem entrou pelo
    // caminho normal ja passou por `parseYouTubeChannelId` na coleta, e repetir
    // a regra copiaria para ca algo que mora em outro modulo. O que este
    // arquivo garante e que o campo existe e e texto.
    channelId: toText(row.channel_id, 'list_watchlist_items.channel_id') as YouTubeChannelId,
    addedAt: toDate(row.added_at, 'list_watchlist_items.added_at'),
    // RN-08: "sem nota" e ausencia, nao string vazia.
    note: toNullableText(row.note, 'list_watchlist_items.note'),
  };
}

export function toWatchlist(
  header: WatchlistHeaderRow,
  items: readonly WatchlistItemRow[],
): Watchlist {
  return {
    id: toUuid(header.id, 'watchlists.id') as WatchlistId,
    ownerId: toUuid(header.user_id, 'watchlists.user_id') as UserId,
    name: toText(header.name, 'watchlists.name'),
    createdAt: toDate(header.created_at, 'watchlists.created_at'),
    items: items.map(toWatchlistItem),
  };
}

export function toWatchlistSummary(row: WatchlistSummaryRow): WatchlistSummary {
  return {
    id: toUuid(row.id, 'watchlists.id') as WatchlistId,
    ownerId: toUuid(row.user_id, 'watchlists.user_id') as UserId,
    name: toText(row.name, 'watchlists.name'),
    createdAt: toDate(row.created_at, 'watchlists.created_at'),
    itemCount: readAggregatedCount(row.watchlist_items),
  };
}

/**
 * Contagem agregada do PostgREST: `watchlist_items ( count )` chega como
 * `[{ count: n }]`.
 *
 * Ausencia vira `0` — e aqui isso esta certo, e nao contradiz a RN-08. Aquela
 * regra fala de dado que o YouTube nao entregou (inscricoes ocultas nao sao
 * zero inscritos). Uma lista sem canais tem, de fato, zero canais.
 */
function readAggregatedCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;

  const first: unknown = value[0];
  if (first === null || typeof first !== 'object') return 0;

  const count: unknown = (first as Record<string, unknown>)['count'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return 0;

  return count;
}
