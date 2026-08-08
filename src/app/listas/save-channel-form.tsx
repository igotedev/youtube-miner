'use client';

import { useActionState } from 'react';

import { saveChannelToWatchlist } from './actions';
import { INITIAL_WATCHLIST_STATE } from './watchlist-state';

/**
 * Salvar o canal desta analise em uma das listas do usuario.
 *
 * As listas chegam PRONTAS do componente de servidor que renderiza este. Buscar
 * daqui exigiria uma rota que devolvesse as listas ao navegador — mais um
 * endpoint para autorizar, resolvendo um problema que a pagina ja resolveu.
 *
 * Salvar de novo o mesmo canal NAO e erro: a acao e idempotente por desenho, e
 * a resposta e a mesma confirmacao.
 */
export function SaveChannelForm({
  channelId,
  options,
}: {
  readonly channelId: string;
  readonly options: readonly { readonly id: string; readonly name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    saveChannelToWatchlist,
    INITIAL_WATCHLIST_STATE,
  );

  if (options.length === 0) {
    // Sem lista nenhuma nao ha o que escolher. Um seletor vazio ao lado de um
    // botao ativo so produziria um erro que o usuario nao sabe corrigir.
    return null;
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-border px-4 py-4"
    >
      <input type="hidden" name="channelId" value={channelId} />

      <label htmlFor="save-watchlist" className="text-sm font-medium">
        Salvar em uma lista
      </label>

      <div className="flex flex-wrap gap-3">
        <select
          id="save-watchlist"
          name="watchlistId"
          required
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      <input
        name="note"
        type="text"
        maxLength={2000}
        placeholder="Nota (opcional)"
        className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
      />

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
