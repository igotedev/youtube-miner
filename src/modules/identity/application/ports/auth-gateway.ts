import type { User } from '../../domain/user';

/**
 * Porta de autenticacao.
 *
 * O resto da aplicacao pede "quem e o usuario atual"; nunca "leia o cookie de
 * sessao do Supabase". Nenhuma camada fora de `infrastructure` sabe que existe
 * cookie, token ou provedor — trocar de provedor troca o adaptador e mais nada.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA PORTA DELIBERADAMENTE NAO TEM.
 *
 * Nao ha `signInWithPassword`, `changePassword` nem `resetPassword`. Nao e
 * omissao: o produto nao tem senha (ADR-006). Acrescentar qualquer um dos tres
 * exige revisar aquele ADR primeiro, e nao apenas escrever um metodo.
 *
 * Nao ha `getSession`. A identidade tem de ser VERIFICADA contra o servidor de
 * autenticacao, e um metodo que devolvesse o conteudo do cookie sem verificar
 * seria usado por engano no lugar certo. Ver a nota em `getCurrentUser`.
 * ---------------------------------------------------------------------------
 */
export interface AuthGateway {
  /**
   * Usuario da requisicao atual, ou `null` quando nao ha sessao — ausencia de
   * usuario nao e erro.
   *
   * A implementacao VERIFICA o token contra o servidor de autenticacao. Ela nao
   * pode confiar no conteudo do cookie: cookie e dado enviado pelo cliente, e
   * um `user.id` forjado passaria direto. Ver ADR-006, item 3.
   */
  getCurrentUser(): Promise<User | null>;

  /**
   * Envia um link de acesso para o endereco informado.
   *
   * Cria a conta se ela ainda nao existir — cadastro e login sao o mesmo ato
   * (ADR-006, item 1).
   *
   * NAO INFORMA se o endereco ja tinha conta, e isso e proposital: quem chama
   * nao tem como responder de forma diferente para os dois casos, e portanto nao
   * tem como transformar a tela de login em um oraculo de enumeracao de contas.
   *
   * O destino do link e do adaptador, nao de quem chama. Aceitar uma URL aqui
   * abriria caminho para redirecionamento aberto: bastaria alguem passar o
   * proprio dominio para receber o codigo de autorizacao da vitima.
   */
  sendMagicLink(email: string): Promise<void>;

  /**
   * Troca o codigo trazido pelo link de acesso por uma sessao ativa.
   *
   * Unico ponto do produto que CRIA sessao. Fica na porta, e nao na rota, para
   * que a apresentacao nao precise alcancar o cliente do provedor — a rota so
   * repassa o codigo que chegou na URL e decide para onde mandar o usuario.
   *
   * @throws {UnauthorizedError} Codigo invalido, expirado ou ja usado. Sao a
   *   mesma coisa para quem chama: nao ha sessao, e o motivo exato nao pode ser
   *   exibido — vem em texto do provedor e costuma conter o endereco de e-mail.
   */
  completeSignIn(code: string): Promise<void>;

  /** Encerra a sessao atual. Idempotente: sem sessao, nao faz nada. */
  signOut(): Promise<void>;
}
