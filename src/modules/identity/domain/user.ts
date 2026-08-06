import type { Brand } from '@/shared/domain';

export type UserId = Brand<string, 'UserId'>;

/**
 * Usuario autenticado.
 *
 * Espelha apenas o que a aplicacao precisa conhecer. Credenciais, hash de senha
 * e tokens ficam inteiramente com o provedor de autenticacao e nunca entram
 * neste tipo. Ver ADR-003.
 */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly createdAt: Date;
}
