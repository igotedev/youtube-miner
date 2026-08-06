import {
  InvalidChannelReferenceError,
  type InvalidChannelReferenceReason,
} from './errors/invalid-channel-reference';
import type { YouTubeChannelId } from './youtube-channel';

/**
 * Referencia normalizada a um canal do YouTube.
 *
 * Funcao pura de dominio: sem rede, sem relogio, sem `process.env`, sem
 * dependencia externa. `URL` e `decodeURIComponent` sao primitivas padrao da
 * linguagem, disponiveis em Node e no navegador — nao sao SDK nem I/O.
 *
 * RN-01/RN-02: o resultado NAO guarda a URL completa como identificador. Guarda
 * o identificador extraido e o caminho canonico. `originalInput` existe apenas
 * para rastreabilidade e nunca deve ser usado como chave.
 *
 * Esta etapa NAO resolve handle, nome personalizado ou nome de usuario para o
 * ID oficial — isso exige consultar a YouTube Data API e pertence ao adaptador
 * da porta `ChannelResolver`. Ver SPEC-002, secao "Estrategia futura".
 */

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export type YouTubeChannelReferenceKind =
  'channel_id' | 'handle' | 'custom_name' | 'legacy_username';

interface ReferenceBase {
  /** A entrada exatamente como foi recebida, sem trim. So rastreabilidade. */
  readonly originalInput: string;
  /** Caminho canonico no youtube.com, sem host, query ou fragmento. */
  readonly canonicalPath: string;
}

export type YouTubeChannelReference =
  | (ReferenceBase & {
      readonly kind: 'channel_id';
      /**
       * Tipado como `YouTubeChannelId`, e nao `string`, porque este e o unico
       * ponto do sistema que valida o formato do ID oficial. Deixar `string`
       * aqui obrigaria todo consumidor a re-validar ou a fazer um cast cego.
       */
      readonly value: YouTubeChannelId;
    })
  | (ReferenceBase & { readonly kind: 'handle'; readonly value: string })
  | (ReferenceBase & { readonly kind: 'custom_name'; readonly value: string })
  | (ReferenceBase & { readonly kind: 'legacy_username'; readonly value: string });

// ---------------------------------------------------------------------------
// Regras, todas documentadas na SPEC-002
// ---------------------------------------------------------------------------

/** `youtu.be` esta fora: e o encurtador de VIDEOS. Ver SPEC-002, secao 6.3. */
export const ALLOWED_HOSTNAMES = ['youtube.com', 'www.youtube.com', 'm.youtube.com'] as const;

const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

/** ID oficial: `UC` + 22 caracteres do alfabeto base64url. 24 no total. */
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export const CHANNEL_ID_LENGTH = 24;

/** Maximo documentado pelo YouTube para handles. */
export const MAX_HANDLE_LENGTH = 30;

/**
 * Limite generoso para `/c/` e `/user/`. Nao ha maximo publicado para nomes
 * personalizados legados, e recusar um nome valido e pior que aceitar um nome
 * longo que a API rejeitaria depois.
 */
export const MAX_LEGACY_IDENTIFIER_LENGTH = 100;

/**
 * Caracteres que nunca aparecem em um identificador de canal.
 *
 * Lista de recusa, e nao de permissao, de proposito: o YouTube aceita handles
 * com letras nao-ASCII, e uma lista de permissao ASCII recusaria handles
 * validos com base em suposicao.
 */
