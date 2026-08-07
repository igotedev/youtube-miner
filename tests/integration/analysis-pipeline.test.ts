import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnalysisPipeline } from '@/config/composition';
import type { UserId } from '@/modules/identity';
import { InvalidChannelReferenceError } from '@/modules/youtube-collection';
import { createAdminClient } from '@/shared/infrastructure/supabase/supabase-clients';

/**
 * Pipeline de analise de ponta a ponta, contra o Postgres real (SPEC-009).
 *
 * ---------------------------------------------------------------------------
 * ESTE TESTE ERA UNITARIO E VIROU DE INTEGRACAO.
 *
 * Ate a SPEC-008 a raiz de composicao montava repositorios em memoria, e o fluxo
 * inteiro rodava sem banco. Provava que os casos de uso conversam entre si —
 * nao que a analise SOBREVIVE, que e o que o usuario percebe.
 *
 * Agora prova as duas coisas, e prova a terceira que nenhum teste anterior
 * alcancava: que `channel_analyses.user_id` aponta para um usuario de verdade.
 * ---------------------------------------------------------------------------
 *
 * A coleta roda em modo de DEMONSTRACAO de proposito. `.env.local` costuma ter
 * `YOUTUBE_API_KEY`, e um teste que a usasse gastaria quota real a cada
 * execucao e dependeria de um canal de terceiro continuar existindo. Teste nao
 * acessa a rede externa — regra do projeto, secao 7 do CLAUDE.md.
 */

/**
 * Antes de QUALQUER coisa que leia o ambiente.
 *
 * `getServerEnv()` guarda o resultado em cache na primeira chamada, e
 * `createAdminClient()` logo abaixo e uma delas. Remover a variavel dentro do
 * `beforeAll` seria tarde: o ambiente ja teria sido congelado com a chave
 * presente, e o pipeline sairia em modo `live` — gastando quota de verdade a
 * cada execucao do teste.
 *
 * Foi exatamente isso que a guarda do `beforeAll` pegou na primeira execucao.
 */
delete process.env.YOUTUBE_API_KEY;

const client = createAdminClient();

const VALID_URL = 'https://www.youtube.com/@canal-de-exemplo';

let buildAnalysisPipeline: () => AnalysisPipeline;
let ownerId: UserId;

const createdUsers: UserId[] = [];

async function createUser(): Promise<UserId> {
  const email = `pipeline-${randomUUID()}@exemplo.test`;
  const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true });

  if (error !== null || data.user === null) {
    throw new Error(`Nao foi possivel criar usuario de teste: ${error?.message ?? 'sem usuario'}`);
  }
  createdUsers.push(data.user.id as UserId);
  return data.user.id as UserId;
}

beforeAll(async () => {
  ({ buildAnalysisPipeline } = await import('@/config/composition'));

  const pipeline = buildAnalysisPipeline();
  if (pipeline.mode !== 'demonstration') {
    // Guarda do guarda. Se isto falhar, os testes abaixo estariam chamando a
    // YouTube Data API de verdade e gastando quota sem ninguem notar.
    throw new Error('O pipeline deveria estar em modo de demonstracao neste teste.');
  }

  ownerId = await createUser();
});

afterAll(async () => {
  // A cascata leva as analises junto. Os artefatos globais — canal, coleta,
  // snapshots, metricas — ficam, e e assim que tem de ser: eles nao tem dono.
  for (const userId of createdUsers) {
    await client.auth.admin.deleteUser(userId);
  }
});

