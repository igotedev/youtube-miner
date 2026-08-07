import { beforeEach, describe, expect, it } from 'vitest';

import {
  CalculateAnalysisMetrics,
  GetAnalysisMetrics,
  StartChannelAnalysis,
} from '@/modules/channel-analysis';
import { InvalidChannelReferenceError } from '@/modules/youtube-collection';

import {
  DEMONSTRATION_USER_ID,
  buildAnalysisPipeline,
  resetDemonstrationStores,
} from './analysis-pipeline';

/**
 * A raiz de composicao e a unica coisa entre os casos de uso testados e uma tela
 * que funciona. Estes testes verificam a montagem — nao a regra de negocio, que
 * ja tem teste no proprio caso de uso.
 */

const VALID_URL = 'https://www.youtube.com/@canal-de-exemplo';

beforeEach(() => {
  resetDemonstrationStores();
});

describe('buildAnalysisPipeline', () => {
  it('monta os dois casos de uso e a consulta', () => {
    const pipeline = buildAnalysisPipeline();

    expect(pipeline.start).toBeInstanceOf(StartChannelAnalysis);
    expect(pipeline.calculateMetrics).toBeInstanceOf(CalculateAnalysisMetrics);
    expect(pipeline.getMetrics).toBeInstanceOf(GetAnalysisMetrics);
  });

  it('declara o modo de demonstracao', () => {
    // A tela le ESTE campo para decidir o aviso. Um literal na tela sobreviveria
    // a troca dos adaptadores e passaria a mentir.
    expect(buildAnalysisPipeline().mode).toBe('demonstration');
  });
});

describe('pipeline completo', () => {
  it('leva a analise de ponta a ponta e devolve metricas', async () => {
    const pipeline = buildAnalysisPipeline();

    const started = await pipeline.start.execute({
      requestedBy: DEMONSTRATION_USER_ID,
      channelUrl: VALID_URL,
    });
    expect(started.status).toBe('collecting_videos');

    const finished = await pipeline.calculateMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });
    expect(finished.status).toBe('partially_completed');
    expect(finished.analyticsResultId).not.toBeNull();

    const view = await pipeline.getMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });

    expect(view.metrics).not.toBeNull();
    expect(view.calculatedAt).toBeInstanceOf(Date);
  });

  it('separa Shorts de videos longos (RN-06)', async () => {
    const pipeline = buildAnalysisPipeline();
    const started = await pipeline.start.execute({
      requestedBy: DEMONSTRATION_USER_ID,
      channelUrl: VALID_URL,
    });
    await pipeline.calculateMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });

    const { metrics } = await pipeline.getMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.shorts.videoCount).toBeGreaterThan(0);
    expect(metrics!.long.videoCount).toBeGreaterThan(0);
    // As duas medianas sao calculadas sobre conjuntos disjuntos.
    expect(metrics!.shorts.viewCount.median).not.toBe(metrics!.long.viewCount.median);
  });

  it('preserva ausencia como `null` ate a saida (RN-08)', async () => {
    // O fixture tem um video longo sem contagem de visualizacoes.
    const pipeline = buildAnalysisPipeline();
    const started = await pipeline.start.execute({
      requestedBy: DEMONSTRATION_USER_ID,
      channelUrl: VALID_URL,
    });
    await pipeline.calculateMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });

    const { metrics } = await pipeline.getMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });

    expect(metrics!.long.videosWithoutViewCount).toBeGreaterThan(0);
    const withoutViews = metrics!.long.videos.find((video) => video.viewsPerDay === null);
    expect(withoutViews).toBeDefined();
    expect(withoutViews?.outlierScore).toBeNull();
    expect(withoutViews?.outlierBand).toBeNull();
  });
});

describe('estado entre invocacoes', () => {
  it('compartilha os repositorios entre chamadas separadas de build', async () => {
    // E o que torna a tela possivel: `start` e `calculateMetrics` chegam em
    // requisicoes diferentes, cada uma montando o proprio pipeline.
    const first = buildAnalysisPipeline();
    const started = await first.start.execute({
      requestedBy: DEMONSTRATION_USER_ID,
      channelUrl: VALID_URL,
    });

    const second = buildAnalysisPipeline();
    const finished = await second.calculateMetrics.execute({
      analysisId: started.id,
      requestedBy: DEMONSTRATION_USER_ID,
    });

    expect(finished.id).toBe(started.id);
    expect(finished.status).toBe('partially_completed');
  });

  it('descarta o estado quando os repositorios sao reiniciados', async () => {
    const pipeline = buildAnalysisPipeline();
    const started = await pipeline.start.execute({
      requestedBy: DEMONSTRATION_USER_ID,
      channelUrl: VALID_URL,
    });

    resetDemonstrationStores();

    await expect(
      buildAnalysisPipeline().getMetrics.execute({
        analysisId: started.id,
        requestedBy: DEMONSTRATION_USER_ID,
      }),
    ).rejects.toThrow('Analise nao encontrada.');
  });
});

describe('validacao da referencia (SPEC-002 no fluxo)', () => {
  it.each([
    ['host fora do YouTube', 'https://vimeo.com/canal'],
    ['URL de video, nao de canal', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['texto solto', 'nao-e-uma-url'],
    ['string vazia', '   '],
  ])('rejeita %s antes de qualquer coleta', async (_caso, url) => {
    const pipeline = buildAnalysisPipeline();

    await expect(
      pipeline.start.execute({ requestedBy: DEMONSTRATION_USER_ID, channelUrl: url }),
    ).rejects.toBeInstanceOf(InvalidChannelReferenceError);
  });

  it.each([
    ['handle', 'https://www.youtube.com/@canal-de-exemplo'],
    ['ID de canal', 'https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'],
    ['dominio movel', 'https://m.youtube.com/@canal-de-exemplo'],
  ])('aceita %s', async (_caso, url) => {
    const pipeline = buildAnalysisPipeline();

    const analysis = await pipeline.start.execute({
      requestedBy: DEMONSTRATION_USER_ID,
      channelUrl: url,
    });
    expect(analysis.status).toBe('collecting_videos');
  });
});
