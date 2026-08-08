import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { WatchlistId } from '@/modules/watchlists';
import { SupabaseWatchlistRepository } from '@/modules/watchlists/infrastructure/supabase/supabase-watchlist-repository';
import type {
  CollectionRun,
  CollectionRunId,
  YouTubeChannelId,
} from '@/modules/youtube-collection';
import { SupabaseCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/supabase/supabase-collection-run-repository';
import { ConflictError, NotFoundError } from '@/shared/errors';
import { createAdminClient } from '@/shared/infrastructure/supabase/supabase-clients';

/**
 * Testes de INTEGRACAO do adaptador de listas (SPEC-012).
 *
 * Exigem `npm run db:start`. Fora de `npm run verify` de proposito.
 *
 * ---------------------------------------------------------------------------
 * O QUE SO APARECE AQUI, E NAO NO ADAPTADOR EM MEMORIA.
 *
 *  - o INDICE FUNCIONAL de nome. O fake aplica a mesma regra em JavaScript, mas
 *    quem tem de recusar `'concorrentes'` depois de `'Concorrentes'` e o banco;
 *  - a CHAVE ESTRANGEIRA com `youtube_channels`. O fake simula com um conjunto;
 *    aqui, salvar um canal nunca analisado tem de falhar de verdade;
 *  - as TRES FUNCOES de traducao `UC...` -> uuid interno. Elas nao existem em
 *    lugar nenhum do codigo TypeScript, entao nenhum teste unitario as exercita;
 *  - a CASCATA: apagar a lista leva os itens, e o canal global sobrevive
 *    (`on delete restrict`).
 * ---------------------------------------------------------------------------
 */

const client = createAdminClient();

const watchlists = new SupabaseWatchlistRepository(client);
const collectionRuns = new SupabaseCollectionRunRepository(client);

const REQUESTED_AT = new Date('2026-08-08T10:00:00.000Z');
const CREATED_AT = new Date('2026-08-08T12:00:00.000Z');
const ADDED_AT = new Date('2026-08-08T13:00:00.000Z');

const createdUsers: UserId[] = [];
const createdChannels: YouTubeChannelId[] = [];

function makeChannelId(): YouTubeChannelId {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 22);
  return `UC${suffix}` as YouTubeChannelId;
}

async function createUser(): Promise<UserId> {
  const email = `listas-${randomUUID()}@exemplo.test`;
  const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true });

  if (error !== null || data.user === null) {
    throw new Error(`Nao foi possivel criar usuario de teste: ${error?.message ?? 'sem usuario'}`);
  }
  createdUsers.push(data.user.id as UserId);
  return data.user.id as UserId;
}

function buildRun(channelId: YouTubeChannelId): CollectionRun {
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
  };
}

/** Registra o canal criando uma execucao de coleta — o caminho real. */
async function registerChannel(): Promise<YouTubeChannelId> {
  const id = makeChannelId();
  createdChannels.push(id);
  await collectionRuns.startRun(buildRun(id));
  return id;
}

async function createList(ownerId: UserId, name: string): Promise<WatchlistId> {
  const id = randomUUID() as WatchlistId;
  await watchlists.create({ id, ownerId, name, createdAt: CREATED_AT });
  return id;
}

let ownerId: UserId;
let strangerId: UserId;
let channelId: YouTubeChannelId;

beforeAll(async () => {
  const { error } = await client.from('watchlists').select('id').limit(1);
  if (error !== null) {
    throw new Error(
      `Supabase local inacessivel. Rode \`npm run db:start\` antes. Detalhe: ${error.message}`,
    );
  }

  ownerId = await createUser();
  strangerId = await createUser();
});

afterAll(async () => {
  // Ordem importa: os itens referenciam o canal com `on delete restrict`.
  // Apagar o usuario primeiro leva listas e itens pela cascata; so entao o
  // canal global fica livre.
  for (const userId of createdUsers) {
    await client.auth.admin.deleteUser(userId);
  }
  for (const id of createdChannels) {
    await client.from('youtube_channels').delete().eq('youtube_channel_id', id);
  }
});

beforeEach(async () => {
  channelId = await registerChannel();
});

describe('create', () => {
  it('grava a lista com um usuario real', async () => {
    const id = await createList(ownerId, `Concorrentes ${randomUUID()}`);

    const found = await watchlists.findById(id, ownerId);
    expect(found?.id).toBe(id);
    expect(found?.items).toEqual([]);
  });

  it('RECUSA dois nomes que so diferem no caixa', async () => {
    // O defeito real da SPEC-004: o comentario prometia unicidade
    // case-insensitive e `unique (user_id, name)` nao entregava. Quem recusa
    // agora e o indice `(user_id, lower(name))`.
    const nome = `Concorrentes ${randomUUID()}`;
    await createList(ownerId, nome);

    await expect(createList(ownerId, nome.toLowerCase())).rejects.toBeInstanceOf(ConflictError);
  });

  it('o mesmo nome em contas diferentes e permitido', async () => {
    const nome = `Concorrentes ${randomUUID()}`;
    await createList(ownerId, nome);

    await expect(createList(strangerId, nome)).resolves.toBeDefined();
  });
});

