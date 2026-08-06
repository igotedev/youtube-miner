import type { ChannelMetrics } from '@/modules/video-analytics';

import type { InsightReport } from '../../domain/insight-report';

/**
 * Entrada do relatorio.
 *
 * O tipo e a barreira contra a RN-14: repare que ele recebe `metrics` JA
 * CALCULADAS. A IA nunca ve a lista bruta de visualizacoes para "tirar a
 * media" — ela recebe os numeros prontos e escreve o texto em cima deles.
 */
export interface InsightRequest {
  readonly channelTitle: string;
  readonly channelDescription: string;
  readonly metrics: ChannelMetrics;
  readonly recentTitles: readonly string[];
}

/**
 * Porta de geracao de relatorio.
 *
 * O adaptador Claude sera escrito na SPEC de insights e sera responsavel por
 * montar o prompt, validar a resposta com Zod antes de devolver e contabilizar
 * tokens.
 *
 * RN-09: quem chama deve tratar a falha desta porta como DEGRADACAO, nunca como
 * falha da analise. Dados objetivos ja coletados permanecem validos e a analise
 * termina em `partially_completed`.
 *
 * @throws {ExternalServiceError} Falha ou resposta invalida do provedor.
 */
export interface InsightGenerator {
  generate(request: InsightRequest): Promise<InsightReport>;
}
