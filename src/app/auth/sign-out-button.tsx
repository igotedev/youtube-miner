import { signOut } from './sign-out-action';

/**
 * Botao de sair.
 *
 * Formulario, e nao link: a saida e POST (ver `sign-out-action.ts`). Componente
 * de servidor — nao precisa de estado nem de interatividade no cliente.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
      >
        Sair
      </button>
    </form>
  );
}
