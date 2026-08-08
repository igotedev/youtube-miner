import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { ChannelDirectory, YouTubeChannelId } from '@/modules/youtube-collection';
import { InMemoryChannelDirectory } from '@/modules/youtube-collection/infrastructure/memory/in-memory-channel-directory';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { InMemoryAnalysisRepository } from '../../infrastructure/memory/in-memory-analysis-repository';
import { ListUserAnalyses, MAX_HISTORY_ITEMS } from './list-user-analyses';

const OWNER = 'user-owner' as UserId;
const STRANGER = 'user-stranger' as UserId;
const CANAL_A = 'UC_fixture_channel_00000' as YouTubeChannelId;
const CANAL_B = 'UC_fixture_channel_00001' as YouTubeChannelId;

function buildAnalysis(
  id: string,
  requestedAt: string,
  channelId: YouTubeChannelId = CANAL_A,
  owner: UserId = OWNER,
): Analysis {
  return {
    id: id as AnalysisId,
    requestedBy: owner,
    channelId,
    requestedUrl: 'https://www.youtube.com/@canal-de-exemplo',
    status: 'partially_completed',
    collectionRunId: null,
    analyticsResultId: null,
    idempotencyKey: null,
    requestedAt: new Date(requestedAt),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
  };
}

describe('ListUserAnalyses', () => {
  let analyses: InMemoryAnalysisRepository;
  let channelDirectory: InMemoryChannelDirectory;
  let query: ListUserAnalyses;

  beforeEach(() => {
    analyses = new InMemoryAnalysisRepository();
    channelDirectory = new InMemoryChannelDirectory();
    query = new ListUserAnalyses({ analyses, channelDirectory });
  });

  it('junta cada analise ao canal correspondente', async () => {
    await analyses.create(buildAnalysis('a', '2026-08-01T00:00:00.000Z', CANAL_A));
    await analyses.create(buildAnalysis('b', '2026-07-01T00:00:00.000Z', CANAL_B));
    await channelDirectory.ensureRegistered(CANAL_A);
    await channelDirectory.ensureRegistered(CANAL_B);
    channelDirectory.setSummary(CANAL_A, 'Canal A', '@canal-a');
    channelDirectory.setSummary(CANAL_B, 'Canal B', '@canal-b');

    const view = await query.execute({ requestedBy: OWNER });

    expect(view.items.map((item) => [item.analysis.id, item.channel?.title])).toEqual([
      ['a', 'Canal A'],
      ['b', 'Canal B'],
    ]);
  });

  it('preserva a ordem do repositorio — mais recente primeiro', async () => {
    await analyses.create(buildAnalysis('antiga', '2026-06-01T00:00:00.000Z'));
    await analyses.create(buildAnalysis('nova', '2026-08-01T00:00:00.000Z'));
    await channelDirectory.ensureRegistered(CANAL_A);

    const view = await query.execute({ requestedBy: OWNER });

    // A juncao com os canais nao pode reordenar nada.
    expect(view.items.map((item) => item.analysis.id)).toEqual(['nova', 'antiga']);
  });

  it('canal sem titulo chega como titulo nulo, nao como ausencia do canal', async () => {
    await analyses.create(buildAnalysis('a', '2026-08-01T00:00:00.000Z'));
    // Registrado, mas sem coleta concluida — o caso da analise que falhou.
    await channelDirectory.ensureRegistered(CANAL_A);

    const view = await query.execute({ requestedBy: OWNER });

    expect(view.items[0]?.channel).toEqual({ id: CANAL_A, title: null, handle: null });
  });

  it('canal sumido do registro nao derruba a lista', async () => {
    await analyses.create(buildAnalysis('a', '2026-08-01T00:00:00.000Z'));
    // Nenhum `ensureRegistered`: a linha do canal nao existe.

    const view = await query.execute({ requestedBy: OWNER });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]?.channel).toBeNull();
  });

  it('consulta cada canal uma unica vez, mesmo com varias analises dele', async () => {
    await analyses.create(buildAnalysis('a', '2026-08-01T00:00:00.000Z', CANAL_A));
    await analyses.create(buildAnalysis('b', '2026-07-01T00:00:00.000Z', CANAL_A));
    await analyses.create(buildAnalysis('c', '2026-06-01T00:00:00.000Z', CANAL_A));
    await channelDirectory.ensureRegistered(CANAL_A);

    const spy = vi.spyOn(channelDirectory, 'findSummaries');
    await query.execute({ requestedBy: OWNER });

    // Uma chamada, com um id. Tres analises do mesmo canal nao podem virar tres
    // idas ao banco — nem um lote com o mesmo id repetido tres vezes.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual([CANAL_A]);
  });

  it('usuario sem analises recebe lista vazia e nao consulta canal nenhum', async () => {
    const spy = vi.spyOn(channelDirectory, 'findSummaries');

    const view = await query.execute({ requestedBy: OWNER });

    expect(view.items).toEqual([]);
    expect(view.reachedLimit).toBe(false);
    // Sem itens nao ha canal a consultar. Uma ida ao banco com lista vazia seria
    // trabalho puro.
    expect(spy).not.toHaveBeenCalled();
  });

  it('nunca inclui analise de outro usuario', async () => {
    await analyses.create(buildAnalysis('minha', '2026-07-01T00:00:00.000Z'));
    await analyses.create(buildAnalysis('alheia', '2026-08-01T00:00:00.000Z', CANAL_A, STRANGER));
    await channelDirectory.ensureRegistered(CANAL_A);

    const view = await query.execute({ requestedBy: OWNER });

    expect(view.items.map((item) => item.analysis.id)).toEqual(['minha']);
  });

  it('declara o teto e avisa quando ele foi atingido', async () => {
    for (let index = 0; index < MAX_HISTORY_ITEMS + 5; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      await analyses.create(buildAnalysis(`a${index}`, `2026-05-${day}T00:00:00.000Z`));
    }
    await channelDirectory.ensureRegistered(CANAL_A);

    const view = await query.execute({ requestedBy: OWNER });

    expect(view.items).toHaveLength(MAX_HISTORY_ITEMS);
    expect(view.limit).toBe(MAX_HISTORY_ITEMS);
    expect(view.reachedLimit).toBe(true);
  });

  it('pede ao repositorio exatamente o teto, e nao mais', async () => {
    const spy = vi.spyOn(analyses, 'listByOwner');

    await query.execute({ requestedBy: OWNER });

    // O corte tem de acontecer NO REPOSITORIO, para o adaptador real poder
    // traduzi-lo em `limit` no SQL. Cortar em memoria aqui traria todas as
    // analises do usuario pela rede.
    expect(spy).toHaveBeenCalledWith(OWNER, MAX_HISTORY_ITEMS);
  });

  it('nao depende do fake: qualquer ChannelDirectory serve', async () => {
    await analyses.create(buildAnalysis('a', '2026-08-01T00:00:00.000Z'));

    const stub: ChannelDirectory = {
      ensureRegistered: () => Promise.resolve(),
      findSummaries: () =>
        Promise.resolve([{ id: CANAL_A, title: 'Vindo de outro adaptador', handle: null }]),
    };

    const view = await new ListUserAnalyses({ analyses, channelDirectory: stub }).execute({
      requestedBy: OWNER,
    });

    expect(view.items[0]?.channel?.title).toBe('Vindo de outro adaptador');
  });
});
