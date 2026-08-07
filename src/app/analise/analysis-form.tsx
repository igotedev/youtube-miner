'use client';

import { useActionState } from 'react';

import { analyzeChannel } from './actions';
import { INITIAL_ANALYSIS_STATE } from './analysis-state';
import { formatAnalysisStatus, formatCount, formatTimestamp } from './format';
import { MetricsPanel } from './metrics-panel';

/**
 * Formulario da analise.
 *
 * Componente de cliente porque precisa de `useActionState` para exibir erro e
 * estado de envio. Nao contem regra de negocio: envia a URL, recebe um estado
 * pronto e o desenha.
 */
export function AnalysisForm() {
  const [state, formAction, pending] = useActionState(analyzeChannel, INITIAL_ANALYSIS_STATE);

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="channelUrl" className="text-sm font-medium">
          URL do canal
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="channelUrl"
            name="channelUrl"
            type="text"
            required
            defaultValue="https://www.youtube.com/@canal-de-exemplo"
            placeholder="https://www.youtube.com/@canal"
            className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? 'Analisando...' : 'Analisar'}
          </button>
        </div>

        {(state.status === 'invalid' || state.status === 'error') && (
          <p aria-live="polite" role="alert" className="text-sm text-red-500">
            {state.message}
          </p>
        )}
      </form>

      {state.status === 'ready' && (
        <div className="flex flex-col gap-6">
          {state.mode === 'demonstration' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <strong>Dados de demonstracao.</strong> Nenhuma consulta foi feita ao YouTube. Os
              numeros abaixo vem de um conjunto fixo de exemplo e{' '}
              <strong>nao descrevem o canal informado</strong> — qualquer URL valida produz este
              mesmo resultado. A integracao real existe; falta a variavel{' '}
              <code className="font-mono">YOUTUBE_API_KEY</code> no ambiente.
            </p>
          )}

          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">Estado</dt>
              <dd>{formatAnalysisStatus(state.analysisStatus)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Coletado em</dt>
              <dd className="font-mono">{formatTimestamp(state.metrics.collectedAt)} UTC</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Videos analisados</dt>
              <dd className="font-mono">{formatCount(state.metrics.totalVideoCount)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Sem formato definido</dt>
              <dd className="font-mono">{formatCount(state.metrics.unclassifiedVideoCount)}</dd>
            </div>
          </dl>

          {/* RN-06: dois paineis separados, e nenhum total agregado entre eles. */}
          <div className="grid gap-4 md:grid-cols-2">
            <MetricsPanel
              title="Shorts"
              caption="Metricas calculadas apenas sobre os Shorts."
              metrics={state.metrics.shorts}
            />
            <MetricsPanel
              title="Videos longos"
              caption="Metricas calculadas apenas sobre os videos longos."
              metrics={state.metrics.long}
            />
          </div>

          <p className="text-xs text-muted">
            Shorts e videos longos nao sao somados nem comparados entre si: sao formatos com
            dinamicas de distribuicao diferentes, e uma media unica descreveria um canal que nao
            existe. Estes numeros descrevem o que foi observado — nao preveem resultado futuro.
          </p>
        </div>
      )}
    </div>
  );
}
