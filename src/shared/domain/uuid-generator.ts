/**
 * Porta de geracao de identificadores.
 *
 * Junto com `Clock`, esta e a segunda fonte de nao-determinismo que o dominio
 * nao pode acessar sozinho (R9). Um caso de uso que chamasse
 * `crypto.randomUUID()` direto produziria uma entidade diferente a cada
 * execucao e nenhum teste poderia fixar o resultado.
 *
 * Existe uma unica porta para os tres modulos que precisam gerar IDs, em vez de
 * `AnalysisIdGenerator`, `CollectionRunIdGenerator` e `AnalyticsResultIdGenerator`:
 * as tres seriam identicas, e o tipo nominal e aplicado no ponto de construcao
 * da entidade, nao na porta.
 *
 * A implementacao vive em `shared/infrastructure`.
 */
export interface UuidGenerator {
  /** Novo UUID v4, em minusculas, no formato canonico com hifens. */
  next(): string;
}
