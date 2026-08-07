import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  CollectionRun,
  CollectionRunId,
  YouTubeChannel,
  YouTubeChannelId,
  YouTubeVideo,
  YouTubeVideoId,
} from '@/modules/youtube-collection';
import { ConcurrentCollectionRunError } from '@/modules/youtube-collection';
import { SupabaseCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/supabase/supabase-collection-run-repository';
import { createAdminClient } from '@/shared/infrastructure/supabase/supabase-clients';

/**
 * Testes de INTEGRACAO contra o Supabase local.
 *
 * Exigem `npm run db:start`. Ficam fora de `npm run verify` de proposito — ver
 * o comentario em `vitest.config.mts`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTES TESTES EXISTEM, SE JA HA TESTES EM MEMORIA.
 *
 * O repositorio em memoria IMITA a semantica do banco: ele finge o indice unico
 * parcial, finge as constraints, finge as cascatas. Um teste contra ele prova
 * que o caso de uso conversa com a porta — nao que o banco se comporta como o
 * fake afirma.
 *
 * O que so aparece aqui: o indice `uniq_active_run_per_channel` de verdade, a
 * transacao de `complete_collection_run`, os tipos do Postgres (bigint, jsonb,
 * timestamptz) atravessando o driver, e a diferenca entre `null` e ausente
 * sobrevivendo a ida e volta.
 * ---------------------------------------------------------------------------
 *
 * Isolamento: cada arquivo usa canais com IDs unicos por execucao e limpa o que
 * criou. Nao ha `truncate`, que apagaria o trabalho de outro teste rodando.
 */

const client = createAdminClient();
const repository = new SupabaseCollectionRunRepository(client);

/** IDs de canal validos (`UC` + 22) e unicos por execucao, para nao colidir. */
function makeChannelId(): YouTubeChannelId {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 22);
  return `UC${suffix}` as YouTubeChannelId;
}

const REQUESTED_AT = new Date('2026-07-30T10:00:00.000Z');
const CAPTURED_AT = new Date('2026-07-30T10:00:30.000Z');
const REUSABLE_UNTIL = new Date('2026-07-31T10:00:30.000Z');

function buildRun(channelId: YouTubeChannelId, patch: Partial<CollectionRun> = {}): CollectionRun {
  return {
    id: randomUUID() as CollectionRunId,
    channelId,
    status: 'pending',
    requestedAt: REQUESTED_AT,
    startedAt: REQUESTED_AT,
    capturedAt: null,
    completedAt: null,
    failedAt: null,
    reusableUntil: null,
    invalidatedAt: null,
    errorCode: null,
    ...patch,
  };
}

function buildChannel(
  channelId: YouTubeChannelId,
  patch: Partial<YouTubeChannel> = {},
): YouTubeChannel {
  return {
    id: channelId,
    title: 'Canal de Integracao',
    handle: '@canal-integracao',
    description: 'Canal ficticio criado por teste automatizado.',
    publishedAt: new Date('2021-03-15T00:00:00.000Z'),
    country: 'BR',
    subscriberCount: 128_000,
    hiddenSubscriberCount: false,
    videoCount: 214,
    viewCount: 19_400_000,
    ...patch,
  };
}

function buildVideos(channelId: YouTubeChannelId): YouTubeVideo[] {
  return [
    {
      id: 'vid_int_001' as YouTubeVideoId,
      channelId,
      title: 'Short de exemplo',
      publishedAt: new Date('2026-07-28T12:00:00.000Z'),
      durationSeconds: 58,
      format: 'short',
      viewCount: 42_000,
      likeCount: 900,
      commentCount: 20,
    },
    {
      id: 'vid_int_002' as YouTubeVideoId,
      channelId,
      title: 'Video longo de exemplo',
      publishedAt: new Date('2026-07-24T12:00:00.000Z'),
      durationSeconds: 942,
      format: 'long',
      // RN-08: os tres ausentes. Precisam voltar como `null`, nao como 0.
      viewCount: null,
      likeCount: null,
      commentCount: null,
    },
    {
      id: 'vid_int_003' as YouTubeVideoId,
      channelId,
      title: 'Formato indeterminado',
      publishedAt: new Date('2026-07-20T12:00:00.000Z'),
      durationSeconds: null,
      format: 'unknown',
      // Contagem grande, para provar que `bigint` atravessa o driver inteiro.
      viewCount: 9_007_199_254_740_990,
      likeCount: null,
      commentCount: null,
    },
  ];
}

const createdChannels: YouTubeChannelId[] = [];

function trackChannel(id: YouTubeChannelId): YouTubeChannelId {
  createdChannels.push(id);
  return id;
}

