# SPEC-004 — Persistência PostgreSQL, snapshots e reuso de análises

| Campo      | Valor                                               |
| ---------- | --------------------------------------------------- |
| Status     | Implementada — **SQL não executado** (ver seção 23) |
| Data       | 2026-08-06                                          |
| Camada     | `infrastructure` + tipos de domínio afetados        |
| Depende de | SPEC-001 (RN-01..RN-14), SPEC-002, SPEC-003         |
| Decisão    | ADR-005                                             |

---

## 1. Contexto

Três SPECs produziram tipos de domínio maduros e **nada é persistido**. Toda
análise recomeça do zero, e a RN-10 — reuso de coletas recentes — não tinha onde
existir.

O gargalo real do produto é a **quota da YouTube Data API**: teto diário rígido,
externo, que não se resolve com mais servidor. Sem persistência, dois usuários
analisando o mesmo canal na mesma hora gastam quota duas vezes por um dado
idêntico e público.

## 2. Objetivo

Fundação de persistência que estabeleça:

- onde a RN-10 existe, de forma verificável;
- a separação entre dado público global e dado do usuário;
- isolamento por usuário em duas camadas;
- proteção estrutural contra coletas simultâneas do mesmo canal;
- idempotência de solicitações;
- separação física entre bruto, calculado e gerado por IA.

## 3. Modelo de propriedade dos dados

Ver ADR-005 para a decisão completa. Em resumo:

| Território | Tem dono? | Reutilizável?           | Cliente alcança? |
| ---------- | --------- | ----------------------- | ---------------- |
| Global     | não       | **sim, entre usuários** | **não**          |
| Usuário    | sim       | não                     | sim, o próprio   |

## 4. Dados globais × dados do usuário

**Globais:** `youtube_channels`, `youtube_collection_runs`,
`youtube_channel_snapshots`, `youtube_video_snapshots`,
`video_analytics_results`.

**Do usuário:** `profiles`, `channel_analyses`, `ai_insight_reports` (via
análise), `watchlists`, `watchlist_items` (via lista).

Dados públicos do YouTube são reutilizáveis entre usuários. **Isso não significa
expô-los ao navegador**: as cinco tabelas globais não têm policy nem `GRANT` para
`authenticated`. A aplicação devolve DTOs montados no servidor.

## 5. Propriedade das tabelas por módulo

| Módulo               | Tabelas                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `identity`           | `profiles` (o Supabase Auth continua dono de `auth.users`)                                            |
| `youtube-collection` | `youtube_channels`, `youtube_collection_runs`, `youtube_channel_snapshots`, `youtube_video_snapshots` |
| `channel-analysis`   | `channel_analyses`                                                                                    |
| `video-analytics`    | `video_analytics_results`                                                                             |
| `ai-insights`        | `ai_insight_reports`                                                                                  |
| `watchlists`         | `watchlists`, `watchlist_items`                                                                       |

R7 continua valendo: um repositório não consulta tabela de outro módulo.

### Dívida registrada

`SupabaseAnalysisRepository.resolveInternalChannelId` faz
`select id from youtube_channels where youtube_channel_id = ?` — uma leitura em
tabela de `youtube-collection`. É o **único** ponto assim no código, existe
porque o domínio fala `UC...` enquanto as FKs usam o UUID interno, e some quando
`youtube-collection` expuser uma porta `ChannelDirectory`. Está anotado no
próprio arquivo.

## 6. Entidades persistidas

10 tabelas. Ver `supabase/migrations/20260806120000_initial_schema.sql`.