const FORBIDDEN_IDENTIFIER_CHARS = /[\s/\\?#&=%:@]/;

/**
 * Sub-rotas aceitas depois do segmento do canal. Exatamente as sete listadas na
 * SPEC-002; acrescentar outra e mudanca de SPEC, nao de codigo.
 */
const CHANNEL_SUB_ROUTES = new Set([
  'videos',
  'shorts',
  'streams',
  'playlists',
  'community',
  'channels',
  'about',
]);

/**
 * Rotas de conteudo conhecidas na raiz do youtube.com. Existem apenas para
 * produzir um erro melhor: sem elas, `/watch?v=...` cairia em `unknown_path`,
 * que nao diz ao usuario o que ele fez de errado.
 */
const NON_CHANNEL_ROOT_ROUTES = new Set([
  'watch',
  'shorts',
  'playlist',
  'results',
  'live',
  'embed',
  'clip',
  'hashtag',
  'feed',
  'post',
]);

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Interpreta uma entrada do usuario e devolve a referencia normalizada.
 *
 * @throws {InvalidChannelReferenceError} Entrada nao reconhecida. O `reason`
 *   indica o motivo exato.
 */
export function parseYouTubeChannelReference(input: string): YouTubeChannelReference {
  const trimmed = input.trim();

  if (trimmed === '') {
    throw fail('empty_input');
  }

  // Handle solto: `@nomedocanal`.
  if (trimmed.startsWith('@')) {
    return buildHandle(trimmed.slice(1), input);
  }

  // ID oficial solto: `UCxxxxxxxxxxxxxxxxxxxxxx`.
  // A checagem e frouxa de proposito — basta parecer uma tentativa de ID para
  // que o erro seja `invalid_channel_id`, que e mais util que
  // `unrecognized_input` para quem digitou um ID truncado.
  if (looksLikeBareChannelId(trimmed)) {
    return buildChannelId(trimmed, input);
  }

  if (!looksLikeUrl(trimmed)) {
    throw fail('unrecognized_input');
  }

  return fromUrl(toAllowedUrl(trimmed), input);
}

// ---------------------------------------------------------------------------
// Entrada solta
// ---------------------------------------------------------------------------

function looksLikeBareChannelId(candidate: string): boolean {
  return (
    candidate.startsWith('UC') &&
    !candidate.includes('/') &&
    !candidate.includes('.') &&
    !candidate.includes(':') &&
    !/\s/.test(candidate)
  );
}

/**
 * Distingue "isso e uma URL malformada" de "isso e texto qualquer".
 *
 * Sem essa separacao, `canal qualquer` receberia `unsupported_host` — tecnicamente
 * verdadeiro e inutil para quem digitou.
 */
function looksLikeUrl(candidate: string): boolean {
  if (hasScheme(candidate)) return true;
  const hostCandidate = candidate.split(/[/?#]/, 1)[0] ?? '';
  return hostCandidate.includes('.');
}

function hasScheme(candidate: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate);
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

function toAllowedUrl(candidate: string): URL {
  // Entrada sem protocolo (`youtube.com/@canal`) e aceita: assume-se https.
  const withScheme = hasScheme(candidate) ? candidate : `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw fail('malformed_url');
  }

  if (!(ALLOWED_PROTOCOLS as readonly string[]).includes(url.protocol)) {
    throw fail('unsupported_protocol');
  }

  // Antes do host: uma URL com credenciais nao deve nem ser reportada como
  // "dominio errado", porque a checagem seguinte poderia colocar o host — e por
  // tabela a origem da credencial — em um erro.
  if (url.username !== '' || url.password !== '') {
    throw fail('credentials_in_url');
  }

  // `new URL` ja normaliza o hostname para minusculas; o `toLowerCase` explicito
  // documenta a regra em vez de depender desse detalhe.
  if (!(ALLOWED_HOSTNAMES as readonly string[]).includes(url.hostname.toLowerCase())) {
    throw fail('unsupported_host');
  }

  return url;
}

function fromUrl(url: URL, originalInput: string): YouTubeChannelReference {
  // `url.pathname` ja exclui query e fragmento. O filtro remove barra final e
  // barras duplicadas.
  const segments = url.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeSegment);

  const [first, ...rest] = segments;

  if (first === undefined) {
    throw fail('unknown_path');
  }

  if (first === 'channel') {
    const [id, ...subRoutes] = rest;
    if (id === undefined) throw fail('invalid_channel_id');
    assertOnlyKnownSubRoutes(subRoutes);
    return buildChannelId(id, originalInput);
  }

  if (first.startsWith('@')) {
    assertOnlyKnownSubRoutes(rest);
    return buildHandle(first.slice(1), originalInput);
  }

  if (first === 'c') {
    const [name, ...subRoutes] = rest;
    if (name === undefined) throw fail('invalid_custom_name');
    assertOnlyKnownSubRoutes(subRoutes);
    return buildCustomName(name, originalInput);
  }

  if (first === 'user') {
    const [name, ...subRoutes] = rest;
    if (name === undefined) throw fail('invalid_legacy_username');
    assertOnlyKnownSubRoutes(subRoutes);
    return buildLegacyUsername(name, originalInput);
  }

  if (NON_CHANNEL_ROOT_ROUTES.has(first.toLowerCase())) {
    throw fail('not_a_channel_url');
  }

  throw fail('unknown_path');
}

function decodeSegment(segment: string): string {
  try {
    // Um handle acentuado chega como `%40caf%C3%A9`. Sem decodificar, a
    // validacao recusaria `%`, rejeitando uma URL perfeitamente valida.
    return decodeURIComponent(segment);
  } catch {
    throw fail('malformed_url');
  }
}

/** Aceita no maximo uma sub-rota, e apenas as sete conhecidas. */
function assertOnlyKnownSubRoutes(subRoutes: readonly string[]): void {
  if (subRoutes.length === 0) return;
  const [only, ...extra] = subRoutes;
  if (extra.length > 0 || only === undefined || !CHANNEL_SUB_ROUTES.has(only.toLowerCase())) {
    throw fail('unknown_path');
  }
}

// ---------------------------------------------------------------------------
// Construtores das variantes
// ---------------------------------------------------------------------------

function buildChannelId(rawId: string, originalInput: string): YouTubeChannelReference {
  if (!CHANNEL_ID_PATTERN.test(rawId)) {
    throw fail('invalid_channel_id');
  }
  return {
    kind: 'channel_id',
    // Unico lugar autorizado a criar um `YouTubeChannelId` a partir de entrada
    // de usuario: o cast so acontece depois da validacao acima.
    value: rawId as YouTubeChannelId,
    originalInput,
    canonicalPath: `/channel/${rawId}`,
  };
}

function buildHandle(afterAt: string, originalInput: string): YouTubeChannelReference {
  if (!isValidIdentifier(afterAt, MAX_HANDLE_LENGTH)) {
    throw fail('invalid_handle');
  }
  return {
    kind: 'handle',
    // Maiusculas e minusculas preservadas: handles distinguem caixa na exibicao.
    value: `@${afterAt}`,
    originalInput,
    canonicalPath: `/@${afterAt}`,
  };
}

function buildCustomName(rawName: string, originalInput: string): YouTubeChannelReference {
  if (!isValidIdentifier(rawName, MAX_LEGACY_IDENTIFIER_LENGTH)) {
    throw fail('invalid_custom_name');
  }
  return {
    kind: 'custom_name',
    value: rawName,
    originalInput,
    canonicalPath: `/c/${rawName}`,
  };
}

function buildLegacyUsername(rawName: string, originalInput: string): YouTubeChannelReference {
  if (!isValidIdentifier(rawName, MAX_LEGACY_IDENTIFIER_LENGTH)) {
    throw fail('invalid_legacy_username');
  }
  return {
    kind: 'legacy_username',
    value: rawName,
    originalInput,
    canonicalPath: `/user/${rawName}`,
  };
}

function isValidIdentifier(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !FORBIDDEN_IDENTIFIER_CHARS.test(value);
}

function fail(reason: InvalidChannelReferenceReason): InvalidChannelReferenceError {
  return new InvalidChannelReferenceError(reason);
}
