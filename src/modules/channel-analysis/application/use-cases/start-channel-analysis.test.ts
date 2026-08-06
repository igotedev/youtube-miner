import { beforeEach, describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { CollectionRun, CollectionRunId } from '@/modules/youtube-collection';
import { ConcurrentCollectionRunError, MAX_RECENT_VIDEOS } from '@/modules/youtube-collection';
// Imports internos deliberados: adaptadores nao fazem parte da superficie
// publica e so podem ser usados em teste ou na raiz de composicao.
import { InMemoryCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/memory/in-memory-collection-run-repository';
import {
  createFakeChannelResolver,
  createFakeYouTubeChannelSource,
  fakeFixture,
} from '@/modules/youtube-collection/infrastructure/fake/fake-youtube-source';
import type { Clock, UuidGenerator } from '@/shared/domain';
import { noopLogger } from '@/shared/observability';

import { InMemoryAnalysisRepository } from '../../infrastructure/memory/in-memory-analysis-repository';
import { StartChannelAnalysis } from './start-channel-analysis';

const FIXED_NOW = new Date('2026-08-06T10:30:00.000Z');
const MS_PER_HOUR = 3_600_000;
const FRESHNESS_HOURS = 24;

/** Relogio ajustavel: `capturedAt` e `requestedAt` precisam poder divergir. */
function mutableClock(start = FIXED_NOW) {
  let current = start;
  return {
    clock: { now: () => current } satisfies Clock,
    advanceHours(hours: number) {
      current = new Date(current.getTime() + hours * MS_PER_HOUR);
    },
  };
}

function sequentialIds(): UuidGenerator {
  let n = 0;
  return { next: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}

function buildUseCase() {
  const analyses = new InMemoryAnalysisRepository();
  const collectionRuns = new InMemoryCollectionRunRepository();
  const { clock, advanceHours } = mutableClock();
  const channelSource = createFakeYouTubeChannelSource();

  let fetchedChannels = 0;
  const countingSource = {
    fetchChannel: (id: Parameters<typeof channelSource.fetchChannel>[0]) => {
      fetchedChannels += 1;
      return channelSource.fetchChannel(id);
    },
    fetchRecentVideos: channelSource.fetchRecentVideos,
  };

  const useCase = new StartChannelAnalysis({
    clock,
    logger: noopLogger,
    ids: sequentialIds(),
    channelResolver: createFakeChannelResolver(),
    channelSource: countingSource,
    analyses,
    collectionRuns,
    analysisFreshnessHours: FRESHNESS_HOURS,
  });

  return {
    useCase,
    analyses,
    collectionRuns,
    advanceHours,
    quotaSpent: () => fetchedChannels,
  };
}

const INPUT = {
  requestedBy: 'user_1' as UserId,
  channelUrl: 'https://www.youtube.com/@canal-de-exemplo',
};

describe('StartChannelAnalysis — coleta nova', () => {
  it('percorre os estados de coleta e para em collecting_videos', async () => {
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    // Nao avanca para calculating_metrics: a persistencia do resultado da
    // SPEC-003 e de outro caso de uso. Se este assert quebrar, passou do escopo.
    expect(analysis.status).toBe('collecting_videos');
  });

  it('ancora a analise no ID oficial do canal, e nao na URL digitada', async () => {
    // RN-01 e RN-02.
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(analysis.channelId).toBe(fakeFixture.channelId);
    expect(analysis.requestedUrl).toBe(INPUT.channelUrl);
  });

  it('aponta para a coleta em vez de embutir o snapshot (ADR-005)', async () => {
    const { useCase, collectionRuns } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(analysis.collectionRunId).not.toBeNull();
    const snapshot = await collectionRuns.findSnapshot(analysis.collectionRunId as CollectionRunId);
    expect(snapshot?.channel.id).toBe(fakeFixture.channelId);
    expect(snapshot?.videos).toHaveLength(fakeFixture.videos.length);
  });

  it('deixa as metricas sem preencher (RN-04)', async () => {
    // O relatorio de IA nao aparece na analise: a FK vai no sentido inverso
    // (`ai_insight_reports.analysis_id`) e o relatorio e opcional (RN-09).
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(analysis.analyticsResultId).toBeNull();
  });

  it('registra a data da coleta a partir do relogio injetado (RN-12)', async () => {
    const { useCase, collectionRuns } = buildUseCase();

    const analysis = await useCase.execute(INPUT);
    const run = await collectionRuns.findById(analysis.collectionRunId as CollectionRunId);

    expect(analysis.requestedAt).toEqual(FIXED_NOW);
    expect(run?.capturedAt).toEqual(FIXED_NOW);
  });

  it('define a validade da coleta a partir da configuracao recebida', async () => {
    const { useCase, collectionRuns } = buildUseCase();

    const analysis = await useCase.execute(INPUT);
    const run = await collectionRuns.findById(analysis.collectionRunId as CollectionRunId);

    expect(run?.reusableUntil).toEqual(
      new Date(FIXED_NOW.getTime() + FRESHNESS_HOURS * MS_PER_HOUR),
    );
  });

  it('respeita o teto de 50 videos recentes', async () => {
    const { useCase, collectionRuns } = buildUseCase();

    const analysis = await useCase.execute(INPUT);
    const snapshot = await collectionRuns.findSnapshot(analysis.collectionRunId as CollectionRunId);

    expect(snapshot?.videos.length).toBeLessThanOrEqual(MAX_RECENT_VIDEOS);
  });

  it('propaga a falha do resolvedor sem criar analise nem coleta', async () => {
    const { useCase, analyses, collectionRuns } = buildUseCase();

    await expect(useCase.execute({ ...INPUT, channelUrl: '' })).rejects.toThrow();
    expect(await analyses.listByChannel(INPUT.requestedBy, fakeFixture.channelId)).toEqual([]);
    expect(await collectionRuns.findActiveForChannel(fakeFixture.channelId)).toBeNull();
  });
});

describe('reuso de coleta recente (RN-10)', () => {
  it('reaproveita a coleta de outro usuario sem gastar quota', async () => {
    const { useCase, quotaSpent } = buildUseCase();

    const first = await useCase.execute(INPUT);
    expect(quotaSpent()).toBe(1);

    // Outro usuario, mesmo canal, dentro da validade.
    const second = await useCase.execute({
      ...INPUT,
      requestedBy: 'user_2' as UserId,
    });

    expect(quotaSpent()).toBe(1);
    expect(second.collectionRunId).toBe(first.collectionRunId);
  });

  it('pula collecting_channel quando reaproveita', async () => {
    const { useCase } = buildUseCase();

    await useCase.execute(INPUT);
    const reused = await useCase.execute({ ...INPUT, requestedBy: 'user_2' as UserId });

    expect(reused.status).toBe('collecting_videos');
    expect(reused.collectionRunId).not.toBeNull();
  });

  it('coleta de novo quando a validade expirou', async () => {
    const { useCase, advanceHours, quotaSpent } = buildUseCase();

    const first = await useCase.execute(INPUT);
    advanceHours(FRESHNESS_HOURS + 1);
    const second = await useCase.execute({ ...INPUT, requestedBy: 'user_2' as UserId });

    expect(quotaSpent()).toBe(2);
    expect(second.collectionRunId).not.toBe(first.collectionRunId);
  });

  it('nao reaproveita uma coleta sem snapshot', async () => {
    // Execucao marcada como concluida mas sem dados: reaproveita-la devolveria
    // nada. O repositorio filtra por presenca de snapshot, como o SQL faz.
    const { collectionRuns } = buildUseCase();
    const orphan: CollectionRun = {
      id: 'run_orfa' as CollectionRunId,
      channelId: fakeFixture.channelId,
      status: 'completed',
      requestedAt: FIXED_NOW,
      startedAt: FIXED_NOW,
      capturedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      failedAt: null,
      reusableUntil: new Date(FIXED_NOW.getTime() + MS_PER_HOUR),
      errorCode: null,
      invalidatedAt: null,
    };
    await collectionRuns.startRun(orphan);
    await collectionRuns.save({ ...orphan });

    expect(
      await collectionRuns.findReusableForChannel(fakeFixture.channelId, FIXED_NOW),
    ).toBeNull();
  });
});

describe('idempotencia', () => {
  it('devolve a mesma analise para a mesma chave, sem coletar de novo', async () => {
    const { useCase, quotaSpent } = buildUseCase();
    const withKey = { ...INPUT, idempotencyKey: 'req-abc-123' };

    const first = await useCase.execute(withKey);
    const second = await useCase.execute(withKey);

    expect(second.id).toBe(first.id);
    expect(quotaSpent()).toBe(1);
  });

  it('a mesma chave de outro usuario cria uma analise propria', async () => {
    // A unicidade e por (user_id, idempotency_key): chaves geradas no cliente
    // podem colidir entre usuarios sem que uma solicitacao anule a outra.
    const { useCase } = buildUseCase();
    const key = 'req-abc-123';

    const first = await useCase.execute({ ...INPUT, idempotencyKey: key });
    const second = await useCase.execute({
      ...INPUT,
      requestedBy: 'user_2' as UserId,
      idempotencyKey: key,
    });

    expect(second.id).not.toBe(first.id);
    expect(second.requestedBy).toBe('user_2');
  });

  it('sem chave, cada solicitacao cria uma analise nova', async () => {
    const { useCase } = buildUseCase();

    const first = await useCase.execute(INPUT);
    const second = await useCase.execute(INPUT);

    expect(second.id).not.toBe(first.id);
  });
});

describe('isolamento por usuario', () => {
  let repository: InMemoryAnalysisRepository;

  beforeEach(() => {
    repository = new InMemoryAnalysisRepository();
  });

  it('nao devolve a analise de outro usuario', async () => {
    const { useCase } = buildUseCase();
    const analysis = await useCase.execute(INPUT);

    const asOwner = await repository.findById(analysis.id, INPUT.requestedBy);
    expect(asOwner).toBeNull(); // repositorio novo, sem os dados

    const populated = new InMemoryAnalysisRepository();
    await populated.create(analysis);

    expect(await populated.findById(analysis.id, INPUT.requestedBy)).not.toBeNull();
    expect(await populated.findById(analysis.id, 'user_2' as UserId)).toBeNull();
  });
});

describe('concorrencia', () => {
  it('recusa uma segunda coleta ativa do mesmo canal', async () => {
    const { collectionRuns } = buildUseCase();
    const base = {
      channelId: fakeFixture.channelId,
      status: 'pending' as const,
      requestedAt: FIXED_NOW,
      startedAt: null,
      capturedAt: null,
      completedAt: null,
      failedAt: null,
      reusableUntil: null,
      errorCode: null,
      invalidatedAt: null,
    };

    await collectionRuns.startRun({ ...base, id: 'run_a' as CollectionRunId });

    // Espelha a violacao do indice unico parcial no banco.
    await expect(
      collectionRuns.startRun({ ...base, id: 'run_b' as CollectionRunId }),
    ).rejects.toBeInstanceOf(ConcurrentCollectionRunError);
  });

  it('permite nova coleta depois que a anterior concluiu', async () => {
    const { collectionRuns } = buildUseCase();
    const base = {
      channelId: fakeFixture.channelId,
      requestedAt: FIXED_NOW,
      startedAt: FIXED_NOW,
      capturedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      failedAt: null,
      reusableUntil: null,
      errorCode: null,
      invalidatedAt: null,
    };

    const first = { ...base, id: 'run_a' as CollectionRunId, status: 'pending' as const };
    await collectionRuns.startRun(first);
    await collectionRuns.save({ ...first, status: 'completed' });

    await expect(
      collectionRuns.startRun({ ...base, id: 'run_b' as CollectionRunId, status: 'pending' }),
    ).resolves.toBeDefined();
  });
});
