import { describe, expect, it } from 'vitest';

import { CorruptedPersistedDataError } from '@/shared/errors';

import {
  fromDate,
  fromNullableDate,
  toCount,
  toDate,
  toEnumValue,
  toJsonObject,
  toNullableDate,
  toNullableText,
  toText,
  toUuid,
} from './row-mappers';

const VALID_UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('toUuid', () => {
  it('aceita um UUID canonico', () => {
    expect(toUuid(VALID_UUID, 'id')).toBe(VALID_UUID);
  });

  it.each([
    ['string vazia', ''],
    ['texto qualquer', 'nao-e-uuid'],
    ['UUID truncado', '3f2b1c4d-5e6f-4a7b-8c9d'],
    ['null', null],
    ['numero', 42],
  ])('recusa %s', (_name, value) => {
    expect(() => toUuid(value, 'id')).toThrow(CorruptedPersistedDataError);
  });
});

describe('toText', () => {
  it('aceita texto nao vazio', () => {
    expect(toText('abc', 'title')).toBe('abc');
  });

  it('recusa texto vazio e null', () => {
    expect(() => toText('', 'title')).toThrow(CorruptedPersistedDataError);
    expect(() => toText(null, 'title')).toThrow(CorruptedPersistedDataError);
  });

  it('toNullableText preserva null sem transformar em string vazia', () => {
    expect(toNullableText(null, 'handle')).toBeNull();
    expect(toNullableText(undefined, 'handle')).toBeNull();
    expect(toNullableText('@canal', 'handle')).toBe('@canal');
  });
});

describe('datas', () => {
  it('reconstroi timestamptz vindo como string ISO', () => {
    const date = toDate('2026-08-06T12:00:00.000Z', 'created_at');
    expect(date.toISOString()).toBe('2026-08-06T12:00:00.000Z');
  });

  it('aceita offset diferente de UTC e normaliza o instante', () => {
    // timestamptz e um instante absoluto; o offset e so a forma de escrever.
    expect(toDate('2026-08-06T09:00:00.000-03:00', 'created_at').toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    );
  });

  it('aceita um Date ja construido', () => {
    const original = new Date('2026-08-06T12:00:00.000Z');
    expect(toDate(original, 'created_at')).toEqual(original);
  });

  it('recusa data invalida em vez de produzir Invalid Date', () => {
    // `new Date('nao-e-data')` nao lanca: devolve Invalid Date, que so se
    // manifesta muito depois e longe da causa.
    expect(() => toDate('nao-e-data', 'created_at')).toThrow(CorruptedPersistedDataError);
    expect(() => toDate(new Date('nao-e-data'), 'created_at')).toThrow(CorruptedPersistedDataError);
  });

  it('recusa tipos que nao sao data', () => {
    expect(() => toDate(1234, 'created_at')).toThrow(CorruptedPersistedDataError);
    expect(() => toDate(null, 'created_at')).toThrow(CorruptedPersistedDataError);
  });

  it('toNullableDate preserva null', () => {
    expect(toNullableDate(null, 'completed_at')).toBeNull();
    expect(toNullableDate(undefined, 'completed_at')).toBeNull();
  });

  it('faz o percurso de ida e volta sem perder o instante', () => {
    const original = new Date('2026-08-06T12:34:56.789Z');
    expect(toDate(fromDate(original, 'x'), 'x')).toEqual(original);
  });

  it('fromNullableDate preserva null', () => {
    expect(fromNullableDate(null, 'x')).toBeNull();
  });

  it('fromDate recusa Invalid Date', () => {
    expect(() => fromDate(new Date('nao-e-data'), 'x')).toThrow(CorruptedPersistedDataError);
  });
});

