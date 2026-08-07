import type { Metadata } from 'next';

import { AnalysisForm } from './analysis-form';

export const metadata: Metadata = {
  title: 'Analisar canal — YouTube Niche Miner',
  description:
    'Executa o pipeline de analise de um canal do YouTube e exibe as metricas objetivas, com Shorts e videos longos separados.',
};

/**
 * Tela de analise de canal (SPEC-006).
 *
 * Componente de servidor, sem estado. Toda a interacao vive em `AnalysisForm`, e
 * a execucao vive na Server Action — que pede os casos de uso prontos a raiz de
 * composicao. Nenhum adaptador e instanciado nesta camada (R6).
 */
export default function AnalysisPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
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