| Tabela                      | Guarda                                             |
| --------------------------- | -------------------------------------------------- |
| `profiles`                  | dados mínimos da aplicação, ligados a `auth.users` |
| `youtube_channels`          | identidade canônica de um canal                    |
| `youtube_collection_runs`   | uma tentativa de coleta                            |
| `youtube_channel_snapshots` | payload bruto do canal                             |
| `youtube_video_snapshots`   | vídeos capturados, brutos + campos extraídos       |
| `video_analytics_results`   | resultado determinístico da SPEC-003               |
| `channel_analyses`          | análise solicitada por um usuário                  |
| `ai_insight_reports`        | relatórios de IA (nenhum gerado ainda)             |
| `watchlists`                | listas de canais                                   |
| `watchlist_items`           | canais dentro de uma lista                         |

`profiles` guarda apenas `id`, `created_at` e `updated_at`. Nada de nome, avatar
ou preferência: o MVP não precisa, e **o que não se guarda não vaza**.

## 7. Relacionamentos

```
auth.users ─1:1─ profiles
     │
     ├─1:N─ channel_analyses ─N:1─ youtube_channels
     │            │  │
     │            │  └─N:1─ youtube_collection_runs  (reutilizável, global)
     │            │  └─N:1─ video_analytics_results  (global)
     │            └─1:N─ ai_insight_reports
     │
     └─1:N─ watchlists ─1:N─ watchlist_items ─N:1─ youtube_channels

youtube_channels ─1:N─ youtube_collection_runs
                              ├─1:1─ youtube_channel_snapshots
                              ├─1:N─ youtube_video_snapshots
                              └─1:N─ video_analytics_results (uma por versão)
```

O `N:1` de `channel_analyses` para `youtube_collection_runs` é o que materializa
a RN-10: **várias análises, de usuários diferentes, apontando para a mesma
coleta**.

## 8. Chaves primárias

Todas `uuid`, com `default gen_random_uuid()` (extensão `pgcrypto`).

Exceção: `profiles.id` é o próprio `auth.users.id`, sem geração própria — são a
mesma entidade vista de dois lados.

UUID e não `bigserial`: identificadores aparecem em URL e em log, e um serial
revela volume de negócio (quantas análises existem, com que velocidade crescem).

## 9. Chaves estrangeiras e `ON DELETE`

Todas explícitas. A regra que rege as escolhas: **remover um usuário apaga o que
é dele e preserva os artefatos globais.**

| FK                                               | `ON DELETE` | Por quê                                                                 |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------- |
| `profiles.id → auth.users`                       | `CASCADE`   | o perfil é o usuário                                                    |
| `channel_analyses.user_id → auth.users`          | `CASCADE`   | análise é do usuário                                                    |
| `channel_analyses.channel_id → youtube_channels` | `RESTRICT`  | canal global não some sob os pés de uma análise                         |
| `channel_analyses.collection_run_id → runs`      | `SET NULL`  | limpeza administrativa de dado global não pode destruir dado do usuário |
| `channel_analyses.analytics_result_id → results` | `SET NULL`  | idem                                                                    |
| `ai_insight_reports.analysis_id → analyses`      | `CASCADE`   | relatório não existe sem análise                                        |
| `youtube_collection_runs.channel_id → channels`  | `CASCADE`   | remoção administrativa de canal leva suas coletas                       |
| `youtube_channel_snapshots.collection_run_id`    | `CASCADE`   | snapshot pertence à execução                                            |
| `youtube_video_snapshots.collection_run_id`      | `CASCADE`   | idem                                                                    |
| `video_analytics_results.collection_run_id`      | `CASCADE`   | métricas sem coleta não significam nada                                 |
| `watchlists.user_id → auth.users`                | `CASCADE`   | lista é do usuário                                                      |
| `watchlist_items.watchlist_id → watchlists`      | `CASCADE`   | item pertence à lista                                                   |
| `watchlist_items.channel_id → youtube_channels`  | `RESTRICT`  | canal não some enquanto alguém o acompanha                              |

`SET NULL` em `collection_run_id` merece nota: uma análise órfã é preferível a
uma análise apagada. O usuário mantém o registro de que pediu a análise, mesmo
que o artefato global tenha sido removido.

## 10. Restrições

