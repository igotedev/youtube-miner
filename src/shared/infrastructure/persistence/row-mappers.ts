import { CorruptedPersistedDataError } from '@/shared/errors';

/**
 * Conversores entre linhas do PostgreSQL e valores de dominio.
 *
 * Regra que rege este arquivo: uma linha corrompida FALHA em vez de produzir
 * silenciosamente uma entidade valida. `as SomeDomainType` sem validacao e
 * exatamente o que estas funcoes existem para evitar — um cast cego transforma
 * `null` em `string` aos olhos do compilador e explode tres camadas adiante,
 * longe da causa.
 *
 * Os erros nunca interpolam o valor recebido: uma linha pode conter dado de
 * usuario, e mensagem de erro acaba em log.
 */

function corrupted(field: string, reason: string): CorruptedPersistedDataError {
  return new CorruptedPersistedDataError(`Dado persistido invalido em "${field}": ${reason}.`, {
    field,
    reason,
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw corrupted(field, 'nao e um UUID canonico');
  }
  return value;
}

export function toText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw corrupted(field, 'nao e um texto nao vazio');
  }
  return value;
}

export function toNullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return toText(value, field);
}

/**
 * `timestamptz` -> `Date`.
 *
 * O cliente Supabase devolve `timestamptz` como string ISO-8601 em UTC. A
 * reconstrucao e explicita e valida o resultado: `new Date('qualquer coisa')`
 * nao lanca, produz um `Invalid Date` que so se manifesta muito depois.
 */
export function toDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw corrupted(field, 'nao e uma data');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw corrupted(field, 'nao e uma data valida');
  }
  return date;
}

export function toNullableDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value, field);
}

/** `Date` -> string ISO-8601 em UTC, formato aceito por `timestamptz`. */
export function fromDate(value: Date, field: string): string {
  if (Number.isNaN(value.getTime())) {
    throw corrupted(field, 'nao e uma data valida');
  }
  return value.toISOString();
}

export function fromNullableDate(value: Date | null, field: string): string | null {
  return value === null ? null : fromDate(value, field);
}

/**
 * `bigint` do PostgreSQL -> `number` do dominio.
 *
 * O cliente Supabase transporta JSON, e `bigint` chega como STRING quando
 * excede o inteiro seguro do JavaScript, e como `number` quando cabe. Aceitar
 * as duas formas e obrigatorio; um `Number(value)` cego arredondaria em
 * silencio um valor grande e o produto exibiria uma contagem errada.
 *
 * Acima de `Number.MAX_SAFE_INTEGER` a funcao RECUSA em vez de arredondar. O
 * dominio usa `number` e essa escolha tem um limite honesto: 9.007.199.254.740.991
 * visualizacoes. Nenhum canal do YouTube chega perto — o video mais visto da
 * plataforma esta na casa de 10^10, cinco ordens de grandeza abaixo. Se um dia
 * chegar, a decisao correta e mudar o dominio com ADR, nao truncar aqui.
 *
 * `null` permanece `null`: contagem indisponivel nao e zero (RN-08).
 */
export function toCount(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'bigint') {
    // `BigInt(0)` e nao `0n`: o literal exige target ES2020, e o projeto compila
    // para ES2017. O TIPO bigint esta disponivel pela lib esnext.
    if (value < BigInt(0)) throw corrupted(field, 'contagem negativa');
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw corrupted(field, 'excede o inteiro seguro do JavaScript');
    }
    return Number(value);
  }

  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) throw corrupted(field, 'nao e um inteiro');
    return toCount(BigInt(value), field);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw corrupted(field, 'nao e finito');
    if (!Number.isInteger(value)) throw corrupted(field, 'nao e inteiro');
    if (value < 0) throw corrupted(field, 'contagem negativa');
    if (value > Number.MAX_SAFE_INTEGER) {
      throw corrupted(field, 'excede o inteiro seguro do JavaScript');
    }
    return value;
  }

  throw corrupted(field, 'tipo inesperado para contagem');
}

/** `integer` nao negativo, como duracao em segundos. */
export function toNonNegativeInteger(value: unknown, field: string): number | null {
  return toCount(value, field);
}

/**
 * Valor de uma lista fechada de estados.
 *
 * Um `status` desconhecido vindo do banco significa que a migration andou sem o
 * codigo — falhar alto e o unico jeito de isso ser notado.
 */
export function toEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw corrupted(field, 'valor fora do conjunto conhecido');
  }
  return value as T;
}

/** `jsonb` que precisa ser um objeto — nunca array, nunca escalar. */
export function toJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw corrupted(field, 'nao e um objeto JSON');
  }
  return value as Record<string, unknown>;
}
