import { describe, expect, it } from 'vitest';

import {
  ACTIVE_COLLECTION_RUN_STATUSES,
  COLLECTION_RUN_STATUSES,
  isActiveCollectionRunStatus,
  isReusableCollectionRun,
  type CollectionRun,
  type CollectionRunId,
  type CollectionRunStatus,
} from './collection-run';
import type { YouTubeChannelId } from './youtube-channel';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const ONE_HOUR = 3_600_000;

function run(overrides: Partial<CollectionRun> = {}): CollectionRun {
  return {
    id: 'run_1' as CollectionRunId,
    channelId: 'UCabcdefghijklmnopqrstuv' as YouTubeChannelId,
    status: 'completed',
    requestedAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
    startedAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
    capturedAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
    completedAt: new Date(NOW.getTime() - 2 * ONE_HOUR),
    failedAt: null,
    reusableUntil: new Date(NOW.getTime() + 22 * ONE_HOUR),
    errorCode: null,
    invalidatedAt: null,
    ...overrides,
  };
}

describe('estados da execucao de coleta', () => {
  it('declara os cinco estados da SPEC-004', () => {
    expect(COLLECTION_RUN_STATUSES).toEqual([
      'pending',
      'collecting_channel',
      'collecting_videos',
      'completed',
      'failed',
    ]);
  });

  it('trata como ativos apenas os tres estados em andamento', () => {
    const active = COLLECTION_RUN_STATUSES.filter(isActiveCollectionRunStatus);
    expect(active).toEqual(ACTIVE_COLLECTION_RUN_STATUSES);
  });

  it('nao considera completed nem failed como ativos', () => {
    const terminal: CollectionRunStatus[] = ['completed', 'failed'];
    expect(terminal.filter(isActiveCollectionRunStatus)).toEqual([]);
  });
});

describe('isReusableCollectionRun', () => {
  it('reaproveita execucao concluida dentro da validade', () => {
    expect(isReusableCollectionRun(run(), NOW)).toBe(true);
  });

  it('aceita o instante exato de expiracao', () => {
    // Fronteira inclusiva, documentada na SPEC-004.
    expect(isReusableCollectionRun(run({ reusableUntil: NOW }), NOW)).toBe(true);
  });

  it('recusa um milissegundo depois da expiracao', () => {
    const expired = run({ reusableUntil: new Date(NOW.getTime() - 1) });
    expect(isReusableCollectionRun(expired, NOW)).toBe(false);
  });

  it('nunca reaproveita execucao que falhou', () => {
    // Reaproveitar uma falha serviria dados incompletos como se fossem bons.
    const failed = run({
      status: 'failed',
      failedAt: NOW,
      errorCode: 'EXTERNAL_SERVICE_ERROR',
      reusableUntil: new Date(NOW.getTime() + ONE_HOUR),
    });
    expect(isReusableCollectionRun(failed, NOW)).toBe(false);
  });

  it('nunca reaproveita execucao em andamento', () => {
    for (const status of ACTIVE_COLLECTION_RUN_STATUSES) {
      const active = run({ status, reusableUntil: new Date(NOW.getTime() + ONE_HOUR) });
      expect(isReusableCollectionRun(active, NOW), `falhou em ${status}`).toBe(false);
    }
  });

  it('recusa execucao sem prazo de validade', () => {
    expect(isReusableCollectionRun(run({ reusableUntil: null }), NOW)).toBe(false);
  });

  it('recusa execucao invalidada administrativamente, mesmo dentro da validade', () => {
    const invalidated = run({ invalidatedAt: new Date(NOW.getTime() - ONE_HOUR) });
    expect(isReusableCollectionRun(invalidated, NOW)).toBe(false);
  });

  it('usa o instante de referencia recebido, nao o relogio do sistema', () => {
    const subject = run();
    const muitoDepois = new Date(NOW.getTime() + 100 * ONE_HOUR);

    expect(isReusableCollectionRun(subject, NOW)).toBe(true);
    expect(isReusableCollectionRun(subject, muitoDepois)).toBe(false);
  });
});
