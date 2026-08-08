import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { InsightReport, InsightReportId } from '@/modules/ai-insights';
import { SupabaseInsightReportRepository } from '@/modules/ai-insights/infrastructure/supabase/supabase-insight-report-repository';
import { fromInsightReport as fromInsightReportRow } from '@/modules/ai-insights/infrastructure/supabase/insight-report-row';
import type { Analysis, AnalysisId } from '@/modules/channel-analysis';
import { SupabaseAnalysisRepository } from '@/modules/channel-analysis/infrastructure/supabase/supabase-analysis-repository';
import type { UserId } from '@/modules/identity';
import type { AnalyticsResult, AnalyticsResultId } from '@/modules/video-analytics';
import { ANALYTICS_ALGORITHM_VERSION, calculateChannelMetrics } from '@/modules/video-analytics';
import type { AnalyticsVideo } from '@/modules/video-analytics';
import { SupabaseAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/supabase/supabase-analytics-result-repository';
import type {
  CollectionRun,
  CollectionRunId,
  YouTubeChannelId,
  YouTubeVideoId,
} from '@/modules/youtube-collection';
import { SupabaseChannelDirectory } from '@/modules/youtube-collection/infrastructure/supabase/supabase-channel-directory';
import { SupabaseCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/supabase/supabase-collection-run-repository';
import { ConflictError, NotFoundError } from '@/shared/errors';
import { createAdminClient } from '@/shared/infrastructure/supabase/supabase-clients';

/**
 * Testes de INTEGRACAO da persistencia da analise (SPEC-009).
 *
 * Exigem `npm run db:start`. Fora de `npm run verify` de proposito.
 *
 * ---------------------------------------------------------------------------
 * O QUE SO APARECE AQUI.
 *
 * `channel_analyses.user_id` e `not null references auth.users (id)`. Nenhum
 * teste em memoria toca nisso: o repositorio falso aceita qualquer string como
 * dono. Foi exatamente essa chave estrangeira que manteve a persistencia
 * desligada ate a autenticacao existir.
 *
 * Por isso estes testes criam um USUARIO DE VERDADE pela API administrativa do
 * Supabase Auth, e nao um UUID inventado. Se a FK, a cascata ou o trigger que
 * cria o `profile` estiverem errados, quebra aqui.
 *
 * Tambem so aparece aqui: o indice unico parcial de idempotencia, a unicidade
 * por (coleta, versao) das metricas, e o percurso do `jsonb` de metricas pelo
 * driver — inclusive a data de dentro dele.
 * ---------------------------------------------------------------------------
 */

const client = createAdminClient();

const analyses = new SupabaseAnalysisRepository(client);
const analyticsResults = new SupabaseAnalyticsResultRepository(client);
const collectionRuns = new SupabaseCollectionRunRepository(client);

const COLLECTED_AT = new Date('2026-07-30T10:00:30.000Z');
const CALCULATED_AT = new Date('2026-07-30T10:00:45.000Z');
const REQUESTED_AT = new Date('2026-07-30T10:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function makeChannelId(): YouTubeChannelId {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 22);
  return `UC${suffix}` as YouTubeChannelId;
}

/**
 * Cria um usuario real em `auth.users`.
 *
 * `email_confirm` evita o envio de e-mail: o teste nao depende de entrega, so
 * da linha existir para a chave estrangeira apontar.
 */
async function createUser(): Promise<UserId> {
  const email = `teste-${randomUUID()}@exemplo.test`;
  const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true });

  if (error !== null || data.user === null) {
    throw new Error(`Nao foi possivel criar usuario de teste: ${error?.message ?? 'sem usuario'}`);
  }
  return data.user.id as UserId;
}

