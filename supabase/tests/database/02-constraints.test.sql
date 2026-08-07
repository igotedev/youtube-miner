-- =============================================================================
-- SPEC-004 — Constraints: o que o banco precisa RECUSAR.
--
-- Cada teste tenta gravar algo invalido e espera falha. Sem estes, as CHECKs
-- poderiam estar escritas errado e ninguem saberia — uma constraint que nunca
-- foi vista rejeitando nada e uma constraint nao verificada.
--
-- NAO EXECUTADO: Docker e Supabase CLI ausentes. Rodar com `npm run db:test`.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Canal valido de apoio.
insert into public.youtube_channels (id, youtube_channel_id, handle)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'UCabcdefghijklmnopqrstuv', '@canal');

insert into public.youtube_collection_runs (id, channel_id, status, captured_at, completed_at)
values ('bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'completed', now(), now());

-- --- ID oficial do canal -----------------------------------------------------
select throws_ok(
  $$insert into public.youtube_channels (youtube_channel_id) values ('UC123')$$,
  '23514', null, 'ID de canal curto e recusado');

select throws_ok(
  $$insert into public.youtube_channels (youtube_channel_id) values ('XXabcdefghijklmnopqrstuv')$$,
  '23514', null, 'ID sem prefixo UC e recusado');

select throws_ok(
  $$insert into public.youtube_channels (youtube_channel_id) values ('UCabcdefghijklmnopqrst!v')$$,
  '23514', null, 'ID com caractere invalido e recusado');

-- UC + 22 caracteres = 24 no total. A versao anterior deste teste usava 23 e
-- portanto afirmava que um ID INVALIDO era valido; a constraint o recusou, como
-- devia. Contar os caracteres importa aqui.
select lives_ok(
  $$insert into public.youtube_channels (youtube_channel_id) values ('UCzyxwvutsrqponmlkjihgfe')$$,
  'ID oficial valido e aceito');

-- --- Contagens negativas -----------------------------------------------------
select throws_ok(
  $$insert into public.youtube_video_snapshots
      (collection_run_id, youtube_video_id, title, published_at, format, view_count,
       raw_payload, source_schema_version)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'vid1', 'T', now(), 'long', -1,
            '{}'::jsonb, 'v1')$$,
  '23514', null, 'view_count negativo e recusado');

select throws_ok(
  $$insert into public.youtube_video_snapshots
      (collection_run_id, youtube_video_id, title, published_at, format, duration_seconds,
       raw_payload, source_schema_version)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'vid2', 'T', now(), 'long', -5,
            '{}'::jsonb, 'v1')$$,
  '23514', null, 'duracao negativa e recusada');

-- NULL continua permitido: indisponivel nao e zero (RN-08).
select lives_ok(
  $$insert into public.youtube_video_snapshots
      (collection_run_id, youtube_video_id, title, published_at, format, view_count,
       raw_payload, source_schema_version)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'vid3', 'T', now(), 'long', null,
            '{}'::jsonb, 'v1')$$,
  'view_count NULL e aceito como indisponivel');

-- --- Formato e status --------------------------------------------------------
select throws_ok(
  $$insert into public.youtube_video_snapshots
      (collection_run_id, youtube_video_id, title, published_at, format,
       raw_payload, source_schema_version)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'vid4', 'T', now(), 'vertical',
            '{}'::jsonb, 'v1')$$,
  '23514', null, 'formato desconhecido e recusado');

select throws_ok(
  $$insert into public.youtube_collection_runs (channel_id, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'archived')$$,
  '23514', null, 'status de coleta desconhecido e recusado');

-- --- JSON bruto precisa ser objeto -------------------------------------------
select throws_ok(
  $$insert into public.youtube_channel_snapshots
      (collection_run_id, raw_payload, source_schema_version)
    values ('bbbbbbbb-0000-4000-8000-000000000001', '[]'::jsonb, 'v1')$$,
  '23514', null, 'payload em array e recusado');

-- --- Video duplicado na mesma coleta -----------------------------------------
insert into public.youtube_video_snapshots
  (collection_run_id, youtube_video_id, title, published_at, format, raw_payload, source_schema_version)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'dup', 'T', now(), 'long', '{}'::jsonb, 'v1');

select throws_ok(
  $$insert into public.youtube_video_snapshots
      (collection_run_id, youtube_video_id, title, published_at, format, raw_payload, source_schema_version)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'dup', 'T', now(), 'long', '{}'::jsonb, 'v1')$$,
  '23505', null, 'mesmo video duas vezes na mesma coleta e recusado');

-- --- Resultado duplicado para coleta + versao --------------------------------
insert into public.video_analytics_results
  (collection_run_id, algorithm_version, calculated_at, metrics)
values ('bbbbbbbb-0000-4000-8000-000000000001', '1.0.0', now(), '{}'::jsonb);

select throws_ok(
  $$insert into public.video_analytics_results
      (collection_run_id, algorithm_version, calculated_at, metrics)
    values ('bbbbbbbb-0000-4000-8000-000000000001', '1.0.0', now(), '{}'::jsonb)$$,
  '23505', null, 'resultado duplicado para a mesma versao e recusado');

-- Outra versao do algoritmo convive com a primeira.
select lives_ok(
  $$insert into public.video_analytics_results
      (collection_run_id, algorithm_version, calculated_at, metrics)
    values ('bbbbbbbb-0000-4000-8000-000000000001', '2.0.0', now(), '{}'::jsonb)$$,
  'duas versoes de algoritmo convivem para a mesma coleta');

select throws_ok(
  $$insert into public.video_analytics_results
      (collection_run_id, algorithm_version, calculated_at, metrics)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'v1', now(), '{}'::jsonb)$$,
  '23514', null, 'versao fora de MAJOR.MINOR.PATCH e recusada');

-- --- Concorrencia: uma coleta ativa por canal --------------------------------
insert into public.youtube_collection_runs (id, channel_id, status)
values ('cccccccc-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'pending');

select throws_ok(
  $$insert into public.youtube_collection_runs (channel_id, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'collecting_channel')$$,
  '23505', null, 'segunda coleta ativa no mesmo canal e recusada');

-- Concluir a primeira libera o canal.
update public.youtube_collection_runs
   set status = 'completed', captured_at = now(), completed_at = now()
 where id = 'cccccccc-0000-4000-8000-000000000001';

select lives_ok(
  $$insert into public.youtube_collection_runs (channel_id, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'pending')$$,
  'nova coleta e aceita depois que a anterior concluiu');

-- --- Coerencia de carimbos ---------------------------------------------------
select throws_ok(
  $$insert into public.youtube_collection_runs (channel_id, status, reusable_until)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'failed', now() + interval '1 day')$$,
  '23514', null, 'execucao falha nao pode ter prazo de reuso');

select * from finish();
rollback;
