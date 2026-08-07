import { z } from 'zod';

/**
 * Schemas das respostas da YouTube Data API v3.
 *
 * A fronteira onde JSON de terceiro vira dado confiavel. Nada passa daqui sem
 * validacao: um campo que mudou de tipo do outro lado deve FALHAR aqui, com o
 * caminho do campo, e nao virar `NaN` tres camadas adiante.
 *
 * DUAS CARACTERISTICAS DA API QUE OS SCHEMAS PRECISAM ABSORVER.
 *
 * 1. Contadores vem como STRING (`"21318398"`), nao numero. Provavelmente para
 *    nao estourar a precisao de `Number` em JSON. Convertemos aqui, uma vez.
 *
 * 2. Campo ausente NAO e zero (RN-08). `subscriberCount` some quando o canal
 *    oculta a inscricao; `commentCount` some quando comentarios estao
 *    desativados; `likeCount` some quando as curtidas estao ocultas. Cada um
 *    desses vira `null`, e o tipo de dominio ja obriga quem consome a tratar.
 */

/**
 * Contador que a API manda como string.
 *
 * `undefined` (campo ausente) vira `null`. String nao numerica, negativa ou
 * acima do inteiro seguro FALHA — arredondar silenciosamente produziria um
 * numero errado apresentado como certo.
 */
const apiCount = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return null;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      ctx.addIssue({ code: 'custom', message: 'contador nao e inteiro nao negativo' });
      return z.NEVER;
    }
    if (parsed > Number.MAX_SAFE_INTEGER) {
      ctx.addIssue({ code: 'custom', message: 'contador acima do inteiro seguro' });
      return z.NEVER;
    }
    return parsed;
  });

/** Data ISO 8601 da API. Falha se nao for uma data real. */
const apiDate = z.string().transform((value, ctx) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'data invalida' });
    return z.NEVER;
  }
  return parsed;
});

// ---------------------------------------------------------------------------
// channels.list
// ---------------------------------------------------------------------------

const channelItemSchema = z.object({
  id: z.string().min(1),
  snippet: z
    .object({
      title: z.string(),
      description: z.string().default(''),
      /** `@handle` quando o canal tem um. Ausente em canais sem handle. */
      customUrl: z.string().optional(),
      publishedAt: apiDate,
      country: z.string().optional(),
    })
    .optional(),
  statistics: z
    .object({
      viewCount: apiCount,
      subscriberCount: apiCount,
      /**
       * A API manda booleano de verdade aqui, nao string. Quando `true`,
       * `subscriberCount` vem ausente ou zerado — e zero NAO significa que o
       * canal tem zero inscritos (RN-08).
       */
      hiddenSubscriberCount: z.boolean().default(false),
      videoCount: apiCount,
    })
    .optional(),
  contentDetails: z
    .object({
      relatedPlaylists: z.object({
        /** Playlist com todos os uploads do canal. Porta de entrada dos videos. */
        uploads: z.string().min(1).optional(),
      }),
    })
    .optional(),
});

export const channelsResponseSchema = z.object({
  /**
   * Ausente quando nada casou com a consulta.
   *
   * A API responde HTTP 200 SEM este campo para canal inexistente — nao 404.
   * Tratar isso como falha transformaria "esse canal nao existe" em "a API
   * quebrou", que sao coisas diferentes para quem esta na tela.
   */
  items: z.array(channelItemSchema).optional(),
});

export type ChannelItem = z.infer<typeof channelItemSchema>;

// ---------------------------------------------------------------------------
// playlistItems.list
// ---------------------------------------------------------------------------

export const playlistItemsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z.object({
          videoId: z.string().min(1),
        }),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// videos.list
// ---------------------------------------------------------------------------

const videoItemSchema = z.object({
  id: z.string().min(1),
  snippet: z
    .object({
      title: z.string(),
      publishedAt: apiDate,
      channelId: z.string().min(1),
    })
    .optional(),
  contentDetails: z
    .object({
      /** ISO 8601 (`PT14M35S`). Convertida por `parseIso8601Duration`. */
      duration: z.string().optional(),
    })
    .optional(),
  statistics: z
    .object({
      viewCount: apiCount,
      likeCount: apiCount,
      commentCount: apiCount,
    })
    .optional(),
});

export const videosResponseSchema = z.object({
  items: z.array(videoItemSchema).optional(),
});

export type VideoItem = z.infer<typeof videoItemSchema>;

// ---------------------------------------------------------------------------
// Erro
// ---------------------------------------------------------------------------

/**
 * Corpo de erro da API.
 *
 * `reason` e o que distingue quota esgotada de chave invalida de canal
 * inexistente. Todos chegam como 403 ou 400, e so o `reason` separa.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    errors: z
      .array(z.object({ reason: z.string().optional(), domain: z.string().optional() }))
      .optional(),
  }),
});
