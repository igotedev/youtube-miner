'use client';

import { useActionState, useState } from 'react';

import type { AnalyzedPeriod } from '@/modules/video-analytics';

import { analyzeChannel } from './actions';
import { INITIAL_ANALYSIS_STATE } from './analysis-state';
import {
  formatAnalysisStatus,
  formatCount,
  formatDate,
  formatDateRange,
  formatIntervalDays,
  formatTimestamp,
} from './format';
import { MetricsPanel } from './metrics-panel';
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
          {state.mode === 'demonstration' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <strong>Dados de demonstracao.</strong> Nenhuma consulta foi feita ao YouTube. Os
              numeros abaixo vem de um conjunto fixo de exemplo e{' '}
              <strong>nao descrevem o canal informado</strong> — qualquer URL valida produz este
              mesmo resultado. A integracao real existe; falta a variavel{' '}
              <code className="font-mono">YOUTUBE_API_KEY</code> no ambiente.
            </p>
          )}

          {state.requestedPeriod !== null && (
            <PeriodSummary
              period={state.requestedPeriod}
              coverage={state.coverage}
              analyzed={state.metrics.totalVideoCount}
            />
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

          {/*
            Zero videos e um RESULTADO VALIDO, nao uma falha: o intervalo pedido
            simplesmente nao tem video. Exibir os paineis zerados sugeriria um
            canal sem visualizacoes, que e outra afirmacao (RN-08).
          */}
          {state.metrics.totalVideoCount === 0 ? (
            <p className="rounded-md border border-border px-4 py-3 text-sm">
              Nao foram encontrados videos no periodo selecionado.
            </p>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Resumo do recorte por periodo.
 *
 * Exibe TRES coisas que sao facilmente confundidas e significam coisas
 * diferentes:
 *
 *  - o intervalo PEDIDO;
 *  - o que a coleta ALCANCA (os uploads mais recentes, sem filtro);
 *  - quantos videos sobraram dentro do pedido.
 *
 * Sem a segunda, um resultado vazio pareceria "o canal nao publicou", quando a
 * verdade costuma ser "a coleta nao chega ate la".
 */
function PeriodSummary({
  period,
  coverage,
  analyzed,
}: {
  readonly period: { readonly start: Date; readonly end: Date };
  readonly coverage: { readonly videoCount: number; readonly period: AnalyzedPeriod } | null;
  readonly analyzed: number;
}) {
  const requestedDays = (period.end.getTime() - period.start.getTime()) / 86_400_000;

  /**
   * O pedido cai inteiramente fora do que a coleta cobre?
   *
   * Neste caso o resultado vazio nao diz nada sobre o canal, e a tela precisa
   * dizer por que — senao o usuario conclui a coisa errada.
   *
   * Os DOIS lados importam, e por motivos diferentes:
   *
   *  - antes da cobertura: a coleta traz so os uploads mais recentes e nao
   *    alcanca aquele passado;
   *  - depois da cobertura: o canal simplesmente nao publicou desde entao — que
   *    e uma informacao sobre o canal, e nao uma limitacao da coleta.
   *
   * Uma mensagem unica para os dois casos estaria errada em um deles.
   */
  const coverageStart = coverage?.period.firstPublishedAt ?? null;
  const coverageEnd = coverage?.period.lastPublishedAt ?? null;
  const beforeCoverage = coverageStart !== null && period.end.getTime() < coverageStart.getTime();
  const afterCoverage = coverageEnd !== null && period.start.getTime() > coverageEnd.getTime();

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border px-4 py-3 text-sm">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex gap-2">
          <dt className="text-muted">Periodo solicitado</dt>
          <dd className="font-mono">{formatDateRange(period.start, period.end)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Duracao</dt>
          {/*
            Arredondado para cima: de 01/01 00:00 a 31/01 23:59 sao 30,99 dias, e
            o usuario que digitou esse intervalo conta 31 dias.
          */}
          <dd className="font-mono">{formatIntervalDays(Math.ceil(requestedDays))}</dd>
        </div>
        {coverage !== null && (
          <div className="flex gap-2">
            <dt className="text-muted">Videos na coleta</dt>
            <dd className="font-mono">{formatCount(coverage.videoCount)}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="text-muted">Videos no periodo</dt>
          <dd className="font-mono">{formatCount(analyzed)}</dd>
        </div>
      </dl>

      {coverage !== null && (
        <p className="text-xs text-muted">
          A coleta traz os uploads mais recentes do canal e cobre{' '}
          <span className="font-mono">{formatDateRange(coverageStart, coverageEnd)}</span>. O filtro
          seleciona dentro dessa cobertura — nao busca vídeos mais antigos.
        </p>
      )}

      {beforeCoverage && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <strong>O periodo pedido e anterior a cobertura da coleta.</strong> Isso nao significa que
          o canal nao publicou nessas datas — significa que a coleta traz os uploads mais recentes e
          comeca em <span className="font-mono">{formatDate(coverageStart)}</span>.
        </p>
      )}

      {afterCoverage && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <strong>Nenhum video coletado e posterior a este periodo.</strong> O upload mais recente
          do canal na coleta e de <span className="font-mono">{formatDate(coverageEnd)}</span>.
        </p>
      )}
    </section>
  );
}
