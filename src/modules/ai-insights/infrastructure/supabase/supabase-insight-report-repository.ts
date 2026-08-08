import type { SupabaseClient } from '@supabase/supabase-js';

import type { AnalysisId } from '@/modules/channel-analysis';
import {
  isNoRowsReturned,
  translatePostgresError,
} from '@/shared/infrastructure/persistence/postgres-errors';

import type {
  InsightFailure,
  InsightReportRepository,
} from '../../application/ports/insight-report-repository';
import type { InsightReport } from '../../domain/insight-report';
import {
  fromInsightFailure,
  fromInsightReport,
  toInsightReport,
  type InsightReportRow,
} from './insight-report-row';

/**
 * Adaptador Supabase de `InsightReportRepository`.
 *
 * Camada FINA de proposito: toda conversao e validacao vive em
 * `insight-report-row.ts`, que e puro e testado.
 *
 * A tabela pertence ao usuario pela analise: `ai_insight_reports.analysis_id`
 * referencia `channel_analyses` com `on delete cascade`, e a policy de leitura
 * atravessa esse caminho. O filtro por dono NAO precisa estar aqui — quem chama
 * ja resolveu a analise por `findById(id, ownerId)` antes de chegar neste
 * ponto, e uma analise que nao e sua nem existe para quem pergunta.
 */

const SELECT_COLUMNS =
  'id, analysis_id, provider, model, prompt_version, report, input_tokens, output_tokens, completed_at';

export class SupabaseInsightReportRepository implements InsightReportRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByAnalysis(analysisId: AnalysisId): Promise<InsightReport | null> {
    const { data, error } = await this.client
      .from('ai_insight_reports')
      .select(SELECT_COLUMNS)
      // So relatorio CONCLUIDO. Uma tentativa falha fica na tabela para
      // auditoria e nao pode voltar como se fosse resultado.
      .eq('analysis_id', analysisId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1);

    if (error !== null) {
      if (isNoRowsReturned(error)) return null;
      throw translatePostgresError(error, 'insightReport.findByAnalysis');
    }

    const rows = (data ?? []) as unknown as InsightReportRow[];
    const first = rows[0];
    return first === undefined ? null : toInsightReport(first);
  }

  async save(report: InsightReport): Promise<void> {
    const { error } = await this.client
      .from('ai_insight_reports')
      .insert(fromInsightReport(report));

    if (error !== null) {
      throw translatePostgresError(error, 'insightReport.save');
    }
  }

  async saveFailure(failure: InsightFailure): Promise<void> {
    const { error } = await this.client
      .from('ai_insight_reports')
      .insert(fromInsightFailure(failure));

    if (error !== null) {
      throw translatePostgresError(error, 'insightReport.saveFailure');
    }
  }
}
