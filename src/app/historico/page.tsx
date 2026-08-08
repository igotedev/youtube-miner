import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SIGN_IN_PATH, buildAnalysisPipeline, buildAuthGateway } from '@/config/composition';

import { SignOutButton } from '../auth/sign-out-button';
import { formatAnalysisStatus, formatTimestamp } from '../analise/format';
import { formatChannelIdentifier, formatChannelName, limitNotice } from './labels';

export const metadata: Metadata = {
  title: 'Historico — YouTube Niche Miner',
  description: 'Analises ja executadas por este usuario, da mais recente para a mais antiga.',
};

/**
 * Historico de analises (SPEC-010).
 *
 * Componente de servidor. Leitura pura: nenhum formulario, nenhuma Server
 * Action, nenhuma chamada ao YouTube, nenhuma unidade de quota.
 *
 * Ate esta tela existir, a persistencia ligada na SPEC-009 nao servia para nada
 * visivel — a analise era gravada e so aparecia na execucao que a disparou.
 */
export default async function HistoryPage() {
  /**
   * O proxy tambem redireciona quem nao tem sessao, agora que `/historico` esta
   * em `PROTECTED_PREFIXES`. Esta verificacao nao e redundante: e a que vale
   * (ADR-006, item 4). Uma rota que saia do `matcher` continua protegida.
   */
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  if (user === null) {
    redirect(`${SIGN_IN_PATH}?next=%2Fhistorico`);
  }

  const pipeline = buildAnalysisPipeline();
  const history = await pipeline.listAnalyses.execute({ requestedBy: user.id });

  const notice = limitNotice(history.reachedLimit, history.limit);

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
          SPEC-010 — historico de analises
        </p>
        <h1 className="text-3xl font-semibold text-balance">Suas analises</h1>
        <p className="text-muted">
          Da mais recente para a mais antiga. Cada analise guarda os numeros como foram calculados
          na epoca — abrir uma delas nao recoleta nada nem consulta o YouTube.
        </p>
      </header>

      {history.items.length === 0 ? (
        /*
         * Nenhuma analise e RESULTADO VALIDO, nao erro. Mesma regra que a tela
         * de analise aplica ao periodo sem videos.
         */
        <section className="flex flex-col gap-3 rounded-md border border-border px-4 py-6 text-sm">
          <p>Voce ainda nao analisou nenhum canal.</p>
          <p>
            <Link href="/analise" className="underline underline-offset-4">
              Analisar um canal
            </Link>
          </p>
        </section>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {history.items.map(({ analysis, channel }) => (
              <li key={analysis.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    href={`/analise/${analysis.id}`}
                    className="text-sm font-medium underline underline-offset-4"
                  >
                    {formatChannelName(channel)}
                  </Link>
                  <span className="font-mono text-xs text-muted">
                    {formatTimestamp(analysis.requestedAt)} UTC
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-mono text-xs text-muted">
                    {formatChannelIdentifier(channel, analysis.channelId)}
                  </span>
                  <span className="text-xs text-muted">
                    {formatAnalysisStatus(analysis.status)}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/*
            O teto so e declarado quando foi atingido. Um aviso permanente faria
            o usuario duvidar de uma lista que esta completa.
          */}
          {notice !== null && <p className="text-xs text-muted">{notice}</p>}
        </>
      )}

      <p>
        <Link href="/analise" className="text-sm underline underline-offset-4">
          Analisar outro canal
        </Link>
      </p>
    </main>
  );
}
