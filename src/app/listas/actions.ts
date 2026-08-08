'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { buildAuthGateway } from '@/config/composition';
import { buildWatchlists } from '@/config/composition/watchlists';
import type { WatchlistId } from '@/modules/watchlists';
import { MAX_WATCHLIST_NAME_LENGTH, MAX_WATCHLIST_NOTE_LENGTH } from '@/modules/watchlists';
import type { YouTubeChannelId } from '@/modules/youtube-collection';
import { AppError } from '@/shared/errors';
import type { ErrorCode } from '@/shared/errors';

import type { WatchlistFormState } from './watchlist-state';

/**
 * Server Actions das listas (SPEC-012).
 *
 * Fazem TRES coisas e mais nenhuma: verificam a sessao, validam o formato da
 * entrada e chamam o caso de uso. Nenhuma regra de negocio, nenhum `new` de
 * adaptador (R6).
 *
 * A SESSAO E A PRIMEIRA COISA, em todas elas. Uma Server Action e um endpoint
 * HTTP publico: o formulario na tela e uma das formas de chama-la, nao a unica,
 * e o proxy nao protege o que nao passa por ele (ADR-006, item 4).
 *
 * NENHUMA DELAS GASTA QUOTA OU TOKEN. Salvar um canal nao coleta nada e nao
 * gera relatorio.
 */

/**
 * Mensagem exibivel por codigo de erro.
 *
 * A decisao e tomada pelo `code`, nunca pelo texto do erro. E nada aqui
 * interpola `AppError.context`, que carrega identificadores internos.
 *
 * `NOT_FOUND` cobre tres situacoes que o sistema distingue e o usuario nao deve
 * distinguir: lista inexistente, lista de outra pessoa e canal nunca analisado.
 * As duas primeiras precisam ser indistinguiveis — "sem permissao" ja
 * confirmaria que a lista existe. A terceira ganha texto proprio no unico lugar
 * onde ela e possivel, `saveChannel`.
 */
const MESSAGE_BY_CODE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Entrada invalida.',
  NOT_FOUND: 'Lista nao encontrada.',
  UNAUTHORIZED: 'Sua sessao expirou. Entre de novo para mexer nas suas listas.',
  FORBIDDEN: 'Lista nao encontrada.',
  CONFLICT: 'Voce ja tem uma lista com esse nome.',
  EXTERNAL_SERVICE_ERROR: 'Nao foi possivel salvar. Tente de novo em instantes.',
  QUOTA_EXCEEDED: 'Nao foi possivel salvar. Tente de novo em instantes.',
  UNEXPECTED_ERROR: 'Nao foi possivel concluir a acao.',
};

const GENERIC_FAILURE = 'Nao foi possivel concluir a acao.';

/**
 * O id vem da URL ou de um campo oculto — entrada do usuario nos dois casos.
 *
 * Validado ANTES de virar consulta: a coluna e `uuid`, e um texto qualquer
 * produziria erro de sintaxe do PostgreSQL em vez de "nao encontrado".
 */
const idSchema = z.uuid();

/**
 * O identificador do canal chega pela tela, e a tela o recebeu de uma analise.
 *
 * Validado quanto ao FORMATO (RN-01: `UC` + 22 caracteres) so para barrar corpo
 * absurdo antes de ir ao banco. Se o canal existe de fato, quem responde e a
 * chave estrangeira — nao ha como saber daqui.
 */
const channelIdSchema = z
  .string()
  .trim()
  .regex(/^UC[\w-]{22}$/u, 'Identificador de canal invalido.');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Informe um nome para a lista.')
  .max(MAX_WATCHLIST_NAME_LENGTH, `O nome passa de ${MAX_WATCHLIST_NAME_LENGTH} caracteres.`);

const noteSchema = z
  .string()
  .trim()
  .max(MAX_WATCHLIST_NOTE_LENGTH, `A nota passa de ${MAX_WATCHLIST_NOTE_LENGTH} caracteres.`)
  .optional();

