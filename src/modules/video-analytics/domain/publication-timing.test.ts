import { describe, expect, it } from 'vitest';

import { InvalidVideoAnalyticsInputError } from './errors/invalid-video-analytics-input';
import {
  calculateAnalyzedPeriod,
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

describe('calculateAnalyzedPeriod', () => {
  describe('tamanho do conjunto', () => {
    it('conjunto vazio devolve tudo indisponivel, nunca zero dias', () => {
      // RN-08. "Nenhum video" e "periodo de zero dias" sao afirmacoes
      // diferentes: a primeira diz que nao ha o que descrever.
      const periodo = calculateAnalyzedPeriod([]);

      expect(periodo.firstPublishedAt).toBeNull();
      expect(periodo.lastPublishedAt).toBeNull();
      expect(periodo.spanInDays).toBeNull();
    });

    it('um video: as duas pontas sao a mesma data e a duracao e zero', () => {
      // Aqui `0` e FATO, nao ausencia — um unico ponto no tempo abrange zero
      // dias. Diferente de `medianIntervalDays`, que e null com um video porque
      // nao existe intervalo algum para medir.
      const data = daysBefore(10);
      const periodo = calculateAnalyzedPeriod([data]);

      expect(periodo.firstPublishedAt).toEqual(data);
      expect(periodo.lastPublishedAt).toEqual(data);
      expect(periodo.spanInDays).toBe(0);
    });

    it('quantidade par de videos', () => {
      const periodo = calculateAnalyzedPeriod([
        daysBefore(30),
        daysBefore(20),
        daysBefore(10),
        daysBefore(2),
      ]);

      expect(periodo.firstPublishedAt).toEqual(daysBefore(30));
      expect(periodo.lastPublishedAt).toEqual(daysBefore(2));
      expect(periodo.spanInDays).toBe(28);
    });

    it('quantidade impar de videos', () => {
      const periodo = calculateAnalyzedPeriod([daysBefore(50), daysBefore(25), daysBefore(5)]);

      expect(periodo.firstPublishedAt).toEqual(daysBefore(50));
      expect(periodo.lastPublishedAt).toEqual(daysBefore(5));
      expect(periodo.spanInDays).toBe(45);
    });
  });

  describe('extremos', () => {
    it('nao depende da ordem da entrada', () => {
      // A coleta entrega em ordem cronologica reversa, mas nada no contrato
      // garante isso. Um `[0]` e `[length - 1]` funcionaria hoje e quebraria em
      // silencio se a ordem mudasse.
      const desordenado = [daysBefore(10), daysBefore(40), daysBefore(1), daysBefore(25)];

      const periodo = calculateAnalyzedPeriod(desordenado);

      expect(periodo.firstPublishedAt).toEqual(daysBefore(40));
      expect(periodo.lastPublishedAt).toEqual(daysBefore(1));
      expect(periodo.spanInDays).toBe(39);
    });

    it('todas as datas iguais: duracao zero', () => {
      const data = daysBefore(7);
      const periodo = calculateAnalyzedPeriod([data, new Date(data.getTime()), data]);

      expect(periodo.firstPublishedAt).toEqual(data);
      expect(periodo.lastPublishedAt).toEqual(data);
      expect(periodo.spanInDays).toBe(0);
    });

    it('duracao fracionaria e preservada', () => {
      // Arredondar aqui perderia precisao para sempre. A apresentacao arredonda.
      const periodo = calculateAnalyzedPeriod([daysBefore(3.5), daysBefore(1)]);

      expect(periodo.spanInDays).toBeCloseTo(2.5, 10);
    });
  });

  describe('pureza', () => {
    it('nao modifica nem reordena o array recebido', () => {
      const entrada = [daysBefore(1), daysBefore(30), daysBefore(10)];
      const copia = [...entrada];

      calculateAnalyzedPeriod(entrada);

      expect(entrada).toEqual(copia);
    });

    it('devolve instancias novas, nao as datas do chamador', () => {
      // `Date` e mutavel. Devolver a instancia recebida deixaria a saida do
      // motor alteravel por quem mexesse na entrada depois.
      const original = daysBefore(5);
      const periodo = calculateAnalyzedPeriod([original]);

      expect(periodo.firstPublishedAt).not.toBe(original);
      expect(periodo.firstPublishedAt).toEqual(original);
    });

    it('nao le o relogio: nao recebe collectedAt', () => {
      // O periodo descreve o CONJUNTO DE VIDEOS, nao a distancia ate a coleta.
      // A mesma entrada produz o mesmo resultado em qualquer momento (RN-13).
      const dates = [daysBefore(10), daysBefore(2)];

      expect(calculateAnalyzedPeriod(dates)).toEqual(calculateAnalyzedPeriod(dates));
    });
  });

  describe('validacao', () => {
    it('recusa data invalida', () => {
      expect(() => calculateAnalyzedPeriod([new Date('nao e data')])).toThrow(
        InvalidVideoAnalyticsInputError,
      );
    });

    it('recusa data invalida mesmo acompanhada de datas validas', () => {
      expect(() => calculateAnalyzedPeriod([daysBefore(1), new Date(Number.NaN)])).toThrow(
        InvalidVideoAnalyticsInputError,
      );
    });
  });
});
