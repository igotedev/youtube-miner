import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import type { Brand } from '@/shared/domain';

import { InvalidWatchlistError } from './errors/invalid-watchlist';

export type WatchlistId = Brand<string, 'WatchlistId'>;

/**
 * Limites do dominio, espelhando as constraints do banco.
 *
 * Os dois lugares precisam concordar. Aqui a violacao vira erro com motivo, e a
 * tela consegue explicar; no banco ela e a ultima barreira, para o caso de
 * alguem escrever direto.
 */
export const MAX_WATCHLIST_NAME_LENGTH = 100;
export const MAX_WATCHLIST_NOTE_LENGTH = 2_000;

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

/**
 * O que a tela de indice precisa saber, e nada alem.
 *
 * SEM OS ITENS, de proposito. Carregar todos os itens de todas as listas para
 * desenhar um indice traria dado que a tela nao usa. `itemCount` vem do banco,
 * e nao de um `length` sobre uma lista carregada a toa.
 *
 * Mesma decisao de `ChannelSummary` na SPEC-010.
 */
export interface WatchlistSummary {
  readonly id: WatchlistId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly createdAt: Date;
  readonly itemCount: number;
}

/** Uma lista que ainda nao existe. Sem itens: eles entram depois, um a um. */
export interface NewWatchlist {
  readonly id: WatchlistId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly createdAt: Date;
}

export interface NewWatchlistItem {
  readonly channelId: YouTubeChannelId;
  readonly addedAt: Date;
  readonly note: string | null;
}

/**
 * Normaliza e valida o nome de uma lista. Funcao pura (RN-13).
 *
 * Apara as pontas ANTES de medir: `'  '` e nome em branco, e `'  x  '` tem um
 * caractere, nao cinco. Sem isso, o banco recusaria depois com uma mensagem que
 * a tela nao sabe traduzir — `length(btrim(name)) > 0` e a constraint la.
 *
 * Devolve o nome normalizado para que o chamador grave o que foi validado, e
 * nao o texto cru.
 *
 * @throws {InvalidWatchlistError}
 */
export function normalizeWatchlistName(raw: string): string {
  const name = raw.trim();

  if (name.length === 0) {
    throw new InvalidWatchlistError('blank_name', 'A lista precisa de um nome.');
  }
  if (name.length > MAX_WATCHLIST_NAME_LENGTH) {
    throw new InvalidWatchlistError(
      'name_too_long',
      `O nome da lista passa de ${MAX_WATCHLIST_NAME_LENGTH} caracteres.`,
    );
  }

  return name;
}

/**
 * Normaliza e valida a nota de um item. Funcao pura (RN-13).
 *
 * Ausencia e `null`, nunca string vazia (RN-08): "sem nota" e diferente de
 * "nota vazia", e so o primeiro tem significado. Texto so com espacos vira
 * `null` pelo mesmo motivo.
 */
export function normalizeWatchlistNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const note = raw.trim();
  if (note.length === 0) return null;

  if (note.length > MAX_WATCHLIST_NOTE_LENGTH) {
    throw new InvalidWatchlistError(
      'note_too_long',
      `A nota passa de ${MAX_WATCHLIST_NOTE_LENGTH} caracteres.`,
    );
  }

  return note;
}

/**
 * Dois nomes sao o mesmo para efeito de unicidade?
 *
 * Espelha o indice `(user_id, lower(name))` criado pela SPEC-012. Existe para
 * que o adaptador em memoria aplique a MESMA regra do banco — um fake mais
 * permissivo esconde defeito ate a producao.
 *
 * `toLowerCase()` e o que o `lower()` do PostgreSQL faz; nenhum dos dois
 * pretende resolver equivalencia de acentos.
 */
export function isSameWatchlistName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
