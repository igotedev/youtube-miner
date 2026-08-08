import { describe, expect, it } from 'vitest';

import { InvalidWatchlistError } from './errors/invalid-watchlist';
import {
  MAX_WATCHLIST_NAME_LENGTH,
  MAX_WATCHLIST_NOTE_LENGTH,
  isSameWatchlistName,
  normalizeWatchlistName,
  normalizeWatchlistNote,
} from './watchlist';

/**
 * Regras puras das listas (SPEC-012).
 *
 * As tres funcoes aqui existem para que a violacao vire erro COM MOTIVO antes de
 * chegar ao banco. La ela viraria um codigo do PostgreSQL que a tela nao sabe
 * traduzir.
 */

describe('normalizeWatchlistName', () => {
  it('apara as pontas', () => {
    expect(normalizeWatchlistName('  Concorrentes  ')).toBe('Concorrentes');
  });

  it('recusa nome em branco', () => {
    // A constraint `length(btrim(name)) > 0` no banco recusaria depois, com uma
    // mensagem que a tela nao sabe explicar.
    expect(() => normalizeWatchlistName('')).toThrow(InvalidWatchlistError);
    expect(() => normalizeWatchlistName('   ')).toThrow(InvalidWatchlistError);
  });

  it('mede DEPOIS de aparar', () => {
    // `'  x  '` tem um caractere util, nao cinco. Medir antes recusaria nomes
    // legitimos e aceitaria nomes longos com espacos no fim.
    const noLimite = ' '.repeat(20) + 'a'.repeat(MAX_WATCHLIST_NAME_LENGTH) + ' '.repeat(20);
    expect(normalizeWatchlistName(noLimite)).toHaveLength(MAX_WATCHLIST_NAME_LENGTH);
  });

  it('recusa nome acima do teto', () => {
    expect(() => normalizeWatchlistName('a'.repeat(MAX_WATCHLIST_NAME_LENGTH + 1))).toThrow(
      InvalidWatchlistError,
    );
  });

  it('carrega o motivo, e nao so a mensagem', () => {
    // A tela decide pelo motivo, nunca comparando texto de mensagem.
    try {
      normalizeWatchlistName('');
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect((error as InvalidWatchlistError).reason).toBe('blank_name');
    }
  });
});

describe('normalizeWatchlistNote', () => {
  it('ausencia e `null`, nunca string vazia', () => {
    // RN-08: "sem nota" e diferente de "nota vazia", e so o primeiro significa
    // alguma coisa.
    expect(normalizeWatchlistNote(null)).toBeNull();
    expect(normalizeWatchlistNote(undefined)).toBeNull();
    expect(normalizeWatchlistNote('')).toBeNull();
    expect(normalizeWatchlistNote('    ')).toBeNull();
  });

  it('preserva a nota aparada', () => {
    expect(normalizeWatchlistNote('  canal de referencia  ')).toBe('canal de referencia');
  });

  it('recusa nota acima do teto', () => {
    expect(() => normalizeWatchlistNote('a'.repeat(MAX_WATCHLIST_NOTE_LENGTH + 1))).toThrow(
      InvalidWatchlistError,
    );
  });
});

describe('isSameWatchlistName', () => {
  it('ignora maiusculas — a regra que o esquema nao cumpria', () => {
    // Espelha o indice `(user_id, lower(name))` da SPEC-012. Ate aquela
    // migracao, "Concorrentes" e "concorrentes" coexistiam na mesma conta.
    expect(isSameWatchlistName('Concorrentes', 'concorrentes')).toBe(true);
    expect(isSameWatchlistName('CONCORRENTES', 'Concorrentes')).toBe(true);
  });

  it('ignora espacos nas pontas', () => {
    expect(isSameWatchlistName('  Ideias ', 'Ideias')).toBe(true);
  });

  it('nomes diferentes continuam diferentes', () => {
    expect(isSameWatchlistName('Concorrentes', 'Concorrente')).toBe(false);
  });

  it('nao tenta resolver acentos', () => {
    // Nem esta funcao nem o `lower()` do PostgreSQL fazem isso. O teste existe
    // para que a limitacao seja escolhida, e nao descoberta.
    expect(isSameWatchlistName('Ideias', 'Idéias')).toBe(false);
  });
});
