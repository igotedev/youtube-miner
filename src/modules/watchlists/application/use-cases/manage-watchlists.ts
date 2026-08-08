import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import type { Clock, UuidGenerator } from '@/shared/domain';
import { NotFoundError } from '@/shared/errors';
import type { Logger } from '@/shared/observability';

import type { WatchlistId } from '../../domain/watchlist';
import { normalizeWatchlistName, normalizeWatchlistNote } from '../../domain/watchlist';
import type { WatchlistRepository } from '../ports/watchlist-repository';

/**
 * Casos de uso das listas (SPEC-012).
 *
 * ---------------------------------------------------------------------------
 * UMA CLASSE, E NAO SEIS.
 *
 * O projeto usa uma classe por caso de uso quando cada um tem dependencias e
 * regras proprias — `StartChannelAnalysis` orquestra quatro portas,
 * `GenerateAnalysisInsight` percorre estados. Aqui as seis operacoes dividem
 * EXATAMENTE as mesmas tres dependencias e nao tem regra entre si: cada uma
 * normaliza a entrada e chama um metodo da porta.
 *
 * Seis classes identicas, com o mesmo construtor, seriam cerimonia — e o
 * `CLAUDE.md` proibe abstracao sem um caso que a justifique. Se alguma delas
 * ganhar regra propria, ela sai daqui.
 * ---------------------------------------------------------------------------
 *
 * O DONO ATRAVESSA TODOS OS METODOS. Nenhum aceita agir sem ele; a porta nao
 * permitiria (SPEC-012, secao 5).
 */

export interface ManageWatchlistsDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ids: UuidGenerator;
  readonly watchlists: WatchlistRepository;
}

export class ManageWatchlists {
  constructor(private readonly deps: ManageWatchlistsDependencies) {}

  /** Devolve o id da lista criada, para a tela poder levar o usuario ate ela. */
  async create(ownerId: UserId, rawName: string): Promise<WatchlistId> {
    // Normaliza ANTES de gravar: o que vai para o banco e o que foi validado,
    // nao o texto cru.
    const name = normalizeWatchlistName(rawName);
    const id = this.deps.ids.next() as WatchlistId;

    await this.deps.watchlists.create({
      id,
      ownerId,
      name,
      createdAt: this.deps.clock.now(),
    });

    this.deps.logger.info('lista criada', { watchlistId: id });
    return id;
  }

  /**
   * As listas do usuario, sem os itens.
   *
   * Fica aqui, e nao em uma consulta propria, porque seria um repasse de uma
   * linha para a porta. Uma classe que so encaminha e a "camada que apenas
   * repassa chamadas" que o projeto evita — e listar as proprias listas e uma
   * acao do usuario sobre elas como qualquer outra.
   *
   * `GetWatchlist` existe separado porque aquilo NAO e repasse: compoe duas
   * portas para trazer o nome dos canais.
   */
  list(ownerId: UserId) {
    return this.deps.watchlists.listByOwner(ownerId);
  }

  async rename(id: WatchlistId, ownerId: UserId, rawName: string): Promise<void> {
    await this.deps.watchlists.rename(id, ownerId, normalizeWatchlistName(rawName));
  }

  async remove(id: WatchlistId, ownerId: UserId): Promise<void> {
    await this.assertOwned(id, ownerId);
    await this.deps.watchlists.remove(id, ownerId);
    this.deps.logger.info('lista removida', { watchlistId: id });
  }

  /**
   * Salva um canal na lista.
   *
   * Idempotente: salvar de novo o mesmo canal nao e erro e nao duplica. Quem
   * clicou duas vezes queria uma coisa so, e o resultado desejado ja vale.
   *
   * NAO GASTA QUOTA E NAO CHAMA A IA: o canal ja esta registrado, porque so da
   * para salvar canal ja analisado. Se ele nao estiver, a chave estrangeira
   * recusa e a porta devolve `NotFoundError` (SPEC-012, secao 2).
   */
  async saveChannel(
    id: WatchlistId,
    ownerId: UserId,
    channelId: YouTubeChannelId,
    rawNote?: string | null,
  ): Promise<void> {
    await this.deps.watchlists.addItem(id, ownerId, {
      channelId,
      addedAt: this.deps.clock.now(),
      note: normalizeWatchlistNote(rawNote),
    });
  }

  async removeChannel(
    id: WatchlistId,
    ownerId: UserId,
    channelId: YouTubeChannelId,
  ): Promise<void> {
    await this.assertOwned(id, ownerId);
    await this.deps.watchlists.removeItem(id, ownerId, channelId);
  }

  /**
   * Recusa cedo o que nao existe ou nao e seu.
   *
   * `remove` e `removeItem` sao idempotentes por desenho: apagar o que nao
   * existe devolveria sucesso, e o usuario acharia que apagou a lista de outra
   * pessoa. Verificar antes transforma isso em 404 — que, para quem pergunta,
   * e a verdade: a lista nao existe.
   */
  private async assertOwned(id: WatchlistId, ownerId: UserId): Promise<void> {
    const found = await this.deps.watchlists.findById(id, ownerId);
    if (found === null) {
      throw new NotFoundError('Lista nao encontrada.', { watchlistId: id });
    }
  }
}
