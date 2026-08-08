/**
 * Estado exibivel das telas de listas.
 *
 * Vive FORA de `actions.ts` de proposito: um arquivo `'use server'` so pode
 * exportar funcoes assincronas — cada export vira um endpoint invocavel pelo
 * navegador. Tipos somem na compilacao e passariam, mas
 * `INITIAL_WATCHLIST_STATE` e um objeto e nao passa.
 *
 * Ver https://nextjs.org/docs/messages/invalid-use-server-value.
 */

export type WatchlistFormState =
  | { readonly status: 'idle' }
  /** Entrada recusada antes de tocar o banco. O texto explica o que corrigir. */
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
  /**
   * Deu certo. `message` existe porque uma acao silenciosa em uma tela que nao
   * muda de lugar — salvar um canal, por exemplo — deixaria o usuario sem saber
   * se algo aconteceu.
   */
  | { readonly status: 'done'; readonly message: string };

export const INITIAL_WATCHLIST_STATE: WatchlistFormState = { status: 'idle' };