function buildVideos(): AnalyticsVideo[] {
  return [
    {
      id: 'vid_a' as YouTubeVideoId,
      format: 'long',
      publishedAt: new Date(COLLECTED_AT.getTime() - 10 * MS_PER_DAY),
      viewCount: 100,
    },
    {
      id: 'vid_b' as YouTubeVideoId,
      format: 'short',
      publishedAt: new Date(COLLECTED_AT.getTime() - 3 * MS_PER_DAY),
      // RN-08: ausente de proposito. Nao pode virar zero na ida e volta.
      viewCount: null,
    },
  ];
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

function buildAnalysis(
  ownerId: UserId,
  channelId: YouTubeChannelId,
  patch: Partial<Analysis> = {},
): Analysis {
  return {
    id: randomUUID() as AnalysisId,
    requestedBy: ownerId,
    channelId,
    requestedUrl: `https://www.youtube.com/channel/${channelId}`,
    status: 'pending',
    collectionRunId: null,
    analyticsResultId: null,
    idempotencyKey: null,
    requestedAt: REQUESTED_AT,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    ...patch,
  };
}

function buildResult(collectionRunId: CollectionRunId): AnalyticsResult {
  return {
    id: randomUUID() as AnalyticsResultId,
    collectionRunId,
    algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
    calculatedAt: CALCULATED_AT,
    metrics: calculateChannelMetrics({ videos: buildVideos(), collectedAt: COLLECTED_AT }),
  };
}

const createdChannels: YouTubeChannelId[] = [];
const createdUsers: UserId[] = [];

let ownerId: UserId;
let channelId: YouTubeChannelId;

beforeAll(async () => {
  const { error } = await client.from('channel_analyses').select('id').limit(1);
  if (error !== null) {
    throw new Error(
      `Supabase local inacessivel. Rode \`npm run db:start\` antes. Detalhe: ${error.message}`,
    );
  }

  ownerId = await createUser();
  createdUsers.push(ownerId);
});

afterAll(async () => {
  // Ordem importa: analises referenciam o canal com `on delete restrict`.
  // Apagar o usuario primeiro leva as analises junto pela cascata; so entao o
  // canal fica livre.
  for (const userId of createdUsers) {
    await client.auth.admin.deleteUser(userId);
  }
  for (const id of createdChannels) {
    await client.from('youtube_channels').delete().eq('youtube_channel_id', id);
  }
});

/** Registra o canal criando uma execucao de coleta — o caminho real. */
async function registerChannel(): Promise<YouTubeChannelId> {
  const id = makeChannelId();
  createdChannels.push(id);
  await collectionRuns.startRun(buildRun(id));
  return id;
}

beforeEach(async () => {
  channelId = await registerChannel();
});

describe('create', () => {
  it('grava a analise com um usuario real', async () => {
    const analysis = buildAnalysis(ownerId, channelId);

    await analyses.create(analysis);

    expect(await analyses.findById(analysis.id, ownerId)).toEqual(analysis);
  });

  it('recusa dono inexistente — a chave estrangeira com auth.users e real', async () => {
    // O UUID abaixo tem o formato certo e nao existe em `auth.users`. E
    // exatamente o que o DEMONSTRATION_USER_ID era ate a SPEC-009: bem formado e
    // sem correspondente. Este teste e a prova de que ligar a persistencia antes
    // da autenticacao teria falhado na primeira analise.
    const fantasma = '00000000-0000-4000-8000-000000000001' as UserId;

    // `NotFoundError` especificamente, e nao "lancou alguma coisa": e assim que
    // `translatePostgresError` traduz uma violacao de chave estrangeira (23503).
    // Uma asercao generica passaria tambem se o erro fosse de conexao, e o teste
    // deixaria de provar o que diz provar.
    await expect(analyses.create(buildAnalysis(fantasma, channelId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('recusa a segunda analise com a mesma chave de idempotencia', async () => {
    const key = `idem-${randomUUID()}`;

    await analyses.create(buildAnalysis(ownerId, channelId, { idempotencyKey: key }));

    await expect(
      analyses.create(buildAnalysis(ownerId, channelId, { idempotencyKey: key })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('permite a mesma chave de idempotencia para OUTRO usuario', async () => {
    // O indice e `(user_id, idempotency_key)`. Se fosse so pela chave, a
    // requisicao de uma pessoa bloquearia a de outra.
    const outro = await createUser();
    createdUsers.push(outro);
    const key = `idem-${randomUUID()}`;

    await analyses.create(buildAnalysis(ownerId, channelId, { idempotencyKey: key }));
    await analyses.create(buildAnalysis(outro, channelId, { idempotencyKey: key }));

    expect(await analyses.findByIdempotencyKey(ownerId, key)).not.toBeNull();
    expect(await analyses.findByIdempotencyKey(outro, key)).not.toBeNull();
  });

  it('nao colide entre duas analises SEM chave', async () => {
    // O indice e parcial (`where idempotency_key is not null`). Sem isso, duas
    // analises com `null` colidiriam e o caso comum seria o quebrado.
    await analyses.create(buildAnalysis(ownerId, channelId));
    await analyses.create(buildAnalysis(ownerId, channelId));

    expect(await analyses.listByChannel(ownerId, channelId)).toHaveLength(2);
  });
});

describe('isolamento entre usuarios', () => {
  it('nao devolve a analise de outra pessoa', async () => {
    const intruso = await createUser();
    createdUsers.push(intruso);

    const analysis = buildAnalysis(ownerId, channelId);
    await analyses.create(analysis);

    // O cliente e o ADMINISTRATIVO, que ignora RLS. Se isto devolvesse a
    // analise, o isolamento estaria dependendo so da policy — e o adaptador
    // seria o furo. O filtro por dono no codigo e a primeira camada.
    expect(await analyses.findById(analysis.id, intruso)).toBeNull();
  });

  it('nao devolve a analise de outra pessoa por chave de idempotencia', async () => {
    const intruso = await createUser();
    createdUsers.push(intruso);
    const key = `idem-${randomUUID()}`;

    await analyses.create(buildAnalysis(ownerId, channelId, { idempotencyKey: key }));

    expect(await analyses.findByIdempotencyKey(intruso, key)).toBeNull();
  });

  it('lista apenas as analises do proprio usuario para o canal', async () => {
    const outro = await createUser();
    createdUsers.push(outro);

    await analyses.create(buildAnalysis(ownerId, channelId));
    await analyses.create(buildAnalysis(outro, channelId));

    expect(await analyses.listByChannel(ownerId, channelId)).toHaveLength(1);
    expect(await analyses.listByChannel(outro, channelId)).toHaveLength(1);
  });
});

describe('save', () => {
  it('avanca o estado e grava os carimbos', async () => {
    const analysis = buildAnalysis(ownerId, channelId);
    await analyses.create(analysis);

    const started: Analysis = {
      ...analysis,
      status: 'collecting_channel',
      startedAt: new Date('2026-07-30T10:00:05.000Z'),
    };
    await analyses.save(started);

    expect(await analyses.findById(analysis.id, ownerId)).toEqual(started);
  });

  it('nao deixa um usuario alterar a analise de outro', async () => {
    const intruso = await createUser();
    createdUsers.push(intruso);

    const analysis = buildAnalysis(ownerId, channelId);
    await analyses.create(analysis);

    // `save` filtra por `id` E `user_id`. Com o dono trocado, o UPDATE nao
    // alcanca linha nenhuma — e a analise original tem de continuar intacta.
    await analyses.save({ ...analysis, requestedBy: intruso, status: 'failed' });

    const stored = await analyses.findById(analysis.id, ownerId);
    expect(stored?.status).toBe('pending');
  });

  it('liga a analise a coleta e ao resultado de metricas', async () => {
    const run = buildRun(channelId);
    // A analise aponta para artefatos GLOBAIS. Este teste prova que as duas FKs
    // opcionais aceitam os ids reais e voltam iguais.
    await collectionRuns.save({ ...run, status: 'failed', failedAt: COLLECTED_AT });

    const analysis = buildAnalysis(ownerId, channelId);
    await analyses.create(analysis);

    const existingRun = await collectionRuns.findActiveForChannel(channelId);
    expect(existingRun).not.toBeNull();

    const result = buildResult(existingRun!.id);
    await analyticsResults.save(result);

    const linked: Analysis = {
      ...analysis,
      status: 'partially_completed',
      collectionRunId: existingRun!.id,
      analyticsResultId: result.id,
      completedAt: CALCULATED_AT,
    };
    await analyses.save(linked);

    expect(await analyses.findById(analysis.id, ownerId)).toEqual(linked);
  });
});

describe('resultados de metricas', () => {
  let runId: CollectionRunId;

  beforeEach(async () => {
    const active = await collectionRuns.findActiveForChannel(channelId);
    if (active === null) throw new Error('A execucao criada no beforeEach sumiu.');
    runId = active.id;
  });

  it('reconstroi as metricas identicas, com as datas como Date', async () => {
    const result = buildResult(runId);
    await analyticsResults.save(result);

    const stored = await analyticsResults.findById(result.id);

    expect(stored).toEqual(result);
    expect(stored?.calculatedAt).toBeInstanceOf(Date);
    // A data DE DENTRO do jsonb. O driver a entrega como string; se o mapeador
    // nao a reconstruir, o calculo de idade dos videos passa a operar sobre
    // texto e produz NaN muito longe daqui.
    expect(stored?.metrics.collectedAt).toBeInstanceOf(Date);
    expect(stored?.metrics.collectedAt).toEqual(COLLECTED_AT);
  });

  it('preserva ausencia como null atravessando o jsonb (RN-08)', async () => {
    const result = buildResult(runId);
    await analyticsResults.save(result);

    const stored = await analyticsResults.findById(result.id);
    const shorts = stored?.metrics.shorts;

    // O unico Short do fixture nao tem contagem de visualizacoes. A media do
    // formato precisa voltar `null` — nunca `0`, que afirmaria que o video foi
    // publicado e ninguem viu.
    expect(shorts?.videoCount).toBe(1);
    expect(shorts?.videosWithoutViewCount).toBe(1);
    expect(shorts?.viewCount.average).toBeNull();
    expect(shorts?.viewCount.median).toBeNull();
  });

  it('nao mistura Shorts com videos longos (RN-06)', async () => {
    const result = buildResult(runId);
    await analyticsResults.save(result);

    const stored = await analyticsResults.findById(result.id);

    expect(stored?.metrics.long.videoCount).toBe(1);
    expect(stored?.metrics.long.viewCount.average).toBe(100);
    expect(stored?.metrics.shorts.videoCount).toBe(1);
  });

  it('encontra o resultado pela coleta e versao', async () => {
    const result = buildResult(runId);
    await analyticsResults.save(result);

    const found = await analyticsResults.findByCollectionRunAndVersion(
      runId,
      ANALYTICS_ALGORITHM_VERSION,
    );

    expect(found?.id).toBe(result.id);
  });

  it('devolve null para uma versao que nunca foi calculada', async () => {
    await analyticsResults.save(buildResult(runId));

    expect(await analyticsResults.findByCollectionRunAndVersion(runId, '99.0.0')).toBeNull();
  });

  it('recusa dois resultados para a mesma coleta e versao', async () => {
    await analyticsResults.save(buildResult(runId));

    await expect(analyticsResults.save(buildResult(runId))).rejects.toBeInstanceOf(ConflictError);
  });

  it('aceita a mesma coleta em versoes diferentes lado a lado', async () => {
    // E o que permite comparar o efeito de uma mudanca de regra sem recoletar
    // nada — o motivo de a chave ser (coleta, versao) e nao so a coleta.
    const primeira = buildResult(runId);
    const segunda: AnalyticsResult = {
      ...buildResult(runId),
      id: randomUUID() as AnalyticsResultId,
      algorithmVersion: '2.0.0',
    };

    await analyticsResults.save(primeira);
    await analyticsResults.save(segunda);

    expect(await analyticsResults.findByCollectionRunAndVersion(runId, '2.0.0')).not.toBeNull();
    expect(
      await analyticsResults.findByCollectionRunAndVersion(runId, ANALYTICS_ALGORITHM_VERSION),
    ).not.toBeNull();
  });
});

describe('remocao do usuario', () => {
  it('apaga as analises e preserva os artefatos globais', async () => {
    const efemero = await createUser();
    const analysis = buildAnalysis(efemero, channelId);
    await analyses.create(analysis);

    const run = await collectionRuns.findActiveForChannel(channelId);
    expect(run).not.toBeNull();

    await client.auth.admin.deleteUser(efemero);

    // A analise vai junto (`on delete cascade`)...
    expect(await analyses.findById(analysis.id, efemero)).toBeNull();
    // ...e a coleta, que e global e pode servir a outra pessoa, permanece.
    expect(await collectionRuns.findById(run!.id)).not.toBeNull();
  });
});

/**
 * Historico de analises (SPEC-010).
 *
 * ---------------------------------------------------------------------------
 * O QUE SO APARECE AQUI.
 *
 * O fake ordena e corta em JavaScript. O adaptador real traduz as duas coisas em
 * `order` + `limit`, que viram SQL e passam pelo indice
 * `channel_analyses_user_requested_idx`. Sao implementacoes DIFERENTES do mesmo
 * contrato, e so a execucao contra o Postgres mostra se elas concordam.
 *
 * O isolamento por usuario tambem: o repositorio e construido com o cliente
 * ADMINISTRATIVO, que ignora RLS. Se o `.eq('user_id', ...)` sumisse do codigo,
 * nenhum teste em memoria notaria e a policy nao seguraria.
 * ---------------------------------------------------------------------------
 */
describe('listByOwner', () => {
  it('devolve lista vazia para quem nunca analisou nada', async () => {
    const novato = await createUser();
    createdUsers.push(novato);

    expect(await analyses.listByOwner(novato, 50)).toEqual([]);
  });

  it('ordena da mais recente para a mais antiga', async () => {
    const dono = await createUser();
    createdUsers.push(dono);

    const antiga = buildAnalysis(dono, channelId, {
      requestedAt: new Date(REQUESTED_AT.getTime() - 2 * MS_PER_DAY),
    });
    const nova = buildAnalysis(dono, channelId, {
      requestedAt: new Date(REQUESTED_AT.getTime() + 2 * MS_PER_DAY),
    });
    const media = buildAnalysis(dono, channelId);

    // Gravadas fora de ordem: a ordem do resultado nao pode depender da ordem de
    // insercao nem do plano que o Postgres escolher.
    await analyses.create(media);
    await analyses.create(nova);
    await analyses.create(antiga);

    const found = await analyses.listByOwner(dono, 50);

    expect(found.map((analysis) => analysis.id)).toEqual([nova.id, media.id, antiga.id]);
  });

  it('respeita o teto e corta as mais antigas', async () => {
    const dono = await createUser();
    createdUsers.push(dono);

    const nova = buildAnalysis(dono, channelId, {
      requestedAt: new Date(REQUESTED_AT.getTime() + MS_PER_DAY),
    });
    await analyses.create(buildAnalysis(dono, channelId));
    await analyses.create(nova);

    const found = await analyses.listByOwner(dono, 1);

    // O `limit` do SQL corta DEPOIS do `order by`. Se a ordem fosse aplicada em
    // memoria, este teste devolveria a analise errada.
    expect(found.map((analysis) => analysis.id)).toEqual([nova.id]);
  });

  it('nunca devolve analise de outro usuario', async () => {
    const dono = await createUser();
    const estranho = await createUser();
    createdUsers.push(dono, estranho);

    const minha = buildAnalysis(dono, channelId);
    // A alheia e a MAIS RECENTE: sem o filtro por dono ela viria primeiro.
    const alheia = buildAnalysis(estranho, channelId, {
      requestedAt: new Date(REQUESTED_AT.getTime() + MS_PER_DAY),
    });

    await analyses.create(minha);
    await analyses.create(alheia);

    const found = await analyses.listByOwner(dono, 50);

    expect(found.map((analysis) => analysis.id)).toEqual([minha.id]);
  });
});

describe('ChannelDirectory.findSummaries', () => {
  const directory = new SupabaseChannelDirectory(client);

  it('devolve titulo nulo para canal registrado sem coleta concluida', async () => {
    // `registerChannel` cria a linha via `startRun` — exatamente o estado em que
    // uma analise que falhou na coleta deixa o canal.
    const [summary] = await directory.findSummaries([channelId]);

    expect(summary).toEqual({ id: channelId, title: null, handle: null });
  });

  it('busca varios canais em uma consulta e omite o que nao existe', async () => {
    const outro = await registerChannel();
    const inexistente = makeChannelId();

    const found = await directory.findSummaries([channelId, outro, inexistente]);

    // O ausente simplesmente nao vem. Nao e erro: uma analise orfa nao pode
    // derrubar a lista inteira.
    expect(found.map((summary) => summary.id).sort()).toEqual([channelId, outro].sort());
  });

  it('nao vai ao banco quando nada e pedido', async () => {
    expect(await directory.findSummaries([])).toEqual([]);
  });
});

/**
 * Relatorio de IA (SPEC-011).
 *
 * ---------------------------------------------------------------------------
 * O QUE SO APARECE AQUI.
 *
 * A tabela `ai_insight_reports` tem quatro `check` que nenhum teste em memoria
 * exerce: `status` de conjunto fechado, `report` obrigatorio quando concluido,
 * `report` tem de ser objeto JSON, e tokens nao negativos. O fake aceita
 * qualquer coisa; o Postgres nao.
 *
 * E a cascata: apagar a analise leva o relatorio junto, e essa e a diferenca
 * entre um artefato do USUARIO e um artefato global (ADR-005).
 * ---------------------------------------------------------------------------
 */
describe('relatorio de IA', () => {
  const insightReports = new SupabaseInsightReportRepository(client);

  /**
   * Analise em `partially_completed` — o estado de onde a geracao parte.
   *
   * Sem `collectionRunId`: o relatorio nao referencia a coleta, e inventar um
   * identificador aqui so exercitaria a chave estrangeira da coleta, que ja tem
   * teste proprio.
   */
  async function analisePronta(dono: UserId): Promise<Analysis> {
    const analysis = buildAnalysis(dono, channelId, { status: 'partially_completed' });
    await analyses.create(analysis);
    return analysis;
  }

  function buildReport(analysisId: AnalysisId, patch: Partial<InsightReport> = {}): InsightReport {
    return {
      id: randomUUID() as InsightReportId,
      analysisId,
      provider: 'google',
      model: 'gemini-3.6-flash',
      promptVersion: '1.0.0',
      generatedAt: CALCULATED_AT,
      summary: 'O canal publica com cadencia regular.',
      likelyNiche: 'Financas pessoais',
      likelySubNiche: null,
      titlePatterns: ['Pergunta direta no titulo'],
      contentOpportunities: [],
      viralDependencyNotes: null,
      inputTokens: 1500,
      outputTokens: 800,
      ...patch,
    };
  }

  it('grava e le o relatorio inteiro, com nulos e listas vazias', async () => {
    const analysis = await analisePronta(ownerId);
    const report = buildReport(analysis.id);

    await insightReports.save(report);

    // A ida e volta passa pelo `jsonb` e pelo driver. `null` tem de continuar
    // `null`, e lista vazia tem de continuar lista vazia.
    expect(await insightReports.findByAnalysis(analysis.id, ownerId)).toEqual(report);
  });

  it('o relatorio de outro usuario nunca volta', async () => {
    const estranho = await createUser();
    createdUsers.push(estranho);

    const analysis = await analisePronta(ownerId);
    await insightReports.save(buildReport(analysis.id));

    // A tabela NAO tem user_id: o dono vem pelo join com channel_analyses. Este
    // e o unico lugar que prova que aquele join filtra de verdade — o fake em
    // memoria usa um mapa proprio e nao exercita SQL nenhum.
    expect(await insightReports.findByAnalysis(analysis.id, estranho)).toBeNull();
    expect(await insightReports.findByAnalysis(analysis.id, ownerId)).not.toBeNull();
  });

  it('analise sem relatorio devolve null', async () => {
    const analysis = await analisePronta(ownerId);

    expect(await insightReports.findByAnalysis(analysis.id, ownerId)).toBeNull();
  });

  it('tentativa falha e gravada e NAO volta como relatorio', async () => {
    const analysis = await analisePronta(ownerId);

    await insightReports.saveFailure({
      analysisId: analysis.id,
      provider: 'google',
      model: 'gemini-3.6-flash',
      promptVersion: '1.0.0',
      failedAt: CALCULATED_AT,
      errorCode: 'EXTERNAL_SERVICE_ERROR',
    });

    // A linha existe para auditoria...
    const { data } = await client
      .from('ai_insight_reports')
      .select('status, error_code')
      .eq('analysis_id', analysis.id);
    expect(data).toHaveLength(1);

    // ...e a leitura de relatorio nao a alcanca. Se alcancasse, a tela exibiria
    // um bloco vazio como se fosse resultado.
    expect(await insightReports.findByAnalysis(analysis.id, ownerId)).toBeNull();
  });

  it('o banco recusa relatorio concluido sem texto', async () => {
    const analysis = await analisePronta(ownerId);

    // `ai_insight_reports_completed_has_report`. E a garantia que impede um
    // relatorio vazio de existir como concluido — nenhum teste em memoria a ve.
    const { error } = await client.from('ai_insight_reports').insert({
      analysis_id: analysis.id,
      status: 'completed',
      provider: 'google',
      model: 'gemini-3.6-flash',
      prompt_version: '1.0.0',
      report: null,
      completed_at: CALCULATED_AT.toISOString(),
    });

    expect(error).not.toBeNull();
  });

  it('o banco recusa contagem de tokens negativa', async () => {
    const analysis = await analisePronta(ownerId);

    const { error } = await client
      .from('ai_insight_reports')
      .insert({ ...fromInsightReportRow(buildReport(analysis.id)), input_tokens: -1 });

    expect(error).not.toBeNull();
  });

  it('apagar a analise leva o relatorio junto', async () => {
    const efemero = await createUser();
    createdUsers.push(efemero);

    const analysis = await analisePronta(efemero);
    await insightReports.save(buildReport(analysis.id));

    await client.auth.admin.deleteUser(efemero);

    // `on delete cascade` pela analise, que por sua vez cascateia do usuario.
    // O relatorio e do USUARIO — diferente da coleta, que e global e permanece.
    const { data } = await client
      .from('ai_insight_reports')
      .select('id')
      .eq('analysis_id', analysis.id);
    expect(data).toEqual([]);
  });
});
