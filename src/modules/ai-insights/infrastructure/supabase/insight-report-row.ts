import type { AnalysisId } from '@/modules/channel-analysis';
import {
  fromDate,
  toCount,
  toDate,
  toText,
  toUuid,
} from '@/shared/infrastructure/persistence/row-mappers';
import { toJsonObject } from '@/shared/infrastructure/persistence/row-mappers';

import type { InsightFailure } from '../../application/ports/insight-report-repository';
import type { InsightReport, InsightReportId } from '../../domain/insight-report';
import { insightResponseSchema } from '../insight-response';

/**
 * Mapeamento entre a linha de `ai_insight_reports` e `InsightReport`.
 *
 * Uma linha corrompida FALHA aqui. Nenhum `as InsightReport` sobre o objeto
 * inteiro: cada campo passa por um conversor que valida.
 *
 * ---------------------------------------------------------------------------
 * O TEXTO VIVE EM `report` (jsonb), E ELE E VALIDADO PELO MESMO ZOD DA API.
 *
 * Reusar `insightResponseSchema` na leitura nao e economia — e a garantia de
 * que o que sai do banco obedece exatamente o contrato que entrou. Um esquema
 * proprio aqui divergiria do outro na primeira edicao, e a divergencia so
 * apareceria em producao.
 *
 * A coluna e `jsonb`, e nao seis colunas de texto, porque o conjunto de campos
 * do relatorio muda com a versao do prompt. Colunas fixas obrigariam uma
 * migracao a cada ajuste de redacao.
 * ---------------------------------------------------------------------------
 */

/** Idioma do relatorio. O prompt escreve em pt-BR; a coluna registra isso. */
export const INSIGHT_LANGUAGE = 'pt-BR';

export interface InsightReportRow {
  readonly id: unknown;
  readonly analysis_id: unknown;
  readonly provider: unknown;
  readonly model: unknown;
  readonly prompt_version: unknown;
  readonly report: unknown;
  readonly input_tokens: unknown;
  readonly output_tokens: unknown;
  readonly completed_at: unknown;
}

export function toInsightReport(row: InsightReportRow): InsightReport {
  const payload = insightResponseSchema.parse(
    toJsonObject(row.report, 'ai_insight_reports.report'),
  );

  return {
    id: toUuid(row.id, 'ai_insight_reports.id') as InsightReportId,
    analysisId: toUuid(row.analysis_id, 'ai_insight_reports.analysis_id') as AnalysisId,
    provider: toText(row.provider, 'ai_insight_reports.provider'),
    model: toText(row.model, 'ai_insight_reports.model'),
    promptVersion: toText(row.prompt_version, 'ai_insight_reports.prompt_version'),
    // `completed_at` E o instante da geracao. O banco garante que ele existe
    // quando `status = 'completed'`, e so linhas concluidas chegam aqui.
    generatedAt: toDate(row.completed_at, 'ai_insight_reports.completed_at'),
    ...payload,
    // Contagens, e nao medidas ausentes: `0` e legitimo (o fixture gasta zero).
    inputTokens: toCount(row.input_tokens, 'ai_insight_reports.input_tokens') ?? 0,
    outputTokens: toCount(row.output_tokens, 'ai_insight_reports.output_tokens') ?? 0,
  };
}

/** Colunas gravadas no caminho feliz. */
export function fromInsightReport(report: InsightReport): Record<string, unknown> {
  return {
    id: report.id,
    analysis_id: report.analysisId,
    status: 'completed',
    provider: report.provider,
    model: report.model,
    prompt_version: report.promptVersion,
    language: INSIGHT_LANGUAGE,
    report: {
      summary: report.summary,
      likelyNiche: report.likelyNiche,
      likelySubNiche: report.likelySubNiche,
      titlePatterns: [...report.titlePatterns],
      contentOpportunities: [...report.contentOpportunities],
      viralDependencyNotes: report.viralDependencyNotes,
    },
    input_tokens: report.inputTokens,
    output_tokens: report.outputTokens,
    completed_at: fromDate(report.generatedAt, 'generatedAt'),
  };
}

/**
 * Colunas de uma tentativa que falhou.
 *
 * `report` fica nulo e `status` e `failed` — o `check` do banco recusaria uma
 * linha `completed` sem relatorio, que e exatamente o engano que este caminho
 * separado evita.
 */
export function fromInsightFailure(failure: InsightFailure): Record<string, unknown> {
  return {
    analysis_id: failure.analysisId,
    status: 'failed',
    provider: failure.provider,
    model: failure.model,
    prompt_version: failure.promptVersion,
    language: INSIGHT_LANGUAGE,
    report: null,
    failed_at: fromDate(failure.failedAt, 'failedAt'),
    error_code: failure.errorCode,
  };
}
