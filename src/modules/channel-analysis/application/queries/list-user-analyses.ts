import type { UserId } from '@/modules/identity';
import type { ChannelDirectory, ChannelSummary } from '@/modules/youtube-collection';

import type { Analysis } from '../../domain/analysis';
import type { AnalysisRepository } from '../ports/analysis-repository';

/**
 * Consulta: o historico de analises de um usuario (SPEC-010).
 *
 * E uma CONSULTA. Nao cria, nao avanca estado, nao gasta quota, nao toca a API
 * do YouTube. Le duas tabelas e junta.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O CANAL VEM DE UMA PORTA, E NAO DE UM JOIN.
 *
 * A lista precisa dizer de qual canal e cada analise. `Analysis` carrega o
 * `UC...` e a URL digitada; o titulo vive em `youtube_channels`, tabela do
 * modulo `youtube-collection`. Consulta-la daqui seria violacao de R7 — e o
 * unico ponto do projeto que ja faz isso esta registrado como divida na
 * SPEC-004.
 *
 * `ChannelDirectory` e o contrato exposto para isso. A porta ja existia com
 * escrita; a leitura foi acrescentada aqui porque agora ha chamador.
 * ---------------------------------------------------------------------------
 */

/**
 * Teto de itens do historico.
 *
 * O numero nao tem fundamento estatistico: e grande o bastante para o uso normal
 * e pequeno o bastante para caber em uma pagina sem paginacao. A tela DECLARA o
 * teto — uma lista truncada em silencio faz o usuario concluir que uma analise
 * antiga se perdeu, que e uma afirmacao sobre a persistencia e nao sobre a tela.
 */
export const MAX_HISTORY_ITEMS = 50;

export interface AnalysisHistoryItem {
  readonly analysis: Analysis;
  /**
   * `null` quando o canal nao esta registrado.
   *
   * Nao deveria acontecer — a analise so e criada depois de `ensureRegistered` —
   * mas a lista nao pode quebrar por causa de uma linha orfa. Quem exibe ja
   * trata `title` nulo; um resumo ausente cai no mesmo caminho.
   */
  readonly channel: ChannelSummary | null;
}

export interface ListUserAnalysesInput {
  readonly requestedBy: UserId;
}

export interface AnalysisHistoryView {
  readonly items: readonly AnalysisHistoryItem[];
  /** Teto aplicado. Vai para a tela para que ela possa declara-lo. */
  readonly limit: number;
  /**
   * O teto foi atingido.
   *
   * Nao afirma que ha mais analises — afirma que este metodo nao tem como saber.
   * Contar o total exigiria uma segunda consulta para uma informacao que a tela
   * nao usa, e a mensagem honesta e "pode haver mais", nao "ha mais".
   */
  readonly reachedLimit: boolean;
}

export interface ListUserAnalysesDependencies {
  readonly analyses: AnalysisRepository;
  readonly channelDirectory: ChannelDirectory;
}

export class ListUserAnalyses {
  constructor(private readonly deps: ListUserAnalysesDependencies) {}

  async execute(input: ListUserAnalysesInput): Promise<AnalysisHistoryView> {
    const { analyses, channelDirectory } = this.deps;

    // A assinatura da porta exige o dono. Nao existe `listByOwner()` sem ele — e
    // a mesma decisao de `findById(id, ownerId)`: o filtro por usuario esta no
    // codigo porque o cliente administrativo ignora RLS (ADR-005).
    const found = await analyses.listByOwner(input.requestedBy, MAX_HISTORY_ITEMS);

    if (found.length === 0) {
      // Usuario sem nenhuma analise. Resultado VALIDO, nao erro — e sem itens
      // nao ha canal algum a consultar.
      return { items: [], limit: MAX_HISTORY_ITEMS, reachedLimit: false };
    }

    // Ids UNICOS: dez analises do mesmo canal consultam um canal.
    const channelIds = [...new Set(found.map((analysis) => analysis.channelId))];
    const summaries = await channelDirectory.findSummaries(channelIds);

    const byId = new Map(summaries.map((summary) => [summary.id, summary]));

    return {
      // A ordem e a que o repositorio devolveu — mais recente primeiro. O join
      // nao reordena nada.
      items: found.map((analysis) => ({
        analysis,
        channel: byId.get(analysis.channelId) ?? null,
      })),
      limit: MAX_HISTORY_ITEMS,
      reachedLimit: found.length >= MAX_HISTORY_ITEMS,
    };
  }
}