beforeAll(async () => {
  // Falha cedo e com mensagem util se a stack nao estiver no ar.
  const { error } = await client.from('youtube_channels').select('id').limit(1);
  if (error !== null) {
    throw new Error(
      `Supabase local inacessivel. Rode \`npm run db:start\` antes. Detalhe: ${error.message}`,
    );
  }
});

afterAll(async () => {
  // Cascata cuida de execucoes e snapshots.
  for (const channelId of createdChannels) {
    await client.from('youtube_channels').delete().eq('youtube_channel_id', channelId);
  }
});

let channelId: YouTubeChannelId;

beforeEach(() => {
  channelId = trackChannel(makeChannelId());
});

describe('startRun', () => {
  it('registra o canal e cria a execucao', async () => {
    const run = buildRun(channelId);
    await repository.startRun(run);

    const found = await repository.findById(run.id);
    expect(found?.id).toBe(run.id);
    // O `UC...` volta do join, e nao o uuid interno.
    expect(found?.channelId).toBe(channelId);
    expect(found?.status).toBe('pending');
  });

  it('reaproveita o canal ja registrado em vez de duplicar', async () => {
    await repository.startRun(buildRun(channelId));
    await repository.save({ ...buildRun(channelId), status: 'completed' });

    const { data } = await client
      .from('youtube_channels')
      .select('id')
      .eq('youtube_channel_id', channelId);

    expect(data).toHaveLength(1);
  });

  it('recusa segunda execucao ativa para o mesmo canal', async () => {
    // Esta e a asserção que o teste em memoria nao pode fazer honestamente: aqui
    // quem recusa e o indice unico parcial do Postgres.
    await repository.startRun(buildRun(channelId));

    await expect(repository.startRun(buildRun(channelId))).rejects.toBeInstanceOf(
      ConcurrentCollectionRunError,
    );
  });

  it('permite nova execucao depois que a anterior termina', async () => {
    const first = buildRun(channelId);
    await repository.startRun(first);
    await repository.completeWithSnapshot({
      run: {
        ...first,
        status: 'completed',
        capturedAt: CAPTURED_AT,
        completedAt: CAPTURED_AT,
        reusableUntil: REUSABLE_UNTIL,
      },
      channel: buildChannel(channelId),
      videos: buildVideos(channelId),
    });

    // O indice e PARCIAL: so cobre status ativos. Concluida nao bloqueia.
    await expect(repository.startRun(buildRun(channelId))).resolves.toBeDefined();
  });
});

describe('completeWithSnapshot', () => {
  let run: CollectionRun;

  beforeEach(async () => {
    run = buildRun(channelId);
    await repository.startRun(run);
    await repository.completeWithSnapshot({
      run: {
        ...run,
        status: 'completed',
        capturedAt: CAPTURED_AT,
        completedAt: CAPTURED_AT,
        reusableUntil: REUSABLE_UNTIL,
      },
      channel: buildChannel(channelId),
      videos: buildVideos(channelId),
    });
  });

  it('conclui a execucao com os carimbos', async () => {
    const found = await repository.findById(run.id);

    expect(found?.status).toBe('completed');
    expect(found?.capturedAt).toEqual(CAPTURED_AT);
    expect(found?.reusableUntil).toEqual(REUSABLE_UNTIL);
  });

  it('devolve canal e videos na ida e volta', async () => {
    const snapshot = await repository.findSnapshot(run.id);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.channel.title).toBe('Canal de Integracao');
    expect(snapshot?.channel.subscriberCount).toBe(128_000);
    expect(snapshot?.videos).toHaveLength(3);
  });

  it('preserva ausencia como `null` atravessando o banco (RN-08)', async () => {
    const snapshot = await repository.findSnapshot(run.id);
    const longo = snapshot?.videos.find((video) => video.id === 'vid_int_002');

    // Se o mapeamento trocasse `null` por `0` em qualquer ponto — coluna,
    // driver ou mapper — a mediana do formato mudaria sem aviso.
    expect(longo?.viewCount).toBeNull();
    expect(longo?.likeCount).toBeNull();
    expect(longo?.commentCount).toBeNull();
  });

  it('preserva contagem acima de 2^31 (bigint)', async () => {
    const snapshot = await repository.findSnapshot(run.id);
    const desconhecido = snapshot?.videos.find((video) => video.id === 'vid_int_003');

    expect(desconhecido?.viewCount).toBe(9_007_199_254_740_990);
  });

  it('preserva os tres formatos, inclusive `unknown`', async () => {
    const snapshot = await repository.findSnapshot(run.id);
    const formatos = snapshot?.videos.map((video) => video.format).sort();

    expect(formatos).toEqual(['long', 'short', 'unknown']);
  });

  it('e idempotente: repetir nao duplica video nem falha', async () => {
    // Um retry de rede depois de uma gravacao bem-sucedida cai exatamente aqui.
    await repository.completeWithSnapshot({
      run: {
        ...run,
        status: 'completed',
        capturedAt: CAPTURED_AT,
        completedAt: CAPTURED_AT,
        reusableUntil: REUSABLE_UNTIL,
      },
      channel: buildChannel(channelId),
      videos: buildVideos(channelId),
    });

    const snapshot = await repository.findSnapshot(run.id);
    expect(snapshot?.videos).toHaveLength(3);
  });

  it('atualiza os campos denormalizados do canal', async () => {
    const { data } = await client
      .from('youtube_channels')
      .select('title, handle, country, first_seen_at, last_seen_at')
      .eq('youtube_channel_id', channelId)
      .single();

    expect(data?.['title']).toBe('Canal de Integracao');
    expect(data?.['handle']).toBe('@canal-integracao');
    expect(data?.['country']).toBe('BR');
  });

  it('nao faz `last_seen_at` andar para tras', async () => {
    // CAPTURED_AT e uma data anterior ao registro do canal — o caso de uma
    // coleta concluida fora de ordem. `last_seen_at` deve permanecer no valor
    // mais recente, e nunca violar `last_seen_at >= first_seen_at`.
    const { data } = await client
      .from('youtube_channels')
      .select('first_seen_at, last_seen_at')
      .eq('youtube_channel_id', channelId)
      .single();

    const primeiro = new Date(data?.['first_seen_at'] as string);
    const ultimo = new Date(data?.['last_seen_at'] as string);

    expect(ultimo.getTime()).toBeGreaterThanOrEqual(primeiro.getTime());
    expect(ultimo.getTime()).toBeGreaterThan(CAPTURED_AT.getTime());
  });
});

