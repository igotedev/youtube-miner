-- =============================================================================
-- SPEC-012 — Salvar um canal em uma lista, sem violar R7.
--
-- O PROBLEMA QUE ESTA FUNCAO RESOLVE.
--
-- `watchlist_items.channel_id` guarda o UUID INTERNO de `youtube_channels`. O
-- dominio, porem, fala `UC...` (RN-01). Alguem precisa traduzir.
--
-- Traduzir no adaptador de `watchlists` exigiria ler `youtube_channels`, tabela
-- do modulo `youtube-collection` — violacao de R7. Existe exatamente uma divida
-- assim no projeto (`SupabaseAnalysisRepository.resolveInternalChannelId`,
-- registrada na SPEC-004 secao 5), e a auditoria de 2026-08-08 a apontou. Criar
-- uma segunda seria piorar de proposito.
--
-- Expor o UUID interno pela porta `ChannelDirectory` tambem nao serve: aquele
-- contrato diz, por escrito, que o identificador interno "e detalhe de
-- persistencia e nao atravessa esta fronteira".
--
-- Sobra o lugar onde as duas tabelas legitimamente convivem: o banco. E o mesmo
-- caminho de `complete_collection_run` (SPEC-008).
--
-- DE QUEBRA, TRES COISAS FICAM ATOMICAS: a verificacao de dono, a traducao do
-- identificador e a insercao idempotente.
-- =============================================================================

create or replace function public.add_watchlist_item(
  p_watchlist_id uuid,
  p_owner_id     uuid,
  p_channel_id   text,
  p_note         text
)
returns void
language plpgsql
as $$
declare
  v_internal_channel_id uuid;
begin
  -- Dono primeiro. Lista de outra pessoa e tratada como inexistente: dizer
  -- "sem permissao" ja revelaria que ela existe.
  if not exists (
    select 1 from public.watchlists w
    where w.id = p_watchlist_id and w.user_id = p_owner_id
  ) then
    raise exception 'watchlist not found'
      using errcode = '23503';
  end if;

  select c.id into v_internal_channel_id
  from public.youtube_channels c
  where c.youtube_channel_id = p_channel_id;

  -- So da para salvar canal ja analisado: o registro global so nasce quando
  -- alguem analisa o canal (SPEC-012, secao 2).
  if v_internal_channel_id is null then
    raise exception 'channel not registered'
      using errcode = '23503';
  end if;

  -- IDEMPOTENTE. Um duplo clique nao e erro do usuario: ele queria uma coisa
  -- so, e o resultado desejado ja vale. A constraint
  -- `watchlist_items_unique_channel` e quem decide, nao um SELECT previo —
  -- entre consultar e inserir cabe outra requisicao.
  insert into public.watchlist_items (watchlist_id, channel_id, notes)
  values (p_watchlist_id, v_internal_channel_id, p_note)
  on conflict (watchlist_id, channel_id) do nothing;
end;
$$;

-- Os dois `raise` acima usam `23503` (violacao de chave estrangeira) de
-- proposito: e o que `translatePostgresError` ja converte em `NotFoundError`, e
-- e semanticamente verdade nos dois casos — a linha referenciada nao existe.

-- NAO e `security definer`: nao ha escalonamento de privilegio aqui. Quem chama
-- e a raiz de composicao com a service role, que ja alcanca as duas tabelas.
revoke all on function public.add_watchlist_item(uuid, uuid, text, text) from public;
revoke all on function public.add_watchlist_item(uuid, uuid, text, text) from anon, authenticated;
grant execute on function public.add_watchlist_item(uuid, uuid, text, text) to service_role;

comment on function public.add_watchlist_item(uuid, uuid, text, text) is
  'SPEC-012: salva um canal em uma lista traduzindo UC... para o uuid interno, '
  'verificando o dono e sendo idempotente — tudo em uma instrucao.';

-- -----------------------------------------------------------------------------
-- O par simetrico. Remover precisa da MESMA traducao, pelo MESMO motivo.
--
-- Sem esta funcao o adaptador teria de consultar `youtube_channels` para
-- descobrir o uuid antes de apagar — exatamente a violacao de R7 que a funcao
-- acima existe para evitar. Meia solucao nao resolveria nada.
-- -----------------------------------------------------------------------------

create or replace function public.remove_watchlist_item(
  p_watchlist_id uuid,
  p_owner_id     uuid,
  p_channel_id   text
)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.watchlists w
    where w.id = p_watchlist_id and w.user_id = p_owner_id
  ) then
    raise exception 'watchlist not found'
      using errcode = '23503';
  end if;

  -- Remover o que nao esta la NAO e erro: o resultado desejado ja vale. Canal
  -- desconhecido tambem nao e erro aqui — o `delete` simplesmente nao casa.
  delete from public.watchlist_items i
  using public.youtube_channels c
  where i.watchlist_id = p_watchlist_id
    and i.channel_id = c.id
    and c.youtube_channel_id = p_channel_id;
end;
$$;

revoke all on function public.remove_watchlist_item(uuid, uuid, text) from public;
revoke all on function public.remove_watchlist_item(uuid, uuid, text) from anon, authenticated;
grant execute on function public.remove_watchlist_item(uuid, uuid, text) to service_role;

comment on function public.remove_watchlist_item(uuid, uuid, text) is
  'SPEC-012: tira um canal de uma lista pelo UC..., verificando o dono. '
  'Remover o que nao esta la nao e erro.';

-- -----------------------------------------------------------------------------
-- A LEITURA TAMBEM PRECISA DA TRADUCAO, e pelo mesmo motivo.
--
-- O item guarda o uuid interno; a tela precisa do `UC...`. Resolver isso com um
-- `select` aninhado do PostgREST (`youtube_channels ( youtube_channel_id )`)
-- funcionaria — e seria `watchlists` fazendo select na tabela de outro modulo,
-- que e literalmente o exemplo que R7 proibe.
--
-- O filtro por dono esta DENTRO da funcao. Sem ele, quem soubesse um id de lista
-- leria os itens dela: uma funcao que aceita o id sem checar o dono e uma porta
-- aberta com fechadura pintada.
-- -----------------------------------------------------------------------------

create or replace function public.list_watchlist_items(
  p_watchlist_id uuid,
  p_owner_id     uuid
)
returns table (
  channel_id text,
  added_at   timestamptz,
  note       text
)
language sql
stable
as $$
  select c.youtube_channel_id, i.created_at, i.notes
  from public.watchlist_items i
  join public.youtube_channels c on c.id = i.channel_id
  join public.watchlists w on w.id = i.watchlist_id
  where i.watchlist_id = p_watchlist_id
    and w.user_id = p_owner_id
  -- Ordem ESTAVEL (RN-13): o desempate pelo identificador impede que dois itens
  -- salvos no mesmo instante troquem de lugar entre duas leituras iguais.
  order by i.created_at asc, c.youtube_channel_id asc;
$$;

revoke all on function public.list_watchlist_items(uuid, uuid) from public;
revoke all on function public.list_watchlist_items(uuid, uuid) from anon, authenticated;
grant execute on function public.list_watchlist_items(uuid, uuid) to service_role;

comment on function public.list_watchlist_items(uuid, uuid) is
  'SPEC-012: itens de uma lista com o canal ja traduzido para UC..., '
  'escopado pelo dono.';
