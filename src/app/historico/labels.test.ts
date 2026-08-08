import { describe, expect, it } from 'vitest';

import type { ChannelSummary } from '@/modules/youtube-collection';

import { UNAVAILABLE_LABEL } from '../analise/format';
import { formatChannelIdentifier, formatChannelName, limitNotice } from './labels';

const CHANNEL_ID = 'UC_fixture_channel_00000';

function summary(patch: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id: CHANNEL_ID as ChannelSummary['id'],
    title: 'Canal de Exemplo',
    handle: '@canal-de-exemplo',
    ...patch,
  };
}

describe('formatChannelName', () => {
  it('usa o titulo quando ele existe', () => {
    expect(formatChannelName(summary())).toBe('Canal de Exemplo');
  });

  it('diz que o nome esta indisponivel quando o titulo e nulo', () => {
    // RN-08: o nome NAO EXISTE. Nao vira string vazia nem cai na URL digitada.
    expect(formatChannelName(summary({ title: null }))).toContain(UNAVAILABLE_LABEL);
  });

  it('trata resumo ausente como nome indisponivel', () => {
    // Canal sumido do registro e canal sem titulo significam a mesma coisa para
    // quem le: ainda nao sabemos o nome.
    expect(formatChannelName(null)).toBe(formatChannelName(summary({ title: null })));
  });
});

describe('formatChannelIdentifier', () => {
  it('usa o handle quando ele existe', () => {
    expect(formatChannelIdentifier(summary(), CHANNEL_ID)).toBe('@canal-de-exemplo');
  });

  it('cai no ID oficial quando o handle falta', () => {
    // A substituicao e legitima: os dois identificam o mesmo canal de forma
    // estavel, e o ID oficial e a identidade eleita pela RN-01.
    expect(formatChannelIdentifier(summary({ handle: null }), CHANNEL_ID)).toBe(CHANNEL_ID);
    expect(formatChannelIdentifier(null, CHANNEL_ID)).toBe(CHANNEL_ID);
  });
});

describe('limitNotice', () => {
  it('nao avisa nada quando o teto nao foi atingido', () => {
    // Lista completa. Um aviso permanente faria o usuario duvidar dela.
    expect(limitNotice(false, 50)).toBeNull();
  });

  it('declara o teto e diz que PODE haver mais, nunca que ha', () => {
    const notice = limitNotice(true, 50);

    expect(notice).toContain('50');
    expect(notice).toContain('Pode haver');
  });
});
