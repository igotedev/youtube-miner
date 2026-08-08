# SPEC-012 — Watchlists

| Campo      | Valor                                                 |
| ---------- | ----------------------------------------------------- |
| Status     | Implementada                                          |
| Data       | 2026-08-08                                            |
| Módulos    | `watchlists`, `config/composition`, `app`             |
| Depende de | SPEC-004 (esquema), SPEC-009 (autenticação), SPEC-010 |

---

## 1. Contexto

**A décima e última capacidade do MVP.** Com ela, a lista da SPEC-001 seção 4
fecha inteira.

O padrão se repete pela terceira vez: **está tudo construído e nunca foi usado.**

| Peça                                     | Criada em | Uso até aqui |
| ---------------------------------------- | --------- | ------------ |
| Tabelas `watchlists` e `watchlist_items` | SPEC-004  | **nenhum**   |
| 8 policies de RLS                        | SPEC-004  | nenhum       |
| Grants para `authenticated`              | SPEC-004  | nenhum       |
| Porta `WatchlistRepository`              | SPEC-001  | **nenhum**   |
| Tipos `Watchlist` e `WatchlistItem`      | SPEC-001  | nenhum       |

A auditoria de 2026-08-08 registrou essa porta como **abstração especulativa** —
zero implementações, zero chamadores, contrariando a regra do próprio projeto de
não criar abstração sem segundo caso de uso. Esta SPEC é o chamador que faltava.

## 2. A restrição que o esquema impõe, e que vira regra de produto

```sql
channel_id uuid not null references public.youtube_channels (id) on delete restrict
```

O item aponta para o **registro global do canal**, não para um texto livre. E o
canal só entra em `youtube_channels` quando alguém o **analisa**
(`ChannelDirectory.ensureRegistered`, SPEC-009).

**Consequência: só é possível salvar um canal que já foi analisado.**

Isso não é uma limitação a contornar — é o produto se definindo. Uma watchlist
aqui não é uma lista de links; é **um acervo de canais que você já estudou**. O
usuário salva a partir de uma análise, e o que ele salva já tem números.

A alternativa seria aceitar uma URL na tela de listas e registrar o canal na
hora. Rejeitada: resolver uma URL nova custa **quota** (SPEC-007), e gastar
unidade para salvar um canal que ninguém analisou inverteria a ordem do produto
— guardar antes de saber.

### O `restrict` também é decisão, e está certo

Apagar um canal global falha enquanto alguém o acompanha. É o mesmo `restrict`
que já protege as análises. Um `cascade` ali faria a limpeza de um canal
esvaziar listas de terceiros em silêncio.

## 3. Escopo

### Inclui

- Criar, renomear e apagar uma lista.
- Salvar um canal em uma lista **a partir de uma análise**, com nota opcional.
- Remover um canal de uma lista.
- `/listas` — as listas do usuário; `/listas/[id]` — os canais de uma lista.
- Migração corrigindo a unicidade de nome (seção 6).

### Não inclui

- Adicionar canal por URL na tela de listas (seção 2).
- Compartilhar lista, listas públicas, colaboração.
- Ordenação manual, pastas, etiquetas.
- Comparar canais de uma lista entre si — comparação não existe no MVP.
- Monitoramento ou alerta sobre canais salvos — excluídos pelo `CLAUDE.md`.

## 4. Um defeito real no esquema, verificado

O comentário da SPEC-004 afirma:

> _"Nome único por usuário, case-insensitive: 'Concorrentes' e 'concorrentes' na
> mesma conta seriam confusão, não organização."_

**A constraint não faz isso.** `unique (user_id, name)` sobre `text` usa a
collation padrão do PostgreSQL, que **diferencia maiúsculas**.

Verificado contra o banco local em 2026-08-08: inserir `'Concorrentes'` e
`'concorrentes'` para o mesmo usuário — **as duas foram aceitas**, ambas com
`201`. As linhas de teste foram removidas.

O comentário descreve a intenção; a constraint não a implementa. Como o
comportamento pretendido é o certo — dois nomes que só diferem no caixa **são**
confusão —, a correção é do esquema, não do comentário.

### A migração

Substitui a constraint por um índice único funcional:

```sql
alter table public.watchlists drop constraint watchlists_unique_name_per_user;
create unique index watchlists_unique_name_per_user
  on public.watchlists (user_id, lower(name));
```

Não há dado em produção para conflitar.

## 4-A. A segunda migração, que esta SPEC não previu

> Esta seção foi escrita **durante** a implementação. A versão original dizia
> que a seção 4 trazia "a única migração desta SPEC". Estava errada, e a regra
> do projeto é corrigir o documento na mesma mudança, não depois.

`watchlist_items.channel_id` guarda o **uuid interno** de `youtube_channels`. O
domínio fala `UC...` (RN-01). Alguém precisa traduzir, e todos os lugares
óbvios são proibidos:

