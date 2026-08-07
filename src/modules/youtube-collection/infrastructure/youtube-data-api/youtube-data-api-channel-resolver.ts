import { NotFoundError } from '@/shared/errors';

import type { ChannelResolver } from '../../application/ports/channel-resolver';
import type { YouTubeChannelId } from '../../domain/youtube-channel';
import {
  parseYouTubeChannelReference,
  type YouTubeChannelReference,
} from '../../domain/youtube-channel-reference';
import { channelsResponseSchema } from './api-schemas';
import type { YouTubeApiClient } from './youtube-api-client';

/**
 * Resolve uma URL de canal para o ID oficial (RN-01).
 *
 * ---------------------------------------------------------------------------
 * ECONOMIA DE QUOTA — a razao de este adaptador existir com este desenho.
 *
 * O passo puro vem PRIMEIRO. `parseYouTubeChannelReference` (SPEC-002) roda
 * offline e resolve o caso mais comum sem gastar nada: quando a URL ja e
 * `/channel/UC...`, o ID esta em maos e a rede nao e tocada.
 *
 * Para os demais, uma unica chamada a `channels.list` — 1 unidade. Em nenhum
 * caminho se usa `search.list`, que custa 100. Essa diferenca e o que separa
 * ~3.000 analises por dia de 100.
 *
 * Entrada invalida tambem nao gasta nada: o parser lanca antes.
 * ---------------------------------------------------------------------------
 */

export class YouTubeDataApiChannelResolver implements ChannelResolver {
  constructor(private readonly client: YouTubeApiClient) {}

  async resolveChannelId(rawUrl: string): Promise<YouTubeChannelId> {
    // Lanca InvalidChannelReferenceError. Offline, antes de qualquer unidade.
    const reference = parseYouTubeChannelReference(rawUrl);

    if (reference.kind === 'channel_id') {
      return reference.value;
    }

    return this.lookup(reference);
  }

  private async lookup(
    reference: Exclude<YouTubeChannelReference, { kind: 'channel_id' }>,
  ): Promise<YouTubeChannelId> {
    const response = await this.client.get(
      'channels',
      { part: 'id', ...this.lookupParam(reference) },
      channelsResponseSchema,
    );

    const first = response.items?.[0];
    if (first === undefined) {
      // HTTP 200 sem `items` e como a API diz "nao existe". Ver api-schemas.ts.
      throw new NotFoundError(
        this.notFoundMessage(reference.kind),
        // `canonicalPath` e derivado e seguro; a URL original nao entra.
        { canonicalPath: reference.canonicalPath },
      );
    }

    return first.id as YouTubeChannelId;
  }

  private lookupParam(
    reference: Exclude<YouTubeChannelReference, { kind: 'channel_id' }>,
  ): Record<string, string> {
    switch (reference.kind) {
      case 'handle':
        // O parser guarda com o `@`, e a API aceita nas duas formas —
        // conferido contra a API real. Repassamos como esta.
        return { forHandle: reference.value };

      case 'legacy_username':
        return { forUsername: reference.value };

      case 'custom_name':
        /**
         * `/c/nome` NAO tem parametro dedicado na API.
         *
         * A maioria desses nomes virou handle quando o YouTube migrou, entao
         * tentamos `forHandle` — 1 unidade. Se nao casar, devolvemos "nao
         * encontrado" com orientacao.
         *
         * A alternativa seria `search.list`, que resolveria mais casos por 100
         * unidades — 33 vezes o custo de uma analise inteira. Nao vale: o
         * usuario consegue a URL canonica em dois cliques no proprio canal.
         */
        return { forHandle: reference.value };
    }
  }

  private notFoundMessage(kind: string): string {
    if (kind === 'custom_name') {
      return 'Nao foi possivel resolver esta URL personalizada. Abra o canal no YouTube e use a URL que comeca com /channel/ ou o handle @.';
    }
    return 'Nenhum canal foi encontrado para essa URL.';
  }
}
