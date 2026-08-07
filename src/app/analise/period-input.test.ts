import { describe, expect, it } from 'vitest';

import {
  PERIOD_SHORTCUTS,
  parseDayEnd,
  parseDayStart,
  shortcutRange,
  toIsoDay,
} from './period-input';

/**
 * O centro destes testes sao as BORDAS. Um dia de calendario vira um intervalo
 * de instantes, e errar a ponta final por um milissegundo faz o video publicado
 * a noite do ultimo dia sumir sem explicacao.
 */

describe('parseDayStart', () => {
  it('expande para o inicio do dia em UTC', () => {
    expect(parseDayStart('2026-01-01')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('ignora espacos em volta', () => {
    expect(parseDayStart('  2026-01-01  ')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('parseDayEnd', () => {
  it('expande para o FIM do dia em UTC', () => {
    // Se isto virasse 00:00, um video publicado as 22h do ultimo dia ficaria de
    // fora e ninguem entenderia por que.
    expect(parseDayEnd('2026-01-31')?.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('o mesmo dia produz inicio e fim diferentes', () => {
    expect(parseDayStart('2026-03-10')?.toISOString()).not.toBe(
      parseDayEnd('2026-03-10')?.toISOString(),
    );
  });
});

describe('entradas recusadas', () => {
  it.each([
    ['vazio', ''],
    ['so espacos', '   '],
    ['formato brasileiro', '31/01/2026'],
    ['sem zero a esquerda', '2026-1-1'],
    ['com hora', '2026-01-01T10:00'],
    ['texto', 'ontem'],
    ['ano curto', '26-01-01'],
  ])('recusa %s', (_caso, entrada) => {
    expect(parseDayStart(entrada)).toBeNull();
    expect(parseDayEnd(entrada)).toBeNull();
  });

  it('recusa um dia que nao existe no calendario', () => {
    // `2026-02-31` casa com o padrao e nao e uma data. Sem a volta pelo ISO, o
    // JavaScript poderia normalizar para 3 de marco em silencio.
    expect(parseDayStart('2026-02-31')).toBeNull();
    expect(parseDayStart('2026-13-01')).toBeNull();
    expect(parseDayStart('2026-04-31')).toBeNull();
  });

  it('aceita 29 de fevereiro em ano bissexto e recusa em ano comum', () => {
    expect(parseDayStart('2024-02-29')).not.toBeNull();
    expect(parseDayStart('2026-02-29')).toBeNull();
  });
});

describe('shortcutRange', () => {
  const REFERENCIA = new Date('2026-08-07T15:30:00.000Z');

  it('7 dias inclui o dia de hoje', () => {
    // Sete dias inclusive: de 01 a 07. Usar hoje-7 daria oito dias e o rotulo
    // "7 dias" estaria mentindo.
    expect(shortcutRange(7, REFERENCIA)).toEqual({ start: '2026-08-01', end: '2026-08-07' });
  });

  it('30 dias', () => {
    expect(shortcutRange(30, REFERENCIA)).toEqual({ start: '2026-07-09', end: '2026-08-07' });
  });

  it('90 dias atravessa a virada de mes', () => {
    // 10/05 a 07/08 = 22 + 30 + 31 + 7 = 90 dias, contando os dois extremos.
    expect(shortcutRange(90, REFERENCIA)).toEqual({ start: '2026-05-10', end: '2026-08-07' });
  });

  it('365 dias atravessa a virada de ano', () => {
    expect(shortcutRange(365, REFERENCIA)).toEqual({ start: '2025-08-08', end: '2026-08-07' });
  });

  it('1 dia produz inicio igual ao fim', () => {
    expect(shortcutRange(1, REFERENCIA)).toEqual({ start: '2026-08-07', end: '2026-08-07' });
  });

  it('nao le o relogio: a referencia chega por parametro', () => {
    const outra = new Date('2020-01-01T00:00:00.000Z');
    expect(shortcutRange(7, outra).end).toBe('2020-01-01');
  });

  it('todo atalho cobre exatamente a quantidade de dias que o rotulo promete', () => {
    /**
     * A invariante que importa. Foi contando dias no braco que eu errei a
     * expectativa do caso de 90 dias — uma conta manual por caso nao protege
     * ninguem; esta protege.
     */
    for (const shortcut of PERIOD_SHORTCUTS) {
      const range = shortcutRange(shortcut.days, REFERENCIA);
      const inicio = parseDayStart(range.start)!;
      const fim = parseDayEnd(range.end)!;

      const diasCobertos = Math.round((fim.getTime() - inicio.getTime()) / 86_400_000);
      expect(diasCobertos).toBe(shortcut.days);
    }
  });

  it('todo atalho produz um intervalo que o parser aceita e nao inverte', () => {
    for (const shortcut of PERIOD_SHORTCUTS) {
      const range = shortcutRange(shortcut.days, REFERENCIA);
      const inicio = parseDayStart(range.start);
      const fim = parseDayEnd(range.end);

      expect(inicio).not.toBeNull();
      expect(fim).not.toBeNull();
      expect(inicio!.getTime()).toBeLessThan(fim!.getTime());
    }
  });
});

describe('toIsoDay', () => {
  it('devolve o dia em UTC, sem hora', () => {
    expect(toIsoDay(new Date('2026-08-07T23:45:00.000Z'))).toBe('2026-08-07');
  });
});
