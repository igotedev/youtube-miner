import { describe, expect, it } from 'vitest';

import type { ChannelSummary } from '@/modules/youtube-collection';
import type { YouTubeChannelId } from '@/modules/youtube-collection';

import { formatChannelIdentifier, formatChannelName, formatItemCount, formatNote } from './labels';

const CHANNEL_ID = 'UCabcdefghijklmnopqrstuv' as YouTubeChannelId;

function summary(overrides: Partial<ChannelSummary> = {}): ChannelSummary {
  return { id: CHANNEL_ID, title: 'Canal Exemplo', handle: '@exemplo', ...overrides };
}

describe('formatItemCount', () => {
  it('diz com todas as letras que a lista esta vazia', () => {
    // "0 canais" ao lado de um rotulo pareceria erro de carregamento. O usuario
    // acabou de criar a lista e precisa entender que nada deu errado.
    expect(formatItemCount(0)).toBe('Nenhum canal salvo');
  });

  it('nao pluraliza um item so', () => {
    expect(formatItemCount(1)).toBe('1 canal');
  });

  it('pluraliza a partir de dois', () => {
    expect(formatItemCount(2)).toBe('2 canais');
  });
});

describe('formatChannelName', () => {
  it('usa o titulo quando ele existe', () => {
    expect(formatChannelName(summary())).toBe('Canal Exemplo');
  });

  it('declara a ausencia em vez de exibir outra coisa no lugar', () => {
    // RN-08. Os dois casos significam a mesma coisa — "ainda nao sabemos o nome
    // deste canal" — e por isso levam ao mesmo texto.
    expect(formatChannelName(null)).toContain('indisponivel');
    expect(formatChannelName(summary({ title: null }))).toContain('indisponivel');
  });
});

describe('formatChannelIdentifier', () => {
  it('prefere o handle', () => {
    expect(formatChannelIdentifier(summary(), CHANNEL_ID)).toBe('@exemplo');
  });

  it('cai no ID oficial, que sempre existe (RN-01)', () => {
    expect(formatChannelIdentifier(summary({ handle: null }), CHANNEL_ID)).toBe(CHANNEL_ID);
    expect(formatChannelIdentifier(null, CHANNEL_ID)).toBe(CHANNEL_ID);
  });
});

describe('formatNote', () => {
  it('devolve a nota aparada', () => {
    expect(formatNote('  referencia  ')).toBe('referencia');
  });

  it('ausencia e nota so com espacos levam ao mesmo null', () => {
    // O componente decide NAO desenhar o paragrafo. Um paragrafo vazio deixa um
    // espaco que parece nota apagada.
    expect(formatNote(null)).toBeNull();
    expect(formatNote('   ')).toBeNull();
  });
});
