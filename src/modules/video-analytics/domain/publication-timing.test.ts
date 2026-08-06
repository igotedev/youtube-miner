import { describe, expect, it } from 'vitest';

import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import {
  calculatePublicationFrequency,
  calculateVideoAgeInDays,
  calculateViewsPerDay,
  MIN_EFFECTIVE_AGE_DAYS,
  MS_PER_DAY,
} from './publication-timing';

const COLLECTED_AT = new Date('2026-08-06T12:00:00.000Z');

/** Data a N dias fracionarios antes da coleta. */
function daysBefore(days: number): Date {
  return new Date(COLLECTED_AT.getTime() - days * MS_PER_DAY);
}

describe('calculateVideoAgeInDays', () => {
  it('video com exatamente um dia', () => {
    expect(calculateVideoAgeInDays(daysBefore(1), COLLECTED_AT)).toBe(1);
  });

  it('video com dez dias', () => {
    expect(calculateVideoAgeInDays(daysBefore(10), COLLECTED_AT)).toBe(10);
  });

  it('video publicado ha menos de um dia devolve fracao, nao zero nem um', () => {
    // 6 horas = 0,25 dia. Truncar aqui inflaria visualizacoes por dia.
    expect(calculateVideoAgeInDays(daysBefore(0.25), COLLECTED_AT)).toBe(0.25);
  });

  it('video publicado exatamente em collectedAt tem idade zero', () => {
    expect(calculateVideoAgeInDays(COLLECTED_AT, COLLECTED_AT)).toBe(0);
  });

  it('mantem dias fracionarios sem arredondar', () => {
    expect(calculateVideoAgeInDays(daysBefore(1.5), COLLECTED_AT)).toBe(1.5);
    expect(calculateVideoAgeInDays(daysBefore(2.75), COLLECTED_AT)).toBe(2.75);
  });

  it('usa a data de referencia fornecida, nao o relogio do sistema', () => {
    const outraColeta = new Date('2026-09-06T12:00:00.000Z');
    const publicado = daysBefore(10);

    expect(calculateVideoAgeInDays(publicado, COLLECTED_AT)).toBe(10);
    expect(calculateVideoAgeInDays(publicado, outraColeta)).toBe(41);
  });

  it('recusa publicacao posterior a coleta', () => {
    const futuro = new Date(COLLECTED_AT.getTime() + 1);

    try {
      calculateVideoAgeInDays(futuro, COLLECTED_AT);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('future_publication_date');
    }
  });

  it('recusa data de publicacao invalida', () => {
    try {
      calculateVideoAgeInDays(new Date('nao-e-data'), COLLECTED_AT);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_published_at');
    }
  });

  it('recusa data de coleta invalida', () => {
    try {
      calculateVideoAgeInDays(daysBefore(1), new Date('nao-e-data'));
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_collected_at');
    }
  });
});

describe('calculateViewsPerDay', () => {
  it('divide pela idade quando ela passa de um dia', () => {
    expect(calculateViewsPerDay(1000, 10)).toBe(100);
  });

  it('usa um dia como denominador minimo para videos recentes', () => {
    // 6 horas de vida com 100 visualizacoes daria 400/dia sem o piso.
    expect(calculateViewsPerDay(100, 0.25)).toBe(100);
    expect(MIN_EFFECTIVE_AGE_DAYS).toBe(1);
  });

  it('trata idade zero sem divisao por zero e sem Infinity', () => {
    const result = calculateViewsPerDay(500, 0);

    expect(result).toBe(500);
    expect(Number.isFinite(result ?? Number.NaN)).toBe(true);
  });

  it('viewCount zero produz zero, nao indisponivel', () => {
    // Zero visualizacoes e um fato conhecido, diferente de "nao sabemos".
    expect(calculateViewsPerDay(0, 5)).toBe(0);
  });

  it('viewCount ausente produz indisponivel, nao zero', () => {
    expect(calculateViewsPerDay(null, 5)).toBeNull();
  });

  it('nao arredonda o resultado', () => {
    expect(calculateViewsPerDay(100, 3)).toBeCloseTo(33.333333333333336, 12);
  });

  it('recusa viewCount negativo', () => {
    try {
      calculateViewsPerDay(-1, 5);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidVideoAnalyticsInputError).reason).toBe('invalid_view_count');
    }
  });

  it('recusa idade invalida', () => {
    expect(() => calculateViewsPerDay(100, Number.NaN)).toThrow(InvalidVideoAnalyticsInputError);
    expect(() => calculateViewsPerDay(100, -1)).toThrow(InvalidVideoAnalyticsInputError);
  });
});