Filosofia: **o banco garante invariantes estruturais e integridade referencial;
o domínio garante comportamento.** Não se tenta codificar regra de negócio em
`CHECK`.

| Restrição                                     | Impede                                                         |
| --------------------------------------------- | -------------------------------------------------------------- |
| `youtube_channels_id_format`                  | ID fora de `^UC[A-Za-z0-9_-]{22}$` (mesmo formato da SPEC-002) |
| `youtube_channels_handle_format`              | handle malformado                                              |
| `*_non_negative` (5×)                         | contagem ou duração negativa                                   |
| `*_payload_is_object` / `*_metrics_is_object` | `jsonb` que não seja objeto                                    |
| `*_status` (3×)                               | estado desconhecido                                            |
| `youtube_video_snapshots_format`              | formato fora de `short`/`long`/`unknown`                       |
| `youtube_video_snapshots_unique_per_run`      | mesmo vídeo duas vezes na coleta                               |
| `video_analytics_results_unique_per_version`  | resultado duplicado por coleta+versão                          |
| `video_analytics_results_version_format`      | versão fora de `MAJOR.MINOR.PATCH`                             |
| `watchlist_items_unique_channel`              | canal duplicado na lista                                       |
| `watchlists_unique_name_per_user`             | nome de lista repetido na conta                                |
| `uniq_analysis_idempotency_key`               | chave de idempotência repetida por usuário                     |
| `*_completed_stamp` / `*_failed_stamp`        | linha `completed` sem carimbo de conclusão                     |
| `*_reusable_only_when_completed`              | prazo de reuso em execução não concluída                       |
| `*_time_order`                                | `started_at` anterior a `requested_at`                         |

Contagens são **nullable**: `NULL` é "indisponível" e nunca deve virar `0`
(RN-08). Há teste pgTAP confirmando que `NULL` é aceito.

## 11. Índices

| Índice                                            | Serve a                           |
| ------------------------------------------------- | --------------------------------- |
| `youtube_channels.youtube_channel_id` (UNIQUE)    | busca pela chave natural          |
| `youtube_channels_handle_lower_idx`               | busca por handle case-insensitive |
| `uniq_active_run_per_channel` (parcial, UNIQUE)   | concorrência — seção 15           |
| `youtube_collection_runs_reusable_idx` (parcial)  | `findReusableForChannel`          |
| `youtube_collection_runs_status_idx`              | varredura operacional por estado  |
| `youtube_video_snapshots_run_published_idx`       | vídeos de uma coleta, por data    |
| `video_analytics_results` (UNIQUE run+versão)     | `findByCollectionRunAndVersion`   |
| `uniq_analysis_idempotency_key` (parcial, UNIQUE) | idempotência — seção 16           |
| `channel_analyses_user_requested_idx`             | histórico do usuário              |
| `channel_analyses_channel_status_idx`             | análises de um canal por estado   |
| `ai_insight_reports_analysis_idx`                 | relatórios de uma análise         |
| `watchlists_user_idx`                             | listas do usuário                 |
| `watchlist_items_channel_idx`                     | quem acompanha um canal           |

**Nenhum índice duplica uma `UNIQUE`.** `youtube_channel_snapshots.collection_run_id`
já é `UNIQUE` e não recebeu índice adicional; `watchlist_items(watchlist_id, channel_id)`
já cobre buscas por `watchlist_id`.

`handle` recebe índice mas **não** `UNIQUE`: dois canais podem ter tido o mesmo
handle em momentos diferentes, e recusar isso quebraria a coleta.

## 12. Estados persistidos

**`text` + `CHECK`, não `ENUM`.** `ALTER TYPE ... ADD VALUE` não roda dentro de
transação em versões mais antigas do PostgreSQL e acopla a migração ao catálogo;
acrescentar um estado com `CHECK` é uma migração trivial. Custo aceito: o tipo
não fica no catálogo.

