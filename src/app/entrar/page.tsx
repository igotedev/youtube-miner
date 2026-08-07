import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// Modulo especifico, e nao o barrel. Ver a nota em `src/config/composition/index.ts`.
import { DEFAULT_SIGNED_IN_PATH, buildAuthGateway } from '@/config/composition/auth';

import { safeRedirectPath } from '../auth/safe-redirect';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = {
  title: 'Entrar — YouTube Niche Miner',
  description: 'Acesse com um link enviado para o seu e-mail. Nao ha senha.',
};

/**
 * Tela de acesso (SPEC-009).
 *
 * Componente de servidor. A interacao vive em `SignInForm` e o envio na Server
 * Action; nenhum adaptador e instanciado aqui (R6).
 */
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  /**
   * Quem ja tem sessao nao ve a tela de acesso — vai direto para onde queria ir.
   *
   * A verificacao e `getCurrentUser()`, que valida o token contra o servidor
   * Auth. O middleware ja fez a dele, e isso nao dispensa esta: a autorizacao
   * mora junto do recurso (ADR-006, item 4).
   */
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  if (user !== null) {
    const raw = params['next'];
    redirect(safeRedirectPath(typeof raw === 'string' ? raw : null, DEFAULT_SIGNED_IN_PATH));
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          SPEC-009 — acesso por link
        </p>
        <h1 className="text-3xl font-semibold text-balance">Entrar</h1>
        <p className="text-muted">
          Suas analises ficam guardadas na sua conta. Para chegar ate elas, o sistema precisa saber
          quem e voce.
        </p>
      </header>

      <SignInForm linkFailed={params['erro'] === 'link'} />
    </main>
  );
}
