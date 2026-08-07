import { describe, expect, it } from 'vitest';

import { CHANNEL_ID_LENGTH } from '../../domain/youtube-channel-reference';
import { createFakeChannelResolver, createFakeYouTubeChannelSource } from './fake-youtube-source';

/**
 * O fixture de demonstracao precisa ser DADO VALIDO.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO E TESTADO.
 *
 * Ate a SPEC-009 o ID de canal do fixture tinha 23 caracteres, e nao 24 — nao
 * passava na propria regra de formato do projeto (RN-01, SPEC-002). Ninguem
 * percebeu por dois motivos que se reforcavam:
 *
 *  - o fake devolve o ID pronto, sem passar pela validacao de formato;
 *  - o repositorio em memoria aceita qualquer string como identificador.
 *
 * O erro so apareceu no primeiro `insert` contra o PostgreSQL, que verifica o
 * formato em uma constraint. Um fixture invalido nao e detalhe de teste: ele e
 * o que a aplicacao serve quando falta `YOUTUBE_API_KEY`.
 * ---------------------------------------------------------------------------
 */

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const VALID_URL = 'https://www.youtube.com/@canal-de-exemplo';

describe('identificadores do fixture', () => {
  it('o ID de canal resolvido tem o formato oficial', async () => {
    const resolver = createFakeChannelResolver();

    const channelId = await resolver.resolveChannelId(VALID_URL);

    expect(channelId).toMatch(CHANNEL_ID_PATTERN);
    expect(channelId).toHaveLength(CHANNEL_ID_LENGTH);
  });

  it('o canal coletado tem o mesmo ID que o resolvedor devolve', async () => {
    // Se divergirem, a analise apontaria para um canal e o snapshot para outro.
    const resolver = createFakeChannelResolver();
    const source = createFakeYouTubeChannelSource();

    const channelId = await resolver.resolveChannelId(VALID_URL);
    const channel = await source.fetchChannel(channelId);

    expect(channel.id).toBe(channelId);
  });

  it('o handle do canal tem o formato que o banco aceita', async () => {
    // `youtube_channels_handle_format`: arroba seguida de 1 a 30 caracteres sem
    // espaco nem separador de URL.
    const source = createFakeYouTubeChannelSource();
    const resolver = createFakeChannelResolver();

    const channel = await source.fetchChannel(await resolver.resolveChannelId(VALID_URL));

    expect(channel.handle).toMatch(/^@[^\s/\\?#&=%:@]{1,30}$/);
  });

  it('todos os videos pertencem ao canal do fixture', async () => {
    const resolver = createFakeChannelResolver();
    const source = createFakeYouTubeChannelSource();

    const channelId = await resolver.resolveChannelId(VALID_URL);
    const videos = await source.fetchRecentVideos(channelId, 50);

    expect(videos.length).toBeGreaterThan(0);
    for (const video of videos) {
      expect(video.channelId).toBe(channelId);
    }
  });
});

describe('conteudo que o fixture existe para exercitar', () => {
  it('tem Shorts e videos longos, para a RN-06 ter o que separar', async () => {
    const source = createFakeYouTubeChannelSource();
    const resolver = createFakeChannelResolver();

    const videos = await source.fetchRecentVideos(await resolver.resolveChannelId(VALID_URL), 50);

    expect(videos.some((video) => video.format === 'short')).toBe(true);
    expect(videos.some((video) => video.format === 'long')).toBe(true);
  });

  it('tem um video sem contagem de visualizacoes, para a RN-08 ter o que preservar', async () => {
    const source = createFakeYouTubeChannelSource();
    const resolver = createFakeChannelResolver();

    const videos = await source.fetchRecentVideos(await resolver.resolveChannelId(VALID_URL), 50);

    expect(videos.some((video) => video.viewCount === null)).toBe(true);
  });
});
