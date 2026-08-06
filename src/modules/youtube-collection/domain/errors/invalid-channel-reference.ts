import { DomainError } from '@/shared/errors';

/**
 * Motivo da recusa de uma referencia de canal.
 *
 * Por que um discriminante e nao uma classe por caso: o `ErrorCode` de
 * `shared/errors` e um conjunto fechado e transversal. Criar
 * `InvalidYouTubeHandleError`, `InvalidYouTubeHostnameError` e companhia
 * obrigaria a acrescentar codigos especificos do YouTube la — e `shared`
 * passaria a conhecer handles, hostnames e IDs de canal. O conceito ficaria no
 * lugar errado.
 *
 * Aqui o codigo transversal continua sendo `VALIDATION_ERROR` (herdado de
 * `DomainError`) e o detalhe fica dentro do modulo, onde ele pertence.
 */
export type InvalidChannelReferenceReason =
  /** Entrada vazia ou so com espacos. */
  | 'empty_input'
  /** Parece uma URL, mas nao pode ser interpretada como tal. */
  | 'malformed_url'
  /** Protocolo diferente de http/https. */
  | 'unsupported_protocol'
  /** URL com usuario e senha embutidos. */
  | 'credentials_in_url'
  /** Dominio fora da lista permitida. */
  | 'unsupported_host'
  /** URL do YouTube, mas de video, Shorts, playlist, busca ou live. */
  | 'not_a_channel_url'
  /** URL do YouTube com caminho que nao corresponde a nenhum formato de canal. */
  | 'unknown_path'
  | 'invalid_channel_id'
  | 'invalid_handle'
  | 'invalid_custom_name'
  | 'invalid_legacy_username'
  /** Texto que nao se parece com URL, handle nem ID de canal. */
  | 'unrecognized_input';

/**
 * Mensagens voltadas ao usuario final.
 *
 * Nenhuma delas interpola a entrada. Isso e deliberado: a entrada pode conter
 * credenciais (`https://usuario:senha@youtube.com/...`), e mensagem de erro
 * costuma acabar em log. Quem chamou a funcao ja tem o valor em maos e pode
 * decidir, com o contexto que tem, se e seguro exibi-lo.
 */
const MESSAGES: Readonly<Record<InvalidChannelReferenceReason, string>> = {
  empty_input: 'Informe a URL ou o identificador de um canal do YouTube.',
  malformed_url: 'A URL informada nao pode ser interpretada.',
  unsupported_protocol: 'Use uma URL http ou https.',
  credentials_in_url: 'A URL informada contem credenciais e nao pode ser usada.',
  unsupported_host:
    'Informe um endereco do YouTube (youtube.com, www.youtube.com ou m.youtube.com).',
  not_a_channel_url: 'Esse endereco aponta para um video, playlist ou busca, nao para um canal.',
  unknown_path: 'Esse endereco do YouTube nao corresponde a um canal.',
  invalid_channel_id: 'O ID de canal informado nao tem o formato esperado.',
  invalid_handle: 'O handle informado nao tem o formato esperado.',
  invalid_custom_name: 'O nome personalizado informado nao tem o formato esperado.',
  invalid_legacy_username: 'O nome de usuario informado nao tem o formato esperado.',
  unrecognized_input: 'Nao foi possivel reconhecer um canal do YouTube nessa entrada.',
};

/**
 * Recusa de uma referencia de canal.
 *
 * Erro esperado, nao excepcional: entrada invalida de usuario e rotina. Ainda
 * assim e lancado, e nao devolvido, porque esse e o padrao de erro ja adotado
 * no projeto (`AppError` e subclasses) e a porta `ChannelResolver` ja declara
 * `@throws`. Introduzir um `Result` so aqui criaria dois padroes convivendo.
 */
export class InvalidChannelReferenceError extends DomainError {
  readonly reason: InvalidChannelReferenceReason;

  constructor(reason: InvalidChannelReferenceReason) {
    super(MESSAGES[reason], { reason });
    this.reason = reason;
  }
}
