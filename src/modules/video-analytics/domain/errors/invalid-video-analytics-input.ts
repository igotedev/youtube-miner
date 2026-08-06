import { DomainError } from '@/shared/errors';

/**
 * Motivo da recusa de uma entrada do motor de metricas.
 *
 * Mesmo padrao adotado na SPEC-002: uma classe com discriminante, e nao uma
 * classe por caso. O `ErrorCode` de `shared/errors` e um conjunto fechado e
 * transversal; acrescentar `INVALID_VIEW_COUNT` la faria a camada compartilhada
 * conhecer contagem de visualizacoes do YouTube.
 */
export type InvalidVideoAnalyticsInputReason =
  /** `collectedAt` nao e uma data valida. */
  | 'invalid_collected_at'
  /** `publishedAt` de algum video nao e uma data valida. */
  | 'invalid_published_at'
  /** Video publicado depois da coleta. Coleta nao ve o futuro. */
  | 'future_publication_date'
  /** `viewCount` negativo, NaN ou infinito. */
  | 'invalid_view_count'
  /** O mesmo `id` aparece duas vezes na mesma execucao. */
  | 'duplicate_video'
  /** `format` fora de 'short' | 'long' | 'unknown'. */
  | 'unsupported_video_format'
  /** Valor nao finito ou negativo chegando a uma funcao estatistica. */
  | 'invalid_numeric_value';

const MESSAGES: Readonly<Record<InvalidVideoAnalyticsInputReason, string>> = {
  invalid_collected_at: 'A data da coleta e invalida.',
  invalid_published_at: 'A data de publicacao de um video e invalida.',
  future_publication_date: 'Um video consta como publicado depois da data da coleta.',
  invalid_view_count: 'A contagem de visualizacoes de um video e invalida.',
  duplicate_video: 'O mesmo video aparece mais de uma vez na coleta.',
  unsupported_video_format: 'Um video tem formato desconhecido pelo motor de metricas.',
  invalid_numeric_value: 'Um valor numerico invalido chegou ao calculo.',
};

/**
 * Contexto seguro para diagnostico.
 *
 * Diferente da SPEC-002, aqui o identificador do video E incluido: um
 * `YouTubeVideoId` e dado publico, sem nada de sensivel, e sem ele um erro de
 * duplicidade em uma coleta de 50 videos seria impossivel de investigar. O que
 * continua fora e a interpolacao na MENSAGEM, que costuma acabar em log e em
 * tela.
 */
export interface VideoAnalyticsErrorContext {
  /** Identificador do video problematico, quando aplicavel. */
  readonly videoId?: string;
  /** Posicao do video na entrada, quando aplicavel. */
  readonly index?: number;
}

/** Entrada invalida para o motor de metricas. Erro esperado, nao excepcional. */
export class InvalidVideoAnalyticsInputError extends DomainError {
  readonly reason: InvalidVideoAnalyticsInputReason;

  constructor(reason: InvalidVideoAnalyticsInputReason, context: VideoAnalyticsErrorContext = {}) {
    super(MESSAGES[reason], { reason, ...context });
    this.reason = reason;
  }
}
