import type { CompositionMode } from '@/config/composition';
import type { InsightReport } from '@/modules/ai-insights';
import type { CollectionCoverage } from '@/modules/channel-analysis';
import type { AnalysisPeriod, ChannelMetrics } from '@/modules/video-analytics';

/**
 * Estado exibivel da tela de analise.
 *
 * Vive FORA de `actions.ts` de proposito: um arquivo `'use server'` so pode
 * exportar funcoes assincronas — cada export vira um endpoint invocavel pelo
 * cliente. Tipos somem na compilacao e passariam, mas
 * `INITIAL_ANALYSIS_STATE` e um objeto e nao passa.
 *
 * Ver https://nextjs.org/docs/messages/invalid-use-server-value.
 */

export interface AnalysisReadyState {
  readonly status: 'ready';
  readonly mode: CompositionMode;
  /**
   * A IA esta ligada? Separado de `mode`, que fala da origem dos NUMEROS.
   *
   * As duas chaves sao independentes: da para ter dados reais do YouTube sem
   * relatorio de IA, e o contrario. Uma flag unica faria a tela afirmar uma das
   * duas coisas errado.
   */
  readonly insightMode: CompositionMode;
  readonly requestedUrl: string;
  readonly analysisStatus: string;
  readonly metrics: ChannelMetrics;
  /** Intervalo pedido. `null` quando a analise cobriu a coleta inteira. */
  readonly requestedPeriod: AnalysisPeriod | null;
  /**
   * O que a coleta alcanca. `null` quando nao houve recorte.
   *
   * Existe para a tela poder explicar um resultado vazio: pedir janeiro em um
   * canal cuja coleta comeca em fevereiro nao significa que o canal parou de
   * publicar — significa que os 50 uploads mais recentes nao chegam la.
   */
  readonly coverage: CollectionCoverage | null;
  /**
   * Relatorio de IA. `null` quando a geracao falhou.
   *
   * Vem em campo proprio, jamais dentro de `metrics` (RN-05): interpretacao e
   * dado calculado sao coisas diferentes e a tela precisa poder desenha-las
   * como coisas diferentes.
   */
  readonly insight: InsightReport | null;
}

export type AnalysisFormState =
  | { readonly status: 'idle' }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
  | AnalysisReadyState;

export const INITIAL_ANALYSIS_STATE: AnalysisFormState = { status: 'idle' };
