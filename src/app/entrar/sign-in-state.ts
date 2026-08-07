/**
 * Estado exibivel da tela de acesso.
 *
 * Vive FORA de `actions.ts` de proposito: um arquivo `'use server'` so pode
 * exportar funcoes assincronas — cada export vira um endpoint invocavel pelo
 * cliente. Tipos somem na compilacao e passariam, mas `INITIAL_SIGN_IN_STATE` e
 * um objeto e nao passa.
 *
 * Ver https://nextjs.org/docs/messages/invalid-use-server-value.
 */

export type SignInFormState =
  | { readonly status: 'idle' }
  /**
   * O link foi pedido. NAO afirma que o endereco existe, e nao pode afirmar:
   * a mensagem e identica para conta existente e inexistente. Ver ADR-006.
   */
  | { readonly status: 'sent'; readonly email: string }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'error'; readonly message: string };

export const INITIAL_SIGN_IN_STATE: SignInFormState = { status: 'idle' };