| Tabela                    | Estados                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `youtube_collection_runs` | `pending`, `collecting_channel`, `collecting_videos`, `completed`, `failed` |
| `channel_analyses`        | os 8 da SPEC-001                                                            |
| `ai_insight_reports`      | `pending`, `completed`, `failed`                                            |

A coleta tem **menos** estados que a análise, de propósito: uma coleta termina
quando os dados públicos foram capturados. Calcular métricas e gerar relatório
são etapas da análise de um usuário, não da coleta global.

## 13. Política de snapshots

- `raw_payload` em `jsonb`, obrigatoriamente objeto.
- **Um** snapshot de canal por execução (`UNIQUE` em `collection_run_id`).
- N snapshots de vídeo, sem repetir o mesmo vídeo na execução.
- `source_schema_version` acompanha cada snapshot: quando o formato da API
  mudar, dá para saber qual parser usar sem adivinhar pela data.
- Imutáveis após a conclusão — não há caminho de atualização nos adaptadores.
- **Nunca chegam ao navegador.** Sem `GRANT`, sem policy.

Campos extraídos (`title`, `published_at`, `view_count`, `format`) convivem com
o `raw_payload`: o extraído serve às consultas, o bruto permite reprocessar se a
extração estiver errada.

## 14. Política de reutilização

```ts
findReusableForChannel(channelId, referenceTime): CollectionRun | null
```

Reutilizável quando **todos** os critérios valem:

1. mesmo canal oficial;
2. `status = 'completed'`;
3. `reusable_until` não nulo;
4. `reusable_until >= referenceTime` (fronteira **inclusiva**);
5. `invalidated_at` nulo;
6. possui snapshot de canal **e** snapshots de vídeo.

O critério 6 não é decorativo: uma execução marcada `completed` sem snapshot
seria reaproveitada e devolveria nada. Há teste cobrindo esse caso.

**`referenceTime` é sempre recebido.** Nenhum repositório chama `new Date()` —
seria violação de R9, tornaria a consulta não reproduzível e o teste impossível
de fixar.

A duração do cache **não** é decidida no domínio: vem de
`ANALYSIS_FRESHNESS_HOURS`, resolvida por quem monta o caso de uso, que entrega
o `reusableUntil` já calculado.

A regra também existe como função pura, `isReusableCollectionRun`, testada sem
banco. O SQL e a função aplicam os mesmos critérios.

## 15. Política de concorrência

```sql
create unique index uniq_active_run_per_channel
  on public.youtube_collection_runs (channel_id)
  where status in ('pending', 'collecting_channel', 'collecting_videos');
```

**Como funciona.** O índice só considera linhas nos três estados ativos. Uma
segunda execução ativa no mesmo canal viola a unicidade e o `INSERT` falha com
`23505`.

**O que acontece com duas solicitações simultâneas.** A primeira insere. A
segunda recebe `unique_violation`, que o adaptador traduz para
`ConcurrentCollectionRunError`. O caso de uso deve **aguardar ou reaproveitar a
execução em andamento** — nunca iniciar uma segunda coleta, porque cada coleta
duplicada gasta quota por um dado que já está sendo buscado.

**Por que não consultar-e-depois-inserir.** Entre o `SELECT` e o `INSERT` cabe
outra requisição. Sob concorrência real — que é exatamente quando o problema
aparece — a verificação prévia passa nas duas requisições e as duas inserem. A
garantia precisa estar onde a serialização acontece: no índice.

`findActiveForChannel` existe, mas é consulta de leitura para diagnóstico e UI.
Não é a proteção.

**Não há índice impedindo duas análises ativas do mesmo usuário para o mesmo
canal.** A proteção está no nível certo: o que custa quota é a **coleta**, e ela
já é única. Impedir a segunda análise bloquearia casos legítimos — pedir de novo
após uma falha parcial, ou com outra versão do algoritmo.

## 16. Política de idempotência

