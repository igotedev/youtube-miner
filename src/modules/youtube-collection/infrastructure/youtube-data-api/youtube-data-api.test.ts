import { beforeEach, describe, expect, it } from 'vitest';

import { ExternalServiceError, NotFoundError, QuotaExceededError } from '@/shared/errors';
import { noopLogger } from '@/shared/observability';

import { InvalidChannelReferenceError } from '../../domain/errors/invalid-channel-reference';
import type { YouTubeChannelId } from '../../domain/youtube-channel';
import { YouTubeApiClient } from './youtube-api-client';
import { YouTubeDataApiChannelResolver } from './youtube-data-api-channel-resolver';
import { YouTubeDataApiChannelSource } from './youtube-data-api-channel-source';

/**
 * Testes do adaptador da YouTube Data API.
 *
 * `fetch` e injetado, entao tudo aqui roda offline e sem gastar quota. Sem essa
 * injecao, a traducao de erro e a validacao Zod so poderiam ser exercitadas
 * gastando unidades — ou seja, na pratica, nunca.
 *
 * SOBRE OS DADOS. O FORMATO das respostas foi conferido contra a API real
 * (contadores como string, `hiddenSubscriberCount` booleano, duracao ISO 8601,
 * ausencia de `items` em vez de 404). O CONTEUDO e ficticio de proposito:
 * nenhum canal ou video real aparece aqui como se fosse dado de producao.
 */

const FAKE_KEY = 'chave-de-teste-nao-e-uma-chave-real';
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa' as YouTubeChannelId;

interface RecordedCall {
  readonly endpoint: string;
  readonly params: Readonly<Record<string, string>>;
}

interface FakeFetch {
  readonly impl: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
  /** URLs completas, para provar que a chave viaja mas nunca vaza. */
  readonly urls: string[];
}

/** Devolve respostas em fila; cada chamada consome a proxima. */
function fakeFetch(responses: readonly { status?: number; body: unknown | string }[]): FakeFetch {
  const calls: RecordedCall[] = [];
  const urls: string[] = [];
  let index = 0;

  const impl = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    urls.push(url.toString());

    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== 'key') params[key] = value;
    }
    calls.push({ endpoint: url.pathname.split('/').pop() ?? '', params });

    const next = responses[index];
    index += 1;
    if (next === undefined) throw new Error('fake fetch sem resposta preparada');

    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return Promise.resolve(new Response(body, { status: next.status ?? 200 }));
  };

  return { impl: impl as unknown as typeof globalThis.fetch, calls, urls };
}

function buildClient(fake: FakeFetch, dailyQuotaLimit = 10_000): YouTubeApiClient {
  return new YouTubeApiClient({
    apiKey: FAKE_KEY,
    logger: noopLogger,
    dailyQuotaLimit,
    fetchImpl: fake.impl,
  });
}

// --- Respostas de referencia ------------------------------------------------

const CHANNEL_BODY = {
  items: [
    {
      id: CHANNEL_ID,
      snippet: {
        title: 'Canal Ficticio',
        description: 'Descricao ficticia.',
        customUrl: '@canal-ficticio',
        publishedAt: '2021-03-15T00:00:00Z',
        country: 'BR',
      },
      statistics: {
        viewCount: '19400000',
        subscriberCount: '128000',
        hiddenSubscriberCount: false,
        videoCount: '214',
      },
      contentDetails: { relatedPlaylists: { uploads: 'UUaaaaaaaaaaaaaaaaaaaaaa' } },
    },
  ],
};

const PLAYLIST_BODY = {
  items: [
    { contentDetails: { videoId: 'vid_001' } },
    { contentDetails: { videoId: 'vid_002' } },
    { contentDetails: { videoId: 'vid_003' } },
  ],
};

const VIDEOS_BODY = {
  items: [
    // Fora de ordem de proposito: `videos.list` nao garante a ordem pedida.
    {
      id: 'vid_003',
      snippet: { title: 'Terceiro', publishedAt: '2026-07-20T12:00:00Z', channelId: CHANNEL_ID },
      contentDetails: { duration: 'PT45S' },
      statistics: { viewCount: '380000', likeCount: '9000', commentCount: '800' },
    },
    {
      id: 'vid_001',
      snippet: { title: 'Primeiro', publishedAt: '2026-07-28T12:00:00Z', channelId: CHANNEL_ID },
      contentDetails: { duration: 'PT14M35S' },
      // Estatisticas totalmente ausentes: curtidas e comentarios desativados.
      statistics: { viewCount: '31500' },
    },
    {
      id: 'vid_002',
      snippet: { title: 'Segundo', publishedAt: '2026-07-24T12:00:00Z', channelId: CHANNEL_ID },
      contentDetails: { duration: 'PT50S' },
      statistics: {},
    },
  ],
};

