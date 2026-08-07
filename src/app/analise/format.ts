/**
 * Formatadores da tela de analise.
 *
 * Funcoes puras. NAO sao regra de negocio: decidem como um numero vira texto,
 * nunca qual numero. O calculo pertence a `video-analytics` (RN-14).
 *
 * O que elas carregam e a RN-08 do lado visivel. `null` significa "o dado nao
 * existe", e a tela diz exatamente isso — nunca `0`, nunca um traco mudo. Um
 * canal com inscricoes ocultas nao tem zero inscritos, e um video sem contagem
 * de visualizacoes nao teve zero visualizacoes.
 *
 * `0` legitimo — uma contagem que e realmente zero — continua sendo `0`.
 * Distinguir os dois casos e a funcao inteira deste modulo.
 */

/** Texto unico para dado ausente. Centralizado para nao divergir pela tela. */
export const UNAVAILABLE_LABEL = 'indisponivel';

const LOCALE = 'pt-BR';

/**
 * Inteiro com separador de milhar.
 *
 * `0` devolve `'0'`; `null` devolve o rotulo de ausencia. Os dois casos existem
 * e significam coisas diferentes.
 */
export function formatCount(value: number | null): string {
  if (value === null) return UNAVAILABLE_LABEL;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Numero com casas decimais, para medias e medianas.
 *
 * Arredondar e decisao de APRESENTACAO: o motor devolve o valor cheio, e
 * arredonda-lo antes de guardar perderia precisao para sempre.
 */
export function formatDecimal(value: number | null, fractionDigits = 1): string {
  if (value === null) return UNAVAILABLE_LABEL;
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Intervalo de publicacao em dias.
 *
 * `null` acontece com 0 ou 1 video: nao ha intervalo algum. Um canal com um
 * unico video nao publica "a cada zero dias", e a tela nao pode sugerir isso.
 */
export function formatIntervalDays(value: number | null): string {
  if (value === null) return UNAVAILABLE_LABEL;
  return `${formatDecimal(value)} dias`;
}

/**
 * Data sem hora, em UTC.
 *
 * Separada de `formatTimestamp` porque descreve outra coisa: um dia de
 * publicacao, nao um instante de coleta. Exibir hora aqui sugeriria uma precisao
 * que a leitura do periodo nao usa.
 */
export function formatDate(value: Date | null): string {
  if (value === null) return UNAVAILABLE_LABEL;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeZone: 'UTC' }).format(value);
}

/**
 * Intervalo entre duas datas.
 *
 * Basta UMA das pontas faltar para o intervalo inteiro ser indisponivel: metade
 * de um periodo nao e um periodo, e exibir so o inicio deixaria o leitor
 * completar o resto sozinho.
 */
export function formatDateRange(start: Date | null, end: Date | null): string {
  if (start === null || end === null) return UNAVAILABLE_LABEL;
  return `${formatDate(start)} a ${formatDate(end)}`;
}

/** Instante absoluto, em UTC, para que a leitura nao dependa do fuso do leitor. */
export function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

/** Rotulo humano dos estados da analise (SPEC-001). */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Na fila',
  collecting_channel: 'Coletando o canal',
  collecting_videos: 'Coletando os videos',
  calculating_metrics: 'Calculando as metricas',
  generating_insights: 'Gerando o relatorio',
  completed: 'Concluida',
  partially_completed: 'Concluida sem relatorio de IA',
  failed: 'Falhou',
};

export function formatAnalysisStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Rotulo das faixas de outlier (RN-07). `null` nao e uma quinta faixa. */
const OUTLIER_LABELS: Readonly<Record<string, string>> = {
  normal: 'Normal',
  above_normal: 'Acima do normal',
  outlier: 'Fora da curva',
  large_outlier: 'Muito fora da curva',
};

export function formatOutlierBand(band: string | null): string {
  if (band === null) return 'Nao classificavel';
  return OUTLIER_LABELS[band] ?? band;
}
