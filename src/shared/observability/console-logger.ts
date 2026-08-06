import { AppError } from '@/shared/errors';

import type { LogContext, Logger, LogLevel } from './logger';

/**
 * Implementacao inicial: JSON em uma linha por evento, no stdout.
 *
 * Deliberadamente simples. Trocar por um provedor externo significa escrever
 * outro `Logger` — nenhum caso de uso muda.
 */
function emit(level: LogLevel, message: string, context: LogContext | undefined): void {
  const line = JSON.stringify({
    level,
    message,
    ...(context ?? {}),
  });

  if (level === 'error' || level === 'warn') {
    console.error(line);
    return;
  }
  console.log(line);
}

export const consoleLogger: Logger = {
  debug: (message, context) => emit('debug', message, context),
  info: (message, context) => emit('info', message, context),
  warn: (message, context) => emit('warn', message, context),
  error: (message, error, context) =>
    emit('error', message, {
      ...(context ?? {}),
      ...(error
        ? {
            errorName: error.name,
            errorMessage: error.message,
            ...(error instanceof AppError ? { errorCode: error.code, ...error.context } : {}),
          }
        : {}),
    }),
};

/** Logger silencioso, para testes. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
