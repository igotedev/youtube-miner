-- =============================================================================
-- SPEC-008 — Conclusao transacional de uma execucao de coleta
--
-- POR QUE ISTO E UMA FUNCAO, E NAO TRES CHAMADAS DO ADAPTADOR.
--
-- Concluir uma coleta significa gravar quatro coisas: o estado da execucao, o
-- snapshot do canal, os snapshots dos videos e a atualizacao do canal. O cliente
-- do Supabase nao abre transacao — cada chamada e independente.
--
-- Sem atomicidade, uma falha entre a segunda e a terceira gravacao deixaria uma
-- execucao `completed` SEM os videos. E a RN-10 reaproveitaria exatamente essa
-- execucao, devolvendo um snapshot vazio como se fosse um canal sem videos. O
-- erro nao apareceria na hora — apareceria como metricas silenciosamente erradas
-- na analise de outra pessoa, horas depois.
--
-- O corpo de uma funcao plpgsql roda em uma unica transacao. Ou grava tudo, ou
-- nao grava nada.
-- =============================================================================

-- Idempotente por construcao: chamada duas vezes para a mesma execucao produz o
-- mesmo estado final. Um retry de rede depois de uma gravacao bem-sucedida nao
-- pode duplicar video nem estourar constraint.
create or replace function public.complete_collection_run(
  p_run_id                 uuid,
  p_captured_at            timestamptz,
  p_completed_at           timestamptz,
  p_reusable_until         timestamptz,
  p_source_schema_version  text,
  p_channel_payload        jsonb,
  p_channel_title          text,
  p_channel_handle         text,
  p_channel_country        text,
  p_channel_published_at   timestamptz,
  p_videos                 jsonb
)
returns void
language plpgsql
-- `search_path` vazio: a funcao qualifica todos os nomes. Sem isto, um schema no
-- caminho de busca do chamador poderia sequestrar uma tabela.
set search_path = ''
as $$
declare
  v_channel_id uuid;
begin
  if p_videos is null or jsonb_typeof(p_videos) <> 'array' then
    raise exception 'p_videos deve ser um array jsonb'
      using errcode = '22023';
  end if;

  -- Conclui a execucao. O RETURNING confirma que a linha existe e entrega o
  -- canal sem uma segunda consulta.
  update public.youtube_collection_runs
     set status         = 'completed',
         captured_at    = p_captured_at,
         completed_at   = p_completed_at,
         reusable_until = p_reusable_until,
         failed_at      = null,
         error_code     = null,
         error_metadata = null
   where id = p_run_id
  returning channel_id into v_channel_id;

  if v_channel_id is null then
    -- Codigo de "no_data_found": o adaptador o traduz para NotFoundError.
    raise exception 'execucao de coleta % nao encontrada', p_run_id
      using errcode = 'P0002';
  end if;

  -- Dados denormalizados do canal, para busca e exibicao. `first_seen_at` nunca
  -- e tocado.
  --
  -- `last_seen_at` usa GREATEST, e nao atribuicao direta, por duas razoes:
  --
  --  1. Semantica. "Ultima vez que vimos o canal" nao pode ANDAR PARA TRAS. Uma
  --     coleta antiga concluida fora de ordem — retry demorado, fila atrasada,
  --     relogio de outro servidor adiantado — reescreveria o campo com uma data
  --     anterior a captura mais recente que ja temos.
  --
  --  2. Integridade. A constraint `youtube_channels_seen_order` exige
  --     `last_seen_at >= first_seen_at`. Sem GREATEST, uma captura anterior ao
  --     registro do canal derruba a transacao inteira — e com ela a coleta, que
  --     nao tem culpa nenhuma.
  update public.youtube_channels
     set title        = coalesce(p_channel_title, title),
         handle       = coalesce(p_channel_handle, handle),
         country      = coalesce(p_channel_country, country),
         published_at = coalesce(p_channel_published_at, published_at),
         last_seen_at = greatest(last_seen_at, p_captured_at)
   where id = v_channel_id;

  -- `do nothing` e o que torna o retry seguro: o snapshot ja gravado permanece
  -- como esta. Sobrescrever com um payload de outra captura confundiria duas
  -- leituras da API em uma so linha.
  insert into public.youtube_channel_snapshots
      (collection_run_id, raw_payload, source_schema_version)
  values
      (p_run_id, p_channel_payload, p_source_schema_version)
  on conflict (collection_run_id) do nothing;

  insert into public.youtube_video_snapshots
      (collection_run_id, youtube_video_id, title, published_at, duration_seconds,
       format, view_count, like_count, comment_count, raw_payload, source_schema_version)
  select
      p_run_id,
      v.youtube_video_id,
      v.title,
      v.published_at,
      v.duration_seconds,
      v.format,
      v.view_count,
      v.like_count,
      v.comment_count,
      v.raw_payload,
      p_source_schema_version
    from jsonb_to_recordset(p_videos) as v(
      youtube_video_id  text,
      title             text,
      published_at      timestamptz,
      duration_seconds  integer,
      format            text,
      view_count        bigint,
      like_count        bigint,
      comment_count     bigint,
      raw_payload       jsonb
    )
  on conflict (collection_run_id, youtube_video_id) do nothing;
end;
$$;

-- =============================================================================
-- Permissoes
--
-- Esta funcao escreve em quatro tabelas GLOBAIS, que nao tem policy para
-- `authenticated` (ADR-005). Expo-la ao cliente permitiria a qualquer usuario
-- autenticado gravar snapshots arbitrarios — inclusive marcar uma execucao como
-- concluida com dados inventados, que a RN-10 depois serviria a outras pessoas.
--
-- NAO e `security definer`: nao ha escalonamento de privilegio aqui. Quem chama
-- ja precisa de permissao de escrita, e so a service role tem.
-- =============================================================================
revoke all on function public.complete_collection_run(
  uuid, timestamptz, timestamptz, timestamptz, text, jsonb, text, text, text,
  timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.complete_collection_run(
  uuid, timestamptz, timestamptz, timestamptz, text, jsonb, text, text, text,
  timestamptz, jsonb
) to service_role;
