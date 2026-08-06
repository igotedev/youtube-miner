/**
 * Superficie publica do modulo `identity`.
 *
 * Outros modulos importam somente `@/modules/identity`. Qualquer coisa nao
 * reexportada aqui e interna. Ver R5 em docs/architecture/dependency-rules.md.
 */
export type { User, UserId } from './domain/user';
export type { AuthGateway } from './application/ports/auth-gateway';
