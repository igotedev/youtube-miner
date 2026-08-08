import { z } from 'zod';

import { ExternalServiceError, QuotaExceededError } from '@/shared/errors';
import type { Logger } from '@/shared/observability';

import type {
  GeneratedInsight,
  InsightGenerator,
  InsightGeneratorIdentity,
  InsightRequest,
} from '../../application/ports/insight-generator';
import {
  INSIGHT_PROMPT_VERSION,
  INSIGHT_SYSTEM_PROMPT,
  buildInsightPrompt,
} from '../insight-prompt';
import { INSIGHT_JSON_SCHEMA, parseInsightResponse } from '../insight-response';

/**
 * Adaptador da Gemini API (SPEC-011, ADR-007).
 *
 * ---------------------------------------------------------------------------
 * `fetch` DIRETO, SEM SDK — pelo mesmo motivo do adaptador do YouTube.
 *
 * E um endpoint REST, sem estado e sem streaming, cuja resposta seria validada
 * com Zod de qualquer jeito. Um SDK aqui traria peso sem trazer nada que este
 * arquivo nao faca em vinte linhas — e o projeto ganha ZERO dependencia nova.
 * Ver `youtube-api-client.ts`, que resolve o mesmo problema do mesmo jeito.
 * ---------------------------------------------------------------------------
 *
 * Faz TRES coisas: monta o pedido, chama, valida a resposta. Nenhuma regra de
 * negocio, e nenhum tipo do provedor atravessa a fronteira.
 */

const PROVIDER = 'google';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Quanto esperamos antes de desistir. Sem isto, a tela fica pendurada. */
const TIMEOUT_MS = 60_000;

/**
 * Envelope da resposta, validado antes de qualquer leitura.
 *
 * `.passthrough()` de proposito no envelope: campos novos do provedor nao
 * podem quebrar a leitura. O rigor fica no CONTEUDO do relatorio, validado por
 * `insight-response.ts` — e la o campo extra e recusado, porque ali ele
 * significa que os dois lados divergiram.
 */
const responseSchema = z.object({
  status: z.string(),
  steps: z
    .array(
      z.object({
        type: z.string(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      total_input_tokens: z.number().int().nonnegative().optional(),
      total_output_tokens: z.number().int().nonnegative().optional(),
      /**
       * O RACIOCINIO E CONTADO SEPARADO, E ISSO MUDA A CONTA.
       *
       * `total_output_tokens` NAO inclui os tokens de pensamento — medido:
       * 33 entrada + 39 saida + 346 pensamento = 418 no total.
       *
       * Ignora-los faria a coluna registrar uma fracao do custo real, porque na
       * faixa paga o raciocinio e cobrado como saida. Como o dominio tem dois
       * campos e a cobranca tem dois lados, o pensamento e somado a saida — que
       * e o lado em que ele cai.
       */
      total_thought_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface GeminiInsightGeneratorOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly logger: Logger;
}

export class GeminiInsightGenerator implements InsightGenerator {
  readonly identity: InsightGeneratorIdentity;

  constructor(private readonly options: GeminiInsightGeneratorOptions) {
    this.identity = {
      provider: PROVIDER,
      model: options.model,
      promptVersion: INSIGHT_PROMPT_VERSION,
    };
  }

  async generate(request: InsightRequest): Promise<GeneratedInsight> {
    const payload = await this.call(request);

    /**
     * O ESTADO E VERIFICADO ANTES DO CONTEUDO.
     *
     * Uma resposta pode voltar com 200 e `status` diferente de `completed` —
     * recusa por seguranca, corte por limite, cancelamento. Ler o texto sem
     * checar isso produziria um relatorio vazio ou pela metade apresentado como
     * valido.
     */
    if (payload.status !== 'completed') {
      this.options.logger.warn('Relatorio nao concluido pelo provedor.', {
        operation: 'insight.generate',
        status: payload.status,
      });
      throw new ExternalServiceError('O provedor nao concluiu o relatorio.', {
        operation: 'insight.generate',
      });
    }

    const text = (payload.steps ?? [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    if (text.length === 0) {
      throw new ExternalServiceError('O provedor devolveu resposta vazia.', {
        operation: 'insight.generate',
      });
    }

    const parsed = parseInsightResponse(text);

    return {
      provider: PROVIDER,
      model: this.options.model,
      promptVersion: INSIGHT_PROMPT_VERSION,
      ...parsed,
      /**
       * Custo MEDIDO. Na camada gratuita ele e zero em dinheiro e continua
       * valendo como medida: e o que permite saber quanto custaria fora dela,
       * antes de a conta chegar — e so vale se estiver completo.
       */
      inputTokens: payload.usage?.total_input_tokens ?? 0,
      // Saida + raciocinio. Ver a nota no esquema: sao contadores separados, e
      // os dois sao cobrados como saida.
      outputTokens:
        (payload.usage?.total_output_tokens ?? 0) + (payload.usage?.total_thought_tokens ?? 0),
    };
  }

  /**
   * A chamada, com os erros traduzidos para `AppError`.
   *
   * Nenhuma mensagem do provedor chega ao usuario: ela carrega detalhe interno
   * e pode ecoar o proprio pedido. O que sobe e um codigo estavel.
   */
  private async call(request: InsightRequest): Promise<z.infer<typeof responseSchema>> {
    /**
     * O prompt de sistema vai DENTRO da entrada.
     *
     * Este endpoint nao tem campo de instrucao de sistema separado. Concatenar
     * e o caminho documentado; inventar um nome de campo produziria um pedido
     * que o provedor ignora em silencio.
     */
    const input = `${INSIGHT_SYSTEM_PROMPT}\n\n---\n\n${buildInsightPrompt(request)}`;

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          // Chave em CABECALHO, nunca em query string: URL vai para log de
          // servidor, de proxy e de navegador.
          'x-goog-api-key': this.options.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: INSIGHT_JSON_SCHEMA,
          },
          stream: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Rede fora, DNS, ou o tempo esgotou. Nada disso invalida a analise.
      throw new ExternalServiceError('O servico de IA nao respondeu.', {
        operation: 'insight.generate',
      });
    }

    if (!response.ok) {
      throw this.translate(response.status);
    }

    const body: unknown = await response.json().catch(() => null);
    const parsed = responseSchema.safeParse(body);

    if (!parsed.success) {
      throw new ExternalServiceError('Resposta da IA em formato inesperado.', {
        operation: 'insight.generate',
      });
    }

    return parsed.data;
  }

  private translate(status: number): ExternalServiceError | QuotaExceededError {
    /**
     * 429 NA CAMADA GRATUITA E O CASO COMUM, NAO A EXCECAO.
     *
     * O limite diario e baixo e compartilhado pela chave inteira. Merece codigo
     * proprio para que a tela possa dizer "o limite gratuito de hoje acabou" em
     * vez de "o servico falhou" — sao coisas diferentes para quem le.
     */
    if (status === 429) {
      return new QuotaExceededError('Limite gratuito de uso da IA atingido.', {
        operation: 'insight.generate',
      });
    }

    if (status === 401 || status === 403) {
      // Chave errada, revogada ou sem acesso ao modelo. O texto do provedor
      // nunca sobe — ele pode conter parte da credencial.
      return new ExternalServiceError('Credencial da IA recusada.', {
        operation: 'insight.generate',
      });
    }

    this.options.logger.warn('Falha na chamada a IA.', {
      operation: 'insight.generate',
      status,
    });

    return new ExternalServiceError('O servico de IA nao respondeu.', {
      operation: 'insight.generate',
    });
  }
}
