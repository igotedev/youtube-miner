import { describe, expect, it } from 'vitest';

import { toWatchlist, toWatchlistItem, toWatchlistSummary } from './watchlist-row';

/**
 * O que estes testes travam nao e a conversao feliz — e a recusa.
 *
 * Um mapeador permissivo devolve objeto com `undefined` dentro, e o defeito so
 * aparece na tela, longe da causa. Aqui a linha corrompida falha no lugar onde
 * da para dizer QUAL campo estava errado.
 */

const HEADER = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  name: 'Concorrentes',
  created_at: '2026-08-08T12:00:00.000Z',
};

describe('toWatchlistItem', () => {
  it('converte a linha da funcao para o item de dominio', () => {
    const item = toWatchlistItem({
      channel_id: 'UCabcdefghijklmnopqrstuv',
      added_at: '2026-08-08T13:30:00.000Z',
      note: 'canal de referencia',
    });

    expect(item.channelId).toBe('UCabcdefghijklmnopqrstuv');
    expect(item.addedAt.toISOString()).toBe('2026-08-08T13:30:00.000Z');
    expect(item.note).toBe('canal de referencia');
  });

  it('nota ausente vira null, e nao string vazia', () => {
    // RN-08: "sem nota" e ausencia. Um `''` na tela viraria uma linha em branco
    // que parece nota apagada.
    const item = toWatchlistItem({
      channel_id: 'UCabcdefghijklmnopqrstuv',
      added_at: '2026-08-08T13:30:00.000Z',
      note: null,
    });

    expect(item.note).toBeNull();
  });

  it('RECUSA item sem o identificador do canal', () => {
    // Acontece se a funcao do banco mudar de forma sem o adaptador saber.
    expect(() =>
      toWatchlistItem({ channel_id: null, added_at: '2026-08-08T13:30:00.000Z', note: null }),
    ).toThrow();
  });

  it('RECUSA data invalida em vez de produzir Invalid Date', () => {
    expect(() =>
      toWatchlistItem({ channel_id: 'UCabcdefghijklmnopqrstuv', added_at: 'ontem', note: null }),
    ).toThrow();
  });
});

describe('toWatchlist', () => {
  it('junta cabecalho e itens preservando a ordem recebida', () => {
    const watchlist = toWatchlist(HEADER, [
      { channel_id: 'UCprimeiro00000000000000', added_at: '2026-08-08T13:00:00.000Z', note: null },
      { channel_id: 'UCsegundo00000000000000_', added_at: '2026-08-08T14:00:00.000Z', note: null },
    ]);

    // A ordem e a que a funcao do banco devolveu. O mapeador nao reordena nada:
    // duas fontes de ordenacao acabariam discordando.
    expect(watchlist.items.map((item) => item.channelId)).toEqual([
      'UCprimeiro00000000000000',
      'UCsegundo00000000000000_',
    ]);
    expect(watchlist.name).toBe('Concorrentes');
  });

  it('lista sem itens e resultado valido', () => {
    expect(toWatchlist(HEADER, []).items).toEqual([]);
  });

  it('RECUSA cabecalho com id que nao e UUID', () => {
    expect(() => toWatchlist({ ...HEADER, id: 'lista-1' }, [])).toThrow();
  });
});

describe('toWatchlistSummary', () => {
  it('le a contagem agregada do PostgREST', () => {
    const summary = toWatchlistSummary({ ...HEADER, watchlist_items: [{ count: 3 }] });

    expect(summary.itemCount).toBe(3);
  });

  it('lista vazia conta zero — e aqui zero e o numero certo', () => {
    // RN-08 fala de dado que o YouTube nao entregou. Uma lista sem canais tem,
    // de fato, zero canais.
    expect(toWatchlistSummary({ ...HEADER, watchlist_items: [] }).itemCount).toBe(0);
  });

  it('agregacao ausente ou estranha nao quebra o indice', () => {
    // Uma contagem ilegivel nao pode derrubar a tela inteira: o indice existe
    // para o usuario ACHAR a lista, e o nome ja basta para isso.
    expect(toWatchlistSummary({ ...HEADER, watchlist_items: null }).itemCount).toBe(0);
    expect(toWatchlistSummary({ ...HEADER, watchlist_items: [{ count: -1 }] }).itemCount).toBe(0);
  });

  it('RECUSA nome vazio, que a constraint do banco ja impede', () => {
    expect(() => toWatchlistSummary({ ...HEADER, name: '', watchlist_items: [] })).toThrow();
  });
});
