import type { CompositionMode } from '@/config/composition';
import type { InsightReport } from '@/modules/ai-insights';

import { formatTimestamp } from './format';

/**
 * Bloco do relatorio de IA (SPEC-011, secao 9).
 *
 * ---------------------------------------------------------------------------
 * A SEPARACAO VISUAL E A SEGUNDA REGRA DE PRODUTO, NAO ESTILO.
 *
 * "Estimativa nunca e apresentada como dado oficial." Um texto de IA
 * intercalado entre as linhas de metrica seria lido como tendo a mesma
 * procedencia dos numeros. Por isso este bloco fica ABAIXO dos paineis, em
 * moldura propria, rotulado, com o modelo e o instante da geracao.
 *
 * Nenhum numero calculado e repetido aqui. Se o texto citar um, ele vem do
 * modelo — e fica visivelmente atribuido a ele, ao lado do numero calculado e
 * nunca no lugar dele.
 * ---------------------------------------------------------------------------
 */

interface InsightPanelProps {
  readonly insight: InsightReport | null;
  /** `demonstration` quando a composicao esta sem `GEMINI_API_KEY`. */
  readonly mode: CompositionMode;
}

export function InsightPanel({ insight, mode }: InsightPanelProps) {
  if (insight === null) {
    /*
     * Ausencia com MOTIVO. Um espaco vazio faria o usuario procurar um defeito;
     * dizer "nao foi possivel" sem dizer por que faria ele tentar de novo.
     */
    return (
      <section className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">
        <strong>Sem relatorio de IA.</strong> A analise permanece valida — os numeros acima foram
        calculados e nao dependem desta etapa. A geracao do texto falhou ou nao foi concluida.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-wide uppercase">Leitura por IA</h3>
        <p className="text-xs text-muted">
          Texto <strong>gerado por inteligencia artificial</strong> a partir dos numeros acima. E
          interpretacao, nao medicao — os numeros continuam sendo os dos paineis.
        </p>
        <p className="font-mono text-xs text-muted">
          {insight.model} · {formatTimestamp(insight.generatedAt)} UTC
        </p>
      </header>

      {mode === 'demonstration' && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <strong>Texto de exemplo.</strong> Nenhuma consulta foi feita a um modelo de IA — falta a
          variavel <code className="font-mono">GEMINI_API_KEY</code> no ambiente. O texto abaixo e
          fixo e <strong>nao descreve o canal informado</strong>.
        </p>
      )}

      <p className="text-sm leading-relaxed whitespace-pre-line">{insight.summary}</p>

      {(insight.likelyNiche !== null || insight.likelySubNiche !== null) && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {insight.likelyNiche !== null && (
            <div className="flex gap-2">
              <dt className="text-muted">Nicho provavel</dt>
              <dd>{insight.likelyNiche}</dd>
            </div>
          )}
          {insight.likelySubNiche !== null && (
            <div className="flex gap-2">
              <dt className="text-muted">Subnicho provavel</dt>
              <dd>{insight.likelySubNiche}</dd>
            </div>
          )}
        </dl>
      )}

      {/*
        Listas vazias simplesmente nao aparecem. Um titulo seguido de nada
        sugeriria que o sistema falhou em preencher, quando "nao ha padrao
        visivel" e uma resposta legitima.
      */}
      <InsightList title="Padroes nos titulos" items={insight.titlePatterns} />
      <InsightList title="Oportunidades observadas" items={insight.contentOpportunities} />

      {insight.viralDependencyNotes !== null && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold tracking-wide uppercase">Dependencia de virais</h4>
          <p className="text-sm leading-relaxed">{insight.viralDependencyNotes}</p>
        </div>
      )}

      <p className="text-xs text-muted">
        Estas observacoes descrevem o que foi observado no conjunto analisado.{' '}
        <strong>Nao preveem resultado</strong> — seguir um padrao observado nao produz
        visualizacoes.
      </p>
    </section>
  );
}

function InsightList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold tracking-wide uppercase">{title}</h4>
      <ul className="list-inside list-disc text-sm leading-relaxed">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
