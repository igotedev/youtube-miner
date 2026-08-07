import { UnauthorizedError } from '@/shared/errors';

import type { AuthGateway } from '../../application/ports/auth-gateway';
import type { User, UserId } from '../../domain/user';

/**
 * `AuthGateway` controlavel, para teste.
 *
 * ---------------------------------------------------------------------------
 * NAO E MONTADO PELA RAIZ DE COMPOSICAO, E ISSO E DELIBERADO.
 *
 * Os outros fakes do projeto — o `YouTubeChannelSource`, o `ChannelResolver` —
 * entram em producao quando falta a chave da API: exibem numeros de exemplo e a
 * tela avisa que sao de demonstracao. O prejuizo de um fixture visivel e nenhum.
 *
 * Uma sessao falsa e outra categoria de coisa. Se este adaptador fosse
 * escolhido por engano em producao — um nome de variavel digitado errado
 * bastaria —, TODOS OS VISITANTES seriam o mesmo usuario, com acesso as
 * analises uns dos outros, e nada na tela denunciaria isso. Falha silenciosa,
 * em identidade, com dado de terceiros no meio.
 *
 * Por isso a autenticacao nao tem modo de demonstracao: sem Supabase
 * configurado, a composicao falha dizendo o que falta. Ver SPEC-009.
 * ---------------------------------------------------------------------------
 */
export class FakeAuthGateway implements AuthGateway {
  /** Codigo que `completeSignIn` recusa, para exercitar o caminho de falha. */
  static readonly INVALID_CODE = 'CODIGO_INVALIDO';

  private current: User | null;

  /** Quem passa a estar autenticado depois de um `completeSignIn` bem-sucedido. */
  private readonly pendingUser: User;

  /** Enderecos que receberam link, na ordem. Para asserir o envio. */
  readonly sentTo: string[] = [];

  constructor(current: User | null = null, pendingUser: User = FakeAuthGateway.someone()) {
    this.current = current;
    this.pendingUser = pendingUser;
  }

  static someone(id = '11111111-1111-4111-8111-111111111111', email = 'pessoa@exemplo.test'): User {
    return {
      id: id as UserId,
      email,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  /** Gateway ja autenticado, para testar o que exige sessao. */
  static withUser(id?: string, email?: string): FakeAuthGateway {
    const user = FakeAuthGateway.someone(id, email);
    return new FakeAuthGateway(user, user);
  }

  getCurrentUser(): Promise<User | null> {
    return Promise.resolve(this.current);
  }

  sendMagicLink(email: string): Promise<void> {
    this.sentTo.push(email);
    return Promise.resolve();
  }

  completeSignIn(code: string): Promise<void> {
    if (code === FakeAuthGateway.INVALID_CODE) {
      return Promise.reject(new UnauthorizedError('Link de acesso invalido ou expirado.'));
    }
    this.current = this.pendingUser;
    return Promise.resolve();
  }

  signOut(): Promise<void> {
    this.current = null;
    return Promise.resolve();
  }
}
