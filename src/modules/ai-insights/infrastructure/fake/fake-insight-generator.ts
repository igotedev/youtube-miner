import type {
  GeneratedInsight,
  InsightGenerator,
  InsightRequest,
} from '../../application/ports/insight-generator';

/**
 * Gerador de relatorio falso, para desenvolvimento e teste.
 *
 * DETERMINISTICO: o mesmo pedido produz o mesmo texto, sempre. E o oposto do
 * adaptador real, e e por isso que ele serve para teste.
 *
 * O texto DIZ que e de exemplo. Um fixture que se passasse por relatorio real
 * enganaria quem estivesse trabalhando na tela — a mesma razao pela qual o
 * fixture da coleta se anuncia (SPEC-007).
 *
 * A composicao o escolhe quando falta `GEMINI_API_KEY`. Nao ha caminho de
 * producao com chave configurada que chegue aqui.
 */

export const FAKE_INSIGHT_PROVIDER = 'fake';
export const FAKE_INSIGHT_MODEL = 'fixture';
export const FAKE_INSIGHT_PROMPT_VERSION = '0.0.0-fixture';

export function createFakeInsightGenerator(): InsightGenerator {
  return {
    identity: {
      provider: FAKE_INSIGHT_PROVIDER,
      model: FAKE_INSIGHT_MODEL,
      promptVersion: FAKE_INSIGHT_PROMPT_VERSION,
    },
    generate(request: InsightRequest): Promise<GeneratedInsight> {
      return Promise.resolve(buildFakeInsight(request));
    },
  };
}

function buildFakeInsight(request: InsightRequest): GeneratedInsight {
  const { metrics } = request;

  return {
    provider: FAKE_INSIGHT_PROVIDER,
    model: FAKE_INSIGHT_MODEL,
    promptVersion: FAKE_INSIGHT_PROMPT_VERSION,
    summary: [
      'RELATORIO DE EXEMPLO. Nenhuma consulta foi feita a um modelo de IA.',
      `O conjunto analisado tem ${metrics.totalVideoCount} videos, sendo`,
      `${metrics.shorts.videoCount} Shorts e ${metrics.long.videoCount} longos.`,
      'Este texto e fixo e nao descreve o canal informado.',
    ].join(' '),
    likelyNiche: null,
    likelySubNiche: null,
    // Vazias de proposito: sao o caso que a tela precisa saber desenhar, e o
    // fixture nao tem como observar padrao nenhum.
    titlePatterns: [],
    contentOpportunities: [],
    viralDependencyNotes: null,
    // Zero e correto aqui: nenhum token foi realmente gasto.
    inputTokens: 0,
    outputTokens: 0,
  };
}
