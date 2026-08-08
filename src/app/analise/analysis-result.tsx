import type { CompositionMode } from '@/config/composition';
import type { InsightReport } from '@/modules/ai-insights';
import type { CollectionCoverage } from '@/modules/channel-analysis';
import type { AnalysisPeriod, AnalyzedPeriod, ChannelMetrics } from '@/modules/video-analytics';

import { InsightPanel } from './insight-panel';
import {
  formatAnalysisStatus,
  formatCount,
  formatDate,
  formatDateRange,
  formatIntervalDays,
  formatTimestamp,
} from './format';
import { MetricsPanel } from './metrics-panel';

/**
 * Bloco de resultado de uma analise.
 *
 * Sem `'use client'` e sem hook nenhum: e usado pelo formulario, que e componente
 * de cliente, e pela tela de detalhe do historico, que e de servidor. Um estado
 * interno aqui impediria o segundo caso.
 *
 * O que NAO esta aqui: o aviso de dados de demonstracao. Ele afirma algo sobre a
 * ORIGEM dos numeros, e a origem depende de quando a analise rodou — nao de quem
 * a esta exibindo. Cada tela decide o que pode afirmar com honestidade.
 */

interface AnalysisResultProps {
  readonly analysisStatus: string;
  readonly metrics: ChannelMetrics;
  /** Intervalo pedido. `null` quando a leitura cobriu a coleta inteira. */
  readonly requestedPeriod: AnalysisPeriod | null;
  /** O que a coleta alcanca. `null` quando nao houve recorte. */
  readonly coverage: CollectionCoverage | null;
  /** Relatorio de IA. `null` quando nao ha. */
  readonly insight: InsightReport | null;
  /** Se a IA esta ligada nesta composicao. */
  readonly insightMode: CompositionMode;
}

export function AnalysisResult({
  analysisStatus,
  metrics,
  requestedPeriod,
  coverage,
  insight,
  insightMode,
}: AnalysisResultProps) {
  return (
    <div className="flex flex-col gap-6">
      {requestedPeriod !== null && (
        <PeriodSummary
          period={requestedPeriod}
          coverage={coverage}
          analyzed={metrics.totalVideoCount}
        />
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">Estado</dt>
          <dd>{formatAnalysisStatus(analysisStatus)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Coletado em</dt>
          <dd className="font-mono">{formatTimestamp(metrics.collectedAt)} UTC</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Videos analisados</dt>
          <dd className="font-mono">{formatCount(metrics.totalVideoCount)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Sem formato definido</dt>
          <dd className="font-mono">{formatCount(metrics.unclassifiedVideoCount)}</dd>
        </div>
      </dl>

      {/*
        Zero videos e um RESULTADO VALIDO, nao uma falha: o intervalo pedido
        simplesmente nao tem video. Exibir os paineis zerados sugeriria um
        canal sem visualizacoes, que e outra afirmacao (RN-08).
      */}
      {metrics.totalVideoCount === 0 ? (
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
              metrics={metrics.shorts}
            />
            <MetricsPanel
              title="Videos longos"
              caption="Metricas calculadas apenas sobre os videos longos."
              metrics={metrics.long}
            />
          </div>

          <p className="text-xs text-muted">
            Shorts e videos longos nao sao somados nem comparados entre si: sao formatos com
            dinamicas de distribuicao diferentes, e uma media unica descreveria um canal que nao
            existe. Estes numeros descrevem o que foi observado — nao preveem resultado futuro.
          </p>

          {/*
            O relatorio vem DEPOIS dos paineis e em moldura propria. Entre as
            linhas de metrica, ele seria lido como tendo a mesma procedencia dos
            numeros — que e exatamente o que a segunda regra de produto proibe.
          */}
          <InsightPanel insight={insight} mode={insightMode} />
        </>
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
