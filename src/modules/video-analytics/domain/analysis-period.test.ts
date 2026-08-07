import { describe, expect, it } from 'vitest';

import {
  createAnalysisPeriod,
  filterByPeriod,
  isWithinPeriod,
  periodLengthInDays,
} from './analysis-period';
import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';

/** Janeiro de 2026 inteiro, como a interface o produz: dia cheio nas duas pontas. */
const JANEIRO = createAnalysisPeriod(
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2026-01-31T23:59:59.999Z'),
);

function video(iso: string) {
  return { id: iso, publishedAt: new Date(iso) };
}

describe('createAnalysisPeriod', () => {
  it('aceita um intervalo comum', () => {
    const period = createAnalysisPeriod(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-31T23:59:59.999Z'),
    );

    expect(period.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('aceita inicio igual ao fim', () => {
    // Um instante unico. Nao e erro — a interface manda dia cheio, mas o dominio
    // nao impoe isso.
    const instante = new Date('2026-03-10T12:00:00.000Z');

    expect(() => createAnalysisPeriod(instante, instante)).not.toThrow();
  });

  it('recusa inicio depois do fim', () => {
    // Barrar aqui e melhor que devolver "nenhum video encontrado": um intervalo
    // invertido e erro de digitacao, e um resultado vazio pareceria legitimo.
    try {
      createAnalysisPeriod(
        new Date('2026-02-01T00:00:00.000Z'),
        new Date('2026-01-01T00:00:00.000Z'),
      );
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_analysis_period');
    }
  });

  it('recusa inicio depois do fim mesmo por um milissegundo', () => {
    const fim = new Date('2026-01-31T23:59:59.999Z');
    const inicio = new Date(fim.getTime() + 1);

    expect(() => createAnalysisPeriod(inicio, fim)).toThrow(InvalidVideoAnalyticsInputError);
  });

  it.each([
    ['inicio invalido', new Date('nao e data'), new Date('2026-01-31T00:00:00.000Z')],
    ['fim invalido', new Date('2026-01-01T00:00:00.000Z'), new Date(Number.NaN)],
  ])('recusa %s', (_caso, inicio, fim) => {
    expect(() => createAnalysisPeriod(inicio, fim)).toThrow(InvalidVideoAnalyticsInputError);
  });

  it('copia as datas: mexer na entrada nao muda o periodo validado', () => {
    // `Date` e mutavel. Um periodo que muda depois de validado nao foi validado.
    const inicio = new Date('2026-01-01T00:00:00.000Z');
    const period = createAnalysisPeriod(inicio, new Date('2026-01-31T23:59:59.999Z'));

    inicio.setUTCFullYear(2030);

    expect(period.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isWithinPeriod — fronteiras', () => {
  it('inclui o instante exato do inicio', () => {
    // Fronteira inclusiva, como a janela de 30 dias ja faz.
    expect(isWithinPeriod(new Date('2026-01-01T00:00:00.000Z'), JANEIRO)).toBe(true);
  });

  it('inclui o instante exato do fim', () => {
    expect(isWithinPeriod(new Date('2026-01-31T23:59:59.999Z'), JANEIRO)).toBe(true);
  });

  it('exclui um milissegundo antes do inicio', () => {
    expect(isWithinPeriod(new Date('2025-12-31T23:59:59.999Z'), JANEIRO)).toBe(false);
  });

  it('exclui um milissegundo depois do fim', () => {
    expect(isWithinPeriod(new Date('2026-02-01T00:00:00.000Z'), JANEIRO)).toBe(false);
  });

  it('inclui um instante no meio', () => {
    expect(isWithinPeriod(new Date('2026-01-15T08:30:00.000Z'), JANEIRO)).toBe(true);
  });
});

describe('periodLengthInDays', () => {
  it('mede janeiro inteiro como 31 dias menos um milissegundo', () => {
    // Nao arredonda: de 00:00:00.000 a 23:59:59.999 sao 30,99999 dias. Quem
    // exibe decide como apresentar; o dominio nao inventa precisao.
    expect(periodLengthInDays(JANEIRO)).toBeCloseTo(31, 4);
    expect(periodLengthInDays(JANEIRO)).toBeLessThan(31);
  });

  it('um dia cheio mede quase um dia', () => {
    const umDia = createAnalysisPeriod(
      new Date('2026-03-10T00:00:00.000Z'),
      new Date('2026-03-10T23:59:59.999Z'),
    );

    expect(periodLengthInDays(umDia)).toBeCloseTo(1, 4);
    expect(periodLengthInDays(umDia)).toBeLessThan(1);
  });

  it('inicio igual ao fim mede zero', () => {
    const instante = new Date('2026-03-10T12:00:00.000Z');
    expect(periodLengthInDays(createAnalysisPeriod(instante, instante))).toBe(0);
  });

  it('sete dias cheios medem quase sete', () => {
    const semana = createAnalysisPeriod(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-07T23:59:59.999Z'),
    );

    expect(periodLengthInDays(semana)).toBeCloseTo(7, 4);
  });
});

describe('filterByPeriod', () => {
  const videos = [
    video('2025-12-31T23:59:59.999Z'), // 1ms antes — fora
    video('2026-01-01T00:00:00.000Z'), // exatamente o inicio — dentro
    video('2026-01-15T10:00:00.000Z'), // meio — dentro
    video('2026-01-31T23:59:59.999Z'), // exatamente o fim — dentro
    video('2026-02-01T00:00:00.000Z'), // 1ms depois — fora
  ];

  it('mantem apenas os videos dentro do intervalo', () => {
    const dentro = filterByPeriod(videos, JANEIRO);

    expect(dentro.map((v) => v.id)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-15T10:00:00.000Z',
      '2026-01-31T23:59:59.999Z',
    ]);
  });

  it('preserva a ordem de entrada', () => {
    // A ordem importa: `ChannelMetrics.videos` promete a ordem da entrada, e o
    // filtro nao pode embaralhar.
    const desordenados = [videos[2]!, videos[1]!, videos[3]!];

    expect(filterByPeriod(desordenados, JANEIRO).map((v) => v.id)).toEqual([
      '2026-01-15T10:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z',
    ]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(filterByPeriod([], JANEIRO)).toEqual([]);
  });

  it('nenhum video no intervalo devolve lista vazia, nao erro', () => {
    const foraTodos = [video('2025-06-01T00:00:00.000Z'), video('2027-01-01T00:00:00.000Z')];

    expect(filterByPeriod(foraTodos, JANEIRO)).toEqual([]);
  });

  it('um unico video dentro', () => {
    expect(filterByPeriod([video('2026-01-10T00:00:00.000Z')], JANEIRO)).toHaveLength(1);
  });

  it('nao modifica o array recebido', () => {
    const entrada = [...videos];
    filterByPeriod(entrada, JANEIRO);
    expect(entrada).toHaveLength(5);
  });

  it('um periodo de um unico dia seleciona so aquele dia', () => {
    const diaUnico = createAnalysisPeriod(
      new Date('2026-01-15T00:00:00.000Z'),
      new Date('2026-01-15T23:59:59.999Z'),
    );

    expect(filterByPeriod(videos, diaUnico).map((v) => v.id)).toEqual(['2026-01-15T10:00:00.000Z']);
  });
});
