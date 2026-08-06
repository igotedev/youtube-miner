import { ConflictError, ExternalServiceError, NotFoundError } from '@/shared/errors';

/**
 * Traducao de erros do PostgreSQL para erros da aplicacao.
 *
 * ADR-004: nenhuma camada acima de `infrastructure` inspeciona codigo de
 * fornecedor. Um caso de uso que perguntasse `if (error.code === '23505')`
 * conheceria o PostgreSQL — e trocar de banco viraria uma caçada.
 *
 * As mensagens NUNCA repassam `details` ou `hint` do driver: esses campos
 * costumam conter o valor que violou a restricao, que pode ser dado de usuario.
 */

/** Formato de erro do PostgREST, usado pelo cliente Supabase. */
export interface PostgresErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
/** PostgREST devolve isto quando `.single()` nao encontra linha. */
const NO_ROWS_RETURNED = 'PGRST116';

export function isUniqueViolation(error: PostgresErrorLike | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

export function isNoRowsReturned(error: PostgresErrorLike | null | undefined): boolean {
  return error?.code === NO_ROWS_RETURNED;
}

/**
 * Converte um erro do driver no erro de aplicacao correspondente.
 *
 * @param operation rotulo curto e estavel da operacao, para diagnostico. Nunca
 *   inclua nele valores vindos da requisicao.
 */
export function translatePostgresError(
  error: PostgresErrorLike,
  operation: string,
): ConflictError | NotFoundError | ExternalServiceError {
  const context = { operation, pgCode: error.code ?? null };

  switch (error.code) {
    case UNIQUE_VIOLATION:
      return new ConflictError('O registro ja existe.', context);
    case FOREIGN_KEY_VIOLATION:
      return new NotFoundError('Registro relacionado inexistente.', context);
    case CHECK_VIOLATION:
    case NOT_NULL_VIOLATION:
      // Chegou aqui significa que o dominio deixou passar algo que o banco
      // recusou — defeito nosso, nao do usuario. Vira falha de infraestrutura
      // para que apareca no monitoramento em vez de virar erro de validacao.
      return new ExternalServiceError('Dados recusados pelo banco.', context);
    case NO_ROWS_RETURNED:
      return new NotFoundError('Registro nao encontrado.', context);
    default:
      return new ExternalServiceError('Falha ao acessar o banco de dados.', context);
  }
}
