-- =============================================================================
-- SPEC-004 — Exclusoes em cascata e triggers.
--
-- A regra que estes testes protegem: remover um USUARIO apaga o que e dele e
-- PRESERVA os artefatos globais. Um ON DELETE CASCADE no lugar errado faria uma
-- conta cancelada levar junto coletas que servem a todo mundo.
--
-- NAO EXECUTADO: Docker e Supabase CLI ausentes. Rodar com `npm run db:test`.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'a@example.test');

-- O trigger de perfil ja deve ter criado a linha.
select is((select count(*)::int from public.profiles
            where id = '11111111-1111-4111-8111-111111111111'), 1,
  'trigger cria o profile junto com o usuario');

insert into public.youtube_channels (id, youtube_channel_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'UCabcdefghijklmnopqrstuv');

insert into public.youtube_collection_runs (id, channel_id, status, captured_at, completed_at)
values ('bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'completed', now(), now());

insert into public.youtube_channel_snapshots (collection_run_id, raw_payload, source_schema_version)
values ('bbbbbbbb-0000-4000-8000-000000000001', '{}'::jsonb, 'v1');

insert into public.youtube_video_snapshots
  (collection_run_id, youtube_video_id, title, published_at, format, raw_payload, source_schema_version)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'vid1', 'T', now(), 'long', '{}'::jsonb, 'v1');

insert into public.video_analytics_results
  (collection_run_id, algorithm_version, calculated_at, metrics)
values ('bbbbbbbb-0000-4000-8000-000000000001', '1.0.0', now(), '{}'::jsonb);

insert into public.channel_analyses (id, user_id, channel_id, requested_url, status, collection_run_id)
values ('dddddddd-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'https://www.youtube.com/@canal', 'pending',
        'bbbbbbbb-0000-4000-8000-000000000001');

insert into public.ai_insight_reports (analysis_id, status, provider, model, prompt_version)
values ('dddddddd-0000-4000-8000-000000000001', 'pending', 'anthropic', 'modelo', 'v1');

insert into public.watchlists (id, user_id, name)
values ('eeeeeeee-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111', 'Concorrentes');

insert into public.watchlist_items (watchlist_id, channel_id)
values ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

-- --- Canal global protegido enquanto ha dependentes --------------------------
select throws_ok(
  $$delete from public.youtube_channels where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23503', null, 'canal com analise dependente nao pode ser removido');

-- --- Remover a analise leva o relatorio de IA junto --------------------------
delete from public.channel_analyses where id = 'dddddddd-0000-4000-8000-000000000001';
select is((select count(*)::int from public.ai_insight_reports), 0,
  'relatorio de IA some com a analise');

-- --- Remover a lista leva os itens junto -------------------------------------
delete from public.watchlists where id = 'eeeeeeee-0000-4000-8000-000000000001';
select is((select count(*)::int from public.watchlist_items), 0,
  'itens somem com a lista');

-- --- Remover o usuario apaga o que e dele ------------------------------------
insert into public.watchlists (id, user_id, name)
values ('eeeeeeee-0000-4000-8000-000000000002',
        '11111111-1111-4111-8111-111111111111', 'Outra');

delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

select is((select count(*)::int from public.profiles), 0,
  'profile some com o usuario');
select is((select count(*)::int from public.watchlists), 0,
  'listas somem com o usuario');

-- --- ...e PRESERVA os artefatos globais --------------------------------------
select is((select count(*)::int from public.youtube_channels), 1,
  'canal global sobrevive a exclusao do usuario');
select is((select count(*)::int from public.youtube_collection_runs), 1,
  'coleta global sobrevive a exclusao do usuario');
select is((select count(*)::int from public.youtube_channel_snapshots), 1,
  'snapshot de canal sobrevive a exclusao do usuario');
select is((select count(*)::int from public.video_analytics_results), 1,
  'metricas globais sobrevivem a exclusao do usuario');

-- --- Remover a coleta leva os artefatos dela ---------------------------------
delete from public.youtube_collection_runs where id = 'bbbbbbbb-0000-4000-8000-000000000001';
select is((select count(*)::int from public.youtube_channel_snapshots), 0,
  'snapshot de canal some com a coleta');
select is((select count(*)::int from public.youtube_video_snapshots), 0,
  'snapshots de video somem com a coleta');
select is((select count(*)::int from public.video_analytics_results), 0,
  'metricas somem com a coleta');

select * from finish();
rollback;
