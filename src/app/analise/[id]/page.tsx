import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { SIGN_IN_PATH, buildAnalysisPipeline, buildAuthGateway } from '@/config/composition';
import type { AnalysisId } from '@/modules/channel-analysis';
import { NotFoundError } from '@/shared/errors';

import { SignOutButton } from '../../auth/sign-out-button';
import { AnalysisResult } from '../analysis-result';
import { formatTimestamp } from '../format';

export const metadata: Metadata = {
  title: 'Analise — YouTube Niche Miner',
  description: 'Metricas de uma analise ja executada, como foram calculadas e persistidas.',
};

/**
 * Detalhe de uma analise passada (SPEC-010).
 *
 * Componente de servidor, sem formulario e sem Server Action: e leitura pura.
 *
 * ---------------------------------------------------------------------------
 * MOSTRA AS METRICAS COMO FORAM PERSISTIDAS — A COLETA INTEIRA, SEM RECORTE.
 *
 * `GetAnalysisMetrics` aceita periodo desde a SPEC anterior, e nao usa-lo aqui e
 * decisao consciente: o filtro e uma escolha do momento em que a analise foi
 * pedida, e o periodo NAO e guardado junto com ela. Reaplicar um recorte nesta
 * tela exigiria decidir de onde ele viria — e inventar um seria apresentar um
 * numero como se fosse o que o usuario pediu na epoca.
 * ---------------------------------------------------------------------------
 */

/**
 * O id vem da URL, que e entrada do usuario.
 *
 * Validado ANTES de virar consulta: `channel_analyses.id` e `uuid`, e um texto
 * qualquer produziria erro de sintaxe do PostgreSQL em vez de "nao encontrado".
 * Um id malformado nao existe — 404, como qualquer analise que nao e sua.
 */
const idSchema = z.uuid();

export default async function AnalysisDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  const { id } = await params;

  if (user === null) {
    // A verificacao que vale mora aqui, junto do recurso, e nao no proxy
    // (ADR-006, item 4).
    redirect(`${SIGN_IN_PATH}?next=${encodeURIComponent(`/analise/${id}`)}`);
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const pipeline = buildAnalysisPipeline();

  let view;
  try {
    view = await pipeline.getMetrics.execute({
      analysisId: parsedId.data as AnalysisId,
      requestedBy: user.id,
    });
  } catch (error) {
    /**
     * Analise de outro usuario cai aqui, e vira 404 — nunca "sem permissao".
     *
     * A distincao importa: "sem permissao" confirmaria que a analise existe, o
     * que ja e informacao sobre outra pessoa. Para quem pergunta, ela nao
     * existe. A escolha vem do proprio caso de uso, que so lanca `NotFoundError`.
     */
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { analysis, metrics, calculatedAt } = view;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/historico" className="underline underline-offset-4">
            Historico
          </Link>
          <Link href="/analise" className="text-muted underline underline-offset-4">
            Nova analise
          </Link>
        </div>
        <SignOutButton />
      </div>

      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          Analise {analysis.id}
        </p>
        <h1 className="text-3xl font-semibold text-balance">{analysis.channelId}</h1>
        <p className="text-sm break-all text-muted">
          Solicitada em {formatTimestamp(analysis.requestedAt)} UTC a partir de{' '}
          <span className="font-mono">{analysis.requestedUrl}</span>
        </p>
      </header>

      {pipeline.mode === 'demonstration' && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <strong>Esta instalacao esta sem</strong>{' '}
          <code className="font-mono">YOUTUBE_API_KEY</code>. Analises executadas neste estado usam
          um conjunto fixo de exemplo e nao descrevem o canal informado. O sistema{' '}
          <strong>nao registra em que modo cada analise rodou</strong>, entao esta tela nao pode
          afirmar a origem dos numeros abaixo.
        </p>
      )}

      {metrics === null ? (
        /*
         * Ausencia de metricas NAO e um conjunto de zeros (RN-08). A analise
         * existe, terminou de algum jeito, e nao ha numero para exibir.
         */
        <p className="rounded-md border border-border px-4 py-3 text-sm">
          Esta analise nao tem metricas calculadas.
          {analysis.errorCode !== null && (
            <>
              {' '}
              Ela terminou com o erro <span className="font-mono">{analysis.errorCode}</span>.
            </>
          )}
        </p>
      ) : (
        <>
          <AnalysisResult
            analysisStatus={analysis.status}
            metrics={metrics}
            requestedPeriod={null}
            coverage={null}
          />

          {calculatedAt !== null && (
            <p className="text-xs text-muted">
              Metricas calculadas em {formatTimestamp(calculatedAt)} UTC, sobre a coleta inteira.
              Esta tela nao aplica recorte por periodo: o intervalo escolhido no momento da analise
              nao e guardado com ela.
            </p>
          )}
        </>
      )}
    </main>
  );
}
