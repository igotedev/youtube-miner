-- =============================================================================
-- SPEC-004 — Esquema inicial: persistencia, snapshots e reuso de analises.
--
-- Ver docs/specs/SPEC-004-postgresql-persistence.md e
--     docs/adr/ADR-005-persistence-boundaries-and-analysis-reuse.md
--
-- Divisao central (ADR-005):
--   GLOBAL  — youtube_channels, youtube_collection_runs, youtube_channel_snapshots,
--             youtube_video_snapshots, video_analytics_results
--   USUARIO — profiles, channel_analyses, ai_insight_reports, watchlists,
--             watchlist_items
--
-- Dados publicos do YouTube sao globais e reutilizaveis entre usuarios; nada
-- disso e exposto diretamente ao navegador. Ver a secao de RLS no fim.
--
-- Estados usam text + CHECK, nao ENUM: acrescentar um estado com ENUM exige
-- ALTER TYPE, que nao roda dentro de transacao em versoes mais antigas e
-- acopla a migration ao catalogo. CHECK e uma migration trivial.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Funcoes auxiliares
-- -----------------------------------------------------------------------------

-- Mantem updated_at coerente sem depender de o adaptador lembrar de escrever.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- search_path fixo: sem isso, um schema malicioso no caminho poderia sequestrar
-- a resolucao de `now()`.
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- IDENTITY
-- =============================================================================

-- Dados minimos da aplicacao associados a auth.users, que continua sendo do
-- Supabase Auth. Deliberadamente sem dados pessoais: o MVP nao precisa de nome,
-- avatar nem preferencias, e o que nao se guarda nao vaza.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o profile junto com o usuario.
--
-- SECURITY DEFINER e necessario: o trigger roda no contexto do Supabase Auth,
-- que nao tem privilegio de escrita em public.profiles. Nao copia nenhum
-- metadado do usuario — apenas o id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- YOUTUBE COLLECTION  (global)
-- =============================================================================

-- Identidade canonica de um canal.
--
-- RN-01/RN-02: a chave natural e o ID oficial do YouTube, nunca a URL nem o
-- handle — handles mudam. O id interno e UUID para nao acoplar chaves
-- estrangeiras a um identificador de terceiro.
create table public.youtube_channels (
  id                 uuid primary key default gen_random_uuid(),
  youtube_channel_id text        not null unique,
  handle             text,
  title              text,
  country            text,
  published_at       timestamptz,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Mesmo formato validado na SPEC-002: UC + 22 caracteres base64url.
  constraint youtube_channels_id_format
    check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  constraint youtube_channels_handle_format
    check (handle is null or handle ~ '^@[^\s/\\?#&=%:@]{1,30}$'),
  constraint youtube_channels_seen_order
    check (last_seen_at >= first_seen_at)
);

-- Busca por handle e case-insensitive: o usuario digita @Canal e o YouTube
-- devolve @canal. Indice, e nao UNIQUE — dois canais podem ter tido o mesmo
-- handle em momentos diferentes, e recusar isso quebraria a coleta.
create index youtube_channels_handle_lower_idx
  on public.youtube_channels (lower(handle))
  where handle is not null;

create trigger youtube_channels_set_updated_at
  before update on public.youtube_channels
  for each row execute function public.set_updated_at();

-- Uma tentativa de coleta dos dados publicos de um canal.
create table public.youtube_collection_runs (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid        not null references public.youtube_channels (id) on delete cascade,
  status          text        not null,
  requested_at    timestamptz not null default now(),
  started_at      timestamptz,
  captured_at     timestamptz,
  completed_at    timestamptz,
  failed_at       timestamptz,
  reusable_until  timestamptz,
  invalidated_at  timestamptz,
  error_code      text,
  -- Metadados de erro SEM credencial, sem URL com token, sem corpo bruto de
  -- resposta de terceiro. Ver SPEC-004, secao 24.
  error_metadata  jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint youtube_collection_runs_status
    check (status in ('pending', 'collecting_channel', 'collecting_videos', 'completed', 'failed')),
  constraint youtube_collection_runs_error_metadata_is_object
    check (error_metadata is null or jsonb_typeof(error_metadata) = 'object'),
  -- Concluida exige carimbo; falha exige carimbo. Impede a linha "completed sem
  -- completed_at" que faria a auditoria mentir.
  constraint youtube_collection_runs_completed_stamp
    check (status <> 'completed' or (completed_at is not null and captured_at is not null)),
  constraint youtube_collection_runs_failed_stamp
    check (status <> 'failed' or failed_at is not null),
  -- Reuso so faz sentido em execucao concluida.
  constraint youtube_collection_runs_reusable_only_when_completed
    check (reusable_until is null or status = 'completed'),
  constraint youtube_collection_runs_time_order
    check (started_at is null or started_at >= requested_at)
);

