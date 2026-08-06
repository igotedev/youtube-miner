-- =============================================================================
-- SPEC-004 — Row Level Security e isolamento por usuario.
--
-- O teste mais importante do conjunto: uma policy escrita errado nao quebra
-- nada visivelmente, so vaza dado. So se descobre tentando ler o que nao se
-- deveria.
--
-- NAO EXECUTADO: Docker e Supabase CLI ausentes. Rodar com `npm run db:test`.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- --- RLS ativada em todas as tabelas ----------------------------------------
select ok(relrowsecurity, 'RLS ativa em ' || relname)
  from pg_class
 where relname in (
   'profiles', 'youtube_channels', 'youtube_collection_runs',
   'youtube_channel_snapshots', 'youtube_video_snapshots', 'video_analytics_results',
   'channel_analyses', 'ai_insight_reports', 'watchlists', 'watchlist_items'
 )
   and relnamespace = 'public'::regnamespace;

-- --- Tabelas globais: nenhum grant para o navegador --------------------------
-- Criterio de aceitacao 15: o payload bruto nao e alcancavel pelo cliente.
select ok(
  not has_table_privilege('authenticated', 'public.youtube_channel_snapshots', 'SELECT'),
  'authenticated NAO le snapshots de canal');
select ok(
  not has_table_privilege('authenticated', 'public.youtube_video_snapshots', 'SELECT'),
  'authenticated NAO le snapshots de video');
select ok(
  not has_table_privilege('authenticated', 'public.video_analytics_results', 'SELECT'),
  'authenticated NAO le resultados de metricas direto');
select ok(
  not has_table_privilege('authenticated', 'public.youtube_collection_runs', 'SELECT'),
  'authenticated NAO le execucoes de coleta');
select ok(
  not has_table_privilege('anon', 'public.youtube_channel_snapshots', 'SELECT'),
  'anon NAO le snapshots');

-- --- Tabelas do usuario: grants minimos --------------------------------------
select ok(has_table_privilege('authenticated', 'public.watchlists', 'SELECT'),
  'authenticated le as proprias listas');
select ok(has_table_privilege('authenticated', 'public.channel_analyses', 'INSERT'),
  'authenticated pode criar analise');
select ok(
  not has_table_privilege('authenticated', 'public.channel_analyses', 'UPDATE'),
  'authenticated NAO altera analise: progressao de estado e do servidor');
select ok(
  not has_table_privilege('authenticated', 'public.ai_insight_reports', 'INSERT'),
  'authenticated NAO cria relatorio de IA');

-- --- Isolamento entre usuarios ----------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test');

insert into public.youtube_channels (id, youtube_channel_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'UCabcdefghijklmnopqrstuv');

insert into public.channel_analyses (id, user_id, channel_id, requested_url, status)
values ('dddddddd-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'https://www.youtube.com/@canal', 'pending');

insert into public.watchlists (id, user_id, name)
values ('eeeeeeee-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111', 'Concorrentes');

insert into public.watchlist_items (watchlist_id, channel_id)
values ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.ai_insight_reports (analysis_id, status, provider, model, prompt_version)
values ('dddddddd-0000-4000-8000-000000000001', 'pending', 'anthropic', 'modelo', 'v1');

-- Usuario A ve o que e dele.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.channel_analyses), 1,
  'usuario A ve a propria analise');
select is((select count(*)::int from public.watchlists), 1,
  'usuario A ve a propria lista');
select is((select count(*)::int from public.watchlist_items), 1,
  'usuario A ve o item da propria lista');
select is((select count(*)::int from public.ai_insight_reports), 1,
  'usuario A ve o relatorio da propria analise');

-- Usuario B nao ve nada de A.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select is((select count(*)::int from public.channel_analyses), 0,
  'usuario B NAO ve a analise de A');
select is((select count(*)::int from public.watchlists), 0,
  'usuario B NAO ve a lista de A');
select is((select count(*)::int from public.watchlist_items), 0,
  'usuario B NAO ve o item da lista de A');
select is((select count(*)::int from public.ai_insight_reports), 0,
  'usuario B NAO ve o relatorio da analise de A');

-- B nao consegue criar analise em nome de A.
select throws_ok(
  $$insert into public.channel_analyses (user_id, channel_id, requested_url, status)
    values ('11111111-1111-4111-8111-111111111111',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'https://www.youtube.com/@canal', 'pending')$$,
  '42501', null, 'usuario B NAO cria analise em nome de A');

-- Nem criar a propria analise ja concluida, pulando a coleta.
select throws_ok(
  $$insert into public.channel_analyses (user_id, channel_id, requested_url, status)
    values ('22222222-2222-4222-8222-222222222222',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'https://www.youtube.com/@canal', 'completed')$$,
  '42501', null, 'cliente NAO cria analise ja completed');

reset role;

select * from finish();
rollback;
