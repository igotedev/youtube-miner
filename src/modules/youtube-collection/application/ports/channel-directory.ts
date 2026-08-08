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
 * O CHAMADOR DA LEITURA CHEGOU (SPEC-010). Ate aqui esta porta so escrevia, e o
 * comentario anterior dizia que `findByOfficialId` seria abstracao especulativa
 * enquanto nenhum modulo precisasse ler o registro. O historico de analises
 * precisa: a lista mostra DE QUAL CANAL e cada analise, e o titulo vive em
 * `youtube_channels` — tabela deste modulo, que `channel-analysis` nao pode
 * consultar (R7).
 *
 * Continua nao existindo `findByOfficialId` no singular: ver `findSummaries`.
 */

/**
 * O que outro modulo pode saber sobre um canal registrado.
 *
 * Recorte deliberadamente pequeno: identificacao para exibir em lista, e nada
 * mais. `YouTubeChannel` completo — inscritos, contagens, descricao — pertence
 * ao snapshot da coleta, e entrega-lo aqui faria esta porta virar uma segunda
 * via de leitura dos dados coletados.
 *
 * `title` e `handle` sao `string | null` por causa da RN-08, e a ausencia e
 * comum, nao excepcional: `ensureRegistered` cria a linha ANTES de a coleta
 * concluir — e a ordem que a SPEC-009 estabeleceu para satisfazer a chave
 * estrangeira da analise. Um canal cuja coleta falhou nunca teve o titulo
 * preenchido, e quem exibe precisa poder dizer isso em vez de mostrar a URL
 * digitada como se fosse o nome do canal.
 */
export interface ChannelSummary {
  readonly id: YouTubeChannelId;
  readonly title: string | null;
  readonly handle: string | null;
}

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

  /**
   * Resumo dos canais pedidos, EM LOTE.
   *
   * Em lote e nao um por vez porque a lista do historico tem ate 50 analises:
   * uma consulta por item bateria no banco 50 vezes para montar uma tela. A
   * assinatura torna o desperdicio impossivel, e nao apenas improvavel.
   *
   * DEVOLVE APENAS O QUE ENCONTROU, em ordem nao garantida. Um canal sem
   * correspondencia simplesmente nao vem — nao e erro. Lancar excecao faria uma
   * analise orfa derrubar a lista inteira, e quem chama ja precisa lidar com
   * `title` nulo de qualquer forma.
   */
  findSummaries(channelIds: readonly YouTubeChannelId[]): Promise<readonly ChannelSummary[]>;
}
