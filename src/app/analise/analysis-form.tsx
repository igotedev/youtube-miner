'use client';

import { useActionState, useState } from 'react';

import { analyzeChannel } from './actions';
import { AnalysisResult } from './analysis-result';
import { INITIAL_ANALYSIS_STATE } from './analysis-state';
import { PERIOD_SHORTCUTS, shortcutRange } from './period-input';

/**
 * Formulario da analise.
 *
 * Componente de cliente porque precisa de `useActionState` para exibir erro e
 * estado de envio. Nao contem regra de negocio: envia a URL, recebe um estado
 * pronto e o desenha.
 */
export function AnalysisForm() {
  const [state, formAction, pending] = useActionState(analyzeChannel, INITIAL_ANALYSIS_STATE);

  /**
   * As duas datas sao estado controlado APENAS para que os atalhos possam
   * preenche-las. O servidor continua recebendo os dois campos pelo FormData,
   * como qualquer formulario — nada aqui decide quais videos entram.
   */
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  /**
   * O atalho e calculado NO NAVEGADOR e apenas preenche os campos.
   *
   * Duas consequencias boas: o servidor nunca precisa ler o relogio no caminho
   * da analise, e o usuario ve exatamente qual intervalo sera enviado antes de
   * clicar em Analisar.
   */
  function applyShortcut(days: number): void {
    const range = shortcutRange(days, new Date());
    setStart(range.start);
    setEnd(range.end);
  }

  function clearPeriod(): void {
    setStart('');
    setEnd('');
  }

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

        {/*
          Filtro de periodo. Opcional de proposito: em branco analisa a coleta
          inteira, que e o comportamento que existia antes deste campo.
        */}
        <fieldset className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Periodo (opcional)</legend>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="periodStart" className="text-xs text-muted">
                Data inicial
              </label>
              <input
                id="periodStart"
                name="periodStart"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="periodEnd" className="text-xs text-muted">
                Data final
              </label>
              <input
                id="periodEnd"
                name="periodEnd"
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {PERIOD_SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.days}
                type="button"
                onClick={() => applyShortcut(shortcut.days)}
                className="rounded-md border border-border px-2.5 py-1 text-xs"
              >
                {shortcut.label}
              </button>
            ))}
            <button
              type="button"
              onClick={clearPeriod}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted"
            >
              Limpar
            </button>
          </div>

          <p className="text-xs text-muted">
            Em branco, a analise cobre todos os videos da coleta. As datas sao interpretadas em UTC,
            com os dois extremos incluidos.
          </p>
        </fieldset>

        {(state.status === 'invalid' || state.status === 'error') && (
          <p aria-live="polite" role="alert" className="text-sm text-red-500">
            {state.message}
          </p>
        )}
      </form>

      {state.status === 'ready' && (
        <div className="flex flex-col gap-6">
          {/*
            O aviso vive AQUI, e nao em `AnalysisResult`, porque so nesta tela
            ele e verdade sem ressalva: a analise acabou de rodar, nesta
            composicao. A tela de detalhe le uma analise antiga e nao tem como
            saber em que modo ela foi executada.
          */}
          {state.mode === 'demonstration' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <strong>Dados de demonstracao.</strong> Nenhuma consulta foi feita ao YouTube. Os
              numeros abaixo vem de um conjunto fixo de exemplo e{' '}
              <strong>nao descrevem o canal informado</strong> — qualquer URL valida produz este
              mesmo resultado. A integracao real existe; falta a variavel{' '}
              <code className="font-mono">YOUTUBE_API_KEY</code> no ambiente.
            </p>
          )}

          <AnalysisResult
            analysisStatus={state.analysisStatus}
            metrics={state.metrics}
            requestedPeriod={state.requestedPeriod}
            coverage={state.coverage}
            insight={state.insight}
            insightMode={state.insightMode}
          />
        </div>
      )}
    </div>
  );
}
