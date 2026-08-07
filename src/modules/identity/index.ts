/**
 * Superficie publica do modulo `identity`.
 *
 * Outros modulos importam somente `@/modules/identity`. Qualquer coisa nao
 * reexportada aqui e interna. Ver R5 em docs/architecture/dependency-rules.md.
 *
 * Os adaptadores — `SupabaseAuthGateway`, `FakeAuthGateway` — NAO aparecem aqui,
 * como em todo modulo do projeto: adaptador nao e contrato publico. Quem os
 * instancia e a raiz de composicao, que alcanca `infrastructure` por uma excecao
 * estreita e documentada (R6).
 */
export type { User, UserId } from './domain/user';
export type { AuthGateway } from './application/ports/auth-gateway';
