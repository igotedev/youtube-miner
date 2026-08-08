import type { FormatMetrics } from '@/modules/video-analytics';

import type { InsightRequest } from '../application/ports/insight-generator';

/**
 * Montagem do pedido enviado ao modelo.
 *
 * Funcoes puras, sem I/O e sem relogio: o mesmo pedido produz o mesmo texto, o
 * que torna o prompt testavel sem rede.
 *
 * ---------------------------------------------------------------------------
 * OS NUMEROS VAO NO PEDIDO, JA CALCULADOS.
 *
 * E a RN-14 no formato da entrada. A lista bruta de visualizacoes NAO chega
 * aqui — `InsightRequest` carrega `ChannelMetrics`, que ja e resultado. Sem a
 * lista, nao ha o que somar: a regra deixa de depender de o prompt pedir bem.
 *
 * E por isso que os numeros vao rotulados e por extenso: para o texto CITAR o
 * que recebeu, em vez de estimar de cabeca.
 * ---------------------------------------------------------------------------
 */

/**
 * Versao do prompt. Sobe a cada mudanca no texto abaixo.
 *
 * Vai gravada em `ai_insight_reports.prompt_version`: dois relatorios do mesmo
 * canal so sao comparaveis se der para saber que pergunta cada um respondeu.
 */
export const INSIGHT_PROMPT_VERSION = '1.0.0';

/** Texto unico para dado ausente. `null` NUNCA vira `0` no pedido (RN-08). */
const UNAVAILABLE = 'indisponivel';

export const INSIGHT_SYSTEM_PROMPT = [
  'Voce escreve a leitura interpretativa de um canal do YouTube para um analista.',
  '',
  'Os numeros ja foram calculados por um motor deterministico e vao no pedido.',
  'Escreva SOBRE eles. Nao recalcule, nao estime e nao invente numero nenhum:',
  'se um numero nao esta no pedido, ele nao existe para voce.',
  'Numero marcado como "indisponivel" e ausencia de dado, nunca zero.',
  '',
  'DUAS COISAS QUE O TEXTO NAO PODE CONTER:',
  '',
  '1. Promessa de resultado. Nunca sugira que seguir um padrao observado',
  '   produzira visualizacoes, inscritos ou qualquer resultado futuro.',
  '   Descreva o que foi observado, nao o que vai acontecer.',
  '2. Shorts e videos longos somados ou comparados entre si. Sao formatos com',
  '   dinamicas de distribuicao diferentes; trate cada um no seu proprio termo.',
  '',
  'Escreva em portugues do Brasil, direto, sem elogio ao canal e sem preambulo.',
  'Prefira dizer que nao da para inferir a inferir sem base: os campos aceitam',
  'ausencia, e uma lista vazia e uma resposta legitima.',
].join('\n');

/** Numero -> texto do pedido. `null` vira ausencia declarada, jamais `0`. */
function num(value: number | null, suffix = ''): string {
  if (value === null) return UNAVAILABLE;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function day(value: Date | null): string {
  if (value === null) return UNAVAILABLE;
  return value.toISOString().slice(0, 10);
}

function describeFormat(label: string, metrics: FormatMetrics): string {
  if (metrics.videoCount === 0) {
    return `${label}: nenhum video deste formato na coleta.`;
  }

  return [
    `${label}:`,
    `- videos: ${metrics.videoCount} (sem contagem de views: ${metrics.videosWithoutViewCount})`,
    `- periodo: ${day(metrics.analyzedPeriod.firstPublishedAt)} a ${day(metrics.analyzedPeriod.lastPublishedAt)}` +
      ` (${num(metrics.analyzedPeriod.spanInDays)} dias)`,
    `- views totais: ${num(metrics.viewCount.total)}`,
    `- views mediana: ${num(metrics.viewCount.median)} | media: ${num(metrics.viewCount.average)}`,
    `- views minimo: ${num(metrics.viewCount.minimum)} | maximo: ${num(metrics.viewCount.maximum)}`,
    `- views por dia mediana: ${num(metrics.viewsPerDay.median)} | media: ${num(metrics.viewsPerDay.average)}`,
    `- intervalo entre posts mediana: ${num(metrics.publicationFrequency.medianIntervalDays)} dias`,
    `- videos nos ultimos 30 dias: ${metrics.publicationFrequency.videosLast30Days}`,
    `- fora da curva: ${metrics.outliers.count} | muito fora da curva: ${metrics.outliers.largeCount}` +
      ` | nao classificaveis: ${metrics.outliers.unavailableCount}`,
  ].join('\n');
}

export function buildInsightPrompt(request: InsightRequest): string {
  const { metrics } = request;

  const titles =
    request.recentTitles.length === 0
      ? 'Nenhum titulo disponivel.'
      : request.recentTitles.map((title) => `- ${title}`).join('\n');

  return [
    `Canal: ${request.channelTitle}`,
    `Descricao do canal: ${request.channelDescription || UNAVAILABLE}`,
    '',
    `Coletado em: ${metrics.collectedAt.toISOString()}`,
    `Videos analisados: ${metrics.totalVideoCount} (sem formato definido: ${metrics.unclassifiedVideoCount})`,
    '',
    // RN-06: dois blocos, sem nenhum total agregado entre eles.
    describeFormat('SHORTS', metrics.shorts),
    '',
    describeFormat('VIDEOS LONGOS', metrics.long),
    '',
    'Titulos recentes:',
    titles,
  ].join('\n');
}
