import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateChannelMetrics } from '@/modules/video-analytics';
import type { YouTubeVideoId } from '@/modules/youtube-collection';
import { AppError } from '@/shared/errors';
import { noopLogger } from '@/shared/observability';

import type { InsightRequest } from '../../application/ports/insight-generator';
import { GeminiInsightGenerator } from './gemini-insight-generator';

/**
 * O adaptador da Gemini, sem rede.
 *
 * `fetch` e dublado. O que estes testes travam e o CONTRATO com o provedor: o
 * formato do pedido e a leitura da resposta. Sao a unica rede de protecao que
 * existe sem uma chave — e o que sobra e a chamada real, que so uma execucao
 * com chave verifica.
 */

const COLLECTED_AT = new Date('2026-07-30T12:00:00.000Z');

const REQUEST: InsightRequest = {
  channelTitle: 'Canal de Exemplo',
  channelDescription: 'Sobre financas',
  metrics: calculateChannelMetrics({
    videos: [
      {
        id: 'vid-1' as YouTubeVideoId,
        format: 'long',
        publishedAt: new Date('2026-07-20T12:00:00.000Z'),
        viewCount: 100,
      },
    ],
    collectedAt: COLLECTED_AT,
  }),
  recentTitles: ['Um titulo qualquer'],
};

const CONTEUDO = {
  summary: 'O canal publica com cadencia regular.',
  likelyNiche: 'Financas pessoais',
  likelySubNiche: null,
  titlePatterns: [],
  contentOpportunities: [],
  viralDependencyNotes: null,
};

/** Resposta bem formada do provedor. */
function ok(overrides: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(CONTEUDO) }] }],
    usage: { total_input_tokens: 1234, total_output_tokens: 567, total_thought_tokens: 400 },
    ...overrides,
  };
}

function stubFetch(body: unknown, init: { status?: number } = {}) {
  const spy = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

function buildGenerator() {
  return new GeminiInsightGenerator({
    apiKey: 'chave-de-teste',
    model: 'gemini-3.6-flash',
    logger: noopLogger,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeminiInsightGenerator — o pedido', () => {
  it('manda a chave em cabecalho, nunca na URL', async () => {
    const spy = stubFetch(ok());
    await buildGenerator().generate(REQUEST);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];

    // URL vai para log de servidor, de proxy e de navegador. Chave em query
    // string vaza em todos os tres.
    expect(url).not.toContain('chave-de-teste');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('chave-de-teste');
  });

  it('pede saida estruturada pelo esquema, e nao texto livre', async () => {
    const spy = stubFetch(ok());
    await buildGenerator().generate(REQUEST);

    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );

    // ADR-007, decisao 3: o esquema restringe o que o modelo pode gerar. Sem
    // ele, voltariamos a recortar texto com expressao regular.
    expect(body.response_format.mime_type).toBe('application/json');
    expect(body.response_format.schema.additionalProperties).toBe(false);
    expect(body.model).toBe('gemini-3.6-flash');
  });

  it('envia os numeros ja calculados e nenhuma lista bruta', async () => {
    const spy = stubFetch(ok());
    await buildGenerator().generate(REQUEST);

    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );

    // RN-14: o pedido leva agregados rotulados. Se um dia ele passar a levar a
    // lista de visualizacoes por video, a IA ganha como calcular — e este teste
    // e o que avisa.
    expect(body.input).toContain('views mediana');
    expect(body.input).toContain('Um titulo qualquer');
    expect(body.input).not.toContain('vid-1');
  });

  it('declara ausencia como indisponivel, e nunca como zero', async () => {
    const spy = stubFetch(ok());

    await buildGenerator().generate({
      ...REQUEST,
      metrics: calculateChannelMetrics({
        videos: [
          {
            id: 'vid-2' as YouTubeVideoId,
            format: 'long',
            publishedAt: new Date('2026-07-20T12:00:00.000Z'),
            // RN-08: contagem ausente. No pedido tem de aparecer como ausencia.
            viewCount: null,
          },
        ],
        collectedAt: COLLECTED_AT,
      }),
    });

    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.input).toContain('indisponivel');
  });
});

