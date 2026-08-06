import { describe, expect, it } from 'vitest';

import {
  calculateOutlierScore,
  classifyOutlier,
  OUTLIER_THRESHOLDS,
  type OutlierBand,
} from './outlier';

describe('calculateOutlierScore', () => {
  it('divide as visualizacoes pela mediana do formato', () => {
    expect(calculateOutlierScore(300, 100)).toBe(3);
  });

  it('nao arredonda o resultado', () => {
    expect(calculateOutlierScore(100, 3)).toBeCloseTo(33.333333333333336, 12);
    expect(calculateOutlierScore(149, 100)).toBe(1.49);
  });

  it('viewCount zero com mediana positiva produz score zero', () => {
    // Zero e um fato: o video existe e nao foi visto. Nao e indisponivel.
    expect(calculateOutlierScore(0, 100)).toBe(0);
  });

  it('viewCount ausente produz score indisponivel', () => {
    expect(calculateOutlierScore(null, 100)).toBeNull();
  });

  it('mediana ausente produz score indisponivel', () => {
    expect(calculateOutlierScore(500, null)).toBeNull();
  });

  it('mediana zero produz score indisponivel, e nao Infinity', () => {
    // Mesmo com 1000 visualizacoes: sem um "tipico" positivo, a razao nao tem
    // significado. Ver SPEC-003, secao 14.
    const score = calculateOutlierScore(1000, 0);

    expect(score).toBeNull();
    expect(score).not.toBe(Number.POSITIVE_INFINITY);
  });
});

describe('classifyOutlier — fronteiras exatas', () => {
  const cases: readonly (readonly [number, OutlierBand])[] = [
    [0, 'normal'],
    [1, 'normal'],
    [1.4999, 'normal'],
    [1.5, 'above_normal'],
    [2, 'above_normal'],
    [2.4999, 'above_normal'],
    [2.5, 'outlier'],
    [4, 'outlier'],
    [4.9999, 'outlier'],
    [5, 'large_outlier'],
    [12, 'large_outlier'],
  ];

  it.each(cases)('score %s classifica como %s', (score, band) => {
    expect(classifyOutlier(score)).toBe(band);
  });

  it('usa os limites declarados em OUTLIER_THRESHOLDS', () => {
    expect(classifyOutlier(OUTLIER_THRESHOLDS.aboveNormal)).toBe('above_normal');
    expect(classifyOutlier(OUTLIER_THRESHOLDS.outlier)).toBe('outlier');
    expect(classifyOutlier(OUTLIER_THRESHOLDS.largeOutlier)).toBe('large_outlier');
  });

  it('nao arredonda o score antes de classificar', () => {
    // Arredondando para uma casa, 1.4999 viraria 1.5 e mudaria de faixa.
    expect(classifyOutlier(1.4999)).toBe('normal');
    expect(classifyOutlier(2.4999)).toBe('above_normal');
    expect(classifyOutlier(4.9999)).toBe('outlier');
  });

  it('score indisponivel permanece indisponivel', () => {
    expect(classifyOutlier(null)).toBeNull();
  });
});
