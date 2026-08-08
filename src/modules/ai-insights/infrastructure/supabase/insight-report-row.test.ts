import { describe, expect, it } from 'vitest';

import type { AnalysisId } from '@/modules/channel-analysis';
import { CorruptedPersistedDataError } from '@/shared/errors';

import type { InsightReport, InsightReportId } from '../../domain/insight-report';
import { fromInsightFailure, fromInsightReport, toInsightReport } from './insight-report-row';

/**
 * A ida e volta pelo `jsonb`.
 *
 * O texto do relatorio nao tem colunas proprias — ele viaja dentro de uma
 * coluna JSON. Toda a garantia de que o que sai e o que entrou esta neste
 * mapeamento.
 */

const REPORT_ID = '11111111-1111-4111-8111-111111111111' as InsightReportId;
const ANALYSIS_ID = '22222222-2222-4222-8222-222222222222' as AnalysisId;
const GENERATED_AT = new Date('2026-08-01T09:00:00.000Z');

const REPORT: InsightReport = {
  id: REPORT_ID,
  analysisId: ANALYSIS_ID,
  provider: 'google',
  model: 'gemini-3.6-flash',
  promptVersion: '1.0.0',
  generatedAt: GENERATED_AT,
  summary: 'O canal publica com cadencia regular.',
  likelyNiche: 'Financas pessoais',
  likelySubNiche: null,
  titlePatterns: ['Pergunta direta no titulo'],
  contentOpportunities: [],
  viralDependencyNotes: null,
  inputTokens: 1500,
  outputTokens: 800,
};

/** Simula o caminho real: grava, o driver devolve, le. */
function roundTrip(report: InsightReport): InsightReport {
  const row = fromInsightReport(report);
  return toInsightReport({
    id: row['id'],
    analysis_id: row['analysis_id'],
    provider: row['provider'],
    model: row['model'],
    prompt_version: row['prompt_version'],
    report: row['report'],
    input_tokens: row['input_tokens'],
    output_tokens: row['output_tokens'],
    completed_at: row['completed_at'],
  });
}

describe('insight-report-row', () => {
  it('preserva o relatorio inteiro na ida e volta', () => {
    expect(roundTrip(REPORT)).toEqual(REPORT);
  });

  it('preserva `null` como `null`, e nunca como texto vazio', () => {
    // RN-08 do lado da persistencia: "nao da para inferir o nicho" e diferente
    // de "o nicho e string vazia", e a tela desenha os dois de forma diferente.
    const semNicho = roundTrip({ ...REPORT, likelyNiche: null, viralDependencyNotes: null });

    expect(semNicho.likelyNiche).toBeNull();
    expect(semNicho.viralDependencyNotes).toBeNull();
  });

  it('preserva lista vazia como lista vazia', () => {
    expect(roundTrip({ ...REPORT, titlePatterns: [] }).titlePatterns).toEqual([]);
  });

  it('grava zero tokens sem trocar por ausencia', () => {
    // Zero e legitimo: o fixture nao gasta token nenhum. Vira-lo em `null`
    // faria a tela dizer "custo indisponivel" onde o custo e conhecido.
    const gratis = roundTrip({ ...REPORT, inputTokens: 0, outputTokens: 0 });

    expect(gratis.inputTokens).toBe(0);
    expect(gratis.outputTokens).toBe(0);
  });

  it('marca a linha como concluida e carimba o instante', () => {
    const row = fromInsightReport(REPORT);

    // O `check` do banco recusa `completed` sem relatorio e sem `completed_at`.
    expect(row['status']).toBe('completed');
    expect(row['completed_at']).toBe(GENERATED_AT.toISOString());
    expect(row['report']).not.toBeNull();
  });

  it('recusa uma linha cujo JSON nao segue o contrato', () => {
    // Se o esquema e o tipo divergirem numa edicao futura, a divergencia
    // aparece aqui — e nao como texto estranho na tela de alguem.
    expect(() =>
      toInsightReport({
        id: REPORT_ID,
        analysis_id: ANALYSIS_ID,
        provider: 'google',
        model: 'gemini-3.6-flash',
        prompt_version: '1.0.0',
        report: { summary: 'ok' },
        input_tokens: 1,
        output_tokens: 1,
        completed_at: GENERATED_AT.toISOString(),
      }),
    ).toThrow();
  });

  it('recusa identificador que nao e UUID', () => {
    expect(() =>
      toInsightReport({
        id: 'nao-e-uuid',
        analysis_id: ANALYSIS_ID,
        provider: 'google',
        model: 'gemini-3.6-flash',
        prompt_version: '1.0.0',
        report: fromInsightReport(REPORT)['report'],
        input_tokens: 1,
        output_tokens: 1,
        completed_at: GENERATED_AT.toISOString(),
      }),
    ).toThrow(CorruptedPersistedDataError);
  });
});

describe('fromInsightFailure', () => {
  it('grava a tentativa como falha, sem relatorio', () => {
    const row = fromInsightFailure({
      analysisId: ANALYSIS_ID,
      provider: 'google',
      model: 'gemini-3.6-flash',
      promptVersion: '1.0.0',
      failedAt: GENERATED_AT,
      errorCode: 'EXTERNAL_SERVICE_ERROR',
    });

    // Uma linha `completed` com todos os campos de texto vazios seria a mesma
    // linha com outro significado — e o banco a recusaria de qualquer forma.
    expect(row['status']).toBe('failed');
    expect(row['report']).toBeNull();
    expect(row['error_code']).toBe('EXTERNAL_SERVICE_ERROR');
    expect(row['failed_at']).toBe(GENERATED_AT.toISOString());
  });
});
