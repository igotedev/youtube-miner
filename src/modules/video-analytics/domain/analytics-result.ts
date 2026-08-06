import type { CollectionRunId } from '@/modules/youtube-collection';
import type { Brand } from '@/shared/domain';

import type { ChannelMetrics } from './channel-metrics';

export type AnalyticsResultId = Brand<string, 'AnalyticsResultId'>;

/**
 * Versao do algoritmo de metricas.
 *
 * Muda sempre que uma formula, um limite de outlier ou o formato de
 * `ChannelMetrics` mudar. A mesma coleta pode ter resultados de varias versoes
 * guardados lado a lado — e assim que se compara o efeito de uma mudanca de
 * regra sem recoletar nada e sem gastar quota.
 *
 * Formato `MAJOR.MINOR.PATCH`, verificado pelo mapeador de persistencia.
 */
export const ANALYTICS_ALGORITHM_VERSION = '1.0.0';

/**
 * Resultado deterministico do motor da SPEC-003, ja persistivel.
 *
 * ARTEFATO GLOBAL, como a coleta que o originou: as metricas dependem apenas
 * dos dados publicos e da versao do algoritmo, nunca de quem pediu a analise.
 * Duas analises de usuarios diferentes sobre a mesma coleta apontam para o
 * mesmo resultado. Ver ADR-005.
 *
 * RN-04: fica separado do payload bruto. RN-05: fica separado do relatorio de IA.
 */
export interface AnalyticsResult {
  readonly id: AnalyticsResultId;
  readonly collectionRunId: CollectionRunId;
  readonly algorithmVersion: string;
  /** Quando o CALCULO rodou. Nao confundir com `metrics.collectedAt`, que e quando os dados foram lidos da API. */
  readonly calculatedAt: Date;
  readonly metrics: ChannelMetrics;
}
