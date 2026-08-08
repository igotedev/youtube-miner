import { beforeEach, describe, expect, it } from 'vitest';

import type { UserId } from '@/modules/identity';
import type { YouTubeChannelId } from '@/modules/youtube-collection';

import type { Analysis, AnalysisId } from '../../domain/analysis';
import { InMemoryAnalysisRepository } from './in-memory-analysis-repository';

/**
 * Contrato de `listByOwner` (SPEC-010).
 *
 * O fake e uma das duas implementacoes da porta; a outra roda contra o Postgres
 * em `tests/integration/`. O que se afirma aqui e o CONTRATO — ordem, teto,
 * isolamento — e os dois lados precisam concordar. Um fake mais permissivo que o
 * banco esconde defeito ate a producao, que foi como o problema do canal nao
 * registrado sobreviveu ate a SPEC-009.
 */

const OWNER = 'user-owner' as UserId;
const STRANGER = 'user-stranger' as UserId;
const CHANNEL_ID = 'UC_fixture_channel_00000' as YouTubeChannelId;

function buildAnalysis(id: string, requestedAt: string, owner: UserId = OWNER): Analysis {
  return {
    id: id as AnalysisId,
    requestedBy: owner,
    channelId: CHANNEL_ID,
    requestedUrl: 'https://www.youtube.com/@canal-de-exemplo',
    status: 'partially_completed',
    collectionRunId: null,
    analyticsResultId: null,
    idempotencyKey: null,
    requestedAt: new Date(requestedAt),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
  };
}

describe('InMemoryAnalysisRepository.listByOwner', () => {
  let repository: InMemoryAnalysisRepository;

  beforeEach(() => {
    repository = new InMemoryAnalysisRepository();
  });

  it('devolve lista vazia para quem nunca analisou nada', async () => {
    const found = await repository.listByOwner(OWNER, 50);

    // Ausencia de analises e resultado valido, nao erro.
    expect(found).toEqual([]);
  });

  it('ordena da mais recente para a mais antiga', async () => {
    // Inseridas fora de ordem de proposito: a ordem do resultado nao pode
    // depender da ordem de insercao.
    await repository.create(buildAnalysis('b', '2026-07-15T00:00:00.000Z'));
    await repository.create(buildAnalysis('c', '2026-08-01T00:00:00.000Z'));
    await repository.create(buildAnalysis('a', '2026-06-01T00:00:00.000Z'));

    const found = await repository.listByOwner(OWNER, 50);

    expect(found.map((analysis) => analysis.id)).toEqual(['c', 'b', 'a']);
  });

  it('respeita o teto e corta as mais antigas, nunca as mais recentes', async () => {
    await repository.create(buildAnalysis('velha', '2026-06-01T00:00:00.000Z'));
    await repository.create(buildAnalysis('media', '2026-07-01T00:00:00.000Z'));
    await repository.create(buildAnalysis('nova', '2026-08-01T00:00:00.000Z'));

    const found = await repository.listByOwner(OWNER, 2);

    // O teto corta o fim da lista ordenada. Cortar antes de ordenar devolveria
    // duas analises quaisquer.
    expect(found.map((analysis) => analysis.id)).toEqual(['nova', 'media']);
  });

  it('nunca devolve analise de outro usuario', async () => {
    await repository.create(buildAnalysis('minha', '2026-07-01T00:00:00.000Z'));
    await repository.create(buildAnalysis('alheia', '2026-08-01T00:00:00.000Z', STRANGER));

    const found = await repository.listByOwner(OWNER, 50);

    // A alheia e a MAIS RECENTE: se o filtro por dono nao existisse, ela viria
    // primeiro e o teste falharia mesmo com o teto aplicado.
    expect(found.map((analysis) => analysis.id)).toEqual(['minha']);
  });
});
