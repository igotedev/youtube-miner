'use client';

import { useActionState } from 'react';

import { requestMagicLink } from './actions';
import { INITIAL_SIGN_IN_STATE } from './sign-in-state';

/**
 * Formulario de acesso.
 *
 * Componente de cliente porque precisa de `useActionState` para exibir o estado
 * do envio. Nao contem regra: envia o endereco, recebe um estado pronto e o
 * desenha.
 */
export function SignInForm({ linkFailed }: { readonly linkFailed: boolean }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, INITIAL_SIGN_IN_STATE);

  if (state.status === 'sent') {
    return (
      <div
        aria-live="polite"
        className="flex flex-col gap-3 rounded-md border border-border px-4 py-4"
      >
        <p className="text-sm">
          Se <strong className="font-mono">{state.email}</strong> puder receber e-mails, um link de
          acesso acabou de ser enviado.
        </p>
        {/*
          A frase acima e condicional de proposito. Confirmar o envio afirmaria
          que a conta existe, e a tela de acesso viraria um jeito de descobrir
          quem esta cadastrado. Ver ADR-006.
        */}
        <p className="text-sm text-muted">
          O link vale por uma hora e serve uma vez so. Nao encontrou? Verifique o spam antes de
          pedir outro.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {linkFailed && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          Esse link de acesso nao vale mais. Links expiram em uma hora e funcionam uma unica vez —
          peca outro abaixo.
        </p>
      )}

      <label htmlFor="email" className="text-sm font-medium">
        Seu e-mail
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="voce@exemplo.com"
          className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Enviando...' : 'Receber link'}
        </button>
      </div>

      {(state.status === 'invalid' || state.status === 'error') && (
        <p aria-live="polite" role="alert" className="text-sm text-red-500">
          {state.message}
        </p>
      )}

      <p className="text-sm text-muted">
        Nao ha senha. Voce recebe um link por e-mail e entra clicando nele — se ainda nao tiver
        conta, ela e criada nesse momento.
      </p>
    </form>
  );
}
