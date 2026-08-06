import { describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import { MAX_RECENT_VIDEOS } from '@/modules/youtube-collection';
// Import interno deliberado: adaptadores falsos nao fazem parte da superficie
// publica de youtube-collection e nunca devem ser usados fora de teste ou da
// raiz de composicao.
import {
  createFakeChannelResolver,
  createFakeYouTubeChannelSource,
  fakeFixture,
} from '@/modules/youtube-collection/infrastructure/fake/fake-youtube-source';
import type { Clock } from '@/shared/domain';
import { noopLogger } from '@/shared/observability';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import type { AnalysisIdGenerator, AnalysisRepository } from '../ports/analysis-repository';
import { StartChannelAnalysis } from './start-channel-analysis';

const FIXED_NOW = new Date('2026-08-06T10:30:00.000Z');

function fixedClock(): Clock {
  return { now: () => FIXED_NOW };
}

function sequentialIds(): AnalysisIdGenerator {
  let n = 0;
  return { next: () => `analysis_${++n}` as AnalysisId };
}

/**
 * Repositorio em memoria que guarda TODAS as gravacoes, nao apenas a ultima:
 * o que se quer verificar e a sequencia de estados, e um repositorio que so
 * lembrasse do estado final esconderia exatamente isso.
 */
function recordingRepository() {
  const writes: Analysis[] = [];
  const repository: AnalysisRepository = {
    findById: (id) => Promise.resolve(writes.findLast((a) => a.id === id) ?? null),
    findLatestReusable: () => Promise.resolve(null),
    save: (analysis) => {
      writes.push(analysis);
      return Promise.resolve();
    },
  };
  return { repository, writes };
}

function buildUseCase() {
  const { repository, writes } = recordingRepository();
  const useCase = new StartChannelAnalysis({
    clock: fixedClock(),
    logger: noopLogger,
    ids: sequentialIds(),
    channelResolver: createFakeChannelResolver(),
    channelSource: createFakeYouTubeChannelSource(),
    analyses: repository,
  });
  return { useCase, writes };
}

const INPUT = {
  requestedBy: 'user_1' as UserId,
  channelUrl: 'https://www.youtube.com/@canal-de-exemplo',
};

describe('StartChannelAnalysis', () => {
  it('percorre os estados de coleta na ordem e para em collecting_videos', async () => {
    const { useCase, writes } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(writes.map((w) => w.status)).toEqual([
      'pending',
      'collecting_channel',
      'collecting_videos',
    ]);
    // Nao avanca para calculating_metrics: o motor de metricas so chega na
    // SPEC-003. Se este assert quebrar, a implementacao passou do escopo.
    expect(analysis.status).toBe('collecting_videos');
  });

  it('ancora a analise no ID oficial do canal, e nao na URL digitada', async () => {
    // RN-01 e RN-02.
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(analysis.channelId).toBe(fakeFixture.channelId);
    expect(analysis.requestedUrl).toBe(INPUT.channelUrl);
    expect(String(analysis.channelId)).not.toBe(INPUT.channelUrl);
  });

  it('registra a data e hora da coleta a partir do relogio injetado', async () => {
    // RN-12 e RN-13: o carimbo e deterministico, logo verificavel.
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(analysis.createdAt).toEqual(FIXED_NOW);
    expect(analysis.rawSnapshot?.collectedAt).toEqual(FIXED_NOW);
  });

  it('guarda os dados brutos separados das metricas e do relatorio de IA', async () => {
    // RN-04 e RN-05.
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    expect(analysis.rawSnapshot?.channel.id).toBe(fakeFixture.channelId);
    expect(analysis.rawSnapshot?.videos).toHaveLength(fakeFixture.videos.length);
    // Ausencia se representa como null. Nunca como zero, nem como objeto vazio.
    expect(analysis.metrics).toBeNull();
    expect(analysis.insight).toBeNull();
  });

  it('preserva contagens ausentes como null nos dados brutos', async () => {
    // RN-08: o fixture tem um video sem contagem de visualizacoes.
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);
    const views = analysis.rawSnapshot?.videos.map((v) => v.viewCount) ?? [];

    expect(views).toContain(null);
    expect(views).not.toContain(0);
  });

  it('propaga a falha do resolvedor sem gravar analise nenhuma', async () => {
    const { useCase, writes } = buildUseCase();

    await expect(useCase.execute({ ...INPUT, channelUrl: '' })).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('respeita o teto de 50 videos recentes definido pelo modulo de coleta', async () => {
    const { useCase } = buildUseCase();

    const analysis = await useCase.execute(INPUT);

    // O teto vive em youtube-collection; o caso de uso nao inventa um proprio.
    expect(analysis.rawSnapshot?.videos.length).toBeLessThanOrEqual(MAX_RECENT_VIDEOS);
  });
});
