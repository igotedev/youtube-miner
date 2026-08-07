import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Configuracao dos testes de INTEGRACAO.
 *
 * Separada da padrao de proposito: estes testes exigem o Supabase local no ar
 * (`npm run db:start`). Se rodassem em `npm run verify`, o comando que diz se o
 * codigo esta pronto passaria a exigir Docker.
 *
 * Carrega `.env.local` porque o adaptador le a configuracao por
 * `src/config/env.ts` (R8) — o Next faz isso sozinho, o Vitest nao.
 *
 * Parse manual em vez de `dotenv`: sao dez linhas, e o projeto nao adiciona
 * dependencia sem um caso que a justifique. Nao ha suporte a aspas, escapes nem
 * multilinha — as variaveis locais do Supabase nao precisam de nenhum dos tres,
 * e um parser mais esperto seria complexidade sem demanda.
 */
function loadEnvLocal(): void {
  let contents: string;
  try {
    contents = readFileSync('.env.local', 'utf8');
  } catch {
    // Ausente e legitimo: quem roda em CI define as variaveis por fora.
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const name = trimmed.slice(0, separator).trim();
    // Variavel ja definida no ambiente VENCE o arquivo, que e a convencao.
    if (process.env[name] !== undefined) continue;

    process.env[name] = trimmed.slice(separator + 1).trim();
  }
}

loadEnvLocal();

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /**
       * `server-only` e resolvido pelo bundler do Next, nao pelo Node. Sem este
       * alias, carregar o cliente Supabase no Vitest falha com "Cannot find
       * package". Ver o comentario no proprio stub: a barreira de build
       * continua intacta.
       */
      'server-only': fileURLToPath(
        new URL('./tests/integration/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    /**
     * Sem paralelismo entre arquivos: todos falam com o MESMO banco. Dois
     * arquivos criando canais e execucoes ao mesmo tempo produziriam
     * interferencia que pareceria defeito do adaptador.
     */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
