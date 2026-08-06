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
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
  },
});
