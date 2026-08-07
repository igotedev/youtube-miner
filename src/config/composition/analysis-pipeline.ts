import type { UserId } from '@/modules/identity';
// Imports de `infrastructure` sao permitidos APENAS aqui (R6).
import { InMemoryAnalysisRepository } from '@/modules/channel-analysis/infrastructure/memory/in-memory-analysis-repository';
import {
  CalculateAnalysisMetrics,
  GetAnalysisMetrics,
  StartChannelAnalysis,
} from '@/modules/channel-analysis';
import { InMemoryAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/memory/in-memory-analytics-result-repository';
import {
  createFakeChannelResolver,
  createFakeYouTubeChannelSource,
} from '@/modules/youtube-collection/infrastructure/fake/fake-youtube-source';
import { InMemoryCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/memory/in-memory-collection-run-repository';
import { YouTubeApiClient } from '@/modules/youtube-collection/infrastructure/youtube-data-api/youtube-api-client';
import { YouTubeDataApiChannelResolver } from '@/modules/youtube-collection/infrastructure/youtube-data-api/youtube-data-api-channel-resolver';
import { YouTubeDataApiChannelSource } from '@/modules/youtube-collection/infrastructure/youtube-data-api/youtube-data-api-channel-source';
import { cryptoUuidGenerator } from '@/shared/infrastructure/crypto-uuid-generator';
import { systemClock } from '@/shared/infrastructure/system-clock';
import { consoleLogger } from '@/shared/observability';

import { getServerEnv } from '../env';

/**
 * Raiz de composicao do fluxo de analise.
 *
 * Unico ponto do codigo de PRODUCAO autorizado a importar `infrastructure` e a
 * instanciar adaptadores (R6). Quem consome — Server Action, rota, worker — pede
 * um caso de uso pronto e nunca sabe qual adaptador esta por tras.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A COMPOSICAO E DE DEMONSTRACAO, E NAO SUPABASE.
 *
 * Os adaptadores Supabase existem desde a SPEC-004 e NAO sao montados aqui de
 * proposito: a migracao daquela SPEC nunca foi executada (Docker indisponivel no
 * ambiente). Ligar `SupabaseAnalysisRepository` criaria um caminho de producao
 * que ninguem consegue exercitar — uma afirmacao sem verificacao empilhada sobre
 * outra.
 *
 * Quando o banco puder ser validado, a troca acontece NESTE arquivo e em mais
 * nenhum. Nenhum caso de uso muda: e para isso que as portas existem.
 * ---------------------------------------------------------------------------
 */

/**
 * Origem dos dados na composicao ativa.
 *
 * Sai daqui para a tela. A apresentacao NAO decide se os dados sao reais — ela
 * exibe o que a composicao declara. Um literal na tela poderia sobreviver a
 * troca dos adaptadores e passar a mentir.
 *
 * `live` afirma UMA coisa: os numeros vieram da YouTube Data API. Nao afirma
 * nada sobre persistencia, que continua em memoria ate o banco entrar.
 */
export type CompositionMode = 'demonstration' | 'live';

/**
 * Dono das analises enquanto nao existe autenticacao.
 *
 * UUID fixo e obviamente ficticio. Nao representa pessoa alguma e desaparece
 * quando a SPEC de identidade entrar.
 */
export const DEMONSTRATION_USER_ID = '00000000-0000-4000-8000-000000000001' as UserId;

export interface AnalysisPipeline {
  readonly mode: CompositionMode;
  readonly start: StartChannelAnalysis;
  readonly calculateMetrics: CalculateAnalysisMetrics;
  readonly getMetrics: GetAnalysisMetrics;
}

/**
 * Adaptadores que precisam sobreviver entre requisicoes.
 *
 * `StartChannelAnalysis` e `CalculateAnalysisMetrics` sao invocacoes separadas e
 * precisam enxergar os MESMOS repositorios: a analise criada na primeira tem de
 * ser encontravel na segunda.
 *
 * Guardado em `globalThis`, e nao em variavel de modulo, porque o `next dev`
 * recarrega modulos a quente — uma variavel de modulo seria zerada a cada
 * edicao e a analise sumiria entre as duas chamadas.
 *
 * O estado e DO PROCESSO: reiniciar o servidor apaga tudo. Aceitavel numa
 * composicao de demonstracao, e deixa de existir quando o Supabase entrar.
 */
interface InMemoryStores {
  readonly analyses: InMemoryAnalysisRepository;
  readonly collectionRuns: InMemoryCollectionRunRepository;
  readonly analyticsResults: InMemoryAnalyticsResultRepository;
}

const STORES_KEY = Symbol.for('niche-miner.demonstration-stores');

type GlobalWithStores = typeof globalThis & {
  [STORES_KEY]?: InMemoryStores;
};

function getStores(): InMemoryStores {
  const scope = globalThis as GlobalWithStores;

  const existing = scope[STORES_KEY];
  if (existing !== undefined) return existing;

  const created: InMemoryStores = {
    analyses: new InMemoryAnalysisRepository(),
    collectionRuns: new InMemoryCollectionRunRepository(),
    analyticsResults: new InMemoryAnalyticsResultRepository(),
  };
  scope[STORES_KEY] = created;
  return created;
}

/**
 * Monta a coleta contra a YouTube Data API v3.
 *
 * O cliente e criado por chamada, e nao guardado: ele carrega o contador de
 * quota do processo, e um contador compartilhado entre requisicoes exigiria
 * decidir quando zera-lo. O freio real e diario e mora no Google; este e local
 * e existe so para que um defeito em laco nao queime a cota do dia.
 */
function buildLiveCollection(apiKey: string, dailyQuotaLimit: number) {
  const client = new YouTubeApiClient({
    apiKey,
    logger: consoleLogger,
    dailyQuotaLimit,
  });

  return {
    mode: 'live' as const,
    channelResolver: new YouTubeDataApiChannelResolver(client),
    channelSource: new YouTubeDataApiChannelSource(client, consoleLogger),
  };
}

/** Descarta o estado acumulado. Existe para teste; nao ha chamador em producao. */
export function resetDemonstrationStores(): void {
  const scope = globalThis as GlobalWithStores;
  delete scope[STORES_KEY];
}

/**
 * Monta o fluxo de analise com os adaptadores da composicao ativa.
 *
 * `ANALYSIS_FRESHNESS_HOURS` e lido AQUI, dentro de `src/config/` (R8), e chega
 * ao caso de uso como numero puro. O dominio nao le configuracao.
 */
export function buildAnalysisPipeline(): AnalysisPipeline {
  const env = getServerEnv();
  const stores = getStores();

  const shared = {
    clock: systemClock,
    logger: consoleLogger,
    ids: cryptoUuidGenerator,
    analyses: stores.analyses,
    collectionRuns: stores.collectionRuns,
  } as const;

  /**
   * A chave decide a origem dos dados.
   *
   * Ausente, a aplicacao continua subindo com o fixture — o projeto tem de
   * rodar sem chave nenhuma. Presente, a coleta vai a YouTube Data API e o
   * aviso de demonstracao some da tela, porque deixa de ser verdade.
   */
  const apiKey = env.YOUTUBE_API_KEY;
  const collection =
    apiKey === undefined
      ? {
          mode: 'demonstration' as const,
          channelResolver: createFakeChannelResolver(),
          channelSource: createFakeYouTubeChannelSource(),
        }
      : buildLiveCollection(apiKey, env.YOUTUBE_DAILY_QUOTA_LIMIT);

  return {
    mode: collection.mode,
    start: new StartChannelAnalysis({
      ...shared,
      channelResolver: collection.channelResolver,
      channelSource: collection.channelSource,
      analysisFreshnessHours: env.ANALYSIS_FRESHNESS_HOURS,
    }),
    calculateMetrics: new CalculateAnalysisMetrics({
      ...shared,
      analyticsResults: stores.analyticsResults,
    }),
    getMetrics: new GetAnalysisMetrics({
      analyses: stores.analyses,
      analyticsResults: stores.analyticsResults,
    }),
  };
}