```sql
create unique index uniq_analysis_idempotency_key
  on public.channel_analyses (user_id, idempotency_key)
  where idempotency_key is not null;
```

- **Opcional.** Análises sem chave são a maioria e não colidem entre si por
  compartilharem `NULL` — daí o índice ser parcial.
- **Nunca gerada pelo banco.** Quem chama é responsável por ela; gerar
  automaticamente tornaria toda solicitação única e a garantia, inútil.
- **Por usuário.** Chaves geradas no cliente podem colidir entre contas sem que
  uma solicitação anule a outra.

O caso de uso consulta `findByIdempotencyKey` **antes** de qualquer trabalho: um
retry de rede devolve a análise existente sem gastar quota. A corrida que passa
por essa consulta é pega pelo índice.

## 17. Política de exclusão

Ver a tabela da seção 9. O resumo:

- **usuário removido** → perfil, análises, listas e itens somem; canais,
  coletas, snapshots e métricas **permanecem**;
- **coleta removida** → seus snapshots e resultados somem;
- **lista removida** → seus itens somem;
- **análise removida** → seus relatórios de IA somem;
- **canal global** → protegido por `RESTRICT` enquanto houver dependentes.

## 18. Row Level Security

**RLS ativada nas 10 tabelas.** Sem policy, o padrão é negar.

### Tabelas do usuário

| Tabela               | `authenticated` pode                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `profiles`           | ler e atualizar o próprio                                                |
| `channel_analyses`   | ler as próprias; **criar apenas em `pending`**, sem artefatos vinculados |
| `ai_insight_reports` | ler quando a análise dona for sua                                        |
| `watchlists`         | CRUD completo das próprias                                               |
| `watchlist_items`    | CRUD quando a lista for sua                                              |

**Não há policy de `UPDATE` para `channel_analyses`.** A progressão de estado é
do servidor. Sem essa restrição, um cliente marcaria a própria análise como
`completed` sem que coleta alguma tivesse acontecido — e a restrição do
`INSERT` viraria decoração.

### Tabelas globais

RLS ativada, **nenhuma policy**, e `GRANT` revogado. Duas camadas de propósito:
RLS filtra linhas, `GRANT` controla o verbo. Se uma policy futura for escrita
errado, o `GRANT` ausente ainda barra o acesso.

Acesso apenas pelo backend, com a service role, devolvendo DTOs.

## 19. Clientes Supabase permitidos

| Cliente                               | Respeita RLS? | Para quê                                                  |
| ------------------------------------- | ------------- | --------------------------------------------------------- |
| `createUserScopedClient(accessToken)` | **sim**       | perfil, watchlists, leitura das próprias análises         |
| `createAdminClient()`                 | **não**       | coleta, snapshots, métricas globais, progressão de estado |

**Regra de escolha:** se existe um usuário na operação, use o cliente com sessão.
A service role é para o que não tem dono.

Toda consulta feita com o cliente administrativo precisa filtrar por usuário
**no código** — o banco não vai filtrar. As portas ajudam: `findById(id, ownerId)`
não aceita busca sem dono.

## 20. Uso da chave administrativa

`SUPABASE_SERVICE_ROLE_KEY`:

- **nunca** com prefixo `NEXT_PUBLIC_`;
- lida apenas por `src/config/env.ts`, que lança se importado no navegador;
- usada apenas em `src/shared/infrastructure/supabase/`, que carrega
  `import 'server-only'` — **o build falha** se um componente de cliente
  alcançar o módulo. Barreira mecânica, não disciplina;
- ausente dos logs: os erros carregam apenas o código do PostgreSQL e um rótulo
  de operação, nunca `details` nem `hint` do driver, que costumam conter o valor
  que violou a restrição;
- nunca usada com valor real em teste.

## 21. Conversão entre tipos PostgreSQL e domínio

Mapeadores explícitos em `src/shared/infrastructure/persistence/row-mappers.ts`,
com 33 testes. Regra que rege o arquivo: **uma linha corrompida falha em vez de
produzir silenciosamente uma entidade válida.**

