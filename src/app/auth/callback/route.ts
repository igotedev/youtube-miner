import { NextResponse, type NextRequest } from 'next/server';

// Modulo especifico, e nao o barrel: esta rota so precisa de autenticacao, e o
// barrel arrastaria o pipeline de analise inteiro para o bundle. Ver a nota em
// `src/config/composition/index.ts`.
import { DEFAULT_SIGNED_IN_PATH, SIGN_IN_PATH, buildAuthGateway } from '@/config/composition/auth';

import { safeRedirectPath } from '../safe-redirect';

/**
 * Retorno do link de acesso enviado por e-mail.
 *
 * O usuario clica no link, o provedor o traz de volta para ca com um `code`, e
 * esta rota pede a porta que troque esse codigo pela sessao. Os cookies sao
 * gravados no caminho, e o usuario segue para o destino.
 *
 * ---------------------------------------------------------------------------
 * POR QUE E UM ROUTE HANDLER, E NAO UMA PAGINA.
 *
 * A troca precisa ESCREVER cookie, e um Server Component nao pode: quando ele
 * renderiza, a resposta ja comecou. Uma pagina que tentasse trocar o codigo
 * renderizaria bonito e perderia a sessao.
 * ---------------------------------------------------------------------------
 *
 * Nenhum adaptador e instanciado aqui (R6): a rota pede o gateway pronto a raiz
 * de composicao e nao sabe que existe Supabase do outro lado.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get('code');
  /**
   * `next` chega pela URL e portanto vem de quem montou o link. Passa pela
   * validacao antes de virar destino — sem ela, este endpoint seria um
   * redirecionador aberto assinado pelo nosso dominio. Ver `safe-redirect.ts`.
   */
  const destination = safeRedirectPath(searchParams.get('next'), DEFAULT_SIGNED_IN_PATH);

  const backToSignIn = NextResponse.redirect(new URL(`${SIGN_IN_PATH}?erro=link`, origin));

  /**
   * Sem codigo: link expirado, ja usado, ou o provedor recusou. O motivo chega
   * em `error_description` e NAO e repassado — e texto de terceiro, pode conter
   * o endereco de e-mail, e acabaria na barra de enderecos, no historico do
   * navegador e no log do servidor.
   */
  if (code === null) return backToSignIn;

  try {
    const auth = await buildAuthGateway();
    await auth.completeSignIn(code);
  } catch {
    // A porta ja distingue os motivos e decidiu nao os expor. Aqui a resposta e
    // uma so, e e a mesma para todos eles.
    return backToSignIn;
  }

  /**
   * `origin` vem da requisicao e o destino e um caminho relativo ja validado — a
   * combinacao nao consegue apontar para fora do dominio que atendeu esta
   * requisicao.
   */
  return NextResponse.redirect(new URL(destination, origin));
}
