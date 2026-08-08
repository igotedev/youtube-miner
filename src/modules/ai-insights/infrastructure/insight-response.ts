import { z } from 'zod';

import { ExternalServiceError } from '@/shared/errors';

/**
 * O contrato de saida do relatorio (SPEC-011, secao 4).
 *
 * ---------------------------------------------------------------------------
 * DUAS VALIDACOES, E NAO E REDUNDANCIA.
 *
 * `INSIGHT_JSON_SCHEMA` vai para a API e restringe o que o modelo PODE GERAR.
 * `insightResponseSchema` roda aqui e garante o que o nosso codigo RECEBE.
 *
 * As duas respondem perguntas diferentes. A segunda continua valendo se a API
 * mudar, se um intermediario alterar o corpo, ou se o esquema e o tipo
 * divergirem numa edicao futura — que e o defeito mais provavel dos tres.
 *
 * E a mesma regra que ja vale para a YouTube Data API (ADR-004): resposta de
 * terceiro e validada na infraestrutura antes de virar tipo de dominio. A IA
 * nao ganha excecao por ser IA.
 * ---------------------------------------------------------------------------
 *
 * NENHUM CAMPO NUMERICO. Ver `insight-report.ts` e o ADR-007, decisao 4.
 */

/** Tetos de tamanho. Barram resposta absurda antes de ela virar linha no banco. */
const MAX_SUMMARY_LENGTH = 8_000;
const MAX_SHORT_TEXT_LENGTH = 200;
const MAX_ITEM_LENGTH = 500;
const MAX_ITEMS = 10;

/**
 * Esquema enviado a API.
 *
 * `additionalProperties: false` e `required` em tudo sao exigencia do recurso
 * de saida estruturada. Campos opcionais nao existem: o que pode faltar e
 * NULAVEL, e isso e deliberado — um modelo obrigado a preencher todo campo
 * preenche com invencao (SPEC-011, secao 4).
 */
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

export const INSIGHT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'likelyNiche',
    'likelySubNiche',
    'titlePatterns',
    'contentOpportunities',
    'viralDependencyNotes',
  ],
  properties: {
    summary: {
      type: 'string',
      description: 'Leitura em prosa do que os numeros mostram. Nunca promete resultado futuro.',
    },
    likelyNiche: {
      ...nullableString,
      description: 'Nicho provavel do canal. null quando os dados nao permitem inferir.',
    },
    likelySubNiche: {
      ...nullableString,
      description: 'Subnicho provavel. null quando os dados nao permitem inferir.',
    },
    titlePatterns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Padroes observados nos titulos. Lista vazia quando nao ha padrao visivel.',
    },
    contentOpportunities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lacunas observadas. Sao observacoes, nunca previsoes de resultado.',
    },
    viralDependencyNotes: {
      ...nullableString,
      description:
        'Notas sobre concentracao das visualizacoes em poucos videos. null quando a distribuicao nao sugere nada.',
    },
  },
} as const;

/**
 * Esquema de leitura.
 *
 * `.strict()` recusa campo extra de proposito: um campo que o esquema da API
 * nao previa significa que os dois lados divergiram, e continuar em silencio
 * gravaria um relatorio meio validado.
 */
export const insightResponseSchema = z
  .object({
    summary: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH),
    likelyNiche: z.string().trim().max(MAX_SHORT_TEXT_LENGTH).nullable(),
    likelySubNiche: z.string().trim().max(MAX_SHORT_TEXT_LENGTH).nullable(),
    titlePatterns: z.array(z.string().trim().min(1).max(MAX_ITEM_LENGTH)).max(MAX_ITEMS),
    contentOpportunities: z.array(z.string().trim().min(1).max(MAX_ITEM_LENGTH)).max(MAX_ITEMS),
    viralDependencyNotes: z.string().trim().max(MAX_ITEM_LENGTH).nullable(),
  })
  .strict();

export type InsightResponse = z.infer<typeof insightResponseSchema>;

/**
 * Texto -> resposta validada.
 *
 * Falha vira `ExternalServiceError`, e a mensagem NAO carrega o corpo recebido:
 * ele e texto de terceiro, pode conter o que o modelo quis escrever, e acaba em
 * log. O que o erro diz e onde falhou, nao o que veio.
 */
export function parseInsightResponse(raw: string): InsightResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExternalServiceError('Resposta da IA nao e JSON valido.', {
      operation: 'insight.parse',
    });
  }

  const result = insightResponseSchema.safeParse(parsed);
  if (!result.success) {
    // So os CAMINHOS dos campos invalidos, nunca os valores.
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ExternalServiceError('Resposta da IA nao segue o contrato.', {
      operation: 'insight.parse',
      fields,
    });
  }

  return result.data;
}