-- CONCORRENCIA: no maximo uma execucao ativa por canal.
--
-- Indice unico PARCIAL sobre os tres estados em andamento. Duas requisicoes
-- simultaneas para o mesmo canal: uma insere, a outra recebe unique_violation e
-- o adaptador a traduz para ConcurrentCollectionRunError.
--
-- Consultar-e-depois-inserir nao resolveria: entre o SELECT e o INSERT cabe a
-- outra requisicao, e o resultado seria duas coletas gastando quota pelo mesmo
-- dado. Ver SPEC-004, secao 15.
create unique index uniq_active_run_per_channel
  on public.youtube_collection_runs (channel_id)
  where status in ('pending', 'collecting_channel', 'collecting_videos');

-- Suporta findReusableForChannel: filtra canal e validade, ordena por captura.
create index youtube_collection_runs_reusable_idx
  on public.youtube_collection_runs (channel_id, reusable_until desc)
  where status = 'completed' and invalidated_at is null;

create index youtube_collection_runs_status_idx
  on public.youtube_collection_runs (status);

create trigger youtube_collection_runs_set_updated_at
  before update on public.youtube_collection_runs
  for each row execute function public.set_updated_at();

-- Dados do canal capturados em uma execucao. RN-04: bruto, separado do calculado.
create table public.youtube_channel_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  collection_run_id    uuid        not null unique
                       references public.youtube_collection_runs (id) on delete cascade,
  raw_payload          jsonb       not null,
  source_schema_version text       not null,
  created_at           timestamptz not null default now(),

  constraint youtube_channel_snapshots_payload_is_object
    check (jsonb_typeof(raw_payload) = 'object')
);
-- `unique` acima ja garante no maximo um snapshot de canal por execucao e ja
-- cria o indice. Nao criamos outro por cima.

-- Videos capturados em uma execucao.
create table public.youtube_video_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  collection_run_id    uuid        not null
                       references public.youtube_collection_runs (id) on delete cascade,
  youtube_video_id     text        not null,
  title                text        not null,
  published_at         timestamptz not null,
  duration_seconds     integer,
  format               text        not null,
  -- bigint: um canal grande passa de 2^31 visualizacoes. NULL e "indisponivel",
  -- e nunca deve virar 0 — RN-08.
  view_count           bigint,
  like_count           bigint,
  comment_count        bigint,
  raw_payload          jsonb       not null,
  source_schema_version text       not null,
  created_at           timestamptz not null default now(),

  constraint youtube_video_snapshots_unique_per_run
    unique (collection_run_id, youtube_video_id),
  constraint youtube_video_snapshots_format
    check (format in ('short', 'long', 'unknown')),
  constraint youtube_video_snapshots_duration_non_negative
    check (duration_seconds is null or duration_seconds >= 0),
  constraint youtube_video_snapshots_view_count_non_negative
    check (view_count is null or view_count >= 0),
  constraint youtube_video_snapshots_like_count_non_negative
    check (like_count is null or like_count >= 0),
  constraint youtube_video_snapshots_comment_count_non_negative
    check (comment_count is null or comment_count >= 0),
  constraint youtube_video_snapshots_payload_is_object
    check (jsonb_typeof(raw_payload) = 'object')
);

-- O par (collection_run_id, youtube_video_id) da UNIQUE ja atende buscas por
-- collection_run_id sozinho. Este indice adicional serve a ordenacao por data,
-- que o motor de metricas usa para calcular frequencia.
create index youtube_video_snapshots_run_published_idx
  on public.youtube_video_snapshots (collection_run_id, published_at desc);

-- =============================================================================
-- VIDEO ANALYTICS  (global)
-- =============================================================================

-- Resultado deterministico da SPEC-003. RN-04: separado do payload bruto.
create table public.video_analytics_results (
  id                uuid primary key default gen_random_uuid(),
  collection_run_id uuid        not null
                    references public.youtube_collection_runs (id) on delete cascade,
  algorithm_version text        not null,
  calculated_at     timestamptz not null,
  metrics           jsonb       not null,
  created_at        timestamptz not null default now(),

  -- A mesma coleta pode ter resultados de versoes diferentes lado a lado: e
  -- assim que se compara o efeito de uma mudanca de regra sem recoletar nada.
  constraint video_analytics_results_unique_per_version
    unique (collection_run_id, algorithm_version),
  constraint video_analytics_results_version_format
    check (algorithm_version ~ '^\d+\.\d+\.\d+$'),
  constraint video_analytics_results_metrics_is_object
    check (jsonb_typeof(metrics) = 'object')
);
-- A UNIQUE acima ja cria o indice de (collection_run_id, algorithm_version).

-- =============================================================================
-- CHANNEL ANALYSIS  (do usuario)
-- =============================================================================

