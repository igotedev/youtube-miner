import { beforeEach, describe, expect, it } from 'vitest';

import type { YouTubeChannelId } from '../../domain/youtube-channel';
import { InMemoryChannelDirectory } from './in-memory-channel-directory';

/**
 * Contrato de `findSummaries` (SPEC-010).
 *
 * Tres comportamentos que a assinatura sozinha nao garante: lote com ids
 * repetidos, canal inexistente omitido em vez de erro, e titulo nulo para canal
 * registrado sem coleta concluida.
 */

const PRIMEIRO = 'UC_fixture_channel_00000' as YouTubeChannelId;
const SEGUNDO = 'UC_fixture_channel_00001' as YouTubeChannelId;
const AUSENTE = 'UC_fixture_channel_00002' as YouTubeChannelId;

describe('InMemoryChannelDirectory.findSummaries', () => {
  let directory: InMemoryChannelDirectory;

  beforeEach(() => {
    directory = new InMemoryChannelDirectory();
  });

  it('devolve lista vazia quando nada e pedido', async () => {
    expect(await directory.findSummaries([])).toEqual([]);
  });

  it('devolve os canais pedidos em lote', async () => {
    await directory.ensureRegistered(PRIMEIRO);
    await directory.ensureRegistered(SEGUNDO);
    directory.setSummary(PRIMEIRO, 'Canal de Exemplo', '@canal-de-exemplo');

    const found = await directory.findSummaries([PRIMEIRO, SEGUNDO]);

    expect(found).toHaveLength(2);
    expect(found).toContainEqual({
      id: PRIMEIRO,
      title: 'Canal de Exemplo',
      handle: '@canal-de-exemplo',
    });
  });

  it('ids repetidos produzem uma entrada so', async () => {
    await directory.ensureRegistered(PRIMEIRO);

    const found = await directory.findSummaries([PRIMEIRO, PRIMEIRO, PRIMEIRO]);

    // Dez analises do mesmo canal nao podem produzir dez resumos iguais.
    expect(found).toHaveLength(1);
  });

  it('omite canal inexistente em vez de falhar', async () => {
    await directory.ensureRegistered(PRIMEIRO);

    const found = await directory.findSummaries([PRIMEIRO, AUSENTE]);

    // Lancar erro faria uma analise orfa derrubar a lista inteira.
    expect(found.map((summary) => summary.id)).toEqual([PRIMEIRO]);
  });

  it('canal registrado sem coleta concluida tem titulo nulo', async () => {
    await directory.ensureRegistered(PRIMEIRO);

    const [summary] = await directory.findSummaries([PRIMEIRO]);

    // RN-08: o nome NAO EXISTE ainda. Nao e string vazia nem a URL digitada.
    expect(summary).toEqual({ id: PRIMEIRO, title: null, handle: null });
  });

  it('registrar de novo nao apaga o titulo ja preenchido', async () => {
    await directory.ensureRegistered(PRIMEIRO);
    directory.setSummary(PRIMEIRO, 'Canal de Exemplo', null);

    // Espelha o `upsert ... ignoreDuplicates` do adaptador real: uma segunda
    // analise do mesmo canal nao pode zerar o que a coleta ja gravou.
    await directory.ensureRegistered(PRIMEIRO);

    const [summary] = await directory.findSummaries([PRIMEIRO]);
    expect(summary?.title).toBe('Canal de Exemplo');
  });
});
