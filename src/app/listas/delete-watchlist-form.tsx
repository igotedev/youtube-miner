import { deleteWatchlist } from './actions';

/**
 * Apagar a lista.
 *
 * Componente de SERVIDOR: nao precisa de estado, porque a acao termina em
 * `redirect` — a tela deixa de existir.
 *
 * ---------------------------------------------------------------------------
 * A CONFIRMACAO E UM `details`, E NAO UM `confirm()`.
 *
 * Apagar leva os itens junto e nao tem desfazer, entao precisa de um segundo
 * gesto deliberado. Um dialogo do navegador daria isso e traria dois problemas:
 * bloqueia a pagina inteira e nao da para estilizar nem traduzir. O
 * `details/summary` e nativo, acessivel por teclado e nao trava nada.
 *
 * O que nao se perde: os canais continuam no registro global (a chave e
 * `restrict`) e as analises continuam no historico. Apagar a lista apaga a
 * ORGANIZACAO, nao o trabalho — e o texto abaixo diz isso.
 * ---------------------------------------------------------------------------
 */
export function DeleteWatchlistForm({ watchlistId }: { readonly watchlistId: string }) {
  return (
    <details className="rounded-md border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm">Apagar esta lista</summary>

      <div className="flex flex-col gap-3 pt-3">
        <p className="text-sm text-muted">
          A lista e os canais salvos nela somem. As <strong>analises continuam no historico</strong>{' '}
          e nada e recoletado se voce criar a lista de novo.
        </p>

        <form action={deleteWatchlist}>
          <input type="hidden" name="watchlistId" value={watchlistId} />
          <button
            type="submit"
            className="rounded-md border border-amber-500/40 px-4 py-2 text-sm font-medium"
          >
            Apagar a lista definitivamente
          </button>
        </form>
      </div>
    </details>
  );
}
