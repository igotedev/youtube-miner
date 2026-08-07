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
 * Modo da composicao ativa.
 *
 * Sai daqui para a tela. A apresentacao NAO decide se os dados sao reais — ela
 * exibe o que a composicao declara. Um literal na tela poderia sobreviver a
 * troca dos adaptadores e passar a mentir.
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

  return {
    mode: 'demonstration',
    start: new StartChannelAnalysis({
      ...shared,
      channelResolver: createFakeChannelResolver(),
      channelSource: createFakeYouTubeChannelSource(),
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
