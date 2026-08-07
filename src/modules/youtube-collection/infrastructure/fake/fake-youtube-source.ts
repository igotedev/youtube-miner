import { NotFoundError } from '@/shared/errors';

import type { ChannelResolver } from '../../application/ports/channel-resolver';
import type { YouTubeChannelSource } from '../../application/ports/youtube-channel-source';
import type { YouTubeChannel, YouTubeChannelId } from '../../domain/youtube-channel';
import { parseYouTubeChannelReference } from '../../domain/youtube-channel-reference';
import type { YouTubeVideo, YouTubeVideoId } from '../../domain/youtube-video';

/**
 * Adaptadores FALSOS, deterministicos.
 *
 * Existem por um motivo unico: provar, em teste executavel, que as camadas se
 * comunicam pelas portas — que o caso de uso funciona sem conhecer a YouTube
 * Data API. Nao consultam a rede e nao serao promovidos a producao; o adaptador
 * real chega na SPEC de coleta e vive ao lado, em
 * `infrastructure/youtube-data-api/`.
 *
 * O fixture inclui de proposito:
 *  - Shorts e videos longos misturados (RN-06);
 *  - um video com contagem `null` (RN-08: ausente nao e zero);
 *  - um video com visualizacoes muito acima dos demais (caso de outlier).
 */

/**
 * `UC` + 22 caracteres, como a RN-01 exige e como o banco verifica.
 *
 * Ate a SPEC-009 este literal tinha 23 caracteres no total, e nao 24 — nao era
 * um ID de canal valido segundo a regra do proprio projeto. Nada pegava: o fake
 * devolve o valor pronto, sem passar pela validacao de formato, e o repositorio
 * em memoria aceita qualquer string. Apareceu no primeiro `insert` real, contra
 * a constraint `youtube_channels_id_format`.
 *
 * Se este valor mudar, ele tem de continuar casando com `^UC[A-Za-z0-9_-]{22}$`.
 */
const FIXTURE_CHANNEL_ID = 'UC_fixture_channel_00000' as YouTubeChannelId;

const FIXTURE_CHANNEL: YouTubeChannel = {
  id: FIXTURE_CHANNEL_ID,
  title: 'Canal de Exemplo',
  handle: '@canal-de-exemplo',
  description: 'Canal ficticio usado apenas para validar a estrutura do projeto.',
  publishedAt: new Date('2021-03-15T00:00:00.000Z'),
  country: 'BR',
  subscriberCount: 128_000,
  hiddenSubscriberCount: false,
  videoCount: 214,
  viewCount: 19_400_000,
};

interface VideoSeed {
  readonly suffix: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly durationSeconds: number | null;
  readonly viewCount: number | null;
}

const VIDEO_SEEDS: readonly VideoSeed[] = [
  {
    suffix: '01',
    title: 'Rotina matinal em 60 segundos',
    publishedAt: '2026-07-28T12:00:00.000Z',
    durationSeconds: 58,
    viewCount: 42_000,
  },
  {
    suffix: '02',
    title: 'Guia completo para iniciantes',
    publishedAt: '2026-07-24T12:00:00.000Z',
    durationSeconds: 942,
    viewCount: 31_500,
  },
  {
    suffix: '03',
    title: 'Tres erros que todo mundo comete',
    publishedAt: '2026-07-20T12:00:00.000Z',
    durationSeconds: 45,
    viewCount: 380_000,
  },
  {
    suffix: '04',
    title: 'Analisando os numeros do mes',
    publishedAt: '2026-07-16T12:00:00.000Z',
    durationSeconds: 1_260,
    viewCount: 28_900,
  },
  {
    suffix: '05',
    title: 'Voce esta fazendo isso errado',
    publishedAt: '2026-07-12T12:00:00.000Z',
    durationSeconds: 51,
    viewCount: 39_100,
  },
  {
    suffix: '06',
    title: 'Entrevista com um especialista',
    publishedAt: '2026-07-08T12:00:00.000Z',
    durationSeconds: 2_730,
    viewCount: null,
  },
  {
    suffix: '07',
    title: 'O metodo que mudou meu resultado',
    publishedAt: '2026-07-04T12:00:00.000Z',
    durationSeconds: 815,
    viewCount: 34_200,
  },
  {
    suffix: '08',
    title: 'Responda isso antes de comecar',
    publishedAt: '2026-06-30T12:00:00.000Z',
    durationSeconds: 39,
    viewCount: 45_600,
  },
];

/** Criterio provisorio do fixture. O criterio real e assunto da SPEC de coleta. */
const SHORT_MAX_DURATION_SECONDS = 180;

const FIXTURE_VIDEOS: readonly YouTubeVideo[] = VIDEO_SEEDS.map((seed) => ({
  id: `vid_fixture_${seed.suffix}` as YouTubeVideoId,
  channelId: FIXTURE_CHANNEL_ID,
  title: seed.title,
  publishedAt: new Date(seed.publishedAt),
  durationSeconds: seed.durationSeconds,
  format:
    seed.durationSeconds === null
      ? 'unknown'
      : seed.durationSeconds <= SHORT_MAX_DURATION_SECONDS
        ? 'short'
        : 'long',
  viewCount: seed.viewCount,
  likeCount: null,
  commentCount: null,
}));

/**
 * Valida a entrada com o parser da SPEC-002 e devolve sempre o canal do fixture.
 *
 * A validacao NAO e decoracao. `parseYouTubeChannelReference` rejeita host
 * estranho, URL de video, texto solto e entrada vazia — tudo offline, antes de
 * qualquer I/O. E o desenho descrito na porta `ChannelResolver`: a parte pura
 * roda primeiro, e so o que sobra justifica ir a rede.
 *
 * O adaptador real reaproveita exatamente este primeiro passo; o que muda e o
 * segundo, quando o `kind` nao for `channel_id`.
 */
export function createFakeChannelResolver(): ChannelResolver {
  return {
    resolveChannelId: (rawUrl) => {
      try {
        // Lanca InvalidChannelReferenceError quando a entrada nao e uma
        // referencia de canal reconhecivel.
        parseYouTubeChannelReference(rawUrl);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve(FIXTURE_CHANNEL_ID);
    },
  };
}

export function createFakeYouTubeChannelSource(): YouTubeChannelSource {
  return {
    fetchChannel: (channelId) => {
      if (channelId !== FIXTURE_CHANNEL_ID) {
        return Promise.reject(new NotFoundError('Canal fora do fixture.', { channelId }));
      }
      return Promise.resolve(FIXTURE_CHANNEL);
    },
    fetchRecentVideos: (_channelId, limit) => Promise.resolve(FIXTURE_VIDEOS.slice(0, limit)),
  };
}

export const fakeFixture = {
  channelId: FIXTURE_CHANNEL_ID,
  channel: FIXTURE_CHANNEL,
  videos: FIXTURE_VIDEOS,
} as const;
