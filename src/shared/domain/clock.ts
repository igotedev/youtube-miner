/**
 * Porta de tempo.
 *
 * Nenhum caso de uso chama `new Date()` direto. Duas razoes:
 *  - RN-12: toda analise registra a data e hora da coleta, e esse carimbo
 *    precisa ser verificavel em teste;
 *  - RN-13: calculos devem ser deterministicos. Metricas que dependem de
 *    "agora" (frequencia de postagem, visualizacoes por dia) so sao testaveis
 *    se o "agora" for injetado.
 *
 * A implementacao real vive em shared/infrastructure.
 */
export interface Clock {
  now(): Date;
}
