import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que este arquivo verifica: a raiz de composicao FALHA quando a persistencia
 * nao esta configurada, e declara corretamente a origem dos dados.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O TESTE DE PONTA A PONTA DO PIPELINE NAO ESTA MAIS AQUI.
 *
 * Ate a SPEC-008 a composicao montava repositorios em memoria, e o fluxo inteiro
 * cabia em um teste unitario. Desde a SPEC-009 ela monta os adaptadores do
 * Supabase — nao ha mais o que exercitar sem um banco.
 *
 * O teste nao foi descartado: ele foi para `tests/integration/analysis-pipeline.test.ts`,
 * onde roda contra o Postgres de verdade, com um usuario de verdade. Ficou mais
 * lento e ficou muito mais forte.
 *
 * O que sobra aqui e o que NAO precisa de banco — e que e, justamente, a decisao
 * de seguranca desta SPEC: sem configuracao, a aplicacao para.
 * ---------------------------------------------------------------------------
 *
 * Cada caso reimporta o modulo com `vi.resetModules()`, porque `getServerEnv`
 * guarda o resultado em cache: sem isso, o primeiro teste fixaria o ambiente
 * para todos os seguintes.
 */

/**
 * Variaveis que CADA LADO exige — e nao uma lista unica.
 *
 * A separacao e a propria decisao do ADR-005 aparecendo na configuracao:
 *
 *  - a persistencia usa a SERVICE ROLE, porque escreve em tabelas globais e
 *    precisa avancar o estado da analise, coisas que o navegador nao pode fazer;
 *  - a autenticacao usa a chave ANON, porque atua COMO o usuario e precisa
 *    respeitar o RLS.
 *
 * O pipeline nao pede a chave anon, e nao deveria mesmo: pedi-la sugeriria que
 * ele tem algum caminho atuando como usuario. Nao tem.
 */
const PIPELINE_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const AUTH_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

const ALL_SUPABASE_VARS = [...new Set([...PIPELINE_VARS, ...AUTH_VARS])];

const ORIGINAL = { ...process.env };

async function loadPipeline() {
  vi.resetModules();
  return import('./analysis-pipeline');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

/** Preenche todas as variaveis do Supabase com valores sinteticos. */
function configureSupabase(): void {
  process.env = { ...ORIGINAL };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chave-anon-de-teste';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-service-role-de-teste';
}

describe('persistencia obrigatoria', () => {
  it.each(PIPELINE_VARS)('falha nomeando %s quando ela falta', async (missing) => {
    configureSupabase();
    delete process.env[missing];

    const { buildAnalysisPipeline } = await loadPipeline();

    /**
     * A mensagem cita o NOME da variavel. Nao e cortesia: uma falha generica de
     * configuracao manda quem sobe a aplicacao procurar em tudo, e e nesse tipo
     * de investigacao que alguem "resolve" o problema desligando a verificacao.
     *
     * Nunca o VALOR — a service role e segredo, e mensagem de erro vai para log.
     */
    expect(() => buildAnalysisPipeline()).toThrow(missing);
  });

  it('nao pede a chave anon: o pipeline nunca atua como usuario', async () => {
    configureSupabase();
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { buildAnalysisPipeline } = await loadPipeline();

    // Afirmacao deliberada, e nao lacuna do teste anterior. Se um dia o pipeline
    // passar a exigir a chave anon, alguem colocou nele um caminho que atua como
    // usuario — e isso merece revisao, nao um ajuste neste teste.
    expect(() => buildAnalysisPipeline()).not.toThrow();
  });

  it('nao tem modo em memoria — a falta de banco nunca vira degradacao silenciosa', async () => {
    process.env = { ...ORIGINAL };
    for (const name of ALL_SUPABASE_VARS) delete process.env[name];

    const { buildAnalysisPipeline } = await loadPipeline();

    /**
     * A afirmacao e sobre o que NAO acontece. Uma composicao que caisse para
     * repositorios em memoria sem banco produziria analises que somem ao
     * reiniciar o servidor, sem nada na tela dizendo isso — e o defeito
     * apareceria como "minhas analises sumiram", dias depois e longe da causa.
     */
    expect(() => buildAnalysisPipeline()).toThrow();
  });
});

describe('autenticacao obrigatoria', () => {
  it.each(AUTH_VARS)('falha nomeando %s quando ela falta', async (missing) => {
    configureSupabase();
    delete process.env[missing];

    vi.resetModules();
    const { buildAuthGateway } = await import('./auth');

    /**
     * A verificacao de configuracao acontece ANTES de tocar em `cookies()` — por
     * isso este teste roda fora de uma requisicao. Nao e coincidencia: falhar
     * cedo mantem o diagnostico simples, em vez de produzir um erro do framework
     * a tres camadas de distancia da causa.
     */
    await expect(buildAuthGateway()).rejects.toThrow(missing);
  });

  it('nao tem sessao de demonstracao', async () => {
    process.env = { ...ORIGINAL };
    for (const name of ALL_SUPABASE_VARS) delete process.env[name];

    vi.resetModules();
    const { buildAuthGateway } = await import('./auth');

    /**
     * A decisao mais importante da SPEC-009 esta neste teste.
     *
     * A coleta tem modo de demonstracao e a tela avisa. A autenticacao NAO tem:
     * uma sessao falsa escolhida por engano faria de todos os visitantes o mesmo
     * usuario, com acesso as analises uns dos outros, e nada na tela denunciaria
     * isso.
     */
    await expect(buildAuthGateway()).rejects.toThrow();
  });
});

describe('origem dos dados declarada', () => {
  it('declara `demonstration` sem YOUTUBE_API_KEY', async () => {
    configureSupabase();
    delete process.env.YOUTUBE_API_KEY;

    const { buildAnalysisPipeline } = await loadPipeline();

    // A tela le ESTE campo para decidir o aviso. Um literal na tela sobreviveria
    // a troca dos adaptadores e passaria a mentir.
    expect(buildAnalysisPipeline().mode).toBe('demonstration');
  });

  it('declara `live` com YOUTUBE_API_KEY presente', async () => {
    configureSupabase();
    process.env.YOUTUBE_API_KEY = 'chave-de-teste-que-nunca-e-usada';

    const { buildAnalysisPipeline } = await loadPipeline();

    // Nenhuma chamada de rede acontece ao montar: o cliente e construido, nao
    // usado. O teste prova a DECISAO, nao a integracao.
    expect(buildAnalysisPipeline().mode).toBe('live');
  });
});

describe('montagem dos casos de uso', () => {
  it('monta os dois casos de uso e a consulta', async () => {
    configureSupabase();

    const [{ buildAnalysisPipeline }, useCases] = await Promise.all([
      loadPipeline(),
      import('@/modules/channel-analysis'),
    ]);

    const pipeline = buildAnalysisPipeline();

    expect(pipeline.start).toBeInstanceOf(useCases.StartChannelAnalysis);
    expect(pipeline.calculateMetrics).toBeInstanceOf(useCases.CalculateAnalysisMetrics);
    expect(pipeline.getMetrics).toBeInstanceOf(useCases.GetAnalysisMetrics);
  });
});
