/**
 * Superficie publica da raiz de composicao.
 *
 * Quem consome importa `@/config/composition` e recebe casos de uso prontos.
 * Nenhum adaptador vaza por aqui: o tipo de retorno e o do caso de uso, nao o do
 * adaptador que o alimenta. Ver R6 em docs/architecture/dependency-rules.md.
 */
export {
  DEMONSTRATION_USER_ID,
  buildAnalysisPipeline,
  resetDemonstrationStores,
  type AnalysisPipeline,
  type CompositionMode,
} from './analysis-pipeline';
