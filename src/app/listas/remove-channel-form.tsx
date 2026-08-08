'use client';

import { useActionState } from 'react';

import { removeChannelFromWatchlist } from './actions';
import { INITIAL_WATCHLIST_STATE } from './watchlist-state';

/**
 * Tirar um canal da lista.
 *
 * Nao pede confirmacao, e isso e decisao: o canal continua analisado, a analise
 * continua no historico, e salva-lo de novo custa um clique. Confirmar cada
 * remocao aqui treinaria o usuario a clicar em "sim" sem ler — e o dia em que a
 * confirmacao importar de verdade, ele nao vai ler tambem.
 */
export function RemoveChannelForm({
  watchlistId,
  channelId,
}: {
  readonly watchlistId: string;
  readonly channelId: string;
}) {
  const [state, formAction, pending] = useActionState(
    removeChannelFromWatchlist,
    INITIAL_WATCHLIST_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="watchlistId" value={watchlistId} />
      <input type="hidden" name="channelId" value={channelId} />

      <button
        type="submit"
        disabled={pending}
        className="text-xs text-muted underline underline-offset-4 disabled:opacity-50"
      >
        {pending ? 'Removendo...' : 'Remover'}
      </button>

      {/* So o erro aparece aqui: o sucesso ja se ve — a linha some da lista. */}
      {(state.status === 'error' || state.status === 'invalid') && (
        <p aria-live="polite" className="text-xs text-amber-600 dark:text-amber-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
