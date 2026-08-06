import type { Brand } from '@/shared/domain';

/**
 * ID oficial do canal no YouTube (formato `UC...`).
 *
 * RN-01/RN-02: e este valor, nao a URL digitada, que identifica um canal em
 * todo o sistema. Handles (`@nome`) e URLs customizadas mudam; o ID nao.
 */
export type YouTubeChannelId = Brand<string, 'YouTubeChannelId'>;

/**
 * Dados publicos do canal, como vieram da API.
 *
 * Campos que a API pode omitir sao `null`, nunca `0` — RN-08: dado
 * indisponivel nao pode ser exibido como zero. `subscriberCount` e o caso
 * classico: canais podem ocultar a inscricao, e "oculto" nao e "zero
 * inscritos".
 */
export interface YouTubeChannel {
  readonly id: YouTubeChannelId;
  readonly title: string;
  readonly handle: string | null;
  readonly description: string;
  readonly publishedAt: Date;
  readonly country: string | null;
  readonly subscriberCount: number | null;
  readonly hiddenSubscriberCount: boolean;
  readonly videoCount: number | null;
  readonly viewCount: number | null;
}
