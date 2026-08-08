import type { AnalysisId } from '@/modules/channel-analysis';
import type { Brand } from '@/shared/domain';

export type InsightReportId = Brand<string, 'InsightReportId'>;

/**
 * Relatorio textual produzido por IA.
 *
 * RN-05: fica SEPARADO dos dados objetivos. Um relatorio e interpretacao, e o
 * produto nunca pode apresenta-lo como dado oficial (RN-07). Por isso o tipo
 * carrega a procedencia — provedor, modelo, versao do prompt e data — junto com
 * o texto: a interface tem a obrigacao de exibir essa origem.
 *
 * RN-14: proibido pedir a IA qualquer numero que o sistema saiba calcular.
 * Media, mediana, frequencia e outlier vem de video-analytics e sao ENTREGUES
 * prontos a IA; ela escreve sobre eles, nao os produz.
 *
 * ---------------------------------------------------------------------------
 * NENHUM CAMPO NUMERICO, E ISSO E ESTRUTURAL.
 *
 * O esquema de saida e derivado deste tipo. Sem campo numerico, nao ha onde o
 * modelo devolver um numero como se fosse calculo seu.
 *
 * O limite honesto: isso NAO impede o modelo de escrever "cerca de 3 mil
 * visualizacoes" dentro de uma frase. Nenhum esquema impede. O que impede o
 * dano e o pedido levar os numeros prontos, para que o texto os cite em vez de
 * os estimar, e a tela exibir o relatorio separado dos paineis de metricas.
 * Ver ADR-007, decisao 4.
 * ---------------------------------------------------------------------------
 *
 * O CICLO DE TIPOS COM `channel-analysis` E DELIBERADO E E SO DE TIPOS. Os dois
 * lados usam `import type` e o TypeScript apaga os dois na compilacao — nao ha
 * aresta em tempo de execucao. A invariante que mantem isso verdade: o barrel
 * deste modulo exporta APENAS TIPOS. Ver SPEC-011, secao 5.
 */
export interface InsightReport {
  readonly id: InsightReportId;
  /** Analise a que este relatorio pertence. Um relatorio nao existe sozinho. */
  readonly analysisId: AnalysisId;

  /** Procedencia. A interface e obrigada a exibir modelo e instante. */
  readonly provider: string;
  readonly model: string;
  /**
   * Versao do texto do prompt.
   *
   * Coluna, e nao constante perdida no codigo: mudar o prompt muda o produto
   * sem mudar uma linha de regra, e dois relatorios do mesmo canal so sao
   * comparaveis se der para saber que pergunta cada um respondeu.
   */
  readonly promptVersion: string;
  readonly generatedAt: Date;

  readonly summary: string;
  readonly likelyNiche: string | null;
  readonly likelySubNiche: string | null;
  readonly titlePatterns: readonly string[];
  readonly contentOpportunities: readonly string[];
  readonly viralDependencyNotes: string | null;

  /**
   * Custo, para o controle de gasto exigido pelo modulo.
   *
   * Vem do campo `usage` da resposta — e o valor MEDIDO, nao uma estimativa.
   */
  readonly inputTokens: number;
  readonly outputTokens: number;
}
