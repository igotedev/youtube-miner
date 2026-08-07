import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * O alias `@/*` e resolvido manualmente para evitar a dependencia
 * `vite-tsconfig-paths`. Se o alias mudar em tsconfig.json, mude aqui tambem.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    /**
     * `tests/integration/` fica FORA da execucao padrao, e nao por descuido.
     *
     * Aqueles testes exigem o Supabase local no ar. Inclui-los aqui faria
     * `npm run verify` — o comando que diz se o codigo esta pronto — depender de
     * Docker, e ele passaria a falhar em qualquer maquina sem a stack subida.
     * Rode-os com `npm run test:integration`.
     */
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**', 'tests/integration/**'],
  },
});
