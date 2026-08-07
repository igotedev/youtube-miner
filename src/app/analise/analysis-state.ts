import type { CompositionMode } from '@/config/composition';
import type { ChannelMetrics } from '@/modules/video-analytics';

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
}

export type AnalysisFormState =
  | { readonly status: 'idle' }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
  | AnalysisReadyState;

export const INITIAL_ANALYSIS_STATE: AnalysisFormState = { status: 'idle' };
