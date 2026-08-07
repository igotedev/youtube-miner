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
      /**
       * `server-only` e resolvido pelo bundler do Next, nao pelo Node. Sem este
       * alias, qualquer teste que alcance a raiz de composicao falha com
       * "Cannot find package".
       *
       * A barreira de build continua intacta: quem a aplica e o Next ao montar
       * o bundle do cliente, e ele nao le esta configuracao. Ver o comentario no
       * proprio stub.
       */
      'server-only': fileURLToPath(
        new URL('./tests/integration/stubs/server-only.ts', import.meta.url),
      ),
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
