import type { SupabaseClient } from '@supabase/supabase-js';

import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import { NotFoundError } from '@/shared/errors';
import { translatePostgresError } from '@/shared/infrastructure/persistence/postgres-errors';

import type { WatchlistRepository } from '../../application/ports/watchlist-repository';
import type {
  NewWatchlist,
  NewWatchlistItem,
  Watchlist,
  WatchlistId,
  WatchlistSummary,
} from '../../domain/watchlist';
import {
  toWatchlist,
  toWatchlistSummary,
  type WatchlistHeaderRow,
  type WatchlistItemRow,
  type WatchlistSummaryRow,
} from './watchlist-row';

/**
 * Adaptador Supabase de `WatchlistRepository`.
 *
 * Camada FINA de proposito: conversao e validacao vivem em `watchlist-row.ts`,
 * que e puro e testado.
 *
 * ---------------------------------------------------------------------------
 * DUAS COISAS QUE NAO SAO ESTILO, E SIM DECISAO.
 *
 * 1. TODO metodo filtra por dono NO CODIGO, mesmo com RLS ativa. Este
 *    repositorio e construido com o cliente administrativo, que IGNORA RLS
 *    (ADR-005). Confiar so na policy deixaria o isolamento dependente de qual
 *    cliente foi injetado — e a injecao errada nao quebra nada visivelmente.
 *
 * 2. Item de lista entra e sai por FUNCAO do banco, nao por `insert`/`delete`.
 *    `watchlist_items.channel_id` e o uuid interno de `youtube_channels`, e
 *    traduzir isso aqui seria `watchlists` lendo tabela de `youtube-collection`
 *    — violacao de R7. Ver SPEC-012, secao 4-A.
 * ---------------------------------------------------------------------------
 */

/**
 * `watchlist_items ( count )` e agregacao do PostgREST: uma ida ao banco em vez
 * de N. O indice nao carrega os itens (SPEC-012, secao 5).
 */
const SUMMARY_COLUMNS = 'id, user_id, name, created_at, watchlist_items ( count )';
const HEADER_COLUMNS = 'id, user_id, name, created_at';

export class SupabaseWatchlistRepository implements WatchlistRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: WatchlistId, ownerId: UserId): Promise<Watchlist | null> {
    const header = await this.client
      .from('watchlists')
      .select(HEADER_COLUMNS)
      .eq('id', id)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (header.error !== null) {
      throw translatePostgresError(header.error, 'watchlist.findById');
    }
    // Lista de outra pessoa cai aqui junto com lista inexistente, e e o que se
    // quer: quem pergunta nao descobre a diferenca.
    if (header.data === null) return null;

    const items = await this.client.rpc('list_watchlist_items', {
      p_watchlist_id: id,
      p_owner_id: ownerId,
    });

    if (items.error !== null) {
      throw translatePostgresError(items.error, 'watchlist.findById.items');
    }

    return toWatchlist(
      header.data as unknown as WatchlistHeaderRow,
      (items.data ?? []) as unknown as WatchlistItemRow[],
    );
  }

  async listByOwner(ownerId: UserId): Promise<readonly WatchlistSummary[]> {
    const { data, error } = await this.client
      .from('watchlists')
      .select(SUMMARY_COLUMNS)
      .eq('user_id', ownerId)
      // Da mais recente para a mais antiga. O desempate pelo id mantem a ordem
      // estavel entre duas leituras iguais (RN-13).
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (error !== null) {
      throw translatePostgresError(error, 'watchlist.listByOwner');
    }

    const rows = (data ?? []) as unknown as WatchlistSummaryRow[];
    return rows.map(toWatchlistSummary);
  }

  async create(watchlist: NewWatchlist): Promise<void> {
    const { error } = await this.client.from('watchlists').insert({
      id: watchlist.id,
      user_id: watchlist.ownerId,
      name: watchlist.name,
      created_at: watchlist.createdAt.toISOString(),
    });

    if (error !== null) {
      // Nome repetido ignorando o caixa cai aqui como `23505`, pelo indice
      // funcional da secao 4 da SPEC-012, e vira `ConflictError`.
      throw translatePostgresError(error, 'watchlist.create');
    }
  }

  async rename(id: WatchlistId, ownerId: UserId, name: string): Promise<void> {
    const { data, error } = await this.client
      .from('watchlists')
      .update({ name })
      .eq('id', id)
      .eq('user_id', ownerId)
      // `select` depois do `update` para distinguir "nao existe / nao e sua" de
      // "atualizou". Sem isso, renomear a lista de outra pessoa devolveria
      // sucesso silencioso.
      .select('id');

    if (error !== null) {
      throw translatePostgresError(error, 'watchlist.rename');
    }
    if ((data ?? []).length === 0) {
      throw new NotFoundError('Lista nao encontrada.', { watchlistId: id });
    }
  }

  async remove(id: WatchlistId, ownerId: UserId): Promise<void> {
    const { data, error } = await this.client
      .from('watchlists')
      .delete()
      .eq('id', id)
      .eq('user_id', ownerId)
      .select('id');

    if (error !== null) {
      throw translatePostgresError(error, 'watchlist.remove');
    }
    // Apagar lista de outra pessoa e 404, nao sucesso. Idempotencia sem
    // verificacao faria o usuario acreditar que apagou algo que nao era dele.
    if ((data ?? []).length === 0) {
      throw new NotFoundError('Lista nao encontrada.', { watchlistId: id });
    }
  }

  async addItem(id: WatchlistId, ownerId: UserId, item: NewWatchlistItem): Promise<void> {
    // A funcao verifica o dono, traduz o identificador e insere de forma
    // idempotente — as tres coisas em uma instrucao. Entre um `select` de
    // verificacao e um `insert` cabe outra requisicao.
    const { error } = await this.client.rpc('add_watchlist_item', {
      p_watchlist_id: id,
      p_owner_id: ownerId,
      p_channel_id: item.channelId,
      p_note: item.note,
    });

    if (error !== null) {
      // Lista inexistente, lista de outra pessoa e canal nunca analisado chegam
      // como `23503` e viram `NotFoundError`. Sao situacoes diferentes para o
      // sistema, e a mesma resposta para quem pergunta — de proposito.
      throw translatePostgresError(error, 'watchlist.addItem');
    }
  }

  async removeItem(id: WatchlistId, ownerId: UserId, channelId: YouTubeChannelId): Promise<void> {
    const { error } = await this.client.rpc('remove_watchlist_item', {
      p_watchlist_id: id,
      p_owner_id: ownerId,
      p_channel_id: channelId,
    });

    if (error !== null) {
      throw translatePostgresError(error, 'watchlist.removeItem');
    }
  }
}
