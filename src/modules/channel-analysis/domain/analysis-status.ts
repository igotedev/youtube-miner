/**
 * Estados de uma analise, na ordem em que o fluxo feliz os percorre.
 *
 * `partially_completed` existe por causa da RN-09: se a coleta e as metricas
 * deram certo mas a IA falhou, a analise NAO e um fracasso — ela tem dados
 * objetivos validos e apenas nao tem relatorio.
 */
export const ANALYSIS_STATUSES = [
  'pending',
  'collecting_channel',
  'collecting_videos',
  'calculating_metrics',
  'generating_insights',
  'completed',
  'partially_completed',
  'failed',
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Estados finais: nao ha mais trabalho a fazer nesta analise. */
export const TERMINAL_ANALYSIS_STATUSES = [
  'completed',
  'partially_completed',
  'failed',
] as const satisfies readonly AnalysisStatus[];

const TERMINAL = new Set<AnalysisStatus>(TERMINAL_ANALYSIS_STATUSES);

/** Funcao pura. Ver RN-13. */
export function isTerminalStatus(status: AnalysisStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * Uma analise so pode ser reaproveitada (RN-10) se chegou ao fim com dados
 * objetivos validos. `failed` nunca serve de cache; `partially_completed` serve,
 * porque seus numeros estao corretos — falta apenas o texto da IA.
 */
export function isReusableStatus(status: AnalysisStatus): boolean {
  return status === 'completed' || status === 'partially_completed';
}

/**
 * A analise esta em ponto de calcular metricas?
 *
 * `collecting_videos` e o caminho normal: a coleta terminou. `calculating_metrics`
 * tambem passa, para que uma execucao interrompida no meio possa ser retomada
 * sem ficar presa — o calculo e deterministico e refaze-lo nao produz efeito
 * colateral.
 *
 * Qualquer outro estado significa etapa fora de ordem: ou a coleta nao acabou,
 * ou a analise ja terminou.
 */
export function canCalculateMetrics(status: AnalysisStatus): boolean {
  return status === 'collecting_videos' || status === 'calculating_metrics';
}

/**
 * A analise esta em ponto de gerar o relatorio de IA?
 *
 * `partially_completed` e o caminho normal, e a escolha merece explicacao: e um
 * estado TERMINAL. O calculo das metricas termina nele de proposito, para que
 * uma analise cujo relatorio nunca for pedido continue sendo um resultado
 * valido, e nao um trabalho pendente para sempre.
 *
 * `generating_insights` tambem passa, para que uma execucao interrompida no
 * meio da chamada externa possa ser retomada. A retomada nao gasta tokens duas
 * vezes: o caso de uso consulta o relatorio existente antes de chamar (SPEC-011,
 * secao 7).
 *
 * `completed` NAO passa: ja ha relatorio, e gerar outro seria gastar dinheiro
 * para sobrescrever o que existe.
 */
export function canGenerateInsight(status: AnalysisStatus): boolean {
  return status === 'partially_completed' || status === 'generating_insights';
}
