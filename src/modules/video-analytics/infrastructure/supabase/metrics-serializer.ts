import { z } from 'zod';

import type { YouTubeVideoId } from '@/modules/youtube-collection';
import { CorruptedPersistedDataError } from '@/shared/errors';

import type { ChannelMetrics } from '../../domain/channel-metrics';

/**
 * Serializacao de `ChannelMetrics` para `jsonb` e de volta.
 *
 * Quatro estados que o percurso de ida e volta NAO pode confundir, porque cada
 * um afirma algo diferente sobre o canal (RN-08):
 *
 *   0    — contagem conhecida e igual a zero
 *   null — dado indisponivel
 *   []   — formato sem nenhum video
 *   ausente — nao deve existir: todo campo e explicito
 *
 * `JSON.stringify` preserva os tres primeiros sem esforco. O que ele NAO
 * preserva e `Date`: vira string ISO e nunca volta sozinho. Por isso a leitura
 * passa por um schema Zod que reconstroi os `Date` explicitamente, em vez de um
 * `JSON.parse` seguido de cast.
 *
 * `undefined` seria o unico valor perigoso — `JSON.stringify` o apaga da saida.
 * Nenhum campo de `ChannelMetrics` e opcional, e o schema abaixo recusa a
 * ausencia, entao um `undefined` que aparecesse falharia na leitura em vez de
 * virar um campo faltante silencioso.
 */

/** Aceita string ISO ou Date e devolve Date. */
const dateSchema = z.union([z.string(), z.date()]).transform((value, ctx) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'data invalida' });
    return z.NEVER;
  }
  return date;
});

const nullableNumber = z.number().finite().nullable();

const outlierBandSchema = z.enum(['normal', 'above_normal', 'outlier', 'large_outlier']).nullable();

const videoMetricsSchema = z.object({
  // O tipo nominal e aplicado AQUI, depois da validacao — este e o ponto
  // sancionado para criar um `YouTubeVideoId` a partir de dado persistido.
  videoId: z
    .string()
    .min(1)
    .transform((value) => value as YouTubeVideoId),
  ageInDays: z.number().finite().nonnegative(),
  viewsPerDay: nullableNumber,
  outlierScore: nullableNumber,
  outlierBand: outlierBandSchema,
});

const formatMetricsSchema = z.object({
  format: z.enum(['short', 'long']),
  videoCount: z.number().int().nonnegative(),
  videosWithoutViewCount: z.number().int().nonnegative(),
  viewCount: z.object({
    total: nullableNumber,
    average: nullableNumber,
    median: nullableNumber,
    minimum: nullableNumber,
    maximum: nullableNumber,
  }),
  viewsPerDay: z.object({
    average: nullableNumber,
    median: nullableNumber,
  }),
  publicationFrequency: z.object({
    medianIntervalDays: nullableNumber,
    averageIntervalDays: nullableNumber,
    videosLast30Days: z.number().int().nonnegative(),
  }),
  outliers: z.object({
    count: z.number().int().nonnegative(),
    largeCount: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
  }),
  videos: z.array(videoMetricsSchema),
});

const channelMetricsSchema = z.object({
  collectedAt: dateSchema,
  totalVideoCount: z.number().int().nonnegative(),
  unclassifiedVideoCount: z.number().int().nonnegative(),
  shorts: formatMetricsSchema,
  long: formatMetricsSchema,
});

/**
 * `ChannelMetrics` -> valor pronto para a coluna `jsonb`.
 *
 * O percurso por `JSON.parse(JSON.stringify(...))` e deliberado: garante que o
 * que se afirma persistir e exatamente o que sobrevive a serializacao, em vez
 * de entregar ao driver um objeto com `Date` vivo e descobrir a diferenca na
 * leitura.
 */
export function serializeChannelMetrics(metrics: ChannelMetrics): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metrics)) as Record<string, unknown>;
}

/**
 * Valor da coluna `jsonb` -> `ChannelMetrics`, com os `Date` reconstruidos.
 *
 * @throws {CorruptedPersistedDataError} A linha nao corresponde ao formato
 *   esperado. Preferivel a devolver metricas com campos faltando, que
 *   apareceriam como "indisponivel" na tela sem que ninguem soubesse por que.
 */
export function deserializeChannelMetrics(value: unknown): ChannelMetrics {
  const result = channelMetricsSchema.safeParse(value);

  if (!result.success) {
    // Apenas os CAMINHOS dos campos invalidos. Os valores nao entram: a coluna
    // guarda dado de canal e mensagem de erro acaba em log.
    throw new CorruptedPersistedDataError('Metricas persistidas em formato invalido.', {
      issues: result.error.issues.map((issue) => issue.path.join('.')),
    });
  }

  return result.data;
}
