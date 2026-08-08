import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { SIGN_IN_PATH, buildAuthGateway } from '@/config/composition';
import { buildWatchlists } from '@/config/composition/watchlists';
import type { WatchlistId } from '@/modules/watchlists';
import { NotFoundError } from '@/shared/errors';

import { SignOutButton } from '../../auth/sign-out-button';
import { formatTimestamp } from '../../analise/format';
import { DeleteWatchlistForm } from '../delete-watchlist-form';
import { RemoveChannelForm } from '../remove-channel-form';
import { RenameWatchlistForm } from '../rename-watchlist-form';
import { formatChannelIdentifier, formatChannelName, formatItemCount, formatNote } from '../labels';

export const metadata: Metadata = {
  title: 'Lista — YouTube Niche Miner',
  description: 'Canais salvos em uma lista.',
};

/**
 * Detalhe de uma lista (SPEC-012).
 *
 * Leitura mais dois formularios. Nenhuma unidade de quota, nenhum token de IA:
 * o nome dos canais vem do registro global, que ja existe porque cada um deles
 * foi analisado alguma vez.
 */

/**
 * O id vem da URL, que e entrada do usuario.
 *
 * Validado ANTES de virar consulta: `watchlists.id` e `uuid`, e um texto
 * qualquer produziria erro de sintaxe do PostgreSQL em vez de "nao encontrado".
 * Um id malformado nao existe — 404, como qualquer lista que nao e sua.
 */
const idSchema = z.uuid();

export default async function WatchlistDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  const { id } = await params;

  if (user === null) {
    redirect(`${SIGN_IN_PATH}?next=${encodeURIComponent(`/listas/${id}`)}`);
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();

  let view;
  try {
    view = await buildWatchlists().getWatchlist.execute({
      watchlistId: parsedId.data as WatchlistId,
      requestedBy: user.id,
    });
  } catch (error) {
    /**
     * Lista de outro usuario cai aqui, e vira 404 — nunca "sem permissao".
     *
     * A distincao importa: "sem permissao" confirmaria que a lista existe, o que
     * ja e informacao sobre outra pessoa.
     */
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { watchlist, entries } = view;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/listas" className="underline underline-offset-4">
            Suas listas
          </Link>
          <Link href="/analise" className="text-muted underline underline-offset-4">
            Nova analise
          </Link>
        </div>
        <SignOutButton />
      </div>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-balance">{watchlist.name}</h1>
        <p className="text-sm text-muted">
          {formatItemCount(entries.length)} · criada em {formatTimestamp(watchlist.createdAt)} UTC
        </p>
      </header>

      {entries.length === 0 ? (
        /* Lista vazia e RESULTADO VALIDO, nao erro. */
        <section className="flex flex-col gap-3 rounded-md border border-border px-4 py-6 text-sm">
          <p>Esta lista ainda nao tem canais.</p>
          <p className="text-muted">
            Abra uma analise no{' '}
            <Link href="/historico" className="underline underline-offset-4">
              historico
            </Link>{' '}
            e use <strong>Salvar em uma lista</strong>.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {entries.map(({ item, channel }) => {
            const note = formatNote(item.note);

            return (
              <li key={item.channelId} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium">{formatChannelName(channel)}</span>
                  <RemoveChannelForm watchlistId={watchlist.id} channelId={item.channelId} />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-mono text-xs text-muted">
                    {formatChannelIdentifier(channel, item.channelId)}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    salvo em {formatTimestamp(item.addedAt)} UTC
                  </span>
                </div>
                {/* Sem nota, sem paragrafo: um vazio pareceria nota apagada. */}
                {note !== null && <p className="text-sm text-muted">{note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <section className="rounded-md border border-border px-4 py-5">
        <RenameWatchlistForm watchlistId={watchlist.id} currentName={watchlist.name} />
      </section>

      <DeleteWatchlistForm watchlistId={watchlist.id} />
    </main>
  );
}
