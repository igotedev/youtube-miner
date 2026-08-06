import type { User } from '../../domain/user';

/**
 * Porta de autenticacao.
 *
 * O adaptador Supabase Auth sera escrito na SPEC de identidade. Enquanto ele
 * nao existe, esta interface ja fixa o contrato: o resto da aplicacao pede
 * "quem e o usuario atual", nunca "leia o cookie de sessao do Supabase".
 */
export interface AuthGateway {
  /** Devolve `null` quando nao ha sessao — ausencia de usuario nao e erro. */
  getCurrentUser(): Promise<User | null>;
}
