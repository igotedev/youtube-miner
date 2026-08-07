'use server';

import { z } from 'zod';

import { buildAnalysisPipeline, buildAuthGateway } from '@/config/composition';
import { createAnalysisPeriod, type AnalysisPeriod } from '@/modules/video-analytics';
import { AppError } from '@/shared/errors';
import type { ErrorCode } from '@/shared/errors';

import type { AnalysisFormState } from './analysis-state';
import { parseDayEnd, parseDayStart } from './period-input';

/**
 * Server Action da tela de analise.
 *
 * Faz TRES coisas e mais nenhuma: valida o formato da entrada, chama os casos de
 * uso e traduz o resultado para um estado exibivel. Nenhum calculo, nenhuma
 * regra de negocio, nenhum `new` de adaptador (R6) — as dependencias vem prontas
 * da raiz de composicao.
 *
 * Este arquivo exporta APENAS `analyzeChannel`. Um modulo `'use server'` so pode
 * exportar funcoes assincronas — cada export vira um endpoint invocavel pelo
 * navegador. Tipos e constantes de estado ficam em `analysis-state.ts`.
 *
 * A VERIFICACAO DE SESSAO E A PRIMEIRA COISA QUE ACONTECE — antes da validacao
 * da entrada, antes de montar o pipeline. Uma Server Action e um endpoint HTTP
 * publico: o formulario na tela e uma das formas de chama-la, nao a unica, e o
 * middleware nao protege o que nao passa por ele. Ver ADR-006, item 4.
 */

/** Teto de tamanho da entrada. Barra corpo absurdo antes de qualquer trabalho. */
const MAX_URL_LENGTH = 2_048;

const formSchema = z.object({
  channelUrl: z
    .string()
    .trim()
    .min(1, 'Informe a URL de um canal do YouTube.')
    .max(MAX_URL_LENGTH, 'A URL informada e longa demais.'),
  /**
   * As duas datas sao OPCIONAIS e andam juntas.
   *
   * Vazias significam "a coleta inteira" — o comportamento que existia antes do
   * filtro, preservado como padrao. Preencher so uma das duas e recusado: um
   * intervalo pela metade nao e um intervalo, e adivinhar a outra ponta seria
   * escolher pelo usuario.
   */
  periodStart: z.string().trim().optional(),
  periodEnd: z.string().trim().optional(),
});

const INVALID_DAY = 'Informe as datas no formato AAAA-MM-DD.';
const INCOMPLETE_PERIOD = 'Informe as duas datas do periodo, ou deixe as duas em branco.';
const INVERTED_PERIOD = 'A data inicial e posterior a data final.';

/**
 * Constroi o periodo a partir do formulario.
 *
 * Devolve `undefined` quando nao ha recorte, ou uma mensagem quando a entrada
 * esta errada. A validacao do intervalo em si — inicio depois do fim — e do
 * dominio (`createAnalysisPeriod`); aqui so traduzimos o erro para texto.
 */
function readPeriod(
  rawStart: string | undefined,
  rawEnd: string | undefined,
): { period?: AnalysisPeriod } | { message: string } {
  const start = rawStart ?? '';
  const end = rawEnd ?? '';

  if (start === '' && end === '') return {};
  if (start === '' || end === '') return { message: INCOMPLETE_PERIOD };

  const startInstant = parseDayStart(start);
  const endInstant = parseDayEnd(end);
  if (startInstant === null || endInstant === null) return { message: INVALID_DAY };

  try {
    return { period: createAnalysisPeriod(startInstant, endInstant) };
  } catch {
    // O unico motivo possivel neste ponto: inicio depois do fim. As duas datas
    // ja foram validadas acima.
    return { message: INVERTED_PERIOD };
  }
}

/**
 * Mensagem exibivel para cada codigo de erro.
 *
 * A decisao e tomada pelo `code`, nunca pelo texto do erro — e a regra escrita
 * em `shared/errors/app-error.ts`. E nada aqui interpola contexto interno:
 * `AppError.context` carrega identificadores e nomes de coluna que o usuario nao
 * tem por que ver.
 */
const MESSAGE_BY_CODE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'A URL informada nao e de um canal do YouTube.',
  NOT_FOUND: 'Nenhum canal foi encontrado para essa URL.',
  UNAUTHORIZED: 'Sua sessao expirou. Entre de novo para analisar um canal.',
  FORBIDDEN: 'Sem permissao para esta analise.',
  CONFLICT: 'Ja existe uma analise em andamento para este canal. Tente de novo em instantes.',
  EXTERNAL_SERVICE_ERROR: 'O YouTube nao respondeu. Tente de novo em instantes.',
  QUOTA_EXCEEDED: 'O limite diario de consultas a API do YouTube foi atingido.',
  UNEXPECTED_ERROR: 'Nao foi possivel concluir a analise.',
};

const GENERIC_FAILURE = 'Nao foi possivel concluir a analise.';

export async function analyzeChannel(
  _previous: AnalysisFormState,
  formData: FormData,
): Promise<AnalysisFormState> {
  /**
   * Sessao primeiro. Sem ela nao ha dono para a analise, e uma analise sem dono
   * nao existe — `channel_analyses.user_id` e `not null`.
   */
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  if (user === null) {
    return { status: 'error', message: MESSAGE_BY_CODE.UNAUTHORIZED };
  }

  const parsed = formSchema.safeParse({
    channelUrl: formData.get('channelUrl'),
    periodStart: formData.get('periodStart') ?? undefined,
    periodEnd: formData.get('periodEnd') ?? undefined,
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { status: 'invalid', message: first?.message ?? 'Entrada invalida.' };
  }

  const { channelUrl, periodStart, periodEnd } = parsed.data;

  const periodResult = readPeriod(periodStart, periodEnd);
  if ('message' in periodResult) {
    // Intervalo invertido ou incompleto BARRA a analise, antes de gastar quota.
    return { status: 'invalid', message: periodResult.message };
  }

  const pipeline = buildAnalysisPipeline();

  try {
    // Dois casos de uso em sequencia, como o overview.md descreve. Encadea-los
    // automaticamente e assunto da SPEC de filas.
    const started = await pipeline.start.execute({
      requestedBy: user.id,
      channelUrl,
    });

    const finished = await pipeline.calculateMetrics.execute({
      analysisId: started.id,
      requestedBy: user.id,
    });

    const view = await pipeline.getMetrics.execute({
      analysisId: finished.id,
      requestedBy: user.id,
      ...(periodResult.period === undefined ? {} : { period: periodResult.period }),
    });

    if (view.metrics === null) {
      // A analise terminou sem metricas. Nao ha o que exibir, e inventar zeros
      // seria pior que dizer que nao deu (RN-08).
      //
      // NOTA: "nenhum video no periodo" NAO cai aqui. Aquilo produz um
      // `ChannelMetrics` valido com contagens zeradas, e a tela diz que o
      // intervalo esta vazio — que e uma resposta, nao uma falha.
      return { status: 'error', message: GENERIC_FAILURE };
    }

    return {
      status: 'ready',
      mode: pipeline.mode,
      requestedUrl: channelUrl,
      analysisStatus: view.analysis.status,
      metrics: view.metrics,
      requestedPeriod: view.requestedPeriod,
      coverage: view.coverage,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return { status: 'error', message: MESSAGE_BY_CODE[error.code] };
    }
    // Erro nao previsto: nada do original chega ao usuario.
    return { status: 'error', message: GENERIC_FAILURE };
  }
}
