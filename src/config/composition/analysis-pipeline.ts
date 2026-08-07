// Imports de `infrastructure` sao permitidos APENAS aqui (R6).
import { SupabaseAnalysisRepository } from '@/modules/channel-analysis/infrastructure/supabase/supabase-analysis-repository';
import {
  CalculateAnalysisMetrics,
  GetAnalysisMetrics,
  StartChannelAnalysis,
} from '@/modules/channel-analysis';
import { SupabaseAnalyticsResultRepository } from '@/modules/video-analytics/infrastructure/supabase/supabase-analytics-result-repository';
import {
  createFakeChannelResolver,
  createFakeYouTubeChannelSource,
} from '@/modules/youtube-collection/infrastructure/fake/fake-youtube-source';
import { SupabaseChannelDirectory } from '@/modules/youtube-collection/infrastructure/supabase/supabase-channel-directory';
import { SupabaseCollectionRunRepository } from '@/modules/youtube-collection/infrastructure/supabase/supabase-collection-run-repository';
import { YouTubeApiClient } from '@/modules/youtube-collection/infrastructure/youtube-data-api/youtube-api-client';
import { YouTubeDataApiChannelResolver } from '@/modules/youtube-collection/infrastructure/youtube-data-api/youtube-data-api-channel-resolver';
import { YouTubeDataApiChannelSource } from '@/modules/youtube-collection/infrastructure/youtube-data-api/youtube-data-api-channel-source';
import { cryptoUuidGenerator } from '@/shared/infrastructure/crypto-uuid-generator';
import { createAdminClient } from '@/shared/infrastructure/supabase/supabase-clients';
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
 * A PERSISTENCIA E SEMPRE O POSTGRES. NAO HA MODO EM MEMORIA.
 *
 * Ate a SPEC-008 os repositorios eram em memoria, porque `channel_analyses`
 * referencia `auth.users` e nao havia usuario real para a chave estrangeira
 * apontar. Com a autenticacao da SPEC-009, o bloqueio caiu.
 *
 * Os adaptadores em memoria continuam existindo e continuam sendo usados —
 * pelos TESTES, que sao a outra raiz de composicao do projeto. O que nao existe
 * e um caminho de producao que os escolha: uma analise que some ao reiniciar o
 * servidor nao e uma degradacao aceitavel, e um modo que a produza calado seria
 * pior que uma falha de configuracao.
 *
 * Por isto o Supabase e OBRIGATORIO aqui, e a falta dele falha dizendo o nome da
 * variavel que falta.
 * ---------------------------------------------------------------------------
 */

/**
 * Origem dos dados do YouTube na composicao ativa.
 *
 * Sai daqui para a tela. A apresentacao NAO decide se os dados sao reais — ela
 * exibe o que a composicao declara. Um literal na tela poderia sobreviver a
 * troca dos adaptadores e passar a mentir.
 *
 * Afirma UMA coisa: de onde vieram os numeros. Nao afirma nada sobre
 * persistencia nem sobre identidade, que nao tem modo de demonstracao.
 */
export type CompositionMode = 'demonstration' | 'live';

export interface AnalysisPipeline {
  readonly mode: CompositionMode;
  readonly start: StartChannelAnalysis;
  readonly calculateMetrics: CalculateAnalysisMetrics;
  readonly getMetrics: GetAnalysisMetrics;
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

/**
 * Monta o fluxo de analise com os adaptadores da composicao ativa.
 *
 * `ANALYSIS_FRESHNESS_HOURS` e lido AQUI, dentro de `src/config/` (R8), e chega
 * ao caso de uso como numero puro. O dominio nao le configuracao.
 */
export function buildAnalysisPipeline(): AnalysisPipeline {
  const env = getServerEnv();

  /**
   * Cliente ADMINISTRATIVO (service role), que ignora RLS.
   *
   * E o cliente correto para os tres repositorios, por dois motivos distintos:
   *
   *  - coleta e metricas sao artefatos GLOBAIS, sem policy para `authenticated`.
   *    O navegador nao os alcanca nem para leitura (ADR-005);
   *  - a analise e do usuario, mas a PROGRESSAO DE ESTADO e do servidor. O
   *    cliente autenticado pode criar uma analise em `pending` e nao pode
   *    atualiza-la — sem isso, alguem marcaria a propria analise como
   *    `completed` sem que coleta alguma tivesse acontecido.
   *
   * O preco esta registrado no ADR-005: como o RLS nao filtra, o filtro por dono
   * tem de estar no codigo. As assinaturas das portas o exigem — `findById(id,
   * ownerId)` nao aceita busca sem dono — e ha teste de integracao provando que
   * o adaptador obedece.
   */
  const supabase = createAdminClient();

  const shared = {
    clock: systemClock,
    logger: consoleLogger,
    ids: cryptoUuidGenerator,
    analyses: new SupabaseAnalysisRepository(supabase),
    collectionRuns: new SupabaseCollectionRunRepository(supabase),
  } as const;

  const analyticsResults = new SupabaseAnalyticsResultRepository(supabase);

  /**
   * A chave decide a origem dos dados.
   *
   * Ausente, a aplicacao continua subindo com o fixture — e util para trabalhar
   * na tela sem gastar quota. Presente, a coleta vai a YouTube Data API e o
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
      channelDirectory: new SupabaseChannelDirectory(supabase),
      channelResolver: collection.channelResolver,
      channelSource: collection.channelSource,
      analysisFreshnessHours: env.ANALYSIS_FRESHNESS_HOURS,
    }),
    calculateMetrics: new CalculateAnalysisMetrics({
      ...shared,
      analyticsResults,
    }),
    getMetrics: new GetAnalysisMetrics({
      analyses: shared.analyses,
      analyticsResults,
      // So e usado quando ha recorte por periodo: o filtro precisa dos videos do
      // snapshot, que o resultado ja agregado nao carrega.
      collectionRuns: shared.collectionRuns,
    }),
  };
}
