/**
 * Hierarquia de erros da aplicacao.
 *
 * Todo erro esperado carrega um `code` estavel: e ele que a camada de
 * apresentacao usa para decidir a resposta HTTP e a mensagem ao usuario.
 * Nunca inspecione a mensagem em texto para tomar decisoes.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'UNEXPECTED_ERROR';

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;

  /**
   * Contexto seguro para log. Nunca coloque credenciais, tokens ou corpo bruto
   * de resposta de terceiros aqui.
   */
  readonly context: Readonly<Record<string, unknown>>;

  constructor(message: string, context: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.context = Object.freeze({ ...context });
  }
}

/** Violacao de uma regra de negocio. Origem: camada de dominio. */
export class DomainError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
}

/** Entrada malformada, detectada na fronteira (presentation ou adaptador). */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
}

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED' as const;
}

/**
 * Colisao com um estado ja existente: chave unica violada, corrida entre duas
 * requisicoes. Distinto de `ValidationError` — a entrada estava correta, o
 * mundo e que mudou entre a decisao e a gravacao.
 */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
}

/**
 * Uma linha persistida nao pode ser convertida em entidade de dominio.
 *
 * Sempre um defeito nosso — migration incompleta, escrita fora do adaptador,
 * mudanca de esquema sem mapeador. Existe para que uma linha corrompida FALHE
 * em vez de produzir silenciosamente uma entidade com campos errados.
 */
export class CorruptedPersistedDataError extends AppError {
  readonly code = 'UNEXPECTED_ERROR' as const;
}

/**
 * Falha em um sistema de terceiros (YouTube, Supabase, Claude).
 *
 * Existe para sustentar a regra RN-09: uma falha da IA nao pode invalidar os
 * dados objetivos ja coletados. Quem chama decide se degrada ou aborta.
 */
export class ExternalServiceError extends AppError {
  readonly code = 'EXTERNAL_SERVICE_ERROR' as const;
}

/** Teto de quota da API externa atingido. Nunca deve virar dado zerado. */
export class QuotaExceededError extends AppError {
  readonly code = 'QUOTA_EXCEEDED' as const;
}
