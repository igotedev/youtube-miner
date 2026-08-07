import type { VideoFormat } from './youtube-video';

/**
 * Duracao do video: parse do formato da API e classificacao do formato.
 *
 * Funcoes puras. Ficam em `domain` — e nao dentro do adaptador — por dois
 * motivos: a classificacao Shorts/longo e a RN-06, que e regra de negocio; e o
 * parse precisa de teste exaustivo, que nao teria como rodar preso a uma
 * chamada de rede.
 */

/**
 * ISO 8601 de duracao, restrito ao que a YouTube Data API produz.
 *
 * Aceita dias, horas, minutos e segundos, todos opcionais. Semanas (`P2W`) e
 * componentes de data (anos, meses) NAO sao aceitos: a API nao os emite para
 * video, e aceita-los exigiria decidir quantos dias tem um mes.
 */
const ISO_8601_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

/**
 * Converte a duracao da API em segundos.
 *
 * Devolve `null` quando a string nao e reconhecivel — RN-08. Nunca devolve `0`
 * para entrada invalida: `0` e um valor legitimo (`PT0S`, `P0D`) e significa
 * outra coisa.
 *
 * `P0D` e o que a API emite para transmissoes ao vivo e videos ainda nao
 * finalizados. O parse devolve `0` fielmente; quem decide o que fazer com isso
 * e `classifyVideoFormat`.
 */
export function parseIso8601Duration(value: string): number | null {
  const match = ISO_8601_DURATION.exec(value.trim());
  if (match === null) return null;

  const [, days, hours, minutes, seconds] = match;

  // `P` sozinho casa com o padrao mas nao carrega componente algum. Nao e uma
  // duracao de zero segundos — e uma string sem informacao.
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) {
    return null;
  }

  const total =
    Number(days ?? 0) * SECONDS_PER_DAY +
    Number(hours ?? 0) * SECONDS_PER_HOUR +
    Number(minutes ?? 0) * SECONDS_PER_MINUTE +
    Number(seconds ?? 0);

  return Number.isFinite(total) ? total : null;
}

/**
 * Duracao maxima de um Short, em segundos.
 *
 * O YouTube subiu o teto de 60 para 180 segundos. O valor esta aqui, nomeado,
 * porque muda por decisao de plataforma e nao deve ficar espalhado.
 */
export const SHORTS_MAX_DURATION_SECONDS = 180;

/**
 * Classifica o formato do video pela duracao (RN-06).
 *
 * APROXIMACAO ASSUMIDA, e vale registrar. O que define um Short no YouTube nao
 * e so a duracao: proporcao vertical e origem da publicacao tambem contam, e
 * nenhuma das duas vem em `videos.list`. Descobri-las exigiria outra chamada por
 * video — 50 unidades de quota por analise, contra 1.
 *
 * Por isso a duracao e o criterio, e por isso `unknown` existe: e melhor um
 * video fora dos dois blocos do que um video no bloco errado, que deslocaria a
 * mediana daquele formato.
 *
 * `0` cai em `unknown` de proposito. A API emite `P0D` para transmissao ao vivo
 * e video nao finalizado; classificar isso como Short poluiria a mediana dos
 * Shorts com um video que nao e um.
 */
export function classifyVideoFormat(durationSeconds: number | null): VideoFormat {
  if (durationSeconds === null) return 'unknown';
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'unknown';
  return durationSeconds <= SHORTS_MAX_DURATION_SECONDS ? 'short' : 'long';
}
