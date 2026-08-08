import type { ChannelSummary } from '@/modules/youtube-collection';

import { UNAVAILABLE_LABEL } from '../analise/format';

/**
 * Rotulos das telas de listas.
 *
 * Funcoes puras, testadas. Existem separadas dos componentes porque a decisao
 * que elas tomam nao e visual: e a RN-08 aplicada a identificacao do canal —
 * quando o nome nao existe, a tela DIZ que nao existe, em vez de exibir outra
 * coisa no lugar dele.
 */

/**
 * Quantos canais a lista guarda.
 *
 * Frase inteira, e nao um numero solto ao lado de um rotulo: "0 canais" e uma
 * lista vazia, e vale dizer isso com todas as letras — o usuario acabou de
 * cria-la e precisa entender que nada deu errado.
 */
export function formatItemCount(count: number): string {
  if (count === 0) return 'Nenhum canal salvo';
  if (count === 1) return '1 canal';
  return `${count} canais`;
}

/**
 * Nome do canal na lista.
 *
 * Mesma regra do historico: `null` no resumo inteiro e `null` no `title` levam
 * ao mesmo texto, porque os dois significam "ainda nao sabemos o nome deste
 * canal". Nao ha URL digitada aqui para tentar usar como substituta — e nao
 * haveria como usa-la de qualquer forma (RN-02).
 */
export function formatChannelName(channel: ChannelSummary | null): string {
  if (channel === null || channel.title === null) return `Nome ${UNAVAILABLE_LABEL}`;
  return channel.title;
}

/**
 * Identificacao secundaria: o handle, ou o ID oficial quando ele falta.
 *
 * A substituicao e legitima porque os dois identificam o mesmo canal de forma
 * estavel. O ID oficial e o que a RN-01 elege como identidade, e sempre existe.
 */
export function formatChannelIdentifier(channel: ChannelSummary | null, channelId: string): string {
  if (channel === null || channel.handle === null) return channelId;
  return channel.handle;
}

/**
 * A nota do item, ou `null` quando nao ha.
 *
 * Devolve `null` em vez de string vazia para que o componente possa NAO
 * desenhar o paragrafo. Um paragrafo vazio deixa um espaco que parece nota
 * apagada (RN-08).
 */
export function formatNote(note: string | null): string | null {
  if (note === null) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}