describe('findReusableForChannel (RN-10)', () => {
  async function completeRun(patch: Partial<CollectionRun> = {}): Promise<CollectionRun> {
    const run = buildRun(channelId);
    await repository.startRun(run);
    const completed: CollectionRun = {
      ...run,
      status: 'completed',
      capturedAt: CAPTURED_AT,
      completedAt: CAPTURED_AT,
      reusableUntil: REUSABLE_UNTIL,
      ...patch,
    };
    await repository.completeWithSnapshot({
      run: completed,
      channel: buildChannel(channelId),
      videos: buildVideos(channelId),
    });
    return completed;
  }

  it('devolve a coleta dentro da validade', async () => {
    const run = await completeRun();
    const antes = new Date(REUSABLE_UNTIL.getTime() - 3_600_000);

    const found = await repository.findReusableForChannel(channelId, antes);
    expect(found?.id).toBe(run.id);
  });

  it('recusa a coleta expirada', async () => {
    await completeRun();
    const depois = new Date(REUSABLE_UNTIL.getTime() + 1);

    expect(await repository.findReusableForChannel(channelId, depois)).toBeNull();
  });

  it('recusa a coleta invalidada', async () => {
    const run = await completeRun();
    await repository.save({ ...run, invalidatedAt: CAPTURED_AT });

    const antes = new Date(REUSABLE_UNTIL.getTime() - 3_600_000);
    expect(await repository.findReusableForChannel(channelId, antes)).toBeNull();
  });

  it('recusa execucao ainda em andamento', async () => {
    await repository.startRun(buildRun(channelId));

    expect(await repository.findReusableForChannel(channelId, REQUESTED_AT)).toBeNull();
  });

  it('devolve `null` para canal que nunca foi coletado', async () => {
    const desconhecido = trackChannel(makeChannelId());

    expect(await repository.findReusableForChannel(desconhecido, REQUESTED_AT)).toBeNull();
  });
});

describe('findActiveForChannel', () => {
  it('encontra a execucao em andamento', async () => {
    const run = buildRun(channelId);
    await repository.startRun(run);

    const found = await repository.findActiveForChannel(channelId);
    expect(found?.id).toBe(run.id);
  });

  it('devolve `null` quando nao ha execucao ativa', async () => {
    expect(await repository.findActiveForChannel(channelId)).toBeNull();
  });
});

describe('findSnapshot', () => {
  it('devolve `null` para execucao inexistente', async () => {
    expect(await repository.findSnapshot(randomUUID() as CollectionRunId)).toBeNull();
  });

  it('devolve `null` para execucao sem snapshot gravado', async () => {
    // Meia coleta nao e coleta: devolver so os videos seria pior que nada.
    const run = buildRun(channelId);
    await repository.startRun(run);

    expect(await repository.findSnapshot(run.id)).toBeNull();
  });
});
