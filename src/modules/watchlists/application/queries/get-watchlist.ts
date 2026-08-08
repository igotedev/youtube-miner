import type { UserId } from '@/modules/identity';
import type { ChannelDirectory, ChannelSummary } from '@/modules/youtube-collection';
import { NotFoundError } from '@/shared/errors';

import type { Watchlist, WatchlistId, WatchlistItem } from '../../domain/watchlist';
import type { WatchlistRepository } from '../ports/watchlist-repository';

/**
 * Consulta: uma lista com os canais dela, prontos para exibir.
 *
 * E uma CONSULTA: nao muda estado, nao gasta quota, nao chama a IA.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O NOME DO CANAL VEM DE UMA PORTA.
 *
 * O item guarda o `UC...` (RN-01). O titulo vive em `youtube_channels`, tabela
 * do modulo `youtube-collection` — consulta-la daqui seria violacao de R7.
 *
 * `ChannelDirectory.findSummaries` ja existe desde a SPEC-010, criada para o
 * historico pelo mesmo motivo. Aqui ela e reusada sem mudanca: e o segundo caso
 * de uso que aquela porta esperava.
 * ---------------------------------------------------------------------------
 */

export interface WatchlistEntry {
  readonly item: WatchlistItem;
  /**
   * `null` quando o canal sumiu do registro.
   *
   * Nao deveria acontecer — a chave estrangeira e `restrict`, justamente para
   * que um canal acompanhado nao desapareca. Mas a tela nao pode quebrar por
   * causa de uma linha orfa, e `title` nulo ja e caso previsto (RN-08).
   */
  readonly channel: ChannelSummary | null;
}

export interface WatchlistView {
  readonly watchlist: Watchlist;
  readonly entries: readonly WatchlistEntry[];
}

export interface GetWatchlistInput {
  readonly watchlistId: WatchlistId;
  /** Dono da lista. A leitura e sempre escopada. */
  readonly requestedBy: UserId;
}

export interface GetWatchlistDependencies {
  readonly watchlists: WatchlistRepository;
  readonly channelDirectory: ChannelDirectory;
}

export class GetWatchlist {
  constructor(private readonly deps: GetWatchlistDependencies) {}

  async execute(input: GetWatchlistInput): Promise<WatchlistView> {
    const watchlist = await this.deps.watchlists.findById(input.watchlistId, input.requestedBy);

    if (watchlist === null) {
      // Lista de outra pessoa cai aqui tambem: para quem pergunta, ela nao
      // existe. Erro de permissao ja revelaria que existe.
      throw new NotFoundError('Lista nao encontrada.', { watchlistId: input.watchlistId });
    }

    if (watchlist.items.length === 0) {
      // Lista vazia e resultado VALIDO. Sem itens nao ha canal a consultar, e
      // uma ida ao banco com lista vazia seria trabalho puro.
      return { watchlist, entries: [] };
    }

    // Ids UNICOS: a constraint do banco ja impede o mesmo canal duas vezes na
    // mesma lista, mas depender disso aqui acoplaria a consulta ao esquema.
    const channelIds = [...new Set(watchlist.items.map((item) => item.channelId))];
    const summaries = await this.deps.channelDirectory.findSummaries(channelIds);
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));

    return {
      watchlist,
      // A ordem e a que o repositorio devolveu. A juncao nao reordena nada.
      entries: watchlist.items.map((item) => ({
        item,
        channel: byId.get(item.channelId) ?? null,
      })),
    };
  }
}
