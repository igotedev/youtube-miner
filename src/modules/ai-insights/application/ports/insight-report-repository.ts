import type { AnalysisId } from '@/modules/channel-analysis';

import type { InsightReport } from '../../domain/insight-report';

/**
 * Porta de persistencia dos relatorios.
 *
 * R7: a tabela `ai_insight_reports` pertence a este modulo. `channel-analysis`
 * orquestra a geracao por este contrato e nunca por SQL proprio.
 *
 * ---------------------------------------------------------------------------
 * O RELATORIO E DO USUARIO, E NAO E ARTEFATO GLOBAL.
 *
 * Diferente da coleta e das metricas, que sao reaproveitadas entre pessoas pela
 * RN-10, o relatorio pertence a UMA analise — chave estrangeira com
 * `on delete cascade`. Apagar o usuario leva os relatorios dele junto.
 *
 * Por isso nao ha leitura "por canal" nem por versao de prompt: nao existe
 * reuso a implementar. Ver ADR-005.
 * ---------------------------------------------------------------------------
 */
export interface InsightReportRepository {
  /**
   * Relatorio CONCLUIDO desta analise, se houver.
   *
   * Tentativas que falharam nao voltam por aqui: elas ficam gravadas para
   * auditoria, mas nao sao relatorio. Devolver uma delas faria a tela exibir
   * texto vazio como se fosse resultado.
   */
  findByAnalysis(analysisId: AnalysisId): Promise<InsightReport | null>;

  save(report: InsightReport): Promise<void>;

  /**
   * Registra uma tentativa que falhou.
   *
   * Existe separado de `save` porque grava coisas diferentes: nao ha relatorio,
   * ha um codigo de erro. Um `save` com todos os campos textuais vazios seria a
   * mesma linha com outro significado, e a diferenca sumiria na leitura.
   *
   * `errorCode` e codigo estavel, nunca a mensagem bruta do provedor — ela
   * carrega detalhe interno e acaba em log.
   */
  saveFailure(failure: InsightFailure): Promise<void>;
}

export interface InsightFailure {
  readonly analysisId: AnalysisId;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly failedAt: Date;
  readonly errorCode: string;
}
