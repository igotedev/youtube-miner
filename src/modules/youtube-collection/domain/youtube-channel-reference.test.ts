import { describe, expect, it } from 'vitest';

import {
  InvalidChannelReferenceError,
  type InvalidChannelReferenceReason,
} from './errors/invalid-channel-reference';
import {
  CHANNEL_ID_LENGTH,
  MAX_HANDLE_LENGTH,
  parseYouTubeChannelReference,
  type YouTubeChannelReference,
  type YouTubeChannelReferenceKind,
} from './youtube-channel-reference';

/** ID valido: `UC` + 22 caracteres. */
const VALID_ID = 'UCabcdefghijklmnopqrstuv';

interface AcceptedCase {
  readonly name: string;
  readonly input: string;
  readonly kind: YouTubeChannelReferenceKind;
  readonly value: string;
  readonly canonicalPath: string;
}

const ACCEPTED: readonly AcceptedCase[] = [
  // --- ID oficial ---------------------------------------------------------
  {
    name: 'URL /channel/ valida',
    input: `https://www.youtube.com/channel/${VALID_ID}`,
    kind: 'channel_id',
    value: VALID_ID,
    canonicalPath: `/channel/${VALID_ID}`,
  },
  {
    name: 'ID oficial sem URL',
    input: VALID_ID,
    kind: 'channel_id',
    value: VALID_ID,
    canonicalPath: `/channel/${VALID_ID}`,
  },
  {
    name: 'ID com hifen e sublinhado, do alfabeto base64url',
    input: 'UCa-b_cdefghijklmnopqrst',
    kind: 'channel_id',
    value: 'UCa-b_cdefghijklmnopqrst',
    canonicalPath: '/channel/UCa-b_cdefghijklmnopqrst',
  },
  {
    name: 'URL /channel/ com sub-rota /videos',
    input: `https://www.youtube.com/channel/${VALID_ID}/videos`,
    kind: 'channel_id',
    value: VALID_ID,
    canonicalPath: `/channel/${VALID_ID}`,
  },

  // --- Handle -------------------------------------------------------------
  {
    name: 'URL com @handle',
    input: 'https://www.youtube.com/@nomedocanal',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'handle sem URL',
    input: '@nomedocanal',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL com barra final',
    input: 'https://youtube.com/@nomedocanal/',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL com query string',
    input: 'https://www.youtube.com/@nomedocanal?sub_confirmation=1',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL com fragmento',
    input: 'https://www.youtube.com/@nomedocanal#conteudo',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL com rota /videos apos o canal',
    input: 'https://www.youtube.com/@nomedocanal/videos',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL com rota /shorts apos o canal',
    input: 'https://www.youtube.com/@nomedocanal/shorts',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL mobile m.youtube.com',
    input: 'https://m.youtube.com/@nomedocanal',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL sem protocolo',
    input: 'youtube.com/@nomedocanal',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'URL sem protocolo com www',
    input: 'www.youtube.com/@nomedocanal',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'espacos externos na entrada',
    input: '   https://www.youtube.com/@nomedocanal   ',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'exemplo completo da SPEC: rota, query e fragmento juntos',
    input: 'https://www.youtube.com/@CanalExemplo/videos?view=0#conteudo',
    kind: 'handle',
    value: '@CanalExemplo',
    canonicalPath: '/@CanalExemplo',
  },
  {
    name: 'http tambem e aceito',
    input: 'http://www.youtube.com/@nomedocanal',
    kind: 'handle',
    value: '@nomedocanal',
    canonicalPath: '/@nomedocanal',
  },
  {
    name: 'handle acentuado com codificacao percentual',
    input: 'https://www.youtube.com/@caf%C3%A9',
    kind: 'handle',
    value: '@café',
    canonicalPath: '/@café',
  },

  // --- Legado -------------------------------------------------------------
  {
    name: 'URL /c/',
    input: 'https://www.youtube.com/c/NomeDoCanal',
    kind: 'custom_name',
    value: 'NomeDoCanal',
    canonicalPath: '/c/NomeDoCanal',
  },
  {
    name: 'URL /user/',
    input: 'https://www.youtube.com/user/NomeDoUsuario',
    kind: 'legacy_username',
    value: 'NomeDoUsuario',
    canonicalPath: '/user/NomeDoUsuario',
  },
  {
    name: 'URL /c/ com sub-rota e barra final',
    input: 'https://www.youtube.com/c/NomeDoCanal/about/',
    kind: 'custom_name',
    value: 'NomeDoCanal',
    canonicalPath: '/c/NomeDoCanal',
  },
];

interface RejectedCase {
  readonly name: string;
  readonly input: string;
  readonly reason: InvalidChannelReferenceReason;
}

