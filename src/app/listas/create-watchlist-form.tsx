'use client';

import { useActionState } from 'react';

import { createWatchlist } from './actions';
import { INITIAL_WATCHLIST_STATE } from './watchlist-state';

/**
 * Criar uma lista.
 *
 * Componente de cliente porque precisa de `useActionState` para exibir o erro e
 * o estado de envio. Nao contem regra de negocio: manda o nome, recebe um
 * estado pronto e o desenha.
 */
export function CreateWatchlistForm() {
  const [state, formAction, pending] = useActionState(createWatchlist, INITIAL_WATCHLIST_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="watchlist-name" className="text-sm font-medium">
        Nova lista
      </label>

      <div className="flex flex-wrap gap-3">
        <input
          id="watchlist-name"
          name="name"
          type="text"
          required
          maxLength={100}
          placeholder="Concorrentes"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar lista'}
        </button>
      </div>

      {/*
        `aria-live` para que quem usa leitor de tela receba o resultado: o
        formulario nao muda de pagina, e sem isso a resposta passaria calada.
      */}
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
