import type { AppError } from '@/shared/errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

/**
 * Porta de log. Casos de uso dependem desta interface, nunca de `console`
 * direto, para que o destino (stdout, Supabase, provedor externo) possa mudar
 * sem tocar em regra de negocio.
 */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: AppError | Error, context?: LogContext): void;
}
