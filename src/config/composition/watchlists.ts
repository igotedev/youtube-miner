// Imports de `infrastructure` sao permitidos APENAS aqui (R6).
import { SupabaseChannelDirectory } from '@/modules/youtube-collection/infrastructure/supabase/supabase-channel-directory';
import { SupabaseWatchlistRepository } from '@/modules/watchlists/infrastructure/supabase/supabase-watchlist-repository';
import { GetWatchlist, ManageWatchlists } from '@/modules/watchlists';
import { cryptoUuidGenerator } from '@/shared/infrastructure/crypto-uuid-generator';
import { createAdminClient } from '@/shared/infrastructure/supabase/supabase-clients';
import { systemClock } from '@/shared/infrastructure/system-clock';
import { consoleLogger } from '@/shared/observability';

/**
 * Raiz de composicao das listas (SPEC-012).
 *
 * ---------------------------------------------------------------------------
 * ARQUIVO SEPARADO DE `analysis-pipeline.ts`, DE PROPOSITO.
 *
 * Um barrel com reexport estatico arrasta tudo o que reexporta para o bundle de
 * quem o importa. Montar as listas dentro do pipeline de analise faria a tela
 * `/listas` carregar o cliente da YouTube Data API e o gerador do Gemini para
 * desenhar uma lista de nomes.
 *
 * E o mesmo motivo pelo qual `auth.ts` ja vive separado. Nao e violacao de
 * fronteira: os tres arquivos sao a MESMA raiz de composicao.
 * ---------------------------------------------------------------------------
 *
 * NAO GASTA QUOTA NEM TOKEN. Salvar um canal nao coleta nada e nao gera
 * relatorio — o canal ja foi analisado, e por isso ja existe no registro global
 * (SPEC-012, secao 2).
 */

export interface WatchlistsComposition {
  readonly manage: ManageWatchlists;
  readonly getWatchlist: GetWatchlist;
}

export function buildWatchlists(): WatchlistsComposition {
  /**
   * Cliente ADMINISTRATIVO (service role), que ignora RLS — mesma escolha do
   * pipeline de analise, pelo mesmo motivo e com o mesmo preco.
   *
   * As listas TEM policy por dono, e ela e correta. Mas as funcoes do banco que
   * traduzem o identificador do canal (SPEC-012, secao 4-A) tocam
   * `youtube_channels`, tabela global sem policy para `authenticated`. Com o
   * cliente do usuario, salvar um canal falharia na leitura do registro global.
   *
   * O preco esta no ADR-005: como o RLS nao filtra, o filtro por dono tem de
   * estar no codigo. A porta o exige — nenhum metodo aceita busca sem dono — e
   * as funcoes do banco checam o dono por dentro.
   */
  const supabase = createAdminClient();
  const watchlists = new SupabaseWatchlistRepository(supabase);

  return {
    manage: new ManageWatchlists({
      clock: systemClock,
      logger: consoleLogger,
      ids: cryptoUuidGenerator,
      watchlists,
    }),
    getWatchlist: new GetWatchlist({
      watchlists,
      // Reusado sem mudanca desde a SPEC-010: o item guarda o `UC...`, e o
      // titulo do canal vive em `youtube-collection`. Este e o segundo caso de
      // uso que aquela porta esperava.
      channelDirectory: new SupabaseChannelDirectory(supabase),
    }),
  };
}