// ---------------------------------------------------------------------------
// Cliente: quota e traducao de erro
// ---------------------------------------------------------------------------

describe('YouTubeApiClient — quota', () => {
  it('contabiliza uma unidade por chamada', async () => {
    const fake = fakeFetch([{ body: CHANNEL_BODY }]);
    const client = buildClient(fake);

    await new YouTubeDataApiChannelSource(client, noopLogger).fetchChannel(CHANNEL_ID);

    expect(client.spentUnits).toBe(1);
  });

  it('recusa antes de gastar quando o teto seria estourado', async () => {
    const fake = fakeFetch([{ body: CHANNEL_BODY }]);
    const client = buildClient(fake, 0);

    await expect(
      new YouTubeDataApiChannelSource(client, noopLogger).fetchChannel(CHANNEL_ID),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    // O ponto: a rede nao foi tocada. Reservar depois de gastar nao seria freio.
    expect(fake.calls).toHaveLength(0);
    expect(client.spentUnits).toBe(0);
  });
});

describe('YouTubeApiClient — traducao de erro', () => {
  it.each([['quotaExceeded'], ['dailyLimitExceeded'], ['rateLimitExceeded']])(
    'traduz %s em QuotaExceededError',
    async (reason) => {
      const fake = fakeFetch([
        { status: 403, body: { error: { code: 403, errors: [{ reason }] } } },
      ]);

      await expect(
        new YouTubeDataApiChannelSource(buildClient(fake), noopLogger).fetchChannel(CHANNEL_ID),
      ).rejects.toBeInstanceOf(QuotaExceededError);
    },
  );

  it('traduz chave invalida em ExternalServiceError, nao em quota', async () => {
    // Sao coisas diferentes: quota volta amanha, chave invalida nao.
    const fake = fakeFetch([
      { status: 400, body: { error: { code: 400, errors: [{ reason: 'keyInvalid' }] } } },
    ]);

    await expect(
      new YouTubeDataApiChannelSource(buildClient(fake), noopLogger).fetchChannel(CHANNEL_ID),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('traduz resposta que nao e JSON', async () => {
    const fake = fakeFetch([{ status: 502, body: '<html>gateway</html>' }]);

    await expect(
      new YouTubeDataApiChannelSource(buildClient(fake), noopLogger).fetchChannel(CHANNEL_ID),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('traduz resposta fora do schema', async () => {
    // `viewCount` numerico em vez de string: o formato mudou do outro lado.
    const fake = fakeFetch([
      {
        body: {
          items: [
            {
              id: CHANNEL_ID,
              snippet: { title: 'x', publishedAt: '2021-03-15T00:00:00Z' },
              statistics: { viewCount: 12345, hiddenSubscriberCount: false },
            },
          ],
        },
      },
    ]);

    await expect(
      new YouTubeDataApiChannelSource(buildClient(fake), noopLogger).fetchChannel(CHANNEL_ID),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('nunca deixa a chave vazar na mensagem nem no contexto do erro', async () => {
    const fake = fakeFetch([
      { status: 403, body: { error: { code: 403, errors: [{ reason: 'forbidden' }] } } },
    ]);

    const error = await new YouTubeDataApiChannelSource(buildClient(fake), noopLogger)
      .fetchChannel(CHANNEL_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExternalServiceError);
    const serialized = JSON.stringify({
      message: (error as Error).message,
      context: (error as ExternalServiceError).context,
    });
    expect(serialized).not.toContain(FAKE_KEY);

    // Contraprova: a chave REALMENTE foi enviada. Sem isto, o teste passaria
    // mesmo que o adaptador tivesse esquecido de autenticar.
    expect(fake.urls[0]).toContain(FAKE_KEY);
  });
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

describe('YouTubeDataApiChannelResolver', () => {
  it('resolve /channel/UC... sem gastar unidade alguma', async () => {
    const fake = fakeFetch([]);
    const client = buildClient(fake);

    const id = await new YouTubeDataApiChannelResolver(client).resolveChannelId(
      `https://www.youtube.com/channel/${CHANNEL_ID}`,
    );

    expect(id).toBe(CHANNEL_ID);
    expect(fake.calls).toHaveLength(0);
    expect(client.spentUnits).toBe(0);
  });

  it('rejeita entrada invalida offline, antes de qualquer unidade', async () => {
    const fake = fakeFetch([]);
    const client = buildClient(fake);

    await expect(
      new YouTubeDataApiChannelResolver(client).resolveChannelId('https://vimeo.com/canal'),
    ).rejects.toBeInstanceOf(InvalidChannelReferenceError);

    expect(fake.calls).toHaveLength(0);
    expect(client.spentUnits).toBe(0);
  });

  it.each([
    ['handle', 'https://www.youtube.com/@canal-ficticio', 'forHandle', '@canal-ficticio'],
    ['nome legado', 'https://www.youtube.com/user/canalantigo', 'forUsername', 'canalantigo'],
    ['URL personalizada', 'https://www.youtube.com/c/CanalCustom', 'forHandle', 'CanalCustom'],
  ])('resolve %s com uma unidade', async (_caso, url, param, value) => {
    const fake = fakeFetch([{ body: { items: [{ id: CHANNEL_ID }] } }]);
    const client = buildClient(fake);

    const id = await new YouTubeDataApiChannelResolver(client).resolveChannelId(url);

    expect(id).toBe(CHANNEL_ID);
    expect(client.spentUnits).toBe(1);
    expect(fake.calls[0]?.endpoint).toBe('channels');
    expect(fake.calls[0]?.params[param]).toBe(value);
  });

  it('nunca usa search.list — custaria 100 unidades', async () => {
    const fake = fakeFetch([{ body: { items: [{ id: CHANNEL_ID }] } }]);

    await new YouTubeDataApiChannelResolver(buildClient(fake)).resolveChannelId(
      'https://www.youtube.com/c/CanalCustom',
    );

    expect(fake.calls.map((call) => call.endpoint)).not.toContain('search');
  });

  it('trata 200 sem `items` como canal inexistente, e nao como falha da API', async () => {
    // A API responde assim para canal que nao existe. Ver api-schemas.ts.
    const fake = fakeFetch([{ body: {} }]);

    await expect(
      new YouTubeDataApiChannelResolver(buildClient(fake)).resolveChannelId(
        'https://www.youtube.com/@nao-existe',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

describe('YouTubeDataApiChannelSource — canal', () => {
  it('traduz o canal para o dominio', async () => {
    const fake = fakeFetch([{ body: CHANNEL_BODY }]);

    const channel = await new YouTubeDataApiChannelSource(
      buildClient(fake),
      noopLogger,
    ).fetchChannel(CHANNEL_ID);

    expect(channel.title).toBe('Canal Ficticio');
    expect(channel.handle).toBe('@canal-ficticio');
    expect(channel.country).toBe('BR');
    expect(channel.subscriberCount).toBe(128_000);
    expect(channel.videoCount).toBe(214);
    expect(channel.publishedAt).toEqual(new Date('2021-03-15T00:00:00Z'));
  });

  it('devolve inscritos como `null` quando o canal os oculta (RN-08)', async () => {
    // O ponto central da RN-08: oculto NAO e zero.
    const fake = fakeFetch([
      {
        body: {
          items: [
            {
              ...CHANNEL_BODY.items[0],
              statistics: {
                viewCount: '19400000',
                subscriberCount: '0',
                hiddenSubscriberCount: true,
                videoCount: '214',
              },
            },
          ],
        },
      },
    ]);

    const channel = await new YouTubeDataApiChannelSource(
      buildClient(fake),
      noopLogger,
    ).fetchChannel(CHANNEL_ID);

    expect(channel.hiddenSubscriberCount).toBe(true);
    // A API mandou "0"; nao repassamos, porque o numero nao e confiavel.
    expect(channel.subscriberCount).toBeNull();
  });

  it('devolve contadores ausentes como `null`', async () => {
    const fake = fakeFetch([
      { body: { items: [{ id: CHANNEL_ID, snippet: CHANNEL_BODY.items[0]?.snippet }] } },
    ]);

    const channel = await new YouTubeDataApiChannelSource(
      buildClient(fake),
      noopLogger,
    ).fetchChannel(CHANNEL_ID);

    expect(channel.viewCount).toBeNull();
    expect(channel.subscriberCount).toBeNull();
    expect(channel.videoCount).toBeNull();
  });

  it('recusa canal inexistente', async () => {
    const fake = fakeFetch([{ body: {} }]);

    await expect(
      new YouTubeDataApiChannelSource(buildClient(fake), noopLogger).fetchChannel(CHANNEL_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('YouTubeDataApiChannelSource — videos', () => {
  let fake: FakeFetch;
  let client: YouTubeApiClient;

  beforeEach(() => {
    fake = fakeFetch([{ body: CHANNEL_BODY }, { body: PLAYLIST_BODY }, { body: VIDEOS_BODY }]);
    client = buildClient(fake);
  });

  it('coleta 50 videos em tres unidades', async () => {
    await new YouTubeDataApiChannelSource(client, noopLogger).fetchRecentVideos(CHANNEL_ID, 50);

    expect(client.spentUnits).toBe(3);
    expect(fake.calls.map((call) => call.endpoint)).toEqual([
      'channels',
      'playlistItems',
      'videos',
    ]);
  });

  it('pede os videos em UMA chamada em lote, nao uma por video', async () => {
    await new YouTubeDataApiChannelSource(client, noopLogger).fetchRecentVideos(CHANNEL_ID, 50);

    // Uma chamada por video custaria 50 unidades em vez de 1.
    expect(fake.calls.filter((call) => call.endpoint === 'videos')).toHaveLength(1);
    expect(fake.calls[2]?.params['id']).toBe('vid_001,vid_002,vid_003');
  });

  it('preserva a ordem da playlist, nao a ordem da resposta', async () => {
    // `videos.list` devolveu 003, 001, 002. A ordem cronologica correta e a da
    // playlist de uploads.
    const videos = await new YouTubeDataApiChannelSource(client, noopLogger).fetchRecentVideos(
      CHANNEL_ID,
      50,
    );

    expect(videos.map((video) => video.id)).toEqual(['vid_001', 'vid_002', 'vid_003']);
  });

  it('classifica formato pela duracao (RN-06)', async () => {
    const videos = await new YouTubeDataApiChannelSource(client, noopLogger).fetchRecentVideos(
      CHANNEL_ID,
      50,
    );

    expect(videos[0]?.durationSeconds).toBe(875);
    expect(videos[0]?.format).toBe('long');
    expect(videos[1]?.durationSeconds).toBe(50);
    expect(videos[1]?.format).toBe('short');
  });

  it('preserva contadores ausentes como `null` (RN-08)', async () => {
    const videos = await new YouTubeDataApiChannelSource(client, noopLogger).fetchRecentVideos(
      CHANNEL_ID,
      50,
    );

    // Curtidas e comentarios desativados no primeiro; tudo ausente no segundo.
    expect(videos[0]?.viewCount).toBe(31_500);
    expect(videos[0]?.likeCount).toBeNull();
    expect(videos[0]?.commentCount).toBeNull();
    expect(videos[1]?.viewCount).toBeNull();
  });

  it('descarta o video defeituoso sem derrubar os demais', async () => {
    const semSnippet = fakeFetch([
      { body: CHANNEL_BODY },
      { body: PLAYLIST_BODY },
      {
        body: {
          items: [
            VIDEOS_BODY.items[1],
            // Sem `snippet`: sem data de publicacao nao ha idade nem
            // visualizacoes por dia. Inventar uma data produziria numeros
            // plausiveis e errados.
            { id: 'vid_002', contentDetails: { duration: 'PT50S' } },
            VIDEOS_BODY.items[0],
          ],
        },
      },
    ]);

    const videos = await new YouTubeDataApiChannelSource(
      buildClient(semSnippet),
      noopLogger,
    ).fetchRecentVideos(CHANNEL_ID, 50);

    expect(videos.map((video) => video.id)).toEqual(['vid_001', 'vid_003']);
  });

  it('descarta ID que a playlist lista mas `videos.list` nao devolve', async () => {
    // Video removido, privado ou bloqueado por regiao.
    const parcial = fakeFetch([
      { body: CHANNEL_BODY },
      { body: PLAYLIST_BODY },
      { body: { items: [VIDEOS_BODY.items[1]] } },
    ]);

    const videos = await new YouTubeDataApiChannelSource(
      buildClient(parcial),
      noopLogger,
    ).fetchRecentVideos(CHANNEL_ID, 50);

    expect(videos.map((video) => video.id)).toEqual(['vid_001']);
  });

  it('devolve lista vazia — nao erro — para canal sem playlist de uploads', async () => {
    const semUploads = fakeFetch([
      { body: { items: [{ id: CHANNEL_ID, snippet: CHANNEL_BODY.items[0]?.snippet }] } },
    ]);

    const videos = await new YouTubeDataApiChannelSource(
      buildClient(semUploads),
      noopLogger,
    ).fetchRecentVideos(CHANNEL_ID, 50);

    expect(videos).toEqual([]);
  });

  it('nao gasta unidade alguma quando o limite pedido e zero', async () => {
    const vazio = fakeFetch([]);
    const zeroClient = buildClient(vazio);

    const videos = await new YouTubeDataApiChannelSource(zeroClient, noopLogger).fetchRecentVideos(
      CHANNEL_ID,
      0,
    );

    expect(videos).toEqual([]);
    expect(zeroClient.spentUnits).toBe(0);
  });

  it('limita o pedido ao teto de 50 por pagina', async () => {
    await new YouTubeDataApiChannelSource(client, noopLogger).fetchRecentVideos(CHANNEL_ID, 500);

    expect(fake.calls[1]?.params['maxResults']).toBe('50');
  });
});