/** Sessao ou nada. Devolve o dono, ou o estado de erro pronto para exibir. */
async function requireOwner() {
  const auth = await buildAuthGateway();
  const user = await auth.getCurrentUser();

  if (user === null) {
    return { failure: { status: 'error', message: MESSAGE_BY_CODE.UNAUTHORIZED } as const };
  }
  return { ownerId: user.id };
}

function toFailure(error: unknown): WatchlistFormState {
  if (error instanceof AppError) {
    return { status: 'error', message: MESSAGE_BY_CODE[error.code] };
  }
  // Erro nao previsto: nada do original chega ao usuario.
  return { status: 'error', message: GENERIC_FAILURE };
}

export async function createWatchlist(
  _previous: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const owner = await requireOwner();
  if ('failure' in owner) return owner.failure;

  const parsed = nameSchema.safeParse(formData.get('name'));
  if (!parsed.success) {
    return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Entrada invalida.' };
  }

  try {
    await buildWatchlists().manage.create(owner.ownerId, parsed.data);
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath('/listas');
  return { status: 'done', message: 'Lista criada.' };
}

export async function renameWatchlist(
  _previous: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const owner = await requireOwner();
  if ('failure' in owner) return owner.failure;

  const parsed = z
    .object({ watchlistId: idSchema, name: nameSchema })
    .safeParse({ watchlistId: formData.get('watchlistId'), name: formData.get('name') });

  if (!parsed.success) {
    return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Entrada invalida.' };
  }

  try {
    await buildWatchlists().manage.rename(
      parsed.data.watchlistId as WatchlistId,
      owner.ownerId,
      parsed.data.name,
    );
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath('/listas');
  revalidatePath(`/listas/${parsed.data.watchlistId}`);
  return { status: 'done', message: 'Nome alterado.' };
}

/**
 * Apagar leva os itens junto — o `on delete cascade` de `watchlist_items`.
 *
 * Termina em `redirect`, e nao em estado: a tela que disparou a acao deixa de
 * existir. Por isso esta acao nao devolve `WatchlistFormState`; `redirect`
 * lanca por dentro e nada depois dele roda.
 */
export async function deleteWatchlist(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  if ('failure' in owner) redirect('/listas');

  const parsed = idSchema.safeParse(formData.get('watchlistId'));
  if (!parsed.success) redirect('/listas');

  await buildWatchlists().manage.remove(parsed.data as WatchlistId, owner.ownerId);

  revalidatePath('/listas');
  redirect('/listas');
}

export async function saveChannelToWatchlist(
  _previous: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const owner = await requireOwner();
  if ('failure' in owner) return owner.failure;

  const parsed = z
    .object({ watchlistId: idSchema, channelId: channelIdSchema, note: noteSchema })
    .safeParse({
      watchlistId: formData.get('watchlistId'),
      channelId: formData.get('channelId'),
      note: formData.get('note') ?? undefined,
    });

  if (!parsed.success) {
    return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Entrada invalida.' };
  }

  try {
    await buildWatchlists().manage.saveChannel(
      parsed.data.watchlistId as WatchlistId,
      owner.ownerId,
      parsed.data.channelId as YouTubeChannelId,
      parsed.data.note ?? null,
    );
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath('/listas');
  revalidatePath(`/listas/${parsed.data.watchlistId}`);
  // Salvar de novo cai aqui tambem, e e o certo: o resultado desejado ja vale,
  // e um duplo clique nao e erro do usuario.
  return { status: 'done', message: 'Canal salvo na lista.' };
}

export async function removeChannelFromWatchlist(
  _previous: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const owner = await requireOwner();
  if ('failure' in owner) return owner.failure;

  const parsed = z.object({ watchlistId: idSchema, channelId: channelIdSchema }).safeParse({
    watchlistId: formData.get('watchlistId'),
    channelId: formData.get('channelId'),
  });

  if (!parsed.success) {
    return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Entrada invalida.' };
  }

  try {
    await buildWatchlists().manage.removeChannel(
      parsed.data.watchlistId as WatchlistId,
      owner.ownerId,
      parsed.data.channelId as YouTubeChannelId,
    );
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath(`/listas/${parsed.data.watchlistId}`);
  revalidatePath('/listas');
  return { status: 'done', message: 'Canal removido da lista.' };
}