describe('GeminiInsightGenerator — a resposta', () => {
  it('devolve o relatorio com a procedencia e o custo medido', async () => {
    stubFetch(ok());

    const generated = await buildGenerator().generate(REQUEST);

    expect(generated.summary).toBe(CONTEUDO.summary);
    expect(generated.provider).toBe('google');
    expect(generated.model).toBe('gemini-3.6-flash');
    expect(generated.inputTokens).toBe(1234);
    // Saida + raciocinio. Os dois sao contadores separados na resposta e os
    // dois sao cobrados como saida — gravar so o primeiro registraria uma
    // fracao do custo real.
    expect(generated.outputTokens).toBe(567 + 400);
  });

  it('soma o raciocinio a saida, e nao o descarta', async () => {
    stubFetch(
      ok({ usage: { total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 900 } }),
    );

    // Foi assim que o defeito apareceu: uma execucao real gravou 565 tokens de
    // saida sem os milhares de raciocinio que a acompanharam.
    expect((await buildGenerator().generate(REQUEST)).outputTokens).toBe(920);
  });

  it('resposta sem contador de raciocinio nao quebra', async () => {
    stubFetch(ok({ usage: { total_input_tokens: 10, total_output_tokens: 20 } }));

    expect((await buildGenerator().generate(REQUEST)).outputTokens).toBe(20);
  });

  it('recusa estado diferente de concluido antes de ler o texto', async () => {
    // Uma resposta cortada ou recusada volta com 200. Ler o conteudo sem checar
    // o estado produziria relatorio pela metade apresentado como valido.
    stubFetch(ok({ status: 'incomplete' }));

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
  });

  it('recusa resposta sem texto nenhum', async () => {
    stubFetch(ok({ steps: [] }));

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
  });

  it('recusa envelope em formato inesperado', async () => {
    stubFetch({ isso: 'nao e a resposta esperada' });

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
  });

  it('recusa conteudo que nao segue o contrato do relatorio', async () => {
    stubFetch(
      ok({
        steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"summary":"ok"}' }] }],
      }),
    );

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
  });
});

describe('GeminiInsightGenerator — erros de HTTP', () => {
  it('429 vira erro de QUOTA, e nao falha generica', async () => {
    stubFetch({}, { status: 429 });

    // Na camada gratuita este e o caso comum. A tela precisa poder dizer "o
    // limite de hoje acabou" em vez de "o servico falhou".
    await expect(buildGenerator().generate(REQUEST)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('401 e 403 viram erro de servico sem repetir a mensagem do provedor', async () => {
    stubFetch({ error: { message: 'API key AIza-segredo-vazado invalid' } }, { status: 403 });

    try {
      await buildGenerator().generate(REQUEST);
      throw new Error('deveria ter falhado');
    } catch (error) {
      // O texto do provedor pode conter parte da credencial. Ele nunca sobe.
      expect((error as AppError).message).not.toContain('AIza');
    }
  });

  it('falha de rede nao derruba com erro cru', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
  });
});

describe('GeminiInsightGenerator — repeticao', () => {
  /** Respostas em fila; cada chamada consome a proxima. */
  function stubQueue(items: readonly (Response | Error)[]) {
    let i = 0;
    const spy = vi.fn(() => {
      const next = items[i];
      i += 1;
      if (next === undefined) throw new Error('fila vazia');
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  const sucesso = () =>
    new Response(JSON.stringify(ok()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('repete uma vez em 5xx e aproveita a segunda resposta', async () => {
    // O problema e do outro lado e costuma passar. Sem repetir, um 503 custa o
    // relatorio inteiro — e na camada gratuita repetir nao custa dinheiro.
    const spy = stubQueue([new Response('{}', { status: 503 }), sucesso()]);

    const gerado = await buildGenerator().generate(REQUEST);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(gerado.summary).toBe(CONTEUDO.summary);
  });

  it('repete uma vez em falha de rede', async () => {
    const spy = stubQueue([new Error('ECONNRESET'), sucesso()]);

    await buildGenerator().generate(REQUEST);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('desiste depois da segunda, sem terceira tentativa', async () => {
    const spy = stubQueue([new Error('ECONNRESET'), new Error('ECONNRESET')]);

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('NAO repete quando o tempo esgota', async () => {
    // O usuario ja esperou o timeout inteiro. Repetir dobraria a espera de quem
    // ja estava esperando demais.
    const timeout = new DOMException('aborted due to timeout', 'TimeoutError');
    const spy = stubQueue([timeout, sucesso()]);

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('NAO repete em 429 — insistir piora', async () => {
    const spy = stubQueue([new Response('{}', { status: 429 }), sucesso()]);

    await expect(buildGenerator().generate(REQUEST)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('NAO repete em 403 — credencial recusada nao melhora com insistencia', async () => {
    const spy = stubQueue([new Response('{}', { status: 403 }), sucesso()]);

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('NAO repete quando a resposta chega e nao segue o contrato', async () => {
    // Resposta invalida nao e transitoria: repetir produz a mesma invalidez.
    const invalida = new Response(JSON.stringify({ isso: 'nao e a resposta' }), { status: 200 });
    const spy = stubQueue([invalida, sucesso()]);

    await expect(buildGenerator().generate(REQUEST)).rejects.toThrow(AppError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