| PostgreSQL    | Domínio          | Cuidado                                                                   |
| ------------- | ---------------- | ------------------------------------------------------------------------- |
| `uuid`        | `string` branded | validado contra o formato canônico                                        |
| `text`        | `string`         | vazio recusado onde não faz sentido                                       |
| `timestamptz` | `Date`           | `new Date('lixo')` não lança, devolve `Invalid Date`; o mapeador verifica |
| `bigint`      | `number`         | ver abaixo                                                                |
| `integer`     | `number`         | não negativo                                                              |
| `jsonb`       | objeto           | array e escalar recusados                                                 |
| estado `text` | união literal    | valor desconhecido recusado                                               |

### `bigint` → `number`

O cliente Supabase transporta JSON: `bigint` chega como **`number`** quando cabe
no inteiro seguro e como **`string`** quando não cabe. Aceitar as duas formas é
obrigatório; `Number(value)` cego arredondaria em silêncio um valor grande e o
produto exibiria uma contagem errada.

Acima de `Number.MAX_SAFE_INTEGER` o mapeador **recusa em vez de arredondar**. O
domínio usa `number`, e essa escolha tem um limite honesto: 9.007.199.254.740.991
visualizações. Nenhum canal do YouTube chega perto — o vídeo mais visto da
plataforma está na casa de 10¹⁰, cinco ordens de grandeza abaixo. **Se um dia
chegar, a decisão correta é mudar o domínio com ADR, não truncar no mapeador.**

`NULL` permanece `null`. Nunca vira `0` (RN-08).

### `ChannelMetrics` → `jsonb`

Quatro estados que o percurso de ida e volta não pode confundir: `0`, `null`,
`[]` e ausente. `JSON.stringify` preserva os três primeiros; o que ele **não**
preserva é `Date`, que vira string e nunca volta sozinho. Por isso a leitura
passa por schema Zod que reconstrói os `Date` explicitamente, em vez de
`JSON.parse` seguido de cast. 17 testes cobrem isso.

## 22. Estratégia de migrations

- Um arquivo por mudança, `YYYYMMDDHHMMSS_descricao.sql`.
- **Sempre para frente.** Nunca editar migração já aplicada, nem em
  desenvolvimento: o banco de outra pessoa já a executou.
- Determinística, reaplicável em banco limpo, sem dependência de dados externos.
- Sem segredos, sem dados reais.

Migração inicial: `20260806120000_initial_schema.sql`.

## 23. Estratégia de testes

### O que foi executado

| Camada                                    | Ferramenta                       | Estado       |
| ----------------------------------------- | -------------------------------- | ------------ |
| Regras de reuso e concorrência (contrato) | Vitest + repositórios em memória | ✅ executado |
| Mapeadores de linha                       | Vitest                           | ✅ executado |
| Serialização de métricas                  | Vitest                           | ✅ executado |
| Arquitetura (R1–R9)                       | Vitest                           | ✅ executado |

### O que **não** foi executado

> **O SQL desta SPEC nunca rodou.** O ambiente não tem Docker nem Supabase CLI.
> A migração e os testes pgTAP estão escritos e revisados, mas **não
> verificados em execução**. Nada nesta SPEC afirma que RLS, constraints ou
> cascatas foram validados — apenas que foram especificados.

Testes pgTAP escritos, em `supabase/tests/database/`:

| Arquivo                   | Cobre                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `01-schema.test.sql`      | 46 asserções: tabelas, PKs, tipos, FKs, unicidade, índices, funções                                     |
| `02-constraints.test.sql` | 18 asserções: formato de ID, contagens negativas, formato de vídeo, duplicidade, concorrência, carimbos |
| `03-rls.test.sql`         | 21 asserções: RLS ativa, grants, isolamento entre usuários, cliente não cria análise concluída          |
| `04-cascades.test.sql`    | 11 asserções: trigger de perfil, cascatas, preservação de artefatos globais                             |

