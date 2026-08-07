'use server';

import { z } from 'zod';

import { buildAuthGateway } from '@/config/composition';

import type { SignInFormState } from './sign-in-state';

/**
 * Server Action da tela de acesso.
 *
 * Este arquivo exporta APENAS `requestMagicLink`. Um modulo `'use server'` so
 * pode exportar funcoes assincronas — cada export vira um endpoint invocavel
 * pelo navegador. Tipos e constantes ficam em `sign-in-state.ts`.
 */

/** Teto de tamanho. Barra corpo absurdo antes de qualquer trabalho. */
const MAX_EMAIL_LENGTH = 254;

const formSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Informe o seu endereco de e-mail.')
    .max(MAX_EMAIL_LENGTH, 'O endereco informado e longo demais.')
    .pipe(z.email('Isso nao parece um endereco de e-mail.'))
    /**
     * Normaliza para minusculas. `Pessoa@Exemplo.com` e `pessoa@exemplo.com`
     * sao a mesma caixa postal, e tratar as duas como enderecos diferentes
     * criaria duas contas para a mesma pessoa — que so descobriria isso ao nao
     * encontrar as proprias analises.
     */
    .transform((value) => value.toLowerCase()),
});

export async function requestMagicLink(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const parsed = formSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { status: 'invalid', message: first?.message ?? 'Entrada invalida.' };
  }

  const { email } = parsed.data;

  try {
    const auth = await buildAuthGateway();
    await auth.sendMagicLink(email);
  } catch {
    /**
     * A falha e do envio, e o texto do provedor nao chega ao usuario: ele
     * carrega detalhe de entrega e o proprio endereco.
     *
     * Note que este caminho NAO distingue endereco existente de inexistente —
     * a porta nao informa isso, e por isso nao ha como responder de forma
     * diferente para os dois casos, nem por engano.
     */
    return {
      status: 'error',
      message: 'Nao foi possivel enviar o link agora. Tente de novo em instantes.',
    };
  }

  return { status: 'sent', email };
}
