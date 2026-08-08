import { DomainError } from '@/shared/errors';

/**
 * Motivos pelos quais uma lista ou um item nao pode existir.
 *
 * Codigo estavel, nunca mensagem: quem exibe decide o texto, e a decisao e
 * tomada pelo motivo — nao por comparacao de string.
 */
export type InvalidWatchlistReason =
  'blank_name' | 'name_too_long' | 'note_too_long' | 'unknown_watchlist';

export class InvalidWatchlistError extends DomainError {
  constructor(
    readonly reason: InvalidWatchlistReason,
    message: string,
  ) {
    super(message, { reason });
  }
}
