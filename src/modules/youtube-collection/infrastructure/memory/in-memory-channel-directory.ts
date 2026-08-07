import type { ChannelDirectory } from '../../application/ports/channel-directory';
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
  private readonly registered = new Set<string>();

  ensureRegistered(channelId: YouTubeChannelId): Promise<void> {
    this.registered.add(channelId);
    return Promise.resolve();
  }

  has(channelId: YouTubeChannelId): boolean {
    return this.registered.has(channelId);
  }

  get size(): number {
    return this.registered.size;
  }
}
