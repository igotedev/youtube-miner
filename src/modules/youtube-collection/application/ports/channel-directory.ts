import type { YouTubeChannelId } from '../../domain/youtube-channel';

/**
 * Porta de registro de canais.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ELA EXISTE, E POR QUE SO AGORA.
 *
 * O canal e a identidade canonica de `youtube-collection` (RN-01), e outras
 * tabelas apontam para ele. Uma analise, por exemplo, referencia o canal — o que
 * significa que o canal PRECISA existir antes da analise.
 *
 * Enquanto a persistencia era em memoria isso nao aparecia: o repositorio falso
 * aceitava qualquer identificador de canal, existente ou nao. Contra o
 * PostgreSQL, a primeira analise de um canal novo falha com violacao de chave
 * estrangeira — porque quem registra o canal e a COLETA, e a coleta so comeca
 * depois que a analise ja foi criada.
 *
 * O ADR-005 previu esta porta pelo nome, como a forma correta de outro modulo
 * garantir que o canal existe sem consultar a tabela alheia. O defeito acima foi
 * o segundo caso de uso que a justificava.
 * ---------------------------------------------------------------------------
 *
 * O que NAO esta aqui: leitura. Nao ha `findByOfficialId` — nenhum modulo tem
 * caso de uso para ler o registro do canal, e uma porta com metodo sem chamador
 * e abstracao especulativa. Acrescente quando houver o chamador.
 */
export interface ChannelDirectory {
  /**
   * Garante que o canal esta registrado, criando o registro se necessario.
   *
   * IDEMPOTENTE: chamar duas vezes para o mesmo canal e o mesmo que chamar uma.
   * Duas analises simultaneas do mesmo canal novo sao o caso comum, nao a
   * excecao, e nenhuma das duas pode falhar por causa da outra.
   *
   * Nao devolve nada de proposito. O identificador interno usado pelas chaves
   * estrangeiras e detalhe de persistencia e nao atravessa esta fronteira — quem
   * chama fala `UC...`, sempre.
   */
  ensureRegistered(channelId: YouTubeChannelId): Promise<void>;
}