describe('findById e listByOwner', () => {
  it('lista de outro usuario e null, e nao erro de permissao', async () => {
    // Para quem pergunta, ela nao existe. "Sem permissao" ja confirmaria que
    // existe.
    const id = await createList(ownerId, `Privada ${randomUUID()}`);

    expect(await watchlists.findById(id, strangerId)).toBeNull();
  });

  it('conta os itens sem carregar os itens', async () => {
    const id = await createList(ownerId, `Com itens ${randomUUID()}`);
    await watchlists.addItem(id, ownerId, { channelId, addedAt: ADDED_AT, note: null });

    const summaries = await watchlists.listByOwner(ownerId);
    const found = summaries.find((summary) => summary.id === id);

    expect(found?.itemCount).toBe(1);
  });

  it('nunca traz lista de outro usuario', async () => {
    const alheia = await createList(strangerId, `Do estranho ${randomUUID()}`);

    const summaries = await watchlists.listByOwner(ownerId);
    expect(summaries.some((summary) => summary.id === alheia)).toBe(false);
  });
});

describe('addItem', () => {
  it('traduz UC... para o uuid interno e devolve o UC... na leitura', async () => {
    // O percurso inteiro da traducao, ida e volta. Nenhum teste unitario o
    // exercita: as funcoes vivem no banco.
    const id = await createList(ownerId, `Traducao ${randomUUID()}`);
    await watchlists.addItem(id, ownerId, {
      channelId,
      addedAt: ADDED_AT,
      note: '  ja normalizada  ',
    });

    const found = await watchlists.findById(id, ownerId);
    expect(found?.items).toHaveLength(1);
    expect(found?.items[0]?.channelId).toBe(channelId);
    expect(found?.items[0]?.note).toBe('  ja normalizada  ');
  });

  it('salvar duas vezes nao duplica e nao e erro', async () => {
    const id = await createList(ownerId, `Idempotente ${randomUUID()}`);
    await watchlists.addItem(id, ownerId, { channelId, addedAt: ADDED_AT, note: null });
    await watchlists.addItem(id, ownerId, { channelId, addedAt: ADDED_AT, note: 'outra nota' });

    const found = await watchlists.findById(id, ownerId);
    expect(found?.items).toHaveLength(1);
    // A primeira gravacao vence: `on conflict do nothing` nao sobrescreve.
    expect(found?.items[0]?.note).toBeNull();
  });

  it('RECUSA canal que nunca foi analisado', async () => {
    // A restricao central da SPEC-012. Aqui quem recusa e a chave estrangeira,
    // e nao um conjunto em memoria.
    const id = await createList(ownerId, `Sem canal ${randomUUID()}`);

    await expect(
      watchlists.addItem(id, ownerId, {
        channelId: makeChannelId(),
        addedAt: ADDED_AT,
        note: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nao salva em lista de outro usuario', async () => {
    const id = await createList(ownerId, `Alheia ${randomUUID()}`);

    await expect(
      watchlists.addItem(id, strangerId, { channelId, addedAt: ADDED_AT, note: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('removeItem', () => {
  it('remove pelo identificador oficial, e remover de novo nao e erro', async () => {
    const id = await createList(ownerId, `Remocao ${randomUUID()}`);
    await watchlists.addItem(id, ownerId, { channelId, addedAt: ADDED_AT, note: null });

    await watchlists.removeItem(id, ownerId, channelId);
    await expect(watchlists.removeItem(id, ownerId, channelId)).resolves.toBeUndefined();

    expect((await watchlists.findById(id, ownerId))?.items).toEqual([]);
  });

  it('nao remove item de lista de outro usuario', async () => {
    const id = await createList(ownerId, `Protegida ${randomUUID()}`);
    await watchlists.addItem(id, ownerId, { channelId, addedAt: ADDED_AT, note: null });

    await expect(watchlists.removeItem(id, strangerId, channelId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await watchlists.findById(id, ownerId))?.items).toHaveLength(1);
  });
});

describe('rename e remove', () => {
  it('renomeia', async () => {
    const id = await createList(ownerId, `Antigo ${randomUUID()}`);
    const novo = `Novo ${randomUUID()}`;

    await watchlists.rename(id, ownerId, novo);
    expect((await watchlists.findById(id, ownerId))?.name).toBe(novo);
  });

  it('renomear lista de outro usuario e 404, e nao altera nada', async () => {
    const original = `Original ${randomUUID()}`;
    const id = await createList(ownerId, original);

    await expect(watchlists.rename(id, strangerId, 'Sequestrada')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await watchlists.findById(id, ownerId))?.name).toBe(original);
  });

  it('apagar a lista leva os itens e PRESERVA o canal global', async () => {
    // O `on delete cascade` de `watchlist_items` e o `on delete restrict` de
    // `youtube_channels`, provados juntos: a organizacao some, o trabalho fica.
    const id = await createList(ownerId, `Descartavel ${randomUUID()}`);
    await watchlists.addItem(id, ownerId, { channelId, addedAt: ADDED_AT, note: null });

    await watchlists.remove(id, ownerId);

    expect(await watchlists.findById(id, ownerId)).toBeNull();

    const { data } = await client
      .from('youtube_channels')
      .select('youtube_channel_id')
      .eq('youtube_channel_id', channelId);
    expect(data).toHaveLength(1);
  });

  it('apagar lista de outro usuario e 404, e nao apaga nada', async () => {
    const id = await createList(ownerId, `Intacta ${randomUUID()}`);

    await expect(watchlists.remove(id, strangerId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await watchlists.findById(id, ownerId)).not.toBeNull();
  });
});
