/**
 * Validacao do destino pos-login.
 *
 * ---------------------------------------------------------------------------
 * ISTO EXISTE PARA IMPEDIR REDIRECIONAMENTO ABERTO.
 *
 * O middleware manda quem nao tem sessao para `/entrar?next=<caminho>`, e depois
 * do login o usuario volta para `next`. O valor de `next` vem da URL, ou seja,
 * de quem quiser monta-la.
 *
 * Sem esta funcao, um link como
 *
 *     https://nosso-dominio/entrar?next=https://site-do-atacante/entrar
 *
 * levaria a vitima a fazer login de verdade no nosso dominio — cadeado, URL
 * certa, tudo conferindo — e em seguida a despejaria em uma copia da nossa tela
 * de acesso, hospedada por outra pessoa. A confianca e emprestada do nosso
 * dominio; o formulario e do atacante.
 *
 * Regra: so passa CAMINHO RELATIVO da propria aplicacao. Qualquer coisa com
 * host, esquema ou forma duvidosa vira o destino padrao. Na duvida, o padrao —
 * um redirecionamento que perde o destino e um aborrecimento; um que sai do
 * dominio e um phishing assinado por nos.
 * ---------------------------------------------------------------------------
 *
 * Funcao pura. Testada em `safe-redirect.test.ts`.
 */

/**
 * @param raw valor de `next`, como veio da URL. Pode ser `null`.
 * @param fallback destino usado quando `raw` nao passa. Precisa ser um caminho
 *   relativo confiavel, definido no codigo.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== 'string') return fallback;

  const value = raw.trim();
  if (value === '') return fallback;

  // Precisa comecar com uma unica barra. Isto sozinho ja barra
  // `https://outro.site` e `javascript:alert(1)`.
  if (!value.startsWith('/')) return fallback;

  /**
   * `//outro.site` e `/\outro.site` sao URLs PROTOCOLO-RELATIVAS: o navegador as
   * resolve para outro host, mantendo o esquema atual. Comecam com barra e
   * passariam pela checagem acima.
   *
   * A barra invertida entra porque navegadores a normalizam para barra ao
   * resolver a URL — `/\` chega ao destino como `//`.
   */
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return fallback;

  // `\` na segunda posicao ja foi barrado; aqui barramos qualquer outro uso,
  // que nao tem razao de aparecer em um caminho legitimo do produto.
  if (value.includes('\\')) return fallback;

  /**
   * Caracteres de controle — NUL, tabulacao, quebra de linha — sao removidos ou
   * reinterpretados de forma diferente por cada navegador. Um destino que
   * depende de qual navegador o le nao e um destino conhecido.
   *
   * A checagem e por CODIGO, e nao por literal de regex: uma classe com
   * caracteres de controle dentro do fonte e invisivel na revisao e sobrevive
   * mal a qualquer normalizacao do arquivo.
   */
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  return value;
}