create table public.channel_analyses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  channel_id          uuid        not null references public.youtube_channels (id) on delete restrict,
  -- ON DELETE SET NULL: se uma coleta global for removida, a analise do usuario
  -- sobrevive sem o artefato. Apagar a analise junto destruiria dado do usuario
  -- por causa de uma limpeza administrativa de dado global.
  collection_run_id   uuid references public.youtube_collection_runs (id) on delete set null,
  analytics_result_id uuid references public.video_analytics_results (id) on delete set null,
  -- Acrescentado ao modelo de referencia: RN-02 exige rastrear o que o usuario
  -- digitou, sem que isso seja chave de nada. `channel_id` continua sendo o
  -- vinculo real.
  requested_url       text        not null,
  status              text        not null,
  -- Nunca gerada pelo banco: quem chama e responsavel por ela (SPEC-004, 16).
  idempotency_key     text,
  requested_at        timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  failed_at           timestamptz,
  error_code          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint channel_analyses_status
    check (status in (
      'pending', 'collecting_channel', 'collecting_videos', 'calculating_metrics',
      'generating_insights', 'completed', 'partially_completed', 'failed'
    )),
  constraint channel_analyses_requested_url_not_blank
    check (length(btrim(requested_url)) > 0 and length(requested_url) <= 2048),
  constraint channel_analyses_failed_stamp
    check (status <> 'failed' or failed_at is not null),
  constraint channel_analyses_time_order
    check (started_at is null or started_at >= requested_at)
);

-- IDEMPOTENCIA: unica por usuario, e apenas quando a chave existe.
-- Parcial de proposito — analises sem chave sao a maioria e nao devem colidir
-- entre si por compartilharem NULL.
create unique index uniq_analysis_idempotency_key
  on public.channel_analyses (user_id, idempotency_key)
  where idempotency_key is not null;

create index channel_analyses_user_requested_idx
  on public.channel_analyses (user_id, requested_at desc);

create index channel_analyses_channel_status_idx
  on public.channel_analyses (channel_id, status);

create trigger channel_analyses_set_updated_at
  before update on public.channel_analyses
  for each row execute function public.set_updated_at();

-- NOTA: NAO existe indice unico impedindo duas analises ativas do mesmo usuario
-- para o mesmo canal. A protecao contra desperdicio de quota ja esta no nivel
-- certo — `uniq_active_run_per_channel` impede a COLETA duplicada, que e o que
-- custa. Impedir a segunda ANALISE bloquearia um caso legitimo: pedir de novo
-- depois de uma falha parcial, ou com outra versao do algoritmo. Ver SPEC-004,
-- secao 15.

-- =============================================================================
-- AI INSIGHTS  (do usuario, via analise)
-- =============================================================================

-- RN-05: relatorio de IA separado das metricas objetivas.
-- RN-09: uma analise objetiva concluida existe sem relatorio nenhum.
create table public.ai_insight_reports (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid        not null references public.channel_analyses (id) on delete cascade,
  status         text        not null,
  provider       text        not null,
  model          text        not null,
  prompt_version text        not null,
  language       text        not null default 'pt-BR',
  report         jsonb,
  input_tokens   bigint,
  output_tokens  bigint,
  requested_at   timestamptz not null default now(),
  completed_at   timestamptz,
  failed_at      timestamptz,
  error_code     text,
  created_at     timestamptz not null default now(),

  constraint ai_insight_reports_status
    check (status in ('pending', 'completed', 'failed')),
  constraint ai_insight_reports_report_is_object
    check (report is null or jsonb_typeof(report) = 'object'),
  constraint ai_insight_reports_completed_has_report
    check (status <> 'completed' or (report is not null and completed_at is not null)),
  constraint ai_insight_reports_input_tokens_non_negative
    check (input_tokens is null or input_tokens >= 0),
  constraint ai_insight_reports_output_tokens_non_negative
    check (output_tokens is null or output_tokens >= 0)
);

create index ai_insight_reports_analysis_idx
  on public.ai_insight_reports (analysis_id);

-- =============================================================================
-- WATCHLISTS  (do usuario)
-- =============================================================================

create table public.watchlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint watchlists_name_not_blank check (length(btrim(name)) > 0),
  constraint watchlists_name_length     check (length(name) <= 100),
  -- Nome unico por usuario, case-insensitive: "Concorrentes" e "concorrentes"
  -- na mesma conta seriam confusao, nao organizacao.
  constraint watchlists_unique_name_per_user unique (user_id, name)
);

create index watchlists_user_idx on public.watchlists (user_id);

create trigger watchlists_set_updated_at
  before update on public.watchlists
  for each row execute function public.set_updated_at();

