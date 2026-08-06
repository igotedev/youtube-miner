-- =============================================================================
-- SPEC-004 — Estrutura: tabelas, chaves, constraints e indices.
--
-- NAO EXECUTADO no ambiente em que foi escrito: Docker e Supabase CLI ausentes.
-- Para rodar:  npm run db:start && npm run db:test
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- --- 1. Existencia das tabelas ----------------------------------------------
select has_table('public', 'profiles',                  'profiles existe');
select has_table('public', 'youtube_channels',          'youtube_channels existe');
select has_table('public', 'youtube_collection_runs',   'youtube_collection_runs existe');
select has_table('public', 'youtube_channel_snapshots', 'youtube_channel_snapshots existe');
select has_table('public', 'youtube_video_snapshots',   'youtube_video_snapshots existe');
select has_table('public', 'video_analytics_results',   'video_analytics_results existe');
select has_table('public', 'channel_analyses',          'channel_analyses existe');
select has_table('public', 'ai_insight_reports',        'ai_insight_reports existe');
select has_table('public', 'watchlists',                'watchlists existe');
select has_table('public', 'watchlist_items',           'watchlist_items existe');

-- --- 2. Chaves primarias, todas UUID ----------------------------------------
select has_pk('public', 'youtube_channels',        'youtube_channels tem PK');
select has_pk('public', 'youtube_collection_runs', 'youtube_collection_runs tem PK');
select has_pk('public', 'channel_analyses',        'channel_analyses tem PK');
select has_pk('public', 'watchlists',              'watchlists tem PK');

select col_type_is('public', 'youtube_channels',   'id', 'uuid', 'PK e uuid');
select col_type_is('public', 'channel_analyses',   'id', 'uuid', 'PK e uuid');

-- --- 3. Datas sempre com timezone -------------------------------------------
select col_type_is('public', 'youtube_collection_runs', 'captured_at',
  'timestamp with time zone', 'captured_at e timestamptz');
select col_type_is('public', 'channel_analyses', 'requested_at',
  'timestamp with time zone', 'requested_at e timestamptz');
select col_type_is('public', 'youtube_video_snapshots', 'published_at',
  'timestamp with time zone', 'published_at e timestamptz');

-- --- 4. Contagens em bigint, duracao em integer ------------------------------
select col_type_is('public', 'youtube_video_snapshots', 'view_count', 'bigint',
  'view_count e bigint');
select col_type_is('public', 'youtube_video_snapshots', 'duration_seconds', 'integer',
  'duration_seconds e integer');
select col_type_is('public', 'ai_insight_reports', 'input_tokens', 'bigint',
  'input_tokens e bigint');

-- Contagens nullable: NULL e "indisponivel", diferente de zero (RN-08).
select col_is_null('public', 'youtube_video_snapshots', 'view_count',
  'view_count aceita NULL para contagem indisponivel');

-- --- 5. Foreign keys ---------------------------------------------------------
select fk_ok('public', 'youtube_collection_runs', 'channel_id',
             'public', 'youtube_channels', 'id', 'run -> channel');
select fk_ok('public', 'youtube_channel_snapshots', 'collection_run_id',
             'public', 'youtube_collection_runs', 'id', 'channel snapshot -> run');
select fk_ok('public', 'youtube_video_snapshots', 'collection_run_id',
             'public', 'youtube_collection_runs', 'id', 'video snapshot -> run');
select fk_ok('public', 'video_analytics_results', 'collection_run_id',
             'public', 'youtube_collection_runs', 'id', 'metrics -> run');
select fk_ok('public', 'ai_insight_reports', 'analysis_id',
             'public', 'channel_analyses', 'id', 'report -> analysis');
select fk_ok('public', 'watchlist_items', 'watchlist_id',
             'public', 'watchlists', 'id', 'item -> watchlist');
select fk_ok('public', 'watchlist_items', 'channel_id',
             'public', 'youtube_channels', 'id', 'item -> channel');

-- --- 6. Unicidade ------------------------------------------------------------
select col_is_unique('public', 'youtube_channels', 'youtube_channel_id',
  'ID oficial do canal e unico');
select col_is_unique('public', 'youtube_channel_snapshots', 'collection_run_id',
  'no maximo um snapshot de canal por execucao');
select col_is_unique('public', 'youtube_video_snapshots',
  array['collection_run_id', 'youtube_video_id'],
  'mesmo video nao se repete na mesma coleta');
select col_is_unique('public', 'video_analytics_results',
  array['collection_run_id', 'algorithm_version'],
  'um resultado por coleta e versao de algoritmo');
select col_is_unique('public', 'watchlist_items',
  array['watchlist_id', 'channel_id'],
  'mesmo canal nao se repete na mesma lista');
select col_is_unique('public', 'watchlists',
  array['user_id', 'name'],
  'nome de lista e unico por usuario');

-- --- 7. Indices --------------------------------------------------------------
select has_index('public', 'youtube_collection_runs', 'uniq_active_run_per_channel',
  'indice parcial de coleta ativa existe');
select has_index('public', 'youtube_collection_runs', 'youtube_collection_runs_reusable_idx',
  'indice de reuso existe');
select has_index('public', 'youtube_collection_runs', 'youtube_collection_runs_status_idx',
  'indice de status existe');
select has_index('public', 'youtube_video_snapshots', 'youtube_video_snapshots_run_published_idx',
  'indice de videos por coleta e data existe');
select has_index('public', 'channel_analyses', 'uniq_analysis_idempotency_key',
  'indice parcial de idempotencia existe');
select has_index('public', 'channel_analyses', 'channel_analyses_user_requested_idx',
  'indice de analises por usuario existe');
select has_index('public', 'channel_analyses', 'channel_analyses_channel_status_idx',
  'indice de analises por canal e status existe');
select has_index('public', 'ai_insight_reports', 'ai_insight_reports_analysis_idx',
  'indice de relatorios por analise existe');
select has_index('public', 'watchlists', 'watchlists_user_idx',
  'indice de listas por usuario existe');
select has_index('public', 'watchlist_items', 'watchlist_items_channel_idx',
  'indice de itens por canal existe');
select has_index('public', 'youtube_channels', 'youtube_channels_handle_lower_idx',
  'indice case-insensitive de handle existe');

-- --- 8. Funcoes auxiliares ---------------------------------------------------
select has_function('public', 'set_updated_at', 'funcao de updated_at existe');
select has_function('public', 'handle_new_user', 'funcao de criacao de profile existe');

select * from finish();
rollback;
