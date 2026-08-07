/**
 * Superficie publica da raiz de composicao.
 *
 * Quem consome importa `@/config/composition` e recebe casos de uso prontos.
 * Nenhum adaptador vaza por aqui: o tipo de retorno e o do caso de uso, nao o do
 * adaptador que o alimenta. Ver R6 em docs/architecture/dependency-rules.md.
 *
 * ---------------------------------------------------------------------------
 * QUEM PRECISA SO DE AUTENTICACAO IMPORTA `@/config/composition/auth`.
 *
 * Um barrel com reexport estatico arrasta TUDO o que ele reexporta para o bundle
 * de quem o importa. Pelo caminho deste arquivo vem `analysis-pipeline.ts`, que
 * traz os repositorios do Supabase, o cliente da YouTube Data API e, no fim da
 * cadeia, `node:crypto`.
 *
 * Para o middleware isso nao e so peso: ele roda no Edge Runtime, onde modulos
 * do Node nao existem. O build avisa, e o aviso e legitimo.
 *
 * Por isso `src/middleware.ts`, a rota de callback e a tela de acesso importam o
 * modulo especifico, e nao este barrel. Nao e violacao de fronteira — os dois
 * arquivos sao a mesma raiz de composicao.
 * ---------------------------------------------------------------------------
 */
export {
  buildAnalysisPipeline,
  type AnalysisPipeline,
  type CompositionMode,
} from './analysis-pipeline';

export {
  AUTH_CALLBACK_PATH,
  DEFAULT_SIGNED_IN_PATH,
  SIGN_IN_PATH,
  buildAuthGateway,
  refreshSession,
  type SessionRefresh,
} from './auth';
