import type { ChannelMetrics } from '@/modules/video-analytics';

import type { InsightReport } from '../../domain/insight-report';

/**
 * Entrada do relatorio.
 *
 * O tipo e a barreira contra a RN-14: repare que ele recebe `metrics` JA
 * CALCULADAS. A IA nunca ve a lista bruta de visualizacoes para "tirar a
 * media" — ela recebe os numeros prontos e escreve o texto em cima deles.
 *
 * Sem a lista bruta nao ha o que somar. A regra deixa de depender de o prompt
 * pedir bem e passa a depender do que atravessa a fronteira.
 */
export interface InsightRequest {
  readonly channelTitle: string;
  readonly channelDescription: string;
  readonly metrics: ChannelMetrics;
  readonly recentTitles: readonly string[];
}

/**
 * O que o provedor devolve.
 *
 * NAO e um `InsightReport`: falta `id`, `analysisId` e `generatedAt`. O
 * adaptador nao inventa identificador nem le o relogio — quem monta o relatorio
 * completo e o caso de uso, com o gerador de ids e o `Clock` que ja recebe.
 *
 * A procedencia vem daqui porque so o adaptador a conhece: qual provedor
 * respondeu, qual modelo serviu, e qual versao do prompt foi enviada.
 */
export type GeneratedInsight = Pick<
  InsightReport,
  | 'provider'
  | 'model'
  | 'promptVersion'
  | 'summary'
  | 'likelyNiche'
  | 'likelySubNiche'
  | 'titlePatterns'
  | 'contentOpportunities'
  | 'viralDependencyNotes'
  | 'inputTokens'
  | 'outputTokens'
>;

/**
 * Quem vai tentar, antes de tentar.
 *
 * Existe porque uma tentativa que FALHA tambem precisa ser registrada com
 * procedencia — e nesse caminho nao ha resposta de onde tira-la. Sem isto, a
 * linha de auditoria diria "desconhecido" justamente no caso em que saber qual
 * modelo falhou e o que importa.
 *
 * `model` aqui e o modelo PEDIDO. O que efetivamente serviu vem na resposta e
 * pode diferir; no caminho de falha, o pedido e tudo o que se sabe.
 */
export interface InsightGeneratorIdentity {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
}

/**
 * Porta de geracao de relatorio.
 *
 * O adaptador e responsavel por montar o prompt, validar a resposta com Zod
 * antes de devolve-la e contabilizar tokens.
 *
 * RN-09: quem chama deve tratar a falha desta porta como DEGRADACAO, nunca como
 * falha da analise. Dados objetivos ja coletados permanecem validos e a analise
 * termina em `partially_completed`.
 *
 * @throws {ExternalServiceError} Falha, recusa ou resposta invalida do provedor.
 */
export interface InsightGenerator {
  readonly identity: InsightGeneratorIdentity;

  generate(request: InsightRequest): Promise<GeneratedInsight>;
}
