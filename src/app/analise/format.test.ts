import { describe, expect, it } from 'vitest';

import {
  UNAVAILABLE_LABEL,
  formatAnalysisStatus,
  formatCount,
  formatDecimal,
  formatIntervalDays,
  formatOutlierBand,
  formatTimestamp,
} from './format';

/**
 * O centro destes testes e a RN-08: a tela nunca pode exibir `0` no lugar de um
 * dado que nao existe. As duas primeiras asserçoes de cada bloco sao o par que
 * importa — `null` e `0` produzindo textos DIFERENTES.
 */

describe('formatCount', () => {
  it('exibe ausencia como rotulo, nunca como zero', () => {
    expect(formatCount(null)).toBe(UNAVAILABLE_LABEL);
  });

  it('exibe zero legitimo como zero', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('nao confunde ausencia com zero', () => {
    expect(formatCount(null)).not.toBe(formatCount(0));
  });

  it('usa separador de milhar', () => {
    // O separador do pt-BR e o ponto; comparo sem depender do caractere exato
    // de espaco que o ICU possa usar em outras casas.
    expect(formatCount(1_234_567)).toBe('1.234.567');
  });

  it('arredonda para inteiro', () => {
    expect(formatCount(42.7)).toBe('43');
  });
});

describe('formatDecimal', () => {
  it('exibe ausencia como rotulo', () => {
    expect(formatDecimal(null)).toBe(UNAVAILABLE_LABEL);
  });

  it('exibe zero legitimo com casa decimal', () => {
    expect(formatDecimal(0)).toBe('0,0');
  });

  it('mantem a casa decimal pedida', () => {
    expect(formatDecimal(2.5)).toBe('2,5');
    expect(formatDecimal(2.5, 2)).toBe('2,50');
  });
});

describe('formatIntervalDays', () => {
  it('exibe ausencia como rotulo — um video nao publica a cada zero dias', () => {
    expect(formatIntervalDays(null)).toBe(UNAVAILABLE_LABEL);
  });

  it('nao confunde ausencia de intervalo com intervalo zero', () => {
    expect(formatIntervalDays(null)).not.toBe(formatIntervalDays(0));
  });

  it('acompanha a unidade', () => {
    expect(formatIntervalDays(4)).toBe('4,0 dias');
  });
});

describe('formatTimestamp', () => {
  it('formata em UTC, independente do fuso do leitor', () => {
    const formatted = formatTimestamp(new Date('2026-07-30T12:00:00.000Z'));
    expect(formatted).toContain('30/07/2026');
    expect(formatted).toContain('12:00');
  });
});

describe('formatAnalysisStatus', () => {
  it('traduz os estados conhecidos', () => {
    expect(formatAnalysisStatus('partially_completed')).toBe('Concluida sem relatorio de IA');
    expect(formatAnalysisStatus('collecting_videos')).toBe('Coletando os videos');
  });

  it('devolve o proprio valor quando o estado e desconhecido', () => {
    expect(formatAnalysisStatus('estado_novo')).toBe('estado_novo');
  });
});

describe('formatOutlierBand', () => {
  it('trata `null` como nao classificavel, e nao como uma quinta faixa', () => {
    expect(formatOutlierBand(null)).toBe('Nao classificavel');
  });

  it('nao confunde nao classificavel com normal', () => {
    expect(formatOutlierBand(null)).not.toBe(formatOutlierBand('normal'));
  });

  it('traduz as quatro faixas', () => {
    expect(formatOutlierBand('normal')).toBe('Normal');
    expect(formatOutlierBand('above_normal')).toBe('Acima do normal');
    expect(formatOutlierBand('outlier')).toBe('Fora da curva');
    expect(formatOutlierBand('large_outlier')).toBe('Muito fora da curva');
  });
});
