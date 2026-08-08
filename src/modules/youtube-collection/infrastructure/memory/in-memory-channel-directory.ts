import type { ChannelDirectory, ChannelSummary } from '../../application/ports/channel-directory';
import type { YouTubeChannelId } from '../../domain/youtube-channel';

/**
 * `ChannelDirectory` em memoria, para teste.
 *
 * Registra de verdade — mantem o conjunto — para que um teste possa AFIRMAR que
 * o canal foi registrado antes da analise. Um duble que nao guardasse nada
 * passaria em qualquer ordem de chamada, e a ordem e exatamente o que esta porta
 * existe para garantir.
 */
export class InMemoryChannelDirectory implements ChannelDirectory {
  private readonly registered = new Map<string, ChannelSummary>();

  ensureRegistered(channelId: YouTubeChannelId): Promise<void> {
    // NAO sobrescreve: espelha o `upsert ... ignoreDuplicates` do adaptador
    // real. Registrar de novo um canal ja coletado nao pode apagar o titulo.
    if (!this.registered.has(channelId)) {
      this.registered.set(channelId, { id: channelId, title: null, handle: null });
    }
    return Promise.resolve();
  }

  findSummaries(channelIds: readonly YouTubeChannelId[]): Promise<readonly ChannelSummary[]> {
    const found: ChannelSummary[] = [];
    // Percorre os pedidos, e nao o conjunto guardado: ids repetidos produzem uma
    // entrada so, e canal inexistente e omitido — como no `in (...)` do SQL.
    for (const id of new Set(channelIds)) {
      const summary = this.registered.get(id);
      if (summary !== undefined) found.push(summary);
    }
    return Promise.resolve(found);
  }

  /**
   * Preenche titulo e handle, como a conclusao de uma coleta faria.
   *
   * Fora do contrato da porta de proposito: no adaptador real quem escreve isso
   * e `complete_collection_run`, e nao o diretorio. Existe aqui para um teste
   * poder distinguir "canal registrado sem coleta" de "canal ja coletado".
   */
  setSummary(channelId: YouTubeChannelId, title: string | null, handle: string | null): void {
    this.registered.set(channelId, { id: channelId, title, handle });
  }

  has(channelId: YouTubeChannelId): boolean {
    return this.registered.has(channelId);
  }

  get size(): number {
    return this.registered.size;
  }
}