| Onde traduzir                                              | Por que não                                                                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| importar `channel-registration.ts` de `youtube-collection` | import profundo entre módulos — **R5**                                                                                                             |
| consultar `youtube_channels` do adaptador de `watchlists`  | tabela de outro módulo — **R7**. Seria a **segunda** ocorrência da dívida que a auditoria de 2026-08-08 já apontou em `SupabaseAnalysisRepository` |
| expor o uuid interno pela porta `ChannelDirectory`         | aquele contrato diz, por escrito, que o identificador interno "é detalhe de persistência e não atravessa esta fronteira"                           |

Sobra o único lugar onde as duas tabelas legitimamente convivem: **o banco**.
É o mesmo caminho de `complete_collection_run` (SPEC-008), e o precedente traz
o formato junto — `language plpgsql` simples, **não** `security definer`,
`revoke all on function` antes de `grant execute` para `service_role`.

Duas funções, uma por sentido:

- `add_watchlist_item(watchlist, owner, 'UC...', note)` — verifica o dono,
  traduz o identificador e insere com `on conflict do nothing`. As três coisas
  **em uma instrução**: entre um `select` de verificação e um `insert` cabe
  outra requisição.
- `remove_watchlist_item(watchlist, owner, 'UC...')` — o par simétrico.
  Sem ele o adaptador precisaria consultar `youtube_channels` para descobrir o
  uuid antes de apagar, ou seja, exatamente a violação que a outra função existe
  para evitar.

Ambas sinalizam "não encontrado" com `raise ... using errcode = '23503'`
(violação de chave estrangeira). O código é honesto — a linha referenciada de
fato não existe — e `translatePostgresError` já o converte em `NotFoundError`,
sem que o adaptador precise conhecer mais um código de fornecedor.

**Lista de outra pessoa é tratada como inexistente**, nunca como "sem
permissão": a segunda resposta já revelaria que a lista existe.

## 5. A porta muda, e a auditoria é o motivo

A porta atual:

```ts
findById(id: WatchlistId): Promise<Watchlist | null>;
```

**Sem dono.** É exatamente o achado P2-2 da auditoria, no mesmo formato: a
segurança dependeria de quem chama lembrar de verificar. Como a porta nunca teve
implementação, dá para nascer certa.

```ts
export interface WatchlistRepository {
  /** Lista COM os itens. O dono e obrigatorio, e a assinatura garante. */
  findById(id: WatchlistId, ownerId: UserId): Promise<Watchlist | null>;

  /** Resumo das listas, SEM os itens. Ver a nota abaixo. */
  listByOwner(ownerId: UserId): Promise<readonly WatchlistSummary[]>;

  create(watchlist: NewWatchlist): Promise<void>;
  rename(id: WatchlistId, ownerId: UserId, name: string): Promise<void>;
  remove(id: WatchlistId, ownerId: UserId): Promise<void>;

  addItem(id: WatchlistId, ownerId: UserId, item: NewWatchlistItem): Promise<void>;
  removeItem(id: WatchlistId, ownerId: UserId, channelId: YouTubeChannelId): Promise<void>;
}
```

### Por que `listByOwner` não devolve os itens

Carregar todos os itens de todas as listas para desenhar um índice traria dados
que a tela não usa. `WatchlistSummary` leva nome, data e **contagem** — a
contagem vem do banco, não de um `length` sobre uma lista carregada à toa.

É a mesma decisão de `ChannelSummary` na SPEC-010: um tipo de leitura para o
índice, o agregado inteiro só no detalhe.

### Por que métodos explícitos em vez de `save(watchlist)`

Um `save` do agregado inteiro obrigaria o adaptador a **reconciliar** os itens —
descobrir o que entrou, o que saiu, o que mudou — em duas tabelas, sem
transação declarada. Cada método aqui corresponde a **uma ação do usuário** e a
**uma instrução SQL**, o que torna a idempotência e a concorrência discutíveis
uma a uma.

## 6. Nome do canal na tela

A lista guarda `channelId` (`UC...`). Para exibir o nome, `watchlists` usa
`ChannelDirectory.findSummaries` — a mesma porta que a SPEC-010 criou, pelo mesmo
motivo (R7: `youtube_channels` é de `youtube-collection`).

`title` continua podendo ser `null` (RN-08), e a tela diz "nome indisponível" em
vez de exibir o `UC...` como se fosse nome. Os rótulos de `app/historico/labels.ts`
já resolvem isso e são reaproveitados.

## 7. Sem teto, e isso é a decisão

Diferente do histórico, que tem teto de 50 (SPEC-010), aqui **não há limite** de
listas nem de itens.

