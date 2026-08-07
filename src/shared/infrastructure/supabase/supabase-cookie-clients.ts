import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/config/env';

/**
 * Clientes Supabase que carregam a SESSAO DO USUARIO por cookie.
 *
 * Complementam `supabase-clients.ts`, que monta os dois clientes sem sessao: o
 * administrativo (service role) e o de token explicito. Aqui a sessao vem do
 * cookie da requisicao, que e como o navegador a carrega (ADR-006, item 2).
 *
 * `import 'server-only'` no topo: o BUILD FALHA se um componente de cliente
 * alcancar este modulo. Mesma barreira dos outros clientes.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `@supabase/ssr` E NAO O `supabase-js` DIRETO.
 *
 * O `supabase-js` guarda a sessao no `localStorage`, que nao existe no servidor.
 * Como a analise roda no servidor por obrigacao — a chave da API do YouTube e a
 * service role nao podem ir ao navegador —, o servidor PRECISA conhecer o
 * usuario, e cookie e o unico transporte que atravessa as duas pontas.
 *
 * Escrever isso a mao significaria reimplementar o fluxo PKCE, a rotacao de
 * refresh token e a coordenacao de escrita de cookie entre middleware e handler.
 * Trabalho de seguranca sem nada de especifico do produto.
 * ---------------------------------------------------------------------------
 */

interface PublicSupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

function readPublicConfig(): PublicSupabaseConfig {
  const env = getServerEnv();

  // Falha com o NOME da variavel, nunca com o valor. A chave anon e publica por
  // natureza, mas a regra vale para todas sem excecao — uma excecao aqui vira
  // precedente na proxima.
  if (env.NEXT_PUBLIC_SUPABASE_URL === undefined) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL nao esta configurada. Ver .env.example.');
  }
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY nao esta configurada. Ver .env.example.');
  }

  return { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}

/**
 * Cliente com a sessao do cookie, para Server Components, Server Actions e
 * Route Handlers.
 *
 * Usa a chave ANON e portanto RESPEITA o RLS: se a policy estiver errada, o
 * pedido falha. Nao ha como ler dado alheio por aqui — diferente do cliente
 * administrativo, que ignora RLS e depende do codigo filtrar.
 */
export async function createCookieSessionClient(): Promise<SupabaseClient> {
  const { url, anonKey } = readPublicConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        /**
         * Um Server Component NAO PODE escrever cookie — a resposta ja comecou.
         * O `supabase-js` tenta renovar o token de qualquer forma, e a excecao
         * derrubaria a pagina inteira por causa de uma renovacao que o
         * middleware ja fez nesta mesma requisicao.
         *
         * Engolir aqui e correto porque a renovacao tem OUTRO responsavel
         * (`refreshSessionCookies`, abaixo), que roda antes e pode escrever. Se
         * o middleware deixar de rodar, o efeito e sessao expirando cedo — nao
         * sessao aceita sem verificacao.
         */
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // Intencionalmente silencioso. Ver o bloco acima.
        }
      },
    },
  });
}

/**
 * Resultado da renovacao de sessao no middleware.
 *
 * Devolve a resposta PRONTA, com os cookies novos ja escritos, porque quem
 * chama nao tem como recria-la sem perde-los — e um cookie de sessao perdido
 * desloga o usuario silenciosamente.
 */
export interface SessionRefresh {
  readonly response: NextResponse;
  readonly isAuthenticated: boolean;
}

/**
 * Renova o cookie de sessao no middleware.
 *
 * O token de acesso do Supabase expira em uma hora. Sem alguem renovando, a
 * sessao morre no meio da navegacao — e os Server Components, que nao podem
 * escrever cookie, nao teriam como consertar.
 *
 * `isAuthenticated` sai daqui APENAS para o middleware decidir navegacao. Nao e
 * autorizacao: a verificacao que vale acontece dentro de cada Server Action e
 * de cada rota, junto do dado (ADR-006, item 4).
 */
export async function refreshSessionCookies(request: NextRequest): Promise<SessionRefresh> {
  const { url, anonKey } = readPublicConfig();

  let response = NextResponse.next({ request });

  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Os cookies vao para os DOIS lados: no `request`, para que o resto
        // desta requisicao ja enxergue o token novo; e na `response`, para que o
        // navegador o guarde. Escrever so em um dos dois produz um bug que
        // aparece na requisicao seguinte, longe da causa.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options as CookieOptions);
        }
      },
    },
  });

  // `getUser()`, nao `getSession()`: e a chamada que valida o token contra o
  // servidor Auth e, de quebra, dispara a renovacao quando ele esta perto de
  // expirar. `getSession()` devolveria o conteudo do cookie sem verificar nada.
  const { data } = await client.auth.getUser();

  return { response, isAuthenticated: data.user !== null };
}
