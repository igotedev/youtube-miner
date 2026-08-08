/**
 * Superficie publica do modulo `ai-insights`.
 *
 * ---------------------------------------------------------------------------
 * ESTE BARREL EXPORTA APENAS TIPOS, E ISSO E UMA INVARIANTE.
 *
 * `channel-analysis` importa daqui; este modulo importa `AnalysisId` de la. E
 * um ciclo entre os dois barrels — e ele e inofensivo enquanto for so de tipos:
 * os dois lados usam `import type`, o TypeScript apaga ambos na compilacao, e
 * nenhuma aresta sobrevive em tempo de execucao.
 *
 * Exportar um VALOR daqui e importa-lo em `channel-analysis` transformaria o
 * ciclo em real. Constantes e classes ficam em `infrastructure/`, que a raiz de
 * composicao alcanca por caminho explicito. Ver SPEC-011, secao 5.
 * ---------------------------------------------------------------------------
 */
export type { InsightReport, InsightReportId } from './domain/insight-report';
export type {
  GeneratedInsight,
  InsightGenerator,
  InsightGeneratorIdentity,
  InsightRequest,
} from './application/ports/insight-generator';
export type {
  InsightFailure,
  InsightReportRepository,
} from './application/ports/insight-report-repository';