describe('toCount — conversao de bigint', () => {
  it('aceita numero dentro do inteiro seguro', () => {
    expect(toCount(1_234_567, 'view_count')).toBe(1_234_567);
  });

  it('aceita bigint nativo', () => {
    expect(toCount(BigInt(9_000_000), 'view_count')).toBe(9_000_000);
  });

  it('aceita string, que e como bigint grande chega pelo cliente Supabase', () => {
    expect(toCount('9007199254740991', 'view_count')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('aceita zero, que e contagem legitima', () => {
    // Zero visualizacoes e um fato; nao pode virar null.
    expect(toCount(0, 'view_count')).toBe(0);
    expect(toCount('0', 'view_count')).toBe(0);
    expect(toCount(BigInt(0), 'view_count')).toBe(0);
  });

  it('preserva null sem transformar em zero (RN-08)', () => {
    expect(toCount(null, 'view_count')).toBeNull();
    expect(toCount(undefined, 'view_count')).toBeNull();
    expect(toCount(null, 'view_count')).not.toBe(0);
  });

  it('recusa valor acima do inteiro seguro em vez de arredondar', () => {
    // 2^53 + 1: `Number('9007199254740993')` devolveria 9007199254740992 em
    // silencio, e a contagem exibida estaria errada.
    expect(() => toCount('9007199254740993', 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount(BigInt('9007199254740993'), 'view_count')).toThrow(
      CorruptedPersistedDataError,
    );
  });

  it('recusa contagem negativa', () => {
    expect(() => toCount(-1, 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount('-1', 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount(BigInt(-1), 'view_count')).toThrow(CorruptedPersistedDataError);
  });

  it('recusa valores nao inteiros e nao finitos', () => {
    expect(() => toCount(1.5, 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount(Number.NaN, 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount(Number.POSITIVE_INFINITY, 'view_count')).toThrow(
      CorruptedPersistedDataError,
    );
  });

  it('recusa string que nao representa inteiro', () => {
    expect(() => toCount('1e10', 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount('abc', 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount('1.5', 'view_count')).toThrow(CorruptedPersistedDataError);
  });

  it('recusa tipos inesperados', () => {
    expect(() => toCount({}, 'view_count')).toThrow(CorruptedPersistedDataError);
    expect(() => toCount(true, 'view_count')).toThrow(CorruptedPersistedDataError);
  });
});

describe('toEnumValue', () => {
  const STATUSES = ['pending', 'completed', 'failed'] as const;

  it('aceita valor conhecido', () => {
    expect(toEnumValue('completed', STATUSES, 'status')).toBe('completed');
  });

  it('recusa valor desconhecido', () => {
    // Sinal de que a migration andou sem o codigo.
    expect(() => toEnumValue('archived', STATUSES, 'status')).toThrow(CorruptedPersistedDataError);
    expect(() => toEnumValue(null, STATUSES, 'status')).toThrow(CorruptedPersistedDataError);
  });
});

describe('toJsonObject', () => {
  it('aceita objeto', () => {
    expect(toJsonObject({ a: 1 }, 'metrics')).toEqual({ a: 1 });
  });

  it('recusa array, null e escalares', () => {
    expect(() => toJsonObject([], 'metrics')).toThrow(CorruptedPersistedDataError);
    expect(() => toJsonObject(null, 'metrics')).toThrow(CorruptedPersistedDataError);
    expect(() => toJsonObject('texto', 'metrics')).toThrow(CorruptedPersistedDataError);
  });
});

describe('seguranca das mensagens', () => {
  it('nunca interpola o valor recebido na mensagem nem no contexto', () => {
    const sensitive = 'token-secreto-nao-deve-vazar';

    try {
      toUuid(sensitive, 'id');
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      const corrupted = error as CorruptedPersistedDataError;
      expect(corrupted.message).not.toContain(sensitive);
      expect(JSON.stringify(corrupted.context)).not.toContain(sensitive);
      // O nome do campo entra: e util e nao e sensivel.
      expect(corrupted.context).toMatchObject({ field: 'id' });
    }
  });
});
