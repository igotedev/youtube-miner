import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getServerEnv } from '@/config/env';

/**
 * Fabricas de cliente Supabase.
 *
 * `import 'server-only'` no topo faz o BUILD FALHAR se este modulo for
 * alcancado por um componente de cliente. E a barreira que impede a service role
 * de virar parte do bundle do navegador — mais confiavel que disciplina, porque
 * quebra antes do deploy e nao depois (RN-11, ADR-004, ADR-005).
 *
 * Dois clientes, com poderes bem diferentes:
 *
 *  - `createUserScopedClient` — carrega o token do usuario e RESPEITA o RLS.
 *    Usado para perfil, watchlists e leitura das analises do proprio usuario.
 *    Se a policy estiver errada, o pedido falha; nao ha como ler dado alheio.
 *
 *  - `createAdminClient` — usa a service role e IGNORA o RLS por completo.
 *    Usado apenas para os artefatos globais: coleta, snapshots, metricas e
 *    progressao de estado. Toda consulta feita com ele precisa filtrar por
 *    usuario NO CODIGO, porque o banco nao vai filtrar.
 *
 * Regra de escolha: se existe um usuario na operacao, use o cliente com sessao.
 * A service role e para o que nao tem dono.
 */

function assertConfigured(value: string | undefined, name: string): string {
  if (value === undefined || value === '') {
    // Falha cedo e com o NOME da variavel — nunca com o valor.
    throw new Error(
      `${name} nao esta configurada. O adaptador Supabase exige esta variavel; ver .env.example.`,
    );
  }
  return value;
}

/** Cliente que respeita o RLS, atuando como o usuario autenticado. */
export function createUserScopedClient(accessToken: string): SupabaseClient {
  const env = getServerEnv();
  const url = assertConfigured(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = assertConfigured(
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  );

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cliente administrativo. IGNORA RLS.
 *
 * Nunca exponha o resultado de uma consulta feita por aqui diretamente ao
 * navegador: monte um DTO. O payload bruto das tabelas globais nao sai do
 * servidor (ADR-005).
 */
export function createAdminClient(): SupabaseClient {
  const env = getServerEnv();
  const url = assertConfigured(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = assertConfigured(
    env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY',
  );

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
