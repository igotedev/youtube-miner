import { ExternalServiceError, QuotaExceededError } from '@/shared/errors';
import type { Logger } from '@/shared/observability';
import type { ZodType } from 'zod';

import { apiErrorSchema } from './api-schemas';

/**
 * Cliente HTTP da YouTube Data API v3.
 *
 * Responsabilidades: montar a URL, contabilizar quota, validar a resposta com
 * Zod e traduzir falha em `AppError`. Nao conhece canal nem video — isso e dos
 * adaptadores que o usam.
 *
 * ---------------------------------------------------------------------------
 * DISCIPLINA DA CHAVE. A chave viaja na QUERY STRING, o que significa que a URL
 * completa e um segredo. Nenhuma URL entra em mensagem de erro, em contexto de
 * `AppError` ou em log. O que se registra e o nome do endpoint e o custo — o
 * suficiente para diagnosticar, nada que vaze.
 *
 * O corpo bruto da resposta tambem nao e logado (CLAUDE.md, secao 8): so o
 * `reason` extraido, que e um enum curto do Google.
 * ---------------------------------------------------------------------------
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Custo em unidades de quota por endpoint.
 *
 * `search.list` custa 100 e NAO esta aqui de proposito: nenhum caminho deste
 * adaptador pode usa-la. Com 10.000 unidades diarias, ela reduziria o teto de
 * ~3.000 analises por dia para 100.
 */
export const QUOTA_COST = {
  channels: 1,
  playlistItems: 1,
  videos: 1,
} as const;

export type QuotaEndpoint = keyof typeof QUOTA_COST;

/** Razoes que o Google devolve quando a quota acabou. */
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded']);

/** Razoes que indicam problema com a propria chave — defeito de configuracao. */
const KEY_REASONS = new Set(['keyInvalid', 'keyExpired', 'forbidden', 'accessNotConfigured']);

/**
 * Quanto esperamos por resposta antes de desistir.
 *
 * O `fetch` do Node NAO tem timeout padrao. Sem isto, uma conexao pendurada
 * segura a Server Action indefinidamente: o usuario fica com a tela girando,
 * sem erro e sem fim, e um processo do servidor fica preso junto.
 *
 * 15 s e folgado para tres chamadas que costumam responder em menos de um
 * segundo. O objetivo nao e ser agressivo — e ter um fim.
 */
const TIMEOUT_MS = 15_000;

export interface YouTubeApiClientOptions {
  readonly apiKey: string;
  readonly logger: Logger;
  /** Teto de unidades que este processo pode gastar. Ver `YOUTUBE_DAILY_QUOTA_LIMIT`. */
  readonly dailyQuotaLimit: number;
  /**
   * Injetado para que o adaptador seja testavel sem rede.
   *
   * Sem isto, toda a traducao de erro e toda a validacao Zod so poderiam ser
   * exercitadas gastando quota — ou seja, na pratica, nunca.
   */
  readonly fetchImpl?: typeof globalThis.fetch;
}

export class YouTubeApiClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private unitsSpent = 0;

  constructor(private readonly options: YouTubeApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** Unidades gastas por este processo. Diagnostico e teste. */
  get spentUnits(): number {
    return this.unitsSpent;
  }

  /**
   * Executa uma chamada e devolve a resposta ja validada.
   *
   * @throws {QuotaExceededError} Teto local atingido, ou o Google recusou por quota.
   * @throws {ExternalServiceError} Qualquer outra falha, incluindo resposta fora do schema.
   */
  async get<T>(
    endpoint: QuotaEndpoint,
    params: Readonly<Record<string, string>>,
    schema: ZodType<T>,
  ): Promise<T> {
    const cost = QUOTA_COST[endpoint];
    this.reserveQuota(endpoint, cost);

    const url = new URL(`${API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    // Por ultimo, e nunca registrado: a partir daqui `url` e segredo.
    url.searchParams.set('key', this.options.apiKey);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // A causa original e descartada de proposito: mensagens de erro de rede
      // costumam embutir a URL, e a URL carrega a chave. Nao encadeamos.
      throw new ExternalServiceError('Nao foi possivel alcancar a API do YouTube.', {
        endpoint,
      });
    }

    this.unitsSpent += cost;

    const payload: unknown = await this.readJson(response, endpoint);

    if (!response.ok) {
      throw this.translateHttpError(response.status, payload, endpoint);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // So o caminho do campo, nunca o valor: o corpo pode conter qualquer coisa.
      const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
      this.options.logger.error('resposta da API do YouTube fora do schema', undefined, {
        endpoint,
        fields,
      });
      throw new ExternalServiceError('A API do YouTube respondeu em formato inesperado.', {
        endpoint,
      });
    }

    return parsed.data;
  }

  /**
   * Verifica o teto ANTES de gastar.
   *
   * O contador e por processo e zera ao reiniciar — nao e a quota real do
   * Google, que e diaria e compartilhada entre todos os processos do projeto.
   * E um freio local para que um defeito em laco nao queime a cota do dia em
   * segundos. O controle diario de verdade precisa de persistencia, e chega
   * quando o banco estiver ligado.
   */
  private reserveQuota(endpoint: QuotaEndpoint, cost: number): void {
    if (this.unitsSpent + cost > this.options.dailyQuotaLimit) {
      this.options.logger.warn('teto local de quota atingido', {
        endpoint,
        spent: this.unitsSpent,
        limit: this.options.dailyQuotaLimit,
      });
      throw new QuotaExceededError('O limite de consultas a API do YouTube foi atingido.', {
        spent: this.unitsSpent,
        limit: this.options.dailyQuotaLimit,
      });
    }
  }

  private async readJson(response: Response, endpoint: QuotaEndpoint): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ExternalServiceError('A API do YouTube respondeu algo que nao e JSON.', {
        endpoint,
        status: response.status,
      });
    }
  }

  private translateHttpError(
    status: number,
    payload: unknown,
    endpoint: QuotaEndpoint,
  ): ExternalServiceError | QuotaExceededError {
    const parsed = apiErrorSchema.safeParse(payload);
    const reason = parsed.success
      ? parsed.data.error.errors?.find((entry) => entry.reason !== undefined)?.reason
      : undefined;

    if (reason !== undefined && QUOTA_REASONS.has(reason)) {
      this.options.logger.warn('quota recusada pelo Google', { endpoint, reason });
      return new QuotaExceededError('O limite diario da API do YouTube foi atingido.', {
        endpoint,
        reason,
      });
    }

    if (reason !== undefined && KEY_REASONS.has(reason)) {
      // Defeito de configuracao nosso, nao do usuario. Registrado como erro para
      // aparecer no log; a mensagem exibida continua generica.
      this.options.logger.error('chave da YouTube Data API recusada', undefined, {
        endpoint,
        reason,
      });
    }

    return new ExternalServiceError('A API do YouTube recusou a consulta.', {
      endpoint,
      status,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
