-- =============================================================================
-- SPEC-012 — Unicidade de nome de lista, agora de verdade case-insensitive.
--
-- O QUE ESTAVA ERRADO.
--
-- A migracao inicial declarou:
--
--   -- Nome unico por usuario, case-insensitive: "Concorrentes" e "concorrentes"
--   -- na mesma conta seriam confusao, nao organizacao.
--   constraint watchlists_unique_name_per_user unique (user_id, name)
--
-- O comentario descreve a intencao; a constraint NAO a implementa. `unique` sobre
-- `text` usa a collation padrao do PostgreSQL, que diferencia maiusculas.
--
-- Verificado contra o banco local em 2026-08-08: inserir 'Concorrentes' e
-- 'concorrentes' para o mesmo usuario — as DUAS foram aceitas.
--
-- Como o comportamento pretendido e o certo, a correcao e do esquema e nao do
-- comentario. Ver SPEC-012, secao 4.
-- =============================================================================

alter table public.watchlists
  drop constraint watchlists_unique_name_per_user;

-- Indice funcional: e a forma de expressar unicidade sobre uma EXPRESSAO, que
-- `unique (...)` de coluna nao alcanca. O nome e mantido para que quem procurar
-- pela constraint antiga encontre o substituto.
create unique index watchlists_unique_name_per_user
  on public.watchlists (user_id, lower(name));

comment on index public.watchlists_unique_name_per_user is
  'SPEC-012: nome unico por usuario ignorando maiusculas. Substitui a constraint '
  'homonima da migracao inicial, que era case-sensitive apesar do comentario.';
