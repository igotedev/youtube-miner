import { describe, expect, it } from 'vitest';

import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import {
  calculateMean,
  calculateMedian,
  calculateSum,
  findMaximum,
  findMinimum,
} from './statistics';

describe('calculateMean', () => {
  it('com um unico valor devolve o proprio valor', () => {
    expect(calculateMean([42])).toBe(42);
  });

  it('com varios valores devolve a media aritmetica', () => {
    expect(calculateMean([10, 20, 30])).toBe(20);
    expect(calculateMean([1, 2])).toBe(1.5);
  });

  it('com conjunto vazio devolve null, e nao zero', () => {
    // RN-08: "nenhum video" e "media zero" sao afirmacoes diferentes.
    expect(calculateMean([])).toBeNull();
    expect(calculateMean([])).not.toBe(0);
  });

  it('nao arredonda o resultado', () => {
    expect(calculateMean([1, 2])).toBe(1.5);
    expect(calculateMean([10, 20, 25])).toBeCloseTo(18.333333333333332, 12);
  });

  it('aceita zeros, que sao contagem legitima', () => {
    expect(calculateMean([0, 0, 0])).toBe(0);
  });
});

describe('calculateMedian', () => {
  it('com um unico valor devolve o proprio valor', () => {
    expect(calculateMedian([7])).toBe(7);
  });

  it('com quantidade impar devolve o valor central', () => {
    expect(calculateMedian([5, 1, 3])).toBe(3);
  });

  it('com quantidade par devolve a media dos dois centrais', () => {
    expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it('com conjunto vazio devolve null, e nao zero', () => {
    expect(calculateMedian([])).toBeNull();
    expect(calculateMedian([])).not.toBe(0);
  });

  it('ordena numericamente, nao como texto', () => {
    // Com o `sort` padrao isto devolveria 100.
    expect(calculateMedian([10, 9, 100])).toBe(10);
  });

  it('nao arredonda o resultado', () => {
    expect(calculateMedian([1, 2])).toBe(1.5);
  });
});

describe('imutabilidade da entrada', () => {
  it('calculateMedian nao altera o array recebido', () => {
    const values = [5, 1, 3];
    const snapshot = [...values];

    calculateMedian(values);

    expect(values).toEqual(snapshot);
  });

  it('nenhuma funcao estatistica altera o array recebido', () => {
    const values = [9, 2, 7, 4];
    const snapshot = [...values];

    calculateMean(values);
    calculateMedian(values);
    calculateSum(values);
    findMinimum(values);
    findMaximum(values);

    expect(values).toEqual(snapshot);
  });
});

describe('validacao numerica', () => {
  const invalidValues: readonly (readonly [string, number])[] = [
    ['negativo', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  it.each(invalidValues)('calculateMean recusa %s', (_name, value) => {
    expect(() => calculateMean([1, value])).toThrow(InvalidVideoAnalyticsInputError);
  });

  it.each(invalidValues)('calculateMedian recusa %s', (_name, value) => {
    expect(() => calculateMedian([1, value])).toThrow(InvalidVideoAnalyticsInputError);
  });

  it('reporta o motivo invalid_numeric_value', () => {
    try {
      calculateMean([-5]);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_numeric_value');
    }
  });
});

describe('soma, minimo e maximo', () => {
  it('somam e extremam corretamente', () => {
    expect(calculateSum([1, 2, 3])).toBe(6);
    expect(findMinimum([5, 1, 3])).toBe(1);
    expect(findMaximum([5, 1, 3])).toBe(5);
  });

  it('devolvem null para conjunto vazio', () => {
    expect(calculateSum([])).toBeNull();
    expect(findMinimum([])).toBeNull();
    expect(findMaximum([])).toBeNull();
  });
});