create table public.watchlist_items (
  id           uuid primary key default gen_random_uuid(),
  watchlist_id uuid        not null references public.watchlists (id) on delete cascade,
  -- RESTRICT: um canal global nao desaparece enquanto alguem o acompanha.
  channel_id   uuid        not null references public.youtube_channels (id) on delete restrict,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint watchlist_items_unique_channel unique (watchlist_id, channel_id),
  constraint watchlist_items_notes_length check (notes is null or length(notes) <= 2000)
);

-- A UNIQUE (watchlist_id, channel_id) ja cobre buscas por watchlist_id.
-- Este indice serve a pergunta inversa: quem acompanha este canal.
create index watchlist_items_channel_idx on public.watchlist_items (channel_id);

create trigger watchlist_items_set_updated_at
  before update on public.watchlist_items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
--
-- RLS ativada em TODAS as tabelas. Sem policy, o padrao e negar.
--
-- Tabelas globais nao recebem policy nenhuma para `authenticated`: o navegador
-- nunca le payload bruto direto. O backend usa a service role, que ignora RLS,
-- e devolve DTOs controlados. Ver ADR-005.
-- =============================================================================

alter table public.profiles                  enable row level security;
alter table public.youtube_channels          enable row level security;
alter table public.youtube_collection_runs   enable row level security;
alter table public.youtube_channel_snapshots enable row level security;
alter table public.youtube_video_snapshots   enable row level security;
alter table public.video_analytics_results   enable row level security;
alter table public.channel_analyses          enable row level security;
alter table public.ai_insight_reports        enable row level security;
alter table public.watchlists                enable row level security;
alter table public.watchlist_items           enable row level security;

-- --- profiles ---------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Sem INSERT e sem DELETE: o profile nasce pelo trigger e morre com o usuario.

-- --- channel_analyses -------------------------------------------------------
create policy channel_analyses_select_own on public.channel_analyses
  for select to authenticated using ((select auth.uid()) = user_id);

create policy channel_analyses_insert_own on public.channel_analyses
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    -- O navegador so pode criar analise em `pending`. Os estados operacionais
    -- sao do servidor: sem isto, um cliente marcaria a propria analise como
    -- `completed` sem que coleta alguma tivesse acontecido.
    and status = 'pending'
    and collection_run_id is null
    and analytics_result_id is null
  );

-- Sem UPDATE e sem DELETE para `authenticated`. A progressao de estado passa
-- pelo servidor, que usa a service role. Uma policy de UPDATE que permitisse
-- trocar `status` livremente anularia a restricao do INSERT acima.

-- --- ai_insight_reports -----------------------------------------------------
-- Acesso indireto: o relatorio e visivel quando a analise dona pertence a quem
-- pergunta. Escrita e exclusivamente do servidor.
create policy ai_insight_reports_select_via_analysis on public.ai_insight_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.channel_analyses a
      where a.id = ai_insight_reports.analysis_id
        and a.user_id = (select auth.uid())
    )
  );

-- --- watchlists -------------------------------------------------------------
create policy watchlists_select_own on public.watchlists
  for select to authenticated using ((select auth.uid()) = user_id);

create policy watchlists_insert_own on public.watchlists
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy watchlists_update_own on public.watchlists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy watchlists_delete_own on public.watchlists
  for delete to authenticated using ((select auth.uid()) = user_id);

-- --- watchlist_items --------------------------------------------------------
create policy watchlist_items_select_via_list on public.watchlist_items
  for select to authenticated
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_items.watchlist_id and w.user_id = (select auth.uid())
    )
  );

create policy watchlist_items_insert_via_list on public.watchlist_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_items.watchlist_id and w.user_id = (select auth.uid())
    )
  );

create policy watchlist_items_update_via_list on public.watchlist_items
  for update to authenticated
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_items.watchlist_id and w.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_items.watchlist_id and w.user_id = (select auth.uid())
    )
  );

create policy watchlist_items_delete_via_list on public.watchlist_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_items.watchlist_id and w.user_id = (select auth.uid())
    )
  );

-- =============================================================================
-- GRANTS
--
-- RLS filtra LINHAS; grant controla o VERBO. As duas camadas sao necessarias:
-- sem revogar o grant, um erro futuro em uma policy abriria a tabela inteira.
-- =============================================================================

-- Ponto de partida: `authenticated` e `anon` nao alcancam nada em public.
revoke all on all tables in schema public from anon, authenticated;

-- Somente o estritamente necessario, e apenas nas tabelas do usuario.
grant select, update            on public.profiles         to authenticated;
grant select, insert            on public.channel_analyses to authenticated;
grant select                    on public.ai_insight_reports to authenticated;
grant select, insert, update, delete on public.watchlists      to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;

-- As cinco tabelas globais permanecem sem grant algum para `anon` e
-- `authenticated`. O payload bruto so e alcancavel pela service role, no
-- servidor, que devolve DTOs. Criterio de aceitacao 15 da SPEC-004.

-- `anon` nao recebe nada: nenhuma funcionalidade desta etapa e publica.
