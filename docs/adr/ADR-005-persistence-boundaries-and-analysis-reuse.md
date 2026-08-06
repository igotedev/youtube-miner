# ADR-005 — Fronteiras de persistência e reuso de análises

| Campo        | Valor                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| Status       | Aceita                                                                      |
| Data         | 2026-08-06                                                                  |
| Relacionadas | ADR-001, ADR-003, ADR-004                                                   |
| Altera       | Nenhum ADR anterior. Estende ADR-003 com o modelo de propriedade dos dados. |

## Contexto

Até a SPEC-003, a entidade `Analysis` **embutia** o snapshot bruto: cada análise
carregava dentro de si o canal e os vídeos coletados. Isso funcionava enquanto
nada era persistido, mas não sobrevive ao contato com o banco, por três razões:

1. **Quota.** A YouTube Data API tem teto diário. Se cada análise carrega sua
   própria cópia dos dados, dois usuários analisando o mesmo canal na mesma hora
   gastam quota duas vezes por um dado idêntico.
2. **Natureza do dado.** O que o YouTube devolve sobre um canal público é o
   mesmo para todo mundo. Não há nada de pessoal ali. Tratá-lo como dado do
   usuário seria modelar errado.
3. **RN-10** já prevê reuso de análises recentes, mas não havia onde ele
   existisse.

Ao mesmo tempo, análises, listas e relatórios **são** do usuário e não podem
vazar entre contas.

## Decisão

**Dividir a persistência em dois territórios, com regras diferentes.**

### Dados globais

`youtube_channels`, `youtube_collection_runs`, `youtube_channel_snapshots`,
`youtube_video_snapshots`, `video_analytics_results`.

- Não têm `user_id`. Não pertencem a ninguém.
- Podem ser **reutilizados entre solicitações de usuários diferentes**.
- **RLS ativada, e nenhuma policy para `authenticated`.** O navegador não os
  alcança, nem para leitura. Os `GRANT` também são revogados — duas camadas,
  porque uma policy escrita errado no futuro não deve abrir a tabela inteira.
- O acesso é exclusivamente do servidor, com a service role, que devolve **DTOs
  controlados**. O payload bruto de terceiro não sai do backend.

### Dados do usuário

`profiles`, `channel_analyses`, `ai_insight_reports`, `watchlists`,
`watchlist_items`.

- Têm dono, direto (`user_id`) ou indireto (item → lista → dono).
- RLS com policies restritas ao próprio usuário.
- `GRANT` mínimo: o cliente lê e cria análise em `pending`, mas **não atualiza
  status**. A progressão de estado é do servidor — sem isso, um cliente marcaria
  a própria análise como `completed` sem que coleta alguma tivesse acontecido.

### A análise aponta, não contém

`Analysis` deixa de embutir o snapshot e passa a referenciar:

| Campo               | Aponta para                      | Território           |
| ------------------- | -------------------------------- | -------------------- |
| `collectionRunId`   | o que o YouTube devolveu (RN-04) | global, reutilizável |
| `analyticsResultId` | o que o sistema calculou (RN-04) | global               |

O relatório de IA **não** aparece em `Analysis`: a chave estrangeira vai no
sentido `ai_insight_reports.analysis_id → channel_analyses.id`. Guardar também o
caminho inverso criaria dois lugares para a mesma verdade, e o relatório é
opcional por definição (RN-09).

### Foreign key entre módulos não é permissão de acesso

`channel_analyses.channel_id` referencia `youtube_channels.id`, tabela do módulo
`youtube-collection`. **Isso não autoriza `channel-analysis` a consultá-la.** A
integridade referencial é do banco; a comunicação entre módulos continua sendo
por contrato explícito (R5, R7).

Há hoje **uma exceção documentada**: `SupabaseAnalysisRepository` faz um
`select id from youtube_channels where youtube_channel_id = ?` para traduzir o
ID oficial no UUID interno. Está registrada como dívida na SPEC-004, seção 5, e
some quando `youtube-collection` expuser uma porta `ChannelDirectory`.

### A service role nunca chega ao navegador

