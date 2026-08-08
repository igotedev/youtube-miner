import { NextResponse, type NextRequest } from 'next/server';

/**
 * Import do modulo de autenticacao, e nao do barrel `@/config/composition`.
 *
 * O barrel reexporta tambem `analysis-pipeline.ts`, e reexport estatico arrasta
 * o modulo inteiro para o bundle. Viriam junto os repositorios do Supabase, o
 * cliente da YouTube Data API e `node:crypto` — que NAO EXISTE no Edge Runtime,
 * onde este arquivo roda.
 */
import { SIGN_IN_PATH, refreshSession } from '@/config/composition/auth';

/**
 * Proxy de sessao (SPEC-009).
 *
 * O arquivo se chamava `middleware.ts` ate o Next 16, que renomeou a convencao
 * para `proxy`. O comportamento e o mesmo; o nome antigo emite aviso de
 * depreciacao no build.
 *
 * Faz DUAS coisas:
 *
 *  1. **Renova o cookie de sessao.** O token do Supabase expira em uma hora, e
 *     um Server Component nao pode escrever cookie — quando ele renderiza, a
 *     resposta ja comecou. Sem alguem renovando aqui, a sessao morreria no meio
 *     da navegacao e ninguem conseguiria consertar.
 *
 *  2. **Manda quem nao tem sessao para `/entrar`**, guardando o destino
 *     original em `next` para devolve-lo depois do login.
 *
 * ---------------------------------------------------------------------------
 * O ITEM 2 E CONVENIENCIA DE NAVEGACAO, NAO SEGURANCA.
 *
 * A verificacao que vale acontece dentro de cada Server Action e de cada rota,
 * com `getCurrentUser()`, junto do dado. Este arquivo NAO e a fronteira de
 * autorizacao, e nao deve virar uma.
 *
 * Nao e desconfianca de um bug especifico — embora o Next tenha tido um
 * justamente disso (CVE-2025-29927, cabecalho forjado pulando o middleware). E
 * que um ponto unico de verificacao LONGE do recurso protegido e uma classe de
 * defeito: toda rota nova que o `matcher` abaixo nao cobrir nasce desprotegida,
 * e ninguem percebe ate alguem procurar.
 *
 * A propria documentacao do Next reforca: o proxy pode ser distribuido em CDN,
 * separado do codigo de renderizacao, e nao se deve depender dele para estado
 * compartilhado.
 *
 * Ver ADR-006, item 4.
 * ---------------------------------------------------------------------------
 */

/**
 * Rotas que exigem sessao. Prefixos, comparados contra o caminho da URL.
 *
 * `/analise` cobre tambem `/analise/[id]`, pelo prefixo. `/historico` precisou
 * ser acrescentado: uma rota nova nao entra aqui sozinha, e esquecer de
 * acrescenta-la e exatamente o defeito que o comentario acima descreve.
 */
const PROTECTED_PREFIXES = ['/analise', '/historico', '/listas'] as const;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Roda SEMPRE, inclusive em rota publica: a renovacao do token nao depende de
  // a rota ser protegida, e so renovar no caminho protegido faria a sessao
  // expirar de quem ficou navegando pelo resto do site.
  const { response, isAuthenticated } = await refreshSession(request);

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtected || isAuthenticated) return response;

  /**
   * SO REDIRECIONA NAVEGACAO. Um POST segue em frente, mesmo sem sessao.
   *
   * Server Actions sao POST, e o cliente do Next espera uma resposta de acao.
   * Redirecionar uma delas devolve HTML da tela de acesso, o cliente nao sabe
   * interpretar aquilo e a pagina quebra com "An unexpected response was
   * received from the server" — sem nenhuma pista do que aconteceu.
   *
   * E o cenario comum, nao exotico: a sessao expira em uma hora, o usuario deixa
   * a aba aberta e clica em Analisar.
   *
   * Deixar passar nao abre nada. A verificacao que vale esta DENTRO da acao, que
   * chama `getCurrentUser()` antes de qualquer trabalho e responde "sua sessao
   * expirou" — a mensagem que o usuario precisa ver. O proxy nunca foi a
   * fronteira de autorizacao (ADR-006, item 4); redirecionar um POST era ele
   * excedendo o proprio papel.
   */
  if (request.method !== 'GET') return response;

  const destination = request.nextUrl.clone();
  destination.pathname = SIGN_IN_PATH;
  destination.search = '';
  // Caminho + query da URL original, para o usuario voltar exatamente ao que
  // pediu. O valor e validado ANTES de virar destino, do outro lado — ver
  // `src/app/auth/safe-redirect.ts`.
  destination.searchParams.set('next', `${pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(destination);
}

export const config = {
  /**
   * Roda em tudo, menos no que nao tem sessao a renovar: estaticos do Next,
   * imagens e o favicon.
   *
   * Sem `matcher`, o proxy rodaria em TODA requisicao, inclusive CSS e imagens —
   * e a logica de redirecionamento acima passaria a bloquear o carregamento
   * deles.
   *
   * Manter a rota de callback DENTRO do matcher e proposital: ela precisa que os
   * cookies escritos na troca do codigo cheguem ao navegador.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
