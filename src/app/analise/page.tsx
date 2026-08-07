import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SIGN_IN_PATH, buildAuthGateway } from '@/config/composition';

import { SignOutButton } from '../auth/sign-out-button';
import { AnalysisForm } from './analysis-form';

export const metadata: Metadata = {
  title: 'Analisar canal — YouTube Niche Miner',
  description:
    'Executa o pipeline de analise de um canal do YouTube e exibe as metricas objetivas, com Shorts e videos longos separados.',
};

/**
 * Tela de analise de canal (SPEC-006, com sessao desde a SPEC-009).
 *
 * Componente de servidor. Toda a interacao vive em `AnalysisForm`, e a execucao
 * vive na Server Action — que pede os casos de uso prontos a raiz de composicao.
 * Nenhum adaptador e instanciado nesta camada (R6).
 */
export default async function AnalysisPage() {
  /**
   * O middleware ja teria redirecionado quem nao tem sessao. Esta verificacao
   * nao e redundante: ela e a que vale.
   *
   * Se um dia esta rota sair do `matcher` do middleware — por um ajuste de
   * padrao que ninguem relacionou com autenticacao —, a pagina continua
   * protegida. A autorizacao mora junto do recurso (ADR-006, item 4).
   */
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  if (user === null) {
    redirect(`${SIGN_IN_PATH}?next=%2Fanalise`);
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <p className="text-sm text-muted">
          Conectado como <span className="font-mono">{user.email}</span>
        </p>
        <SignOutButton />
      </div>

      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          SPEC-006 — primeira superficie do pipeline
        </p>
        <h1 className="text-3xl font-semibold text-balance">Analisar um canal</h1>
        <p className="text-muted">
          Informe a URL de um canal do YouTube. A analise coleta os videos recentes, calcula as
          metricas objetivas e apresenta Shorts e videos longos separadamente.
        </p>
      </header>

      <AnalysisForm />
    </main>
  );
}