- Sem prefixo `NEXT_PUBLIC_`.
- Lida apenas por `src/config/env.ts`, que lança se importado no cliente.
- Usada apenas em `src/shared/infrastructure/supabase/`, que carrega
  `import 'server-only'` — **o build falha** se um componente de cliente a
  alcançar. Barreira mecânica, não disciplina.
- Não aparece em log: os erros carregam apenas o código do PostgreSQL e um
  rótulo de operação.

## Alternativas consideradas

### Snapshot por usuário, sem compartilhamento

Cada análise guarda sua própria cópia da coleta.

Rejeitada. Modelo mais simples e isolamento trivial, mas multiplica o consumo de
quota pelo número de usuários interessados no mesmo canal — exatamente o recurso
mais escasso do produto. Um canal em alta seria coletado dezenas de vezes por
dia com resultados idênticos.

### Dados globais legíveis pelo cliente autenticado

Policy `for select to authenticated using (true)` nas tabelas globais, deixando
o navegador ler snapshots direto.

Rejeitada. Economizaria uma camada de DTO, mas exporia o payload bruto de
terceiro — formato instável, campos que o produto não controla e que mudam sem
aviso — como se fosse contrato da nossa API. Qualquer mudança do YouTube viraria
uma quebra no cliente.

### Uma tabela `analyses` única, com tudo dentro

Bruto, métricas e relatório em colunas `jsonb` da mesma linha.

Rejeitada. Viola RN-04 e RN-05 na estrutura, não só na convenção. Recalcular
métricas com regra nova exigiria reescrever a linha que contém o bruto, e não
haveria como manter duas versões do algoritmo lado a lado.

### ENUM do PostgreSQL para os estados

Rejeitada. `ALTER TYPE ... ADD VALUE` não roda dentro de transação em versões
mais antigas e acopla a migração ao catálogo. `text` + `CHECK` torna acrescentar
um estado uma migração trivial. O custo é não ter o tipo no catálogo — aceito.

## Consequências positivas

- **Quota gasta uma vez por canal por janela**, independente de quantos usuários
  pedem. É o ganho que motivou a decisão.
- Recalcular métricas com regra nova não exige recoletar nada: o snapshot está
  guardado, e `(collection_run_id, algorithm_version)` permite versões lado a
  lado.
- Isolamento por usuário garantido em **duas camadas** — filtro no código e RLS
  no banco. Nenhuma das duas é a única.
- O payload bruto instável fica confinado ao servidor.
- Remover um usuário apaga o que é dele e preserva os artefatos globais.

## Consequências negativas

- **Mais tabelas e mais joins.** Ler uma análise completa toca quatro tabelas.
  Aceito: é o preço de não duplicar dado público.
- **Dado global cresce sem dono.** Não há usuário para "levar embora" snapshots
  antigos ao cancelar a conta. Vai exigir uma política de retenção — não
  implementada nesta etapa, e registrada como risco na SPEC-004.
- **Uma coleta ruim contamina todas as análises que a reutilizarem.** Mitigação
  parcial: `invalidated_at` permite tirar uma execução do cache sem apagá-la.
- **A service role ignora RLS.** Todo repositório que a usa precisa filtrar por
  usuário no código. Está no contrato das portas — `findById(id, ownerId)` não
  aceita busca sem dono — mas depende de o adaptador obedecer.
- **Dois clientes Supabase** para escolher entre. Regra: se existe usuário na
  operação, use o cliente com sessão.

## Condições que justificariam revisão

- Se dados de canal deixarem de ser públicos (mudança de termos do YouTube), a
  premissa de globalidade cai por inteiro.
- Se o custo de armazenamento dos snapshots superar o da quota economizada — aí
  a retenção deixa de ser opcional e vira parte do modelo.
- Se um requisito de conformidade exigir que dado coletado a pedido de um
  usuário seja apagável por ele, o compartilhamento global precisa ser revisto.
- Se a exceção do `resolveInternalChannelId` se multiplicar em vez de sumir, R7
  está sendo erodida e a porta `ChannelDirectory` passa a ser urgente.
