import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SIGN_IN_PATH, buildAuthGateway } from '@/config/composition';
import { buildWatchlists } from '@/config/composition/watchlists';

import { SignOutButton } from '../auth/sign-out-button';
import { formatTimestamp } from '../analise/format';
import { CreateWatchlistForm } from './create-watchlist-form';
import { formatItemCount } from './labels';

export const metadata: Metadata = {
  title: 'Listas — YouTube Niche Miner',
  description: 'Listas de canais salvos por este usuario.',
};

/**
 * Indice das listas (SPEC-012).
 *
 * Componente de servidor. Nenhuma chamada ao YouTube, nenhuma unidade de quota,
 * nenhum token de IA — salvar um canal nao coleta nada.
 *
 * Carrega apenas os RESUMOS: nome, data e contagem. Trazer os itens de todas as
 * listas para desenhar um indice seria dado que a tela nao usa (SPEC-012,
 * secao 5).
 */
export default async function WatchlistsPage() {
  /**
   * O proxy tambem redireciona quem nao tem sessao, agora que `/listas` esta em
   * `PROTECTED_PREFIXES`. Esta verificacao nao e redundante: e a que vale
   * (ADR-006, item 4). Uma rota que saia do `matcher` continua protegida.
   */
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  if (user === null) {
    redirect(`${SIGN_IN_PATH}?next=%2Flistas`);
  }

  const lists = await buildWatchlists().manage.list(user.id);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/analise" className="underline underline-offset-4">
            Nova analise
          </Link>
          <Link href="/historico" className="text-muted underline underline-offset-4">
            Historico
          </Link>
        </div>
        <SignOutButton />
      </div>

      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          SPEC-012 — listas de canais
        </p>
        <h1 className="text-3xl font-semibold text-balance">Suas listas</h1>
        <p className="text-muted">
          Uma lista guarda canais que voce <strong>ja analisou</strong>. Abrir uma lista nao
          recoleta nada e nao consulta o YouTube.
        </p>
      </header>

      <section className="rounded-md border border-border px-4 py-5">
        <CreateWatchlistForm />
      </section>

      {lists.length === 0 ? (
        /*
         * Nenhuma lista e RESULTADO VALIDO, nao erro. Mesma regra que o
         * historico aplica a quem ainda nao analisou nada.
         */
        <section className="flex flex-col gap-3 rounded-md border border-border px-4 py-6 text-sm">
          <p>Voce ainda nao criou nenhuma lista.</p>
          <p className="text-muted">
            Depois de criar uma, o botao <strong>Salvar em uma lista</strong> aparece na tela de
            cada analise.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <Link
                  href={`/listas/${list.id}`}
                  className="text-sm font-medium underline underline-offset-4"
                >
                  {list.name}
                </Link>
                <span className="font-mono text-xs text-muted">
                  {formatTimestamp(list.createdAt)} UTC
                </span>
              </div>
              <span className="text-xs text-muted">{formatItemCount(list.itemCount)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
