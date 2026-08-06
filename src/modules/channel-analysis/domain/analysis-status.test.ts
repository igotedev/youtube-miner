import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_STATUSES,
  isReusableStatus,
  isTerminalStatus,
  type AnalysisStatus,
} from './analysis-status';

describe('estados da analise', () => {
  it('declara exatamente os oito estados da SPEC-001', () => {
    expect(ANALYSIS_STATUSES).toEqual([
      'pending',
      'collecting_channel',
      'collecting_videos',
      'calculating_metrics',
      'generating_insights',
      'completed',
      'partially_completed',
      'failed',
    ]);
  });

  it('trata como finais apenas completed, partially_completed e failed', () => {
    const terminals = ANALYSIS_STATUSES.filter(isTerminalStatus);
    expect(terminals).toEqual(['completed', 'partially_completed', 'failed']);
  });

  it('nao reaproveita analise que falhou', () => {
    // RN-10: cache de analise nunca pode servir um resultado invalido.
    expect(isReusableStatus('failed')).toBe(false);
  });

  it('reaproveita partially_completed, cujos dados objetivos sao validos', () => {
    // RN-09: falha da IA nao invalida os numeros ja apurados.
    expect(isReusableStatus('partially_completed')).toBe(true);
    expect(isReusableStatus('completed')).toBe(true);
  });

  it('nao considera nenhum estado intermediario reaproveitavel', () => {
    const intermediate: AnalysisStatus[] = [
      'pending',
      'collecting_channel',
      'collecting_videos',
      'calculating_metrics',
      'generating_insights',
    ];
    expect(intermediate.filter(isReusableStatus)).toEqual([]);
    expect(intermediate.filter(isTerminalStatus)).toEqual([]);
  });
});
