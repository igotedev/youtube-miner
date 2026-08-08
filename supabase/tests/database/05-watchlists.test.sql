-- =============================================================================
-- SPEC-012 — Listas: unicidade de nome, permissoes e as funcoes de traducao.
--
-- O que este arquivo prova, e que nenhum teste em Node consegue provar:
--
--  1. o indice funcional recusa dois nomes que so diferem no caixa — o defeito
--     real encontrado na SPEC-004, cujo comentario prometia isso e cuja
--     constraint nao entregava;
--  2. `anon` e `authenticated` NAO podem executar as tres funcoes novas;
--  3. as funcoes traduzem `UC...` para o uuid interno, checam o dono e sao
--     idempotentes.
--
-- TODA CONTAGEM E ESCOPADA PELAS LINHAS DESTE ARQUIVO, com identificadores
-- fixos e exclusivos. Contar a tabela inteira faria o arquivo passar apenas
-- sobre um banco recem-resetado — e falhar por motivo errado em qualquer outro.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-000000000001', 'dono@example.test'),
  ('e0000000-0000-4000-8000-000000000002', 'estranho@example.test');

insert into public.youtube_channels (id, youtube_channel_id) values
  ('c0000000-0000-4000-8000-000000000001', 'UCwatchlisttest000000001'),
  ('c0000000-0000-4000-8000-000000000002', 'UCwatchlisttest000000002');

insert into public.watchlists (id, user_id, name) values
  ('a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'Concorrentes');

-- -----------------------------------------------------------------------------
-- 1. Unicidade de nome ignorando o caixa — o defeito corrigido
-- -----------------------------------------------------------------------------

select has_index('public', 'watchlists', 'watchlists_unique_name_per_user',
  'o indice funcional de nome existe');

select throws_ok(
  $$insert into public.watchlists (user_id, name)
    values ('e0000000-0000-4000-8000-000000000001', 'concorrentes')$$,
  '23505',
  null,
  'dois nomes que so diferem no caixa sao recusados'
);

-- A mesma insercao para OUTRA conta passa: a unicidade e por usuario, e duas
-- pessoas podem chamar as proprias listas do mesmo jeito.
select lives_ok(
  $$insert into public.watchlists (id, user_id, name)
    values ('a0000000-0000-4000-8000-000000000002',
            'e0000000-0000-4000-8000-000000000002', 'Concorrentes')$$,
  'o mesmo nome em contas diferentes e permitido'
);

-- -----------------------------------------------------------------------------
-- 2. Permissoes das funcoes novas
--
-- `revoke` antes de `grant`: sem isso, `public` herda `execute` por padrao e
-- qualquer sessao autenticada chamaria a funcao com o id de lista que quisesse.
-- -----------------------------------------------------------------------------

select function_privs_are('public', 'add_watchlist_item',
  array['uuid','uuid','text','text'], 'anon', array[]::text[],
  'anon nao executa add_watchlist_item');
select function_privs_are('public', 'add_watchlist_item',
  array['uuid','uuid','text','text'], 'authenticated', array[]::text[],
  'authenticated nao executa add_watchlist_item');
select function_privs_are('public', 'add_watchlist_item',
  array['uuid','uuid','text','text'], 'service_role', array['EXECUTE'],
  'service_role executa add_watchlist_item');

select function_privs_are('public', 'remove_watchlist_item',
  array['uuid','uuid','text'], 'authenticated', array[]::text[],
  'authenticated nao executa remove_watchlist_item');
select function_privs_are('public', 'list_watchlist_items',
  array['uuid','uuid'], 'authenticated', array[]::text[],
  'authenticated nao executa list_watchlist_items');

-- Nenhuma das tres e `security definer`: elas nao escalam privilegio, so
-- traduzem identificador. Marcar como definer daria a qualquer chamador os
-- poderes do dono da funcao.
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('add_watchlist_item','remove_watchlist_item','list_watchlist_items')
     and p.prosecdef),
  0,
  'nenhuma das funcoes de lista e security definer'
);

-- -----------------------------------------------------------------------------
-- 3. Comportamento das funcoes
-- -----------------------------------------------------------------------------

select lives_ok(
  $$select public.add_watchlist_item(
      'a0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001',
      'UCwatchlisttest000000001',
      'canal de referencia')$$,
  'salva um canal ja registrado'
);

-- Idempotente: um duplo clique nao e erro, e o resultado desejado ja vale.
select lives_ok(
  $$select public.add_watchlist_item(
      'a0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001',
      'UCwatchlisttest000000001',
      null)$$,
  'salvar de novo nao e erro'
);

select is(
  (select count(*)::int from public.watchlist_items
   where watchlist_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'e nao duplica a linha'
);

-- A restricao central da SPEC-012: so entra canal ja analisado.
select throws_ok(
  $$select public.add_watchlist_item(
      'a0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001',
      'UCnuncaanalisado00000001',
      null)$$,
  '23503',
  null,
  'canal nunca analisado e recusado'
);

-- Lista de outra pessoa e tratada como inexistente, e o erro e o MESMO da
-- linha acima: quem pergunta nao descobre a diferenca.
select throws_ok(
  $$select public.add_watchlist_item(
      'a0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000002',
      'UCwatchlisttest000000002',
      null)$$,
  '23503',
  null,
  'nao salva em lista de outro usuario'
);

select is(
  (select count(*)::int from public.list_watchlist_items(
     'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001')),
  1,
  'a leitura devolve o item do dono'
);

select is(
  (select channel_id from public.list_watchlist_items(
     'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001')),
  'UCwatchlisttest000000001',
  'e ja traduzido para o identificador oficial'
);

-- O filtro por dono esta DENTRO da funcao. Sem ele, saber um id de lista
-- bastaria para ler os itens dela.
select is(
  (select count(*)::int from public.list_watchlist_items(
     'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002')),
  0,
  'a leitura de outro usuario nao devolve nada'
);

-- `do` em vez de `select public.f()`: uma chamada solta produziria um conjunto
-- de resultado no meio da saida TAP, e o `pg_prove` nao sabe o que fazer com
-- ele. `perform` descarta o retorno.
do $$ begin
  perform public.remove_watchlist_item(
    'a0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'UCwatchlisttest000000001');
end $$;

select is(
  (select count(*)::int from public.watchlist_items
   where watchlist_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'remove o canal pelo identificador oficial'
);

-- Remover o que nao esta la nao e erro: o resultado desejado ja vale.
select lives_ok(
  $$select public.remove_watchlist_item(
      'a0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001',
      'UCwatchlisttest000000001')$$,
  'remover de novo nao e erro'
);

select * from finish();
rollback;