Para validar:

```bash
npm run db:start    # exige Docker
npm run db:reset    # aplica migrations em banco limpo
npm run db:test     # roda os pgTAP
```

`npm run verify` **não** depende do banco e continua passando sem ele — decisão
deliberada: a verificação de rotina não pode exigir Docker.

### Tipos gerados

Não foram gerados: o CLI não está disponível. **Nenhum arquivo "gerado" foi
escrito à mão.** Quando o ambiente permitir:

```bash
npm run db:types
```

Os tipos devem ficar apenas na camada de infraestrutura e nunca ser exportados
pelos barrels dos módulos.

## 24. Riscos

| Risco                                                | Impacto                                                        | Mitigação                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| **SQL não executado**                                | constraints ou policies podem ter erro de sintaxe ou semântica | testes pgTAP escritos; validar antes de qualquer deploy      |
| Coleta ruim reutilizada por várias análises          | dados errados se propagam                                      | `invalidated_at` tira do cache sem apagar                    |
| Dado global cresce sem dono                          | custo de armazenamento; nenhum usuário o "leva embora"         | política de retenção — **não implementada**, registrada aqui |
| Service role ignora RLS                              | um repositório que esqueça de filtrar por usuário vaza dado    | portas exigem `ownerId`; `server-only` impede o cliente      |
| `error_metadata` receber payload de terceiro         | credencial ou token em `jsonb` versionado                      | `translatePostgresError` nunca repassa `details`/`hint`      |
| Exceção do `resolveInternalChannelId` se multiplicar | erosão de R7                                                   | anotada no código e aqui; porta `ChannelDirectory` prevista  |
| `bigint` acima do inteiro seguro                     | recusa em vez de dado                                          | limite documentado; exigiria ADR para mudar o domínio        |
| Trigger `SECURITY DEFINER`                           | escalada se o `search_path` for sequestrado                    | `set search_path = ''` na função; não copia metadados        |

## 25. Critérios de aceitação

- [x] SPEC-004 e ADR-005 criados
- [x] Propriedade das tabelas documentada
- [x] Migração inicial criada
- [x] Tabelas globais e do usuário separadas
- [x] Snapshots brutos separados das métricas (RN-04)
- [x] Relatórios de IA separados das métricas (RN-05)
- [x] `youtube_channel_id` com restrição de formato
- [x] Contagens negativas recusadas
- [x] IDs internos em `uuid`; datas em `timestamptz`
- [x] `bigint` com estratégia de conversão testada
- [x] RLS ativada; políticas de usuário implementadas
- [x] Payload bruto global sem acesso do navegador
- [x] Service role restrita ao servidor por `server-only`
- [x] Consulta de reutilização definida, com `referenceTime` explícito
- [x] Concorrência protegida por índice único parcial
- [x] Idempotência com restrição única parcial
- [x] Índices relevantes, sem duplicar `UNIQUE`
- [x] `ON DELETE` explícito em todas as FKs
- [x] Adaptadores não vazam tipos Supabase para o domínio
- [x] Mapeadores validam dados persistidos
- [x] Sem YouTube Data API, sem Claude API
- [x] `typecheck`, `lint`, `test`, `build`, `verify` passam
- [ ] **Testes SQL executados** — bloqueado pelo ambiente (seção 23)

## 26. Fora do escopo

YouTube Data API; resolução real de canais; Claude API; interface, dashboard,
API Route, Server Action; autenticação visual; pagamentos; extensão Chrome;
filas, cron, worker externo; monitoramento periódico; estimativa de receita e
RPM; deploy em projeto Supabase remoto; importação de dados reais do YouTube;
política de retenção de dados globais; adaptadores Supabase para `watchlists`,
`profiles` e `ai_insight_reports` — as tabelas existem, os adaptadores virão com
as SPECs que os usarem.
