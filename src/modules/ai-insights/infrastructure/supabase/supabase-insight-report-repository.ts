import type { SupabaseClient } from '@supabase/supabase-js';

import type { AnalysisId } from '@/modules/channel-analysis';
import type { UserId } from '@/modules/identity';
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
 * O relatorio pertence ao usuario ATRAVES da analise:
 * `ai_insight_reports.analysis_id` referencia `channel_analyses`, que tem
 * `user_id`. O filtro por dono atravessa esse caminho pelo `join`.
 *
 * Ate a auditoria de 2026-08-08 este comentario dizia que o filtro nao era
 * necessario aqui, porque quem chamava ja resolvia a analise por dono. Era
 * verdade — e dependia da ORDEM DAS CHAMADAS, nao do tipo. Agora a assinatura
 * exige o dono, e nao ha como esquecer.
 */

/**
 * Colunas lidas, com o dono trazido pelo `join`.
 *
 * `ai_insight_reports` nao tem `user_id`: o relatorio pertence ao usuario
 * ATRAVES da analise. O `!inner` faz o PostgREST descartar a linha quando o
 * filtro por dono nao casa — em uma unica ida ao banco.
 */
const SELECT_COLUMNS = `
  id, analysis_id, provider, model, prompt_version, report,
  input_tokens, output_tokens, completed_at,
  channel_analyses!inner ( user_id )
`;

export class SupabaseInsightReportRepository implements InsightReportRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByAnalysis(analysisId: AnalysisId, ownerId: UserId): Promise<InsightReport | null> {
    const { data, error } = await this.client
      .from('ai_insight_reports')
      .select(SELECT_COLUMNS)
      // So relatorio CONCLUIDO. Uma tentativa falha fica na tabela para
      // auditoria e nao pode voltar como se fosse resultado.
      .eq('analysis_id', analysisId)
      .eq('status', 'completed')
      /**
       * Filtro por dono NO CODIGO, mesmo com RLS ativo: este repositorio e
       * construido com o cliente administrativo, que ignora RLS. Confiar apenas
       * na policy deixaria o isolamento dependente de qual cliente foi injetado
       * (ADR-005).
       */
      .eq('channel_analyses.user_id', ownerId)
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
