import type { CompositionMode } from '@/config/composition';
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
}

export type AnalysisFormState =
  | { readonly status: 'idle' }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
  | AnalysisReadyState;

export const INITIAL_ANALYSIS_STATE: AnalysisFormState = { status: 'idle' };
