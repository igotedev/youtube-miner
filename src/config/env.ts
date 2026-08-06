import { z } from 'zod';

/**
 * Schema das variaveis de ambiente.
 *
 * Nenhuma integracao real esta ativa nesta etapa, entao todas as variaveis de
 * terceiros sao OPCIONAIS: o projeto precisa rodar sem chave nenhuma. Cada SPEC
 * que ativar uma integracao torna as suas variaveis obrigatorias e registra
 * isso no proprio documento.
 *
 * Regra de segredo (ADR-004): tudo com prefixo NEXT_PUBLIC_ e embutido no
 * bundle do navegador. Segredos nunca usam esse prefixo, e este modulo lanca se
 * for importado no cliente.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),

  // --- Supabase (SPEC futura) ---
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // --- YouTube Data API v3 (SPEC futura) ---
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  YOUTUBE_DAILY_QUOTA_LIMIT: z.coerce.number().int().positive().default(10_000),

  // --- Claude API (SPEC futura) ---
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4_000),

  // --- Politica de reuso de analise (RN-10) ---
  ANALYSIS_FRESHNESS_HOURS: z.coerce.number().int().positive().default(24),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Le e valida o ambiente do servidor.
 *
 * Chamada como funcao, e nao avaliada na importacao, para que um import
 * acidental em codigo de cliente falhe de forma explicita e testavel em vez de
 * quebrar o build inteiro.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'src/config/env.ts foi importado no navegador. Segredos so podem ser lidos no servidor. Ver ADR-004.',
    );
  }

  if (cached) return cached;

  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    // Sao impressos apenas os NOMES das variaveis invalidas, nunca os valores.
    const invalid = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Variaveis de ambiente invalidas: ${invalid}`);
  }

  cached = result.data;
  return cached;
}

/**
 * Configuracao publica, segura para o navegador. Contem apenas valores que ja
 * sao publicos por natureza.
 */
export const publicConfig = {
  appName: 'YouTube Niche Miner',
} as const;
