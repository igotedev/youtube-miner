import { describe, expect, it } from 'vitest';

import {
  SHORTS_MAX_DURATION_SECONDS,
  classifyVideoFormat,
  parseIso8601Duration,
} from './video-duration';

describe('parseIso8601Duration', () => {
  it.each([
    ['PT50S', 50],
    ['PT33S', 33],
    ['PT1M', 60],
    ['PT14M35S', 875],
    ['PT1H', 3_600],
    ['PT1H2M3S', 3_723],
    ['PT2H45M30S', 9_930],
    ['P1DT2H', 93_600],
    ['PT0S', 0],
    ['P0D', 0],
  ])('converte %s em %i segundos', (input, expected) => {
    expect(parseIso8601Duration(input)).toBe(expected);
  });

  it('aceita segundos fracionarios', () => {
    expect(parseIso8601Duration('PT1.5S')).toBe(1.5);
  });

  it('ignora espaco em volta', () => {
    expect(parseIso8601Duration('  PT50S  ')).toBe(50);
  });

  it.each([
    ['string vazia', ''],
    ['sem o P inicial', 'T50S'],
    ['texto solto', '50 segundos'],
    ['P sozinho, sem componente', 'P'],
    ['semanas — a API nao emite', 'P2W'],
    ['meses — exigiria decidir quantos dias tem um mes', 'P1M'],
    ['ordem invertida', 'PT30S5M'],
    ['numero puro', '120'],
  ])('devolve null para %s', (_caso, input) => {
    expect(parseIso8601Duration(input)).toBeNull();
  });

  it('nao confunde entrada invalida com duracao zero (RN-08)', () => {
    // As duas coisas significam fatos diferentes e nao podem colidir.
    expect(parseIso8601Duration('lixo')).toBeNull();
    expect(parseIso8601Duration('PT0S')).toBe(0);
  });
});

describe('classifyVideoFormat', () => {
  it('classifica como short ate o teto, inclusive', () => {
    expect(classifyVideoFormat(1)).toBe('short');
    expect(classifyVideoFormat(59)).toBe('short');
    expect(classifyVideoFormat(SHORTS_MAX_DURATION_SECONDS)).toBe('short');
  });

  it('classifica como long acima do teto', () => {
    expect(classifyVideoFormat(SHORTS_MAX_DURATION_SECONDS + 1)).toBe('long');
    expect(classifyVideoFormat(875)).toBe('long');
  });

  it('classifica duracao ausente como unknown, nunca como long', () => {
    // Chutar `long` contaminaria a mediana dos videos longos (RN-06).
    expect(classifyVideoFormat(null)).toBe('unknown');
  });

  it('classifica duracao zero como unknown — e transmissao ao vivo, nao Short', () => {
    expect(classifyVideoFormat(0)).toBe('unknown');
  });

  it('classifica duracao negativa ou nao finita como unknown', () => {
    expect(classifyVideoFormat(-10)).toBe('unknown');
    expect(classifyVideoFormat(Number.NaN)).toBe('unknown');
    expect(classifyVideoFormat(Number.POSITIVE_INFINITY)).toBe('unknown');
  });

  it('o teto atual e 180 segundos', () => {
    // Fixado em teste porque muda por decisao de plataforma: se o YouTube
    // mudar de novo, este teste falha e obriga a revisar a constante.
    expect(SHORTS_MAX_DURATION_SECONDS).toBe(180);
  });
});
