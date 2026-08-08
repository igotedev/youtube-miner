import { describe, expect, it } from 'vitest';

import { AppError } from '@/shared/errors';

import { INSIGHT_JSON_SCHEMA, parseInsightResponse } from './insight-response';

/**
 * O contrato de saida da IA.
 *
 * E a fronteira: tudo que passa daqui vira relatorio gravado e exibido. Um
 * campo aceito por engano nao aparece como erro — aparece como texto estranho
 * na tela de alguem.
 */

const VALID = {
  summary: 'O canal publica com cadencia regular.',
  likelyNiche: 'Financas pessoais',
  likelySubNiche: null,
  titlePatterns: ['Pergunta direta no titulo'],
  contentOpportunities: [],
  viralDependencyNotes: null,
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe('parseInsightResponse', () => {
  it('aceita uma resposta completa', () => {
    expect(parseInsightResponse(json(VALID))).toEqual(VALID);
  });

  it('aceita nulos e listas vazias', () => {
    // Um modelo obrigado a preencher todo campo preenche com invencao. Ausencia
    // e resposta legitima, e o contrato precisa aceita-la.
    const minimal = {
      summary: 'Nao ha padrao suficiente para inferir nicho.',
      likelyNiche: null,
      likelySubNiche: null,
      titlePatterns: [],
      contentOpportunities: [],
      viralDependencyNotes: null,
    };

    expect(parseInsightResponse(json(minimal))).toEqual(minimal);
  });

  it('recusa texto que nao e JSON', () => {
    expect(() => parseInsightResponse('Claro! Aqui esta o relatorio:')).toThrow(AppError);
  });

  it('recusa resumo vazio', () => {
    // `summary` e o relatorio. Vazio significa que nao ha relatorio, e devolver
    // um objeto valido com texto vazio exibiria um bloco em branco como se
    // fosse resultado.
    expect(() => parseInsightResponse(json({ ...VALID, summary: '   ' }))).toThrow(AppError);
  });

  it('recusa campo faltando', () => {
    const incompleto: Record<string, unknown> = { ...VALID };
    delete incompleto['viralDependencyNotes'];

    expect(() => parseInsightResponse(json(incompleto))).toThrow(AppError);
  });

  it('recusa campo extra — os dois lados divergiram', () => {
    // Um campo que o esquema da API nao previa significa que a resposta e outro
    // contrato. Continuar em silencio gravaria um relatorio meio validado.
    expect(() => parseInsightResponse(json({ ...VALID, estimatedViews: 5000 }))).toThrow(AppError);
  });

  it('recusa numero onde deveria haver texto', () => {
    expect(() => parseInsightResponse(json({ ...VALID, summary: 12345 }))).toThrow(AppError);
  });

  it('a mensagem de erro nao repete o conteudo recebido', () => {
    const segredo = 'texto-que-nao-pode-vazar-para-o-log';

    try {
      parseInsightResponse(json({ ...VALID, summary: segredo, extra: segredo }));
      throw new Error('deveria ter falhado');
    } catch (error) {
      // Resposta de terceiro acaba em log. O erro diz ONDE falhou, nunca o que
      // veio — a mesma regra de `row-mappers.ts`.
      expect(JSON.stringify(error)).not.toContain(segredo);
      expect((error as AppError).message).not.toContain(segredo);
    }
  });
});

describe('INSIGHT_JSON_SCHEMA', () => {
  it('nao declara nenhum campo numerico', () => {
    // RN-14 estrutural: sem campo numerico, nao ha onde o modelo devolver um
    // numero como se fosse calculo seu. Este teste falha se alguem acrescentar
    // um — que e exatamente quando alguem precisa parar e pensar.
    const types = Object.values(INSIGHT_JSON_SCHEMA.properties).map((prop) =>
      'type' in prop ? prop.type : 'anyOf',
    );

    expect(types).not.toContain('number');
    expect(types).not.toContain('integer');
  });

  it('exige todos os campos e recusa propriedades extras', () => {
    // Exigencia do recurso de saida estruturada. O que pode faltar e NULAVEL, e
    // nao opcional.
    expect(INSIGHT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...INSIGHT_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(INSIGHT_JSON_SCHEMA.properties).sort(),
    );
  });
});