const REJECTED: readonly RejectedCase[] = [
  { name: 'string vazia', input: '', reason: 'empty_input' },
  { name: 'somente espacos', input: '     ', reason: 'empty_input' },
  { name: 'tabulacao e quebra de linha', input: '\t\n ', reason: 'empty_input' },

  {
    name: 'URL de video',
    input: 'https://www.youtube.com/watch?v=123',
    reason: 'not_a_channel_url',
  },
  {
    name: 'URL de Shorts',
    input: 'https://www.youtube.com/shorts/123',
    reason: 'not_a_channel_url',
  },
  {
    name: 'URL de playlist',
    input: 'https://www.youtube.com/playlist?list=123',
    reason: 'not_a_channel_url',
  },
  {
    name: 'URL de busca',
    input: 'https://www.youtube.com/results?search_query=teste',
    reason: 'not_a_channel_url',
  },
  { name: 'URL de live', input: 'https://www.youtube.com/live/abc', reason: 'not_a_channel_url' },

  { name: 'dominio invalido', input: 'https://www.google.com/@canal', reason: 'unsupported_host' },
  {
    name: 'subdominio nao autorizado',
    input: 'https://music.youtube.com/@canal',
    reason: 'unsupported_host',
  },
  {
    name: 'youtu.be recusado: e encurtador de video',
    input: 'https://youtu.be/@canal',
    reason: 'unsupported_host',
  },
  {
    name: 'dominio que apenas contem youtube.com',
    input: 'https://youtube.com.exemplo.net/@canal',
    reason: 'unsupported_host',
  },

  { name: 'raiz do youtube sem caminho', input: 'https://youtube.com/', reason: 'unknown_path' },
  {
    name: 'caminho desconhecido',
    input: 'https://www.youtube.com/qualquercoisa',
    reason: 'unknown_path',
  },
  {
    name: 'sub-rota desconhecida apos o canal',
    input: 'https://www.youtube.com/@canal/estatisticas',
    reason: 'unknown_path',
  },
  {
    name: 'mais de uma sub-rota apos o canal',
    input: 'https://www.youtube.com/@canal/videos/extra',
    reason: 'unknown_path',
  },

  { name: 'ID de canal curto', input: 'UC123', reason: 'invalid_channel_id' },
  {
    name: 'ID de canal curto em URL',
    input: 'https://www.youtube.com/channel/UC123',
    reason: 'invalid_channel_id',
  },
  {
    name: 'ID de canal com caractere invalido',
    input: 'UCabcdefghijklmnopqrst!v',
    reason: 'invalid_channel_id',
  },
  {
    name: 'ID de canal longo demais',
    input: `${VALID_ID}extra`,
    reason: 'invalid_channel_id',
  },
  {
    name: '/channel/ sem identificador',
    input: 'https://www.youtube.com/channel/',
    reason: 'invalid_channel_id',
  },

  { name: 'handle vazio', input: '@', reason: 'invalid_handle' },
  // `/@` e reconhecido como tentativa de handle, entao o erro aponta o handle
  // vazio em vez de um generico "caminho desconhecido".
  { name: 'handle vazio em URL', input: 'https://www.youtube.com/@', reason: 'invalid_handle' },
  { name: 'handle com espaco', input: '@canal exemplo', reason: 'invalid_handle' },
  {
    name: 'handle longo demais',
    input: `@${'a'.repeat(MAX_HANDLE_LENGTH + 1)}`,
    reason: 'invalid_handle',
  },

  { name: 'URL malformada', input: 'https://', reason: 'malformed_url' },
  {
    name: 'codificacao percentual quebrada',
    input: 'https://youtube.com/@ca%zz',
    reason: 'malformed_url',
  },
  {
    name: 'protocolo nao permitido',
    input: 'ftp://www.youtube.com/@canal',
    reason: 'unsupported_protocol',
  },
  {
    name: 'protocolo javascript',
    input: 'javascript:alert(1)',
    reason: 'unsupported_protocol',
  },
  {
    name: 'URL contendo credenciais',
    input: 'https://usuario:senha@www.youtube.com/@canal',
    reason: 'credentials_in_url',
  },

  { name: 'texto generico', input: 'canal qualquer', reason: 'unrecognized_input' },
  { name: 'palavra solta', input: 'youtube', reason: 'unrecognized_input' },
];

describe('parseYouTubeChannelReference — entradas aceitas', () => {
  it.each(ACCEPTED)('$name', ({ input, kind, value, canonicalPath }) => {
    const reference = parseYouTubeChannelReference(input);

    expect(reference.kind).toBe(kind);
    expect(reference.value).toBe(value);
    expect(reference.canonicalPath).toBe(canonicalPath);
  });

  it.each(ACCEPTED)('$name — preserva originalInput intacto', ({ input }) => {
    // Sem trim e sem normalizacao: o valor precisa voltar exatamente como veio.
    expect(parseYouTubeChannelReference(input).originalInput).toBe(input);
  });
});

describe('parseYouTubeChannelReference — entradas recusadas', () => {
  it.each(REJECTED)('$name', ({ input, reason }) => {
    expect(() => parseYouTubeChannelReference(input)).toThrow(InvalidChannelReferenceError);

    try {
      parseYouTubeChannelReference(input);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidChannelReferenceError);
      expect((error as InvalidChannelReferenceError).reason).toBe(reason);
    }
  });
});