describe('calculatePublicationFrequency', () => {
  it('nenhum video: intervalos indisponiveis', () => {
    const frequency = calculatePublicationFrequency([], COLLECTED_AT);

    expect(frequency.medianIntervalDays).toBeNull();
    expect(frequency.averageIntervalDays).toBeNull();
    expect(frequency.videosLast30Days).toBe(0);
  });

  it('somente um video: intervalos indisponiveis, nao zero', () => {
    // Um canal com um unico video nao publica "a cada zero dias".
    const frequency = calculatePublicationFrequency([daysBefore(5)], COLLECTED_AT);

    expect(frequency.medianIntervalDays).toBeNull();
    expect(frequency.averageIntervalDays).toBeNull();
    expect(frequency.videosLast30Days).toBe(1);
  });

  it('dois videos produzem um intervalo valido', () => {
    const frequency = calculatePublicationFrequency([daysBefore(10), daysBefore(4)], COLLECTED_AT);

    expect(frequency.medianIntervalDays).toBe(6);
    expect(frequency.averageIntervalDays).toBe(6);
  });

  it('calcula mediana e media de varios intervalos', () => {
    // Publicacoes em 20, 18, 14 e 4 dias atras -> intervalos 10, 4, 2.
    const frequency = calculatePublicationFrequency(
      [daysBefore(20), daysBefore(18), daysBefore(14), daysBefore(4)],
      COLLECTED_AT,
    );

    expect(frequency.medianIntervalDays).toBe(4);
    expect(frequency.averageIntervalDays).toBeCloseTo(16 / 3, 12);
  });

  it('a mediana resiste a uma pausa extraordinaria que desloca a media', () => {
    // Cadencia de 2 dias, interrompida por uma pausa de 200 dias.
    const dates = [daysBefore(206), daysBefore(6), daysBefore(4), daysBefore(2)];
    const frequency = calculatePublicationFrequency(dates, COLLECTED_AT);

    expect(frequency.medianIntervalDays).toBe(2);
    expect(frequency.averageIntervalDays).toBeCloseTo(68, 12);
  });

  it('dois videos no mesmo instante produzem intervalo zero', () => {
    const sameInstant = daysBefore(3);
    const frequency = calculatePublicationFrequency([sameInstant, sameInstant], COLLECTED_AT);

    expect(frequency.medianIntervalDays).toBe(0);
    expect(frequency.averageIntervalDays).toBe(0);
  });

  it('videos fora de ordem produzem o mesmo resultado que ordenados', () => {
    const ordered = [daysBefore(20), daysBefore(14), daysBefore(4)];
    const shuffled = [daysBefore(4), daysBefore(20), daysBefore(14)];

    expect(calculatePublicationFrequency(shuffled, COLLECTED_AT)).toEqual(
      calculatePublicationFrequency(ordered, COLLECTED_AT),
    );
  });

  it('nao altera o array recebido', () => {
    const dates = [daysBefore(4), daysBefore(20), daysBefore(14)];
    const snapshot = dates.map((date) => date.getTime());

    calculatePublicationFrequency(dates, COLLECTED_AT);

    expect(dates.map((date) => date.getTime())).toEqual(snapshot);
  });

  describe('janela de 30 dias', () => {
    it('inclui um video publicado exatamente ha 30 dias', () => {
      const frequency = calculatePublicationFrequency([daysBefore(30)], COLLECTED_AT);
      expect(frequency.videosLast30Days).toBe(1);
    });

    it('exclui um video um milissegundo mais antigo que a fronteira', () => {
      const justOutside = new Date(COLLECTED_AT.getTime() - 30 * MS_PER_DAY - 1);
      const frequency = calculatePublicationFrequency([justOutside], COLLECTED_AT);
      expect(frequency.videosLast30Days).toBe(0);
    });

    it('inclui um video publicado no instante da coleta', () => {
      const frequency = calculatePublicationFrequency([COLLECTED_AT], COLLECTED_AT);
      expect(frequency.videosLast30Days).toBe(1);
    });

    it('conta apenas os videos dentro da janela', () => {
      const frequency = calculatePublicationFrequency(
        [daysBefore(100), daysBefore(31), daysBefore(29), daysBefore(1)],
        COLLECTED_AT,
      );
      expect(frequency.videosLast30Days).toBe(2);
    });

    it('usa collectedAt como referencia, nao o relogio do sistema', () => {
      const dates = [daysBefore(10)];
      const coletaPosterior = new Date(COLLECTED_AT.getTime() + 25 * MS_PER_DAY);

      expect(calculatePublicationFrequency(dates, COLLECTED_AT).videosLast30Days).toBe(1);
      expect(calculatePublicationFrequency(dates, coletaPosterior).videosLast30Days).toBe(0);
    });
  });
});
