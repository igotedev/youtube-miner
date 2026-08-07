// Imports de `infrastructure` sao permitidos APENAS aqui (R6).
import type { AuthGateway } from '@/modules/identity';
import { SupabaseAuthGateway } from '@/modules/identity/infrastructure/supabase/supabase-auth-gateway';
import {
  createCookieSessionClient,
  refreshSessionCookies,
  type SessionRefresh,
} from '@/shared/infrastructure/supabase/supabase-cookie-clients';

import { getServerEnv } from '../env';

/**
 * Raiz de composicao da autenticacao (SPEC-009).
 *
 * ---------------------------------------------------------------------------
 * NAO HA MODO DE DEMONSTRACAO AQUI, E A AUSENCIA E A DECISAO.
 *
 * A coleta tem: sem `YOUTUBE_API_KEY`, o pipeline usa um fixture e a tela avisa
 * que os numeros sao de exemplo. O prejuizo e nenhum, porque o aviso esta na
 * frente do usuario.
 *
 * Uma sessao falsa e outra categoria de coisa. Escolhida por engano — uma
 * variavel com o nome digitado errado bastaria —, todos os visitantes seriam o
 * mesmo usuario, com acesso as analises uns dos outros, e nada na tela
 * denunciaria isso. Falha silenciosa, em identidade.
 *
 * Entao a falta de configuracao FALHA, com o nome da variavel que falta. Uma
 * aplicacao que nao sobe e um problema visivel; uma que sobe compartilhando
 * contas nao e.
 * ---------------------------------------------------------------------------
 */

/**
 * Caminho de retorno do link de acesso.
 *
 * Constante, e nao parametro: e o `emailRedirectTo` enviado ao provedor, e
 * aceitar destino de fora abriria redirecionamento aberto. A allow-list em
 * `supabase/config.toml` precisa conter exatamente esta URL.
 */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/** Para onde o usuario vai depois de entrar, quando nao ha destino pedido. */
export const DEFAULT_SIGNED_IN_PATH = '/analise';

/** Tela de acesso. Para onde o middleware manda quem nao tem sessao. */
export const SIGN_IN_PATH = '/entrar';

/**
 * Monta o `AuthGateway` da requisicao atual.
 *
 * Assincrono porque a sessao vem do cookie, e `cookies()` do Next e assincrono.
 * Nao ha cache entre requisicoes: cada requisicao tem a sua sessao, e um gateway
 * guardado em modulo serviria a sessao de outra pessoa.
 */
export async function buildAuthGateway(): Promise<AuthGateway> {
  const env = getServerEnv();
  const client = await createCookieSessionClient();

  // `APP_URL` tem default `http://localhost:3000` e e lida aqui, dentro de
  // `src/config/` (R8). Em producao ela PRECISA ser a URL real: o link do e-mail
  // aponta para ela, e um valor de desenvolvimento mandaria o usuario para
  // localhost.
  return new SupabaseAuthGateway(client, new URL(AUTH_CALLBACK_PATH, env.APP_URL).toString());
}

/**
 * Renova o cookie de sessao. Chamado pelo middleware, e so por ele.
 *
 * Reexportado daqui, e nao importado direto, porque `src/middleware.ts` nao pode
 * alcancar `infrastructure` — a R6 tem uma unica excecao no codigo de producao,
 * e e esta raiz. Ver `tests/architecture/dependency-rules.test.ts`.
 */
export function refreshSession(
  ...args: Parameters<typeof refreshSessionCookies>
): Promise<SessionRefresh> {
  return refreshSessionCookies(...args);
}

export type { SessionRefresh };
