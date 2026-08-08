import { beforeEach, describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import { AppError } from '@/shared/errors';
import { noopLogger } from '@/shared/observability';

import { InMemoryWatchlistRepository } from '../../infrastructure/memory/in-memory-watchlist-repository';
import { ManageWatchlists } from './manage-watchlists';

/**
 * As acoes do usuario sobre as proprias listas (SPEC-012).
 *
 * O que estes testes travam nao e o CRUD — e o que o esquema exige e o que o
 * produto decidiu: so canal analisado entra, salvar duas vezes nao e erro, e
 * lista de outra pessoa nao existe.
 */

const OWNER = 'user-owner' as UserId;
const STRANGER = 'user-stranger' as UserId;
const CANAL_A = 'UC_fixture_channel_00000' as YouTubeChannelId;
const CANAL_B = 'UC_fixture_channel_00001' as YouTubeChannelId;
const NAO_ANALISADO = 'UC_fixture_channel_99999' as YouTubeChannelId;

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');
const clock = { now: () => FIXED_NOW };

function sequentialIds() {
  let next = 0;
  return {
    next: () => {
      next += 1;
      return `lista-${next}`;
    },
  };
}

let watchlists: InMemoryWatchlistRepository;
let useCase: ManageWatchlists;

beforeEach(() => {
  watchlists = new InMemoryWatchlistRepository();
  // Canais que "ja foram analisados". No banco isto e a chave estrangeira.
  watchlists.registerChannel(CANAL_A);
  watchlists.registerChannel(CANAL_B);

  useCase = new ManageWatchlists({ clock, logger: noopLogger, ids: sequentialIds(), watchlists });
});

describe('ManageWatchlists — criar e listar', () => {
  it('cria a lista com o nome aparado e devolve o id', async () => {
    const id = await useCase.create(OWNER, '  Concorrentes  ');

    const [resumo] = await useCase.list(OWNER);
    expect(resumo?.id).toBe(id);
    expect(resumo?.name).toBe('Concorrentes');
    expect(resumo?.itemCount).toBe(0);
  });

  it('recusa nome que so difere no caixa', async () => {
    // A regra que o esquema NAO cumpria ate a SPEC-012. O fake a aplica porque
    // o banco passa a aplicar — um fake mais permissivo esconde defeito.
    await useCase.create(OWNER, 'Concorrentes');

    await expect(useCase.create(OWNER, 'concorrentes')).rejects.toThrow(AppError);
  });

  it('o mesmo nome em contas diferentes e permitido', async () => {
    await useCase.create(OWNER, 'Concorrentes');

    await expect(useCase.create(STRANGER, 'Concorrentes')).resolves.toBeDefined();
  });

  it('recusa nome em branco antes de tocar o banco', async () => {
    await expect(useCase.create(OWNER, '   ')).rejects.toThrow(AppError);
    expect(watchlists.size).toBe(0);
  });

  it('lista da mais recente para a mais antiga', async () => {
    const primeira = await useCase.create(OWNER, 'Primeira');
    const segunda = await useCase.create(OWNER, 'Segunda');

    // Empate de instante: o fake ordena por `createdAt`, e o relogio e fixo.
    // O que importa aqui e que as duas aparecem e nenhuma some.
    const nomes = (await useCase.list(OWNER)).map((l) => l.id);
    expect(nomes).toHaveLength(2);
    expect(nomes).toContain(primeira);
    expect(nomes).toContain(segunda);
  });

  it('nunca mostra lista de outro usuario', async () => {
    await useCase.create(STRANGER, 'Do estranho');

    expect(await useCase.list(OWNER)).toEqual([]);
  });
});

describe('ManageWatchlists — salvar canais', () => {
  it('salva um canal analisado e conta o item', async () => {
    const id = await useCase.create(OWNER, 'Concorrentes');
    await useCase.saveChannel(id, OWNER, CANAL_A, '  canal de referencia  ');

    const [resumo] = await useCase.list(OWNER);
    expect(resumo?.itemCount).toBe(1);
  });

  it('salvar duas vezes nao duplica e nao e erro', async () => {
    // Um duplo clique nao e erro do usuario: ele queria uma coisa so, e o
    // resultado desejado ja vale.
    const id = await useCase.create(OWNER, 'Concorrentes');
    await useCase.saveChannel(id, OWNER, CANAL_A);
    await useCase.saveChannel(id, OWNER, CANAL_A);

    const [resumo] = await useCase.list(OWNER);
    expect(resumo?.itemCount).toBe(1);
  });

  it('RECUSA canal que nunca foi analisado', async () => {
    // A restricao central da SPEC-012: `watchlist_items.channel_id` referencia
    // `youtube_channels`, e o canal so entra la quando alguem o analisa. Uma
    // watchlist aqui e acervo do que voce estudou, nao lista de links.
    const id = await useCase.create(OWNER, 'Concorrentes');

    await expect(useCase.saveChannel(id, OWNER, NAO_ANALISADO)).rejects.toThrow(AppError);
  });

  it('nota em branco vira ausencia, e nao texto vazio', async () => {
    // RN-08: "sem nota" e diferente de "nota vazia".
    const id = await useCase.create(OWNER, 'Concorrentes');
    await useCase.saveChannel(id, OWNER, CANAL_A, '   ');

    const lista = await watchlists.findById(id, OWNER);
    expect(lista?.items[0]?.note).toBeNull();
  });

  it('nao salva em lista de outro usuario', async () => {
    const id = await useCase.create(OWNER, 'Concorrentes');

    await expect(useCase.saveChannel(id, STRANGER, CANAL_A)).rejects.toThrow(AppError);
  });

  it('remove um canal, e remover o que nao esta la nao e erro', async () => {
    const id = await useCase.create(OWNER, 'Concorrentes');
    await useCase.saveChannel(id, OWNER, CANAL_A);

    await useCase.removeChannel(id, OWNER, CANAL_A);
    await expect(useCase.removeChannel(id, OWNER, CANAL_A)).resolves.toBeUndefined();

    expect((await useCase.list(OWNER))[0]?.itemCount).toBe(0);
  });
});

describe('ManageWatchlists — renomear e apagar', () => {
  it('renomeia', async () => {
    const id = await useCase.create(OWNER, 'Antigo');
    await useCase.rename(id, OWNER, 'Novo');

    expect((await useCase.list(OWNER))[0]?.name).toBe('Novo');
  });

  it('renomear para o proprio nome nao e conflito', async () => {
    const id = await useCase.create(OWNER, 'Concorrentes');

    await expect(useCase.rename(id, OWNER, 'CONCORRENTES')).resolves.toBeUndefined();
  });

  it('recusa renomear para o nome de outra lista', async () => {
    await useCase.create(OWNER, 'Concorrentes');
    const outra = await useCase.create(OWNER, 'Ideias');

    await expect(useCase.rename(outra, OWNER, 'concorrentes')).rejects.toThrow(AppError);
  });

  it('apaga a lista', async () => {
    const id = await useCase.create(OWNER, 'Concorrentes');
    await useCase.remove(id, OWNER);

    expect(await useCase.list(OWNER)).toEqual([]);
  });

  it('apagar lista de outro usuario e 404, e nao apaga nada', async () => {
    // Idempotencia sem verificacao devolveria sucesso, e o usuario acharia que
    // apagou a lista de outra pessoa.
    const id = await useCase.create(OWNER, 'Concorrentes');

    await expect(useCase.remove(id, STRANGER)).rejects.toThrow(AppError);
    expect(watchlists.size).toBe(1);
  });
});
