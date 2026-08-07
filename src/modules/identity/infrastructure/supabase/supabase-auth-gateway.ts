import type { SupabaseClient } from '@supabase/supabase-js';

import { ExternalServiceError, UnauthorizedError } from '@/shared/errors';

import type { AuthGateway } from '../../application/ports/auth-gateway';
import type { User, UserId } from '../../domain/user';

/**
 * Adaptador de `AuthGateway` sobre o Supabase Auth.
 *
 * Recebe um cliente JA CONSTRUIDO com a sessao da requisicao. Nao monta cliente
 * e nao le configuracao: quem sabe de cookie e de chave e a raiz de composicao.
 *
 * ---------------------------------------------------------------------------
 * A DECISAO MAIS IMPORTANTE DESTE ARQUIVO ESTA EM `getCurrentUser`.
 * ---------------------------------------------------------------------------
 */
export class SupabaseAuthGateway implements AuthGateway {
  /**
   * @param client cliente com a sessao do cookie (chave anon, respeita RLS).
   * @param callbackUrl destino absoluto do link de acesso. Vem da configuracao,
   *   nunca de quem chama — ver a nota em `sendMagicLink`.
   */
  constructor(
    private readonly client: SupabaseClient,
    private readonly callbackUrl: string,
  ) {}

  /**
   * `getUser()`, NUNCA `getSession()`.
   *
   * `getSession()` le o cookie e devolve o que estiver la, sem verificar
   * assinatura. Cookie e dado enviado pelo cliente; um `user.id` inventado
   * passaria, e a partir dai toda analise buscada por `findById(id, ownerId)`
   * seria buscada com o dono errado.
   *
   * `getUser()` valida o token contra o servidor Auth. Custa uma chamada de rede
   * por requisicao autenticada, e o preco e obviamente justo. Ver ADR-006.
   */
  async getCurrentUser(): Promise<User | null> {
    const { data, error } = await this.client.auth.getUser();

    // Sem sessao, o Supabase responde com erro — nao e falha, e o caso comum de
    // um visitante. Ausencia de usuario nao e erro (contrato da porta).
    if (error !== null || data.user === null) return null;

    const { id, email, created_at } = data.user;

    if (typeof email !== 'string' || email === '') {
      // Nao deveria acontecer: o unico metodo de autenticacao do produto e por
      // e-mail. Se acontecer, e um usuario que nao sabemos representar, e
      // trata-lo como anonimo esconderia o defeito.
      throw new ExternalServiceError('Usuario autenticado sem endereco de e-mail.', {
        service: 'supabase-auth',
      });
    }

    return {
      id: id as UserId,
      email,
      createdAt: new Date(created_at),
    };
  }

  /**
   * O destino do link vem do construtor, e nao do parametro.
   *
   * Se `emailRedirectTo` viesse de quem chama, bastaria alguem pedir um link
   * apontando para o proprio dominio para receber o codigo de autorizacao da
   * vitima. A allow-list do GoTrue (`supabase/config.toml`) e a segunda barreira;
   * esta assinatura e a primeira.
   */
  async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        // Cadastro e login sao o mesmo ato (ADR-006, item 1).
        shouldCreateUser: true,
        emailRedirectTo: this.callbackUrl,
      },
    });

    if (error !== null) {
      // So o codigo do provedor entra no contexto. A mensagem bruta pode
      // carregar o endereco e detalhes de entrega, que nao vao para log.
      throw new ExternalServiceError('Nao foi possivel enviar o link de acesso.', {
        service: 'supabase-auth',
        providerCode: error.code ?? error.status ?? 'unknown',
      });
    }
  }

  async completeSignIn(code: string): Promise<void> {
    const { error } = await this.client.auth.exchangeCodeForSession(code);

    if (error !== null) {
      // Codigo expirado, ja usado ou forjado — indistinguiveis para quem chama,
      // e deliberadamente. A mensagem do provedor nao entra: ela acabaria na
      // barra de enderecos e no log.
      throw new UnauthorizedError('Link de acesso invalido ou expirado.', {
        service: 'supabase-auth',
      });
    }
  }

  /**
   * Sair nunca falha para quem chama.
   *
   * Um erro aqui significa que o token ja nao valia — que e exatamente o estado
   * desejado. Propagar transformaria "voce ja esta desconectado" em uma tela de
   * erro que impede o usuario de se desconectar.
   */
  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }
}
