import type { ChannelSummary } from '@/modules/youtube-collection';

import { UNAVAILABLE_LABEL } from '../analise/format';

/**
 * Rotulos da tela de historico.
 *
 * Funcoes puras, testadas. Existem separadas do componente porque a decisao que
 * elas tomam nao e visual: e a RN-08 aplicada a identificacao do canal — quando
 * o nome nao existe, a tela DIZ que nao existe, em vez de exibir outra coisa no
 * lugar dele.
 */

/**
 * Nome do canal para a lista.
 *
 * A tentacao errada seria cair na URL digitada quando o titulo falta. A URL nao
 * e o nome do canal: e o que o usuario escreveu, pode ser um handle antigo, um
 * ID cru ou uma URL customizada que mudou de dono (RN-02). Exibi-la no lugar do
 * titulo apresentaria uma coisa como outra.
 *
 * `null` no resumo inteiro e no `title` levam ao mesmo texto de proposito: os
 * dois significam "ainda nao sabemos o nome deste canal".
 */
export function formatChannelName(channel: ChannelSummary | null): string {
  if (channel === null || channel.title === null) return `Nome ${UNAVAILABLE_LABEL}`;
  return channel.title;
}

/**
 * Identificacao secundaria: o handle, ou o ID oficial quando ele falta.
 *
 * Aqui a substituicao E legitima, porque os dois identificam o mesmo canal de
 * forma estavel — diferente da URL digitada. O ID oficial e o que a RN-01 elege
 * como identidade, e sempre existe.
 */
export function formatChannelIdentifier(channel: ChannelSummary | null, channelId: string): string {
  if (channel === null || channel.handle === null) return channelId;
  return channel.handle;
}

/**
 * Aviso do teto, exibido apenas quando ele foi atingido.
 *
 * Nao afirma que ha analises mais antigas — afirma que a lista nao tem como
 * saber. A consulta pediu `limit` itens e recebeu `limit`; contar o resto seria
 * outra ida ao banco para uma informacao que a tela nao usa.
 *
 * `null` quando o teto nao foi atingido: nesse caso a lista esta completa, e um
 * aviso permanente faria o usuario duvidar de uma lista inteira.
 */
export function limitNotice(reachedLimit: boolean, limit: number): string | null {
  if (!reachedLimit) return null;
  return `O historico mostra no maximo ${limit} analises, e esse limite foi atingido. Pode haver analises mais antigas fora desta lista.`;
}