O motivo: o histórico cresce sozinho, uma linha por análise; uma watchlist cresce
**por ato deliberado do usuário**, que não vai salvar mil canais sem perceber.
Inventar um teto agora seria escolher um número sem nenhuma evidência de que ele
incomoda.

**Registrado como limite conhecido**, não como esquecimento: se uma lista chegar
a centenas de itens, `findById` passa a carregar tudo de uma vez, e aí paginação
tem um caso concreto para existir.

## 8. Onde o usuário salva

O botão **"Salvar em uma lista"** aparece onde já existe uma análise:

- na tela de resultado, depois dos painéis;
- em `/analise/[id]`.

Ele abre a escolha entre as listas existentes, com a opção de criar uma nova no
mesmo passo. Salvar **não gasta quota e não chama a IA** — o canal já está
registrado, e o item é uma linha.

Uma lista já contendo o canal aparece marcada, e salvar de novo não é erro: a
constraint `unique (watchlist_id, channel_id)` recusa a duplicata e o caso de uso
trata como "já estava lá", não como falha.

## 9. Autorização

Três camadas, iguais às do resto do produto (ADR-006):

| Camada                    | O que faz                                     |
| ------------------------- | --------------------------------------------- |
| `src/proxy.ts`            | `/listas` entra em `PROTECTED_PREFIXES`       |
| Página e Server Action    | `getCurrentUser()` antes de qualquer trabalho |
| Assinatura da porta + RLS | nenhum método aceita busca sem dono           |

As 8 policies já existem e cobrem os quatro verbos, atravessando
`watchlist_items → watchlists → user_id`.

## 10. Testes

| Arquivo                          | Cobre                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `watchlist.test.ts` (domínio)    | nome em branco recusado, teto de 100 caracteres, nota até 2000                                          |
| `in-memory-watchlist-repository` | contrato: dono obrigatório, item duplicado, lista de outro usuário invisível                            |
| casos de uso                     | criar, salvar canal, remover, apagar lista; salvar duas vezes não é erro; canal não registrado falha    |
| `app/listas/labels.test.ts`      | nome indisponível, contagem no plural correto, estado vazio                                             |
| integração                       | a unicidade **case-insensitive** depois da migração; o `restrict` do canal; a cascata ao apagar a lista |
| pgTAP                            | o novo índice funcional existe e recusa `'A'` + `'a'`                                                   |

O teste de integração da unicidade é o que **prova a correção da seção 4** —
hoje ele falharia.

## 11. Impacto

| Área                  | Impacto                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| **Banco**             | **duas migrações** — o índice funcional de nome (seção 4) e as duas funções de tradução (seção 4-A) |
| **Dependência nova**  | **nenhuma**                                                                                         |
| **Quota do YouTube**  | **nenhuma** — salvar não coleta nada                                                                |
| **Custo de IA**       | **nenhum** — salvar não gera relatório                                                              |
| **Motor de métricas** | **nenhum**                                                                                          |
| **Portas existentes** | `WatchlistRepository` muda antes de ter implementação; `ChannelDirectory` é reusado sem mudança     |
| **MVP**               | fecha a décima capacidade                                                                           |

## 12. Critérios de aceitação

Marcados com a prova que os fecha. Nenhum foi marcado por leitura de código.

- [x] O usuário cria uma lista, salva um canal analisado nela e vê o canal com o
      nome — `/listas`, `/listas/[id]` e o controle na tela de análise; build
      gerando as duas rotas.
- [x] Salvar o mesmo canal duas vezes não é erro, e não duplica —
      `supabase-watchlist-repository.test.ts` e a asserção pgTAP "salvar de novo
      não é erro".
- [x] Lista de outro usuário nunca aparece nem abre — 404, nunca "sem permissão"
      — seis testes de integração, um por operação da porta.
- [x] `'Concorrentes'` e `'concorrentes'` na mesma conta são recusadas — pgTAP
      contra o índice funcional, mais o teste de integração que espera
      `ConflictError`.
- [x] Apagar a lista leva os itens; apagar o usuário leva as listas; o canal
      global sobrevive — teste de integração que confere `youtube_channels`
      depois do `remove`.
- [x] Nenhum método da porta aceita busca sem dono — a assinatura de
      `WatchlistRepository` não compila sem ele.
- [x] Salvar não gasta quota nem token — nenhum caminho de `watchlists` alcança
      `YouTubeApiClient` ou `GeminiInsightGenerator`; a composição das listas é
      um arquivo separado que não os importa.
- [x] Nenhuma consulta de `watchlists` toca `youtube_channels` — R7 intacta. As
      seis ocorrências do nome no módulo são comentários explicando por quê; a
      tradução vive nas três funções do banco.
- [x] `npm run verify` continua passando sem Docker e sem rede — 692 testes.

Fora do `verify`, porque exigem Docker: **19 asserções pgTAP** e **16 testes de
integração** deste módulo, todos passando contra o Postgres local.
