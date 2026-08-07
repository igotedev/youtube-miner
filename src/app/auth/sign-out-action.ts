'use server';

import { redirect } from 'next/navigation';

// Modulo especifico, e nao o barrel. Ver a nota em `src/config/composition/index.ts`.
import { SIGN_IN_PATH, buildAuthGateway } from '@/config/composition/auth';

/**
 * Encerra a sessao.
 *
 * ---------------------------------------------------------------------------
 * E UMA SERVER ACTION, E NAO UMA ROTA `GET /sair`.
 *
 * Uma rota GET que desloga e acionavel por qualquer coisa que carregue uma URL:
 * basta uma tag `<img src="https://nosso-dominio/sair">` em um forum, um e-mail
 * ou um comentario para derrubar a sessao de quem passar por ali. E CSRF de
 * baixo impacto, mas gratuito de evitar.
 *
 * Server Actions sao POST e o Next verifica a origem da requisicao.
 * ---------------------------------------------------------------------------
 *
 * Este arquivo exporta APENAS a acao: modulo `'use server'` so pode exportar
 * funcoes assincronas.
 */
export async function signOut(): Promise<never> {
  const auth = await buildAuthGateway();
  await auth.signOut();

  /**
   * `redirect` lanca por dentro — e assim que o Next interrompe o fluxo. Por
   * isso ele fica FORA de qualquer `try`, e por isso o retorno e `never`.
   */
  redirect(SIGN_IN_PATH);
}
