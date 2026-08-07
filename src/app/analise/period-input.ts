/**
 * Conversao das datas do formulario para instantes absolutos.
 *
 * Funcoes puras. NAO sao regra de negocio: decidem como `2026-01-31` vira um
 * instante, nunca quais videos entram. A regra de selecao pertence ao dominio
 * (`isWithinPeriod`), e a validacao do intervalo tambem.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AS BORDAS SAO EXPANDIDAS AQUI, E EM UTC.
 *
 * `<input type="date">` devolve `AAAA-MM-DD`, sem hora e sem fuso — um DIA DE
 * CALENDARIO, nao um instante. O dominio compara instantes.
 *
 * Quem digita `01/01 a 31/01` espera que um video publicado as 22h do dia 31
 * entre. Se a borda final virasse `31/01T00:00:00Z`, ele ficaria de fora e
 * ninguem entenderia por que.
 *
 * UTC porque e o fuso que o produto inteiro usa para exibir: `formatDate` e
 * `formatTimestamp` fixam `timeZone: 'UTC'`. Expandir no fuso do navegador
 * faria o mesmo intervalo selecionar conjuntos diferentes conforme quem olha, e
 * a analise deixaria de ser reproduzivel.
 *
 * Consequencia assumida e visivel: as datas sao interpretadas como dias UTC.
 * Para um usuario em Sao Paulo (UTC-3), um video publicado as 22h do dia 31 no
 * horario local ja e dia 1o em UTC e fica de fora. E o mesmo criterio que a tela
 * usa para EXIBIR a data do video, entao os dois concordam.
 * ---------------------------------------------------------------------------
 */

/** `AAAA-MM-DD`, o formato que `<input type="date">` produz e aceita. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inicio do dia em UTC: `AAAA-MM-DDT00:00:00.000Z`.
 *
 * Devolve `null` para entrada malformada ou para um dia que nao existe —
 * `2026-02-31` casa com o padrao e nao e uma data.
 */
export function parseDayStart(value: string): Date | null {
  return parseDay(value, 'T00:00:00.000Z');
}

/** Fim do dia em UTC: `AAAA-MM-DDT23:59:59.999Z`. Borda final INCLUSIVA. */
export function parseDayEnd(value: string): Date | null {
  return parseDay(value, 'T23:59:59.999Z');
}

function parseDay(value: string, timeSuffix: string): Date | null {
  const trimmed = value.trim();
  if (!ISO_DAY.test(trimmed)) return null;

  const parsed = new Date(`${trimmed}${timeSuffix}`);
  if (Number.isNaN(parsed.getTime())) return null;

  /**
   * `new Date('2026-02-31T00:00:00.000Z')` e `Invalid Date` no V8, mas a regra
   * nao e garantida por especificacao para toda data fora de faixa. A volta pelo
   * ISO confirma que o dia sobreviveu intacto, em vez de ter sido normalizado
   * para 1o de marco em silencio.
   */
  if (!parsed.toISOString().startsWith(trimmed)) return null;

  return parsed;
}

/**
 * Atalhos oferecidos na tela.
 *
 * Sao APENAS rotulos e uma quantidade de dias. O calculo do intervalo acontece
 * no NAVEGADOR, preenchendo os dois campos de data — o servidor recebe sempre
 * duas datas explicitas.
 *
 * Isso mantem o servidor livre de relogio no caminho da analise (R9 vale para
 * dominio e aplicacao, e nao ha motivo para relaxar aqui) e deixa o usuario ver
 * exatamente qual intervalo sera analisado antes de enviar.
 */
export const PERIOD_SHORTCUTS = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: '6 meses', days: 180 },
  { label: '1 ano', days: 365 },
] as const;

/**
 * Intervalo de `days` dias terminando em `reference`, como `AAAA-MM-DD`.
 *
 * `days` conta o dia de hoje: "7 dias" vai de hoje-6 ate hoje, sete dias
 * inclusive. Usar hoje-7 daria oito dias e o rotulo mentiria.
 *
 * `reference` chega por parametro — a funcao nao le o relogio, e por isso e
 * testavel.
 */
export function shortcutRange(days: number, reference: Date): { start: string; end: string } {
  const end = new Date(reference.getTime());
  const start = new Date(reference.getTime());
  start.setUTCDate(start.getUTCDate() - (days - 1));

  return { start: toIsoDay(start), end: toIsoDay(end) };
}

/** `Date` -> `AAAA-MM-DD` em UTC, o formato que o input espera de volta. */
export function toIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
