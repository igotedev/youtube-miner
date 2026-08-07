import { ExternalServiceError, NotFoundError } from '@/shared/errors';
import type { Logger } from '@/shared/observability';

import type { YouTubeChannelSource } from '../../application/ports/youtube-channel-source';
import { classifyVideoFormat, parseIso8601Duration } from '../../domain/video-duration';
import type { YouTubeChannel, YouTubeChannelId } from '../../domain/youtube-channel';
import type { YouTubeVideo, YouTubeVideoId } from '../../domain/youtube-video';
import {
  channelsResponseSchema,
  playlistItemsResponseSchema,
  videosResponseSchema,
  type ChannelItem,
  type VideoItem,
} from './api-schemas';
import type { YouTubeApiClient } from './youtube-api-client';

/**
 * Coleta dados publicos de canal e videos na YouTube Data API v3.
 *
 * ---------------------------------------------------------------------------
 * CUSTO: 3 unidades por analise completa.
 *
 *   1. channels.list      — dados do canal E a playlist de uploads, de uma vez
 *   2. playlistItems.list — ate 50 IDs de video em uma pagina
 *   3. videos.list        — os 50 videos em UMA chamada, nao 50
 *
 * O passo 3 e onde a maioria das implementacoes desperdica: `videos.list`
 * aceita ate 50 IDs separados por virgula e cobra 1 unidade pelo lote. Uma
 * chamada por video custaria 50.
 * ---------------------------------------------------------------------------
 */

/** Teto da API por pagina; coincide com `MAX_RECENT_VIDEOS`. */
const MAX_ITEMS_PER_PAGE = 50;

export class YouTubeDataApiChannelSource implements YouTubeChannelSource {
  constructor(
    private readonly client: YouTubeApiClient,
    private readonly logger: Logger,
  ) {}

  async fetchChannel(channelId: YouTubeChannelId): Promise<YouTubeChannel> {
    const item = await this.fetchChannelItem(channelId);
    return toDomainChannel(item, channelId);
  }

  async fetchRecentVideos(
    channelId: YouTubeChannelId,
    limit: number,
  ): Promise<readonly YouTubeVideo[]> {
    const requested = Math.min(Math.max(Math.trunc(limit), 0), MAX_ITEMS_PER_PAGE);
    if (requested === 0) return [];

    const channel = await this.fetchChannelItem(channelId);
    const uploads = channel.contentDetails?.relatedPlaylists.uploads;
    if (uploads === undefined) {
      // Canal sem playlist de uploads nao tem video publico. Lista vazia e
      // resultado valido, e a porta diz isso explicitamente.
      return [];
    }

    const playlist = await this.client.get(
      'playlistItems',
      {
        part: 'contentDetails',
        playlistId: uploads,
        maxResults: String(requested),
      },
      playlistItemsResponseSchema,
    );

    const videoIds = (playlist.items ?? []).map((entry) => entry.contentDetails.videoId);
    if (videoIds.length === 0) return [];

    // Ate 50 IDs em UMA chamada: 1 unidade pelo lote inteiro.
    const videos = await this.client.get(
      'videos',
      {
        part: 'snippet,contentDetails,statistics',
        id: videoIds.join(','),
      },
      videosResponseSchema,
    );

    const byId = new Map((videos.items ?? []).map((item) => [item.id, item]));

    // A ordem da playlist de uploads e cronologica reversa e e a que interessa;
    // `videos.list` nao garante devolver na ordem pedida. Percorremos os IDs.
    const videosInOrder = videoIds
      .map((id) => byId.get(id))
      // Um ID que a playlist lista mas `videos.list` nao devolve e video
      // removido, privado ou bloqueado por regiao. Descartar e correto: nao ha
      // dado nenhum sobre ele.
      .filter((item): item is VideoItem => item !== undefined)
      .map((item) => toDomainVideo(item, channelId))
      // Sem `snippet` nao ha data de publicacao, e sem data nao ha idade nem
      // visualizacoes por dia. Descartamos o VIDEO, nunca a analise: um item
      // defeituoso nao pode derrubar os outros 49.
      .filter((video): video is YouTubeVideo => video !== null);

    const discarded = videoIds.length - videosInOrder.length;
    if (discarded > 0) {
      this.logger.info('videos descartados na coleta', {
        channelId,
        listed: videoIds.length,
        discarded,
      });
    }

    return videosInOrder;
  }

  private async fetchChannelItem(channelId: YouTubeChannelId): Promise<ChannelItem> {
    const response = await this.client.get(
      'channels',
      { part: 'snippet,statistics,contentDetails', id: channelId },
      channelsResponseSchema,
    );

    const item = response.items?.[0];
    if (item === undefined) {
      throw new NotFoundError('Canal nao encontrado ou removido.', { channelId });
    }
    return item;
  }
}

// ---------------------------------------------------------------------------
// Traducao para o dominio
// ---------------------------------------------------------------------------

/**
 * RN-08 aplicada campo a campo.
 *
 * `hiddenSubscriberCount: true` forca `subscriberCount` a `null` mesmo que a
 * API mande um numero. Quando a inscricao esta oculta, o valor devolvido nao e
 * confiavel — e "oculto" jamais e "zero inscritos".
 */
function toDomainChannel(item: ChannelItem, channelId: YouTubeChannelId): YouTubeChannel {
  const snippet = item.snippet;
  const statistics = item.statistics;
  const hidden = statistics?.hiddenSubscriberCount ?? false;

  if (snippet === undefined) {
    // Pedimos `part=snippet`; sem ele nao ha titulo nem data de criacao, e
    // inventar valores seria pior que falhar.
    throw new ExternalServiceError('A API do YouTube nao devolveu os dados do canal.', {
      channelId,
    });
  }

  return {
    id: channelId,
    title: snippet.title,
    handle: snippet.customUrl ?? null,
    description: snippet.description,
    publishedAt: snippet.publishedAt,
    country: snippet.country ?? null,
    subscriberCount: hidden ? null : (statistics?.subscriberCount ?? null),
    hiddenSubscriberCount: hidden,
    videoCount: statistics?.videoCount ?? null,
    viewCount: statistics?.viewCount ?? null,
  };
}

/**
 * Devolve `null` para item sem `snippet`, que quem chama descarta.
 *
 * Nao ha como salvar esse video: sem `publishedAt` nao existe idade, e sem
 * idade nao existe visualizacoes por dia nem frequencia. Substituir por uma
 * data inventada — epoch, ou o instante da coleta — produziria numeros
 * plausiveis e errados, que e exatamente o que este projeto nao faz.
 */
function toDomainVideo(item: VideoItem, channelId: YouTubeChannelId): YouTubeVideo | null {
  const snippet = item.snippet;
  if (snippet === undefined) return null;

  const rawDuration = item.contentDetails?.duration;
  const durationSeconds = rawDuration === undefined ? null : parseIso8601Duration(rawDuration);

  return {
    id: item.id as YouTubeVideoId,
    channelId,
    title: snippet.title,
    publishedAt: snippet.publishedAt,
    durationSeconds,
    format: classifyVideoFormat(durationSeconds),
    viewCount: item.statistics?.viewCount ?? null,
    likeCount: item.statistics?.likeCount ?? null,
    commentCount: item.statistics?.commentCount ?? null,
  };
}