describe('contrato do erro', () => {
  it('usa o codigo transversal VALIDATION_ERROR', () => {
    // O detalhe fica em `reason`; `code` continua sendo o vocabulario comum de
    // shared/errors, que a camada de apresentacao usa para escolher o HTTP.
    try {
      parseYouTubeChannelReference('');
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as InvalidChannelReferenceError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('nao expoe a entrada na mensagem nem no contexto', () => {
    // Uma URL com credenciais nao pode vazar para log por meio do erro.
    const secret = 'https://usuario:senha-secreta@www.youtube.com/@canal';

    try {
      parseYouTubeChannelReference(secret);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      const invalid = error as InvalidChannelReferenceError;
      expect(invalid.message).not.toContain('senha-secreta');
      expect(JSON.stringify(invalid.context)).not.toContain('senha-secreta');
    }
  });
});

describe('normalizacao', () => {
  it('normaliza o hostname para minusculas', () => {
    const reference = parseYouTubeChannelReference('https://WWW.YouTube.COM/@nomedocanal');
    expect(reference.kind).toBe('handle');
    expect(reference.canonicalPath).toBe('/@nomedocanal');
  });

  it('preserva a caixa do identificador', () => {
    // O hostname e normalizado; o identificador NAO. `@CanalExemplo` e
    // `@canalexemplo` sao exibidos de formas diferentes.
    expect(parseYouTubeChannelReference('@CanalExemplo').value).toBe('@CanalExemplo');
    expect(parseYouTubeChannelReference('https://youtube.com/c/NomeDoCanal').value).toBe(
      'NomeDoCanal',
    );
  });

  it('nao guarda a URL completa como identificador (RN-01/RN-02)', () => {
    const input = 'https://www.youtube.com/@nomedocanal/videos?x=1';
    const reference = parseYouTubeChannelReference(input);

    expect(reference.value).not.toContain('youtube.com');
    expect(reference.canonicalPath).not.toContain('youtube.com');
    expect(reference.canonicalPath).not.toContain('?');
  });

  it('produz o mesmo resultado para as varias formas da mesma referencia', () => {
    const variants = [
      'https://www.youtube.com/@nomedocanal',
      'https://youtube.com/@nomedocanal/',
      'https://m.youtube.com/@nomedocanal/videos',
      'http://www.youtube.com/@nomedocanal?sub_confirmation=1',
      'youtube.com/@nomedocanal#sobre',
      '  @nomedocanal  ',
    ];

    const canonical = variants.map((v) => parseYouTubeChannelReference(v).canonicalPath);

    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe('/@nomedocanal');
  });

  it('aceita todas as sete sub-rotas documentadas', () => {
    const subRoutes = [
      'videos',
      'shorts',
      'streams',
      'playlists',
      'community',
      'channels',
      'about',
    ];

    for (const route of subRoutes) {
      const reference = parseYouTubeChannelReference(`https://youtube.com/@canal/${route}`);
      expect(reference.canonicalPath, `falhou em /${route}`).toBe('/@canal');
    }
  });

  it('distingue /shorts na raiz de /shorts depois do canal', () => {
    // Mesma palavra, posicoes diferentes: video na raiz, aba do canal depois.
    expect(parseYouTubeChannelReference('https://youtube.com/@canal/shorts').kind).toBe('handle');
    expect(() => parseYouTubeChannelReference('https://youtube.com/shorts/abc')).toThrow(
      InvalidChannelReferenceError,
    );
  });
});

describe('regra do ID oficial', () => {
  it('exige exatamente 24 caracteres', () => {
    expect(VALID_ID).toHaveLength(CHANNEL_ID_LENGTH);
    expect(parseYouTubeChannelReference(VALID_ID).kind).toBe('channel_id');
  });

  it('recusa um caractere a menos e um a mais', () => {
    const short = `UC${'a'.repeat(21)}`;
    const long = `UC${'a'.repeat(23)}`;

    for (const candidate of [short, long]) {
      expect(() => parseYouTubeChannelReference(candidate)).toThrow(InvalidChannelReferenceError);
    }
  });

  it('exige o prefixo UC', () => {
    expect(() => parseYouTubeChannelReference(`UX${'a'.repeat(22)}`)).toThrow(
      InvalidChannelReferenceError,
    );
  });
});

describe('estreitamento do tipo discriminado', () => {
  it('permite discriminar por kind sem cast', () => {
    const reference: YouTubeChannelReference = parseYouTubeChannelReference(VALID_ID);

    if (reference.kind === 'channel_id') {
      // `value` aqui e `YouTubeChannelId`, nao `string` — o compilador garante.
      expect(reference.value).toBe(VALID_ID);
    } else {
      expect.unreachable('deveria ser channel_id');
    }
  });
});