describe('fluxo completo', () => {
  it('leva a analise da URL as metricas e a persiste', async () => {
    const pipeline = buildAnalysisPipeline();

    const started = await pipeline.start.execute({ requestedBy: ownerId, channelUrl: VALID_URL });
    expect(started.status).toBe('collecting_videos');

    const finished = await pipeline.calculateMetrics.execute({
      analysisId: started.id,
      requestedBy: ownerId,
    });
    expect(finished.status).toBe('partially_completed');
    expect(finished.analyticsResultId).not.toBeNull();

    const view = await pipeline.getMetrics.execute({
      analysisId: started.id,
      requestedBy: ownerId,
    });

    expect(view.metrics).not.toBeNull();
    expect(view.calculatedAt).toBeInstanceOf(Date);
  });

  it('a analise sobrevive a um pipeline montado do zero', async () => {
    /**
     * O teste que so o banco permite.
     *
     * Antes da SPEC-009 os repositorios viviam em `globalThis` e este caso
     * passava porque o processo era o mesmo. Aqui a montagem e nova, e o unico
     * lugar de onde a analise pode vir e o Postgres.
     */
    const started = await buildAnalysisPipeline().start.execute({
      requestedBy: ownerId,
      channelUrl: VALID_URL,
    });

    const view = await buildAnalysisPipeline().getMetrics.execute({
      analysisId: started.id,
      requestedBy: ownerId,
    });

    expect(view.analysis.id).toBe(started.id);
  });

  it('separa Shorts de videos longos (RN-06)', async () => {
    const pipeline = buildAnalysisPipeline();
    const started = await pipeline.start.execute({ requestedBy: ownerId, channelUrl: VALID_URL });
    await pipeline.calculateMetrics.execute({ analysisId: started.id, requestedBy: ownerId });

    const { metrics } = await pipeline.getMetrics.execute({
      analysisId: started.id,
      requestedBy: ownerId,
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.shorts.videoCount).toBeGreaterThan(0);
    expect(metrics!.long.videoCount).toBeGreaterThan(0);
    // As duas medianas saem de conjuntos disjuntos.
    expect(metrics!.shorts.viewCount.median).not.toBe(metrics!.long.viewCount.median);
  });

  it('preserva ausencia como `null` ate a saida (RN-08)', async () => {
    // O fixture tem um video longo sem contagem de visualizacoes. Ele atravessa
    // o calculo, o `jsonb` do banco e a volta sem virar zero.
    const pipeline = buildAnalysisPipeline();
    const started = await pipeline.start.execute({ requestedBy: ownerId, channelUrl: VALID_URL });
    await pipeline.calculateMetrics.execute({ analysisId: started.id, requestedBy: ownerId });

    const { metrics } = await pipeline.getMetrics.execute({
      analysisId: started.id,
      requestedBy: ownerId,
    });

    expect(metrics!.long.videosWithoutViewCount).toBeGreaterThan(0);
    const withoutViews = metrics!.long.videos.find((video) => video.viewsPerDay === null);
    expect(withoutViews).toBeDefined();
    expect(withoutViews?.outlierScore).toBeNull();
    expect(withoutViews?.outlierBand).toBeNull();
  });
});

describe('isolamento entre usuarios', () => {
  it('nao entrega a analise de outra pessoa', async () => {
    const intruso = await createUser();

    const started = await buildAnalysisPipeline().start.execute({
      requestedBy: ownerId,
      channelUrl: VALID_URL,
    });

    /**
     * `NotFoundError`, e nao um erro de permissao — de proposito. Responder
     * "sem permissao" confirmaria que a analise existe, e transformaria a
     * consulta em um jeito de descobrir o que os outros analisaram.
     */
    await expect(
      buildAnalysisPipeline().getMetrics.execute({
        analysisId: started.id,
        requestedBy: intruso,
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
    await expect(
      buildAnalysisPipeline().start.execute({ requestedBy: ownerId, channelUrl: url }),
    ).rejects.toBeInstanceOf(InvalidChannelReferenceError);
  });

  it.each([
    ['handle', 'https://www.youtube.com/@canal-de-exemplo'],
    ['ID de canal', 'https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'],
    ['dominio movel', 'https://m.youtube.com/@canal-de-exemplo'],
  ])('aceita %s', async (_caso, url) => {
    const analysis = await buildAnalysisPipeline().start.execute({
      requestedBy: ownerId,
      channelUrl: url,
    });
    expect(analysis.status).toBe('collecting_videos');
  });
});
