import type { ZodType } from 'zod';

import { ValidationError } from '@/shared/errors';

/**
 * Converte uma falha de Zod em `ValidationError`.
 *
 * Existe para que nenhuma camada acima da fronteira precise conhecer o formato
 * de erro do Zod: quem valida entrada de UI ou resposta de terceiro devolve
 * sempre o mesmo tipo de erro da aplicacao.
 *
 * `issues` guarda caminho e mensagem — nunca o valor recebido, que pode conter
 * dado sensivel.
 */
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown, subject: string): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new ValidationError(`Dados invalidos para ${subject}.`, {
      subject,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}
