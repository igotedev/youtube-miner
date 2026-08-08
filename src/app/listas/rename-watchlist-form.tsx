'use client';

import { useActionState } from 'react';

import { renameWatchlist } from './actions';
import { INITIAL_WATCHLIST_STATE } from './watchlist-state';

/**
 * Renomear a lista.
 *
 * O nome atual vem como `defaultValue`, e nao como estado controlado: quem
 * digita e o navegador, e o servidor recebe o campo pelo `FormData`. Estado
 * controlado aqui so adicionaria um lugar onde o valor exibido e o enviado
 * podem divergir.
 */
export function RenameWatchlistForm({
  watchlistId,
  currentName,
}: {
  readonly watchlistId: string;
  readonly currentName: string;
}) {
  const [state, formAction, pending] = useActionState(renameWatchlist, INITIAL_WATCHLIST_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="watchlistId" value={watchlistId} />

      <label htmlFor="rename-watchlist" className="text-sm font-medium">
        Nome da lista
      </label>

      <div className="flex flex-wrap gap-3">
        <input
          id="rename-watchlist"
          name="name"
          type="text"
          required
          maxLength={100}
          defaultValue={currentName}
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Renomear'}
        </button>
      </div>

      {state.status !== 'idle' && (
        <p
          aria-live="polite"
          className={
            state.status === 'done'
              ? 'text-sm text-muted'
              : 'text-sm text-amber-600 dark:text-amber-400'
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
