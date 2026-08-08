# SPEC-010 — Histórico de análises

| Campo      | Valor                                                                 |
| ---------- | --------------------------------------------------------------------- |
| Status     | Implementada                                                          |
| Data       | 2026-08-07                                                            |
| Módulos    | `channel-analysis`, `youtube-collection`, `config/composition`, `app` |
| Depende de | SPEC-004 (esquema), SPEC-005 (métricas), SPEC-009 (autenticação)      |

---

## 1. Contexto

A SPEC-009 ligou a persistência: toda análise vai para o PostgreSQL e sobrevive
ao reinício do servidor. Isso foi verificado derrubando o processo.

E não serve para nada.

`/analise` só mostra o resultado da execução **recém-disparada**, porque o estado
vem do `useActionState`. Fechou a aba, o trabalho sumiu da vista — embora esteja
guardado. A limitação está registrada na própria SPEC-009, seção 8, como dívida
assumida.

Três peças foram construídas para este momento e nunca foram usadas:

| Peça                                                   | Criada em | Uso até aqui           |
| ------------------------------------------------------ | --------- | ---------------------- |
| Índice `channel_analyses (user_id, requested_at desc)` | SPEC-004  | **nenhum**             |
| Policy `channel_analyses_select_own`                   | SPEC-004  | nenhum                 |
| `GetAnalysisMetrics`                                   | SPEC-005  | só no fluxo de criação |

O índice existe desde a migração inicial esperando exatamente esta consulta.

## 2. Escopo é escopo novo, e isso está sendo declarado

**Histórico não é uma das 10 capacidades do MVP** listadas na SPEC-001, seção 4.
Não vou fingir que estava previsto.

O que justifica acrescentá-lo:

- **RN-03** já estabelece que "um mesmo canal pode ter várias análises em datas
  diferentes", e é por isso que `Analysis.id` é a chave, não `channelId`. A regra
  pressupõe um acervo que nunca teve como ser consultado.
- Persistência sem leitura é custo sem benefício: paga-se o banco, a migração e
  o RLS para guardar algo que ninguém alcança.

O que **não** justifica: o `CLAUDE.md` exclui "dashboard completo" do MVP. Uma
lista das próprias análises não é um dashboard — não há gráfico, agregação entre
canais, comparação nem série temporal. Se esta SPEC começar a crescer nessa
direção, ela virou outra coisa e precisa de decisão nova.

### Inclui

- `/historico` — lista das análises do usuário, da mais recente para a mais antiga.
- `/analise/[id]` — as métricas de uma análise passada.
- `AnalysisRepository.listByOwner` — o método que falta na porta.
- `ChannelDirectory` ganha leitura, para a lista poder exibir o nome do canal.

### Não inclui

- Paginação (seção 6), filtro, busca, ordenação alternativa.
- Apagar ou renomear análise.
- Recorte por período na tela de detalhe (seção 8).
- Qualquer agregação entre análises ou entre canais.

## 3. O que falta na porta

`AnalysisRepository` tem `listByChannel(ownerId, channelId)` — exige saber o
canal de antemão. O histórico precisa do contrário: **todas as análises deste
usuário**, sem saber os canais.

```ts
listByOwner(ownerId: UserId, limit: number): Promise<readonly Analysis[]>;
```

Ordenada por `requestedAt` decrescente. O `limit` é parâmetro, e não constante
interna, para que o adaptador o aplique **no banco** — trazer tudo e cortar em
memória desperdiça exatamente o que o índice existe para evitar.

`listByChannel` permanece: é o contrato que a RN-10 e as watchlists usarão.

## 4. `ChannelDirectory` ganha leitura, e era isto que ela esperava

A lista precisa dizer **de qual canal** é cada análise. `Analysis` carrega
`channelId` (`UC...`) e `requestedUrl` — o título vive em `youtube_channels`,
tabela do módulo `youtube-collection`.

Ler aquela tabela daqui seria violação de R7. O caminho correto já estava
previsto: o comentário de `ChannelDirectory`, escrito na SPEC-009, diz

> _"O que NÃO está aqui: leitura. Não há `findByOfficialId` — nenhum módulo tem
> caso de uso para ler o registro do canal, e uma porta com método sem chamador é
> abstração especulativa. **Acrescente quando houver o chamador.**"_

O chamador chegou.

```ts
interface ChannelSummary {
  readonly id: YouTubeChannelId;
  readonly title: string | null;
  readonly handle: string | null;
}

findSummaries(channelIds: readonly YouTubeChannelId[]): Promise<readonly ChannelSummary[]>;
```

### Por que em lote, e não um por vez

Uma lista de 50 análises tocaria o banco 50 vezes. O lote resolve em uma
consulta, e a assinatura torna o desperdício impossível em vez de improvável.

### Por que `title` é `string | null`

RN-08. `ensureRegistered` cria a linha do canal **antes** de qualquer coleta
concluir — é a ordem que a SPEC-009 estabeleceu para satisfazer a chave
estrangeira. Uma análise que falhou na coleta aponta para um canal cujo título
nunca foi preenchido.

`null` ali significa "ainda não sabemos o nome", e a tela diz isso. Exibir a URL
digitada como se fosse o nome do canal seria apresentar uma coisa como outra.

### Canal ausente não é erro

`findSummaries` devolve apenas o que encontrou. Um `channelId` sem
correspondência simplesmente não vem — quem chama trata como título ausente.
Lançar erro faria uma análise órfã derrubar a lista inteira.

## 5. A consulta

`ListUserAnalyses`, em `channel-analysis/application/queries/`, ao lado de
`GetAnalysisMetrics` e seguindo o mesmo padrão: consulta, não comando; não muda
estado, não avança nada.

```
1. analyses.listByOwner(ownerId, MAX_HISTORY_ITEMS)
2. channelDirectory.findSummaries(ids únicos das análises)
3. junta os dois e devolve
```

O passo 2 usa **ids únicos**: dez análises do mesmo canal consultam um canal.

### Isolamento

A assinatura da porta exige o dono — não existe `listByOwner()` sem ele. É a
mesma decisão de `findById(id, ownerId)` do ADR-005: o filtro por usuário está no
código porque o cliente administrativo ignora RLS, e a policy é a segunda camada,
não a única.

## 6. Teto de 50, sem paginação

`MAX_HISTORY_ITEMS = 50`. A tela **declara o teto** — uma lista truncada em
silêncio faz o usuário concluir que uma análise antiga foi perdida.

Paginação entra quando alguém não encontrar o que procura. Antes disso seria
cursor, estado de página e testes de fronteira para um problema que ainda não
existe — e o projeto adia abstração sem segundo caso de uso.

O número 50 não tem fundamento estatístico: é grande o bastante para cobrir uso
normal e pequeno o bastante para uma página. Se ficar apertado, muda-se a
constante.

## 7. Rotas e proteção

| Rota            | O que faz                              |
| --------------- | -------------------------------------- |
| `/historico`    | lista as análises do usuário           |
| `/analise/[id]` | métricas de uma análise passada        |
| `/analise`      | ganha apenas um link para `/historico` |

### As duas rotas novas precisam entrar no `matcher` do proxy

`PROTECTED_PREFIXES` hoje é `['/analise']`. `/historico` **não está coberto**, e
sem acrescentá-lo a rota nasceria fora do redirecionamento de navegação.

Isso não a deixaria insegura — cada página faz a própria verificação com
`getCurrentUser()`, que é a camada que vale (ADR-006, item 4). Mas é exatamente
a "rota nova que o matcher não cobre" que aquele ADR usa como exemplo do risco.
`/analise/[id]` já é coberta pelo prefixo existente.

### Análise de outro usuário

`GetAnalysisMetrics` já lança `NotFoundError` — nunca erro de permissão, que
revelaria a existência. A página traduz isso para 404, e não para "sem
permissão".

## 8. O que a tela de detalhe mostra

As métricas **como foram persistidas** — a coleta inteira, sem recorte.

`GetAnalysisMetrics` aceita um período opcional desde a SPEC anterior, e não
usá-lo aqui é decisão consciente: o filtro é uma escolha do momento da análise, e
reaplicá-lo em uma tela de leitura exigiria decidir se o período fica guardado
com a análise. Não fica, hoje. Reabrir isso é outra SPEC.

### O que ela não pode afirmar: de onde vieram os números

`/analise` exibe o aviso de **dados de demonstração** quando a composição está
sem `YOUTUBE_API_KEY`. Ali o aviso é verdade sem ressalva — a análise acabou de
rodar, naquele modo.

Na tela de detalhe não é. `CompositionMode` descreve **o adaptador de agora**, e
a análise foi executada em outro momento, possivelmente com a chave presente.
**O sistema não registra em que modo cada análise rodou.** Repetir o aviso ali
afirmaria algo que este código não sabe; omiti-lo em uma instalação sem chave
apresentaria números de exemplo como se descrevessem o canal.

A saída foi dizer exatamente isso: quando a composição está em demonstração, a
tela avisa que **a instalação** está sem a chave e que **não há registro do modo
de cada análise**. É menos preciso do que gostaríamos, e é honesto.

A correção de verdade é gravar a proveniência junto da coleta — coluna, migração
e decisão sobre o que fazer com as linhas existentes. Isso é outra SPEC, e está
registrado na seção 12 como dívida.

Por isso `AnalysisResult` — o bloco de métricas compartilhado entre as duas telas
— **não** contém o aviso: ele afirma algo sobre a origem dos dados, e a origem
depende de quem está exibindo, não do que está sendo exibido.

## 9. Estado vazio

Usuário sem nenhuma análise vê _"Você ainda não analisou nenhum canal"_ e um link
para `/analise`. **Resultado válido, não erro** — a mesma regra que a SPEC
anterior aplicou ao período sem vídeos.

## 10. Testes

| Arquivo                                                   | Cobre                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `in-memory-analysis-repository.test.ts`                   | ordem decrescente; teto corta as antigas; análise de outro usuário nunca aparece; vazio     |
| `in-memory-channel-directory.test.ts`                     | lote; ids duplicados; canal inexistente omitido; `title` nulo; registro não apaga o título  |
| `list-user-analyses.test.ts`                              | junta análise e canal; título ausente; canal sumido; ids únicos; teto pedido ao repositório |
| `app/historico/labels.test.ts`                            | nome indisponível; queda para o ID oficial; aviso de teto só quando atingido                |
| `tests/integration/supabase-analysis-persistence.test.ts` | o mesmo contrato contra o PostgreSQL, com o índice real e usuários distintos                |

### Por que a apresentação virou função pura

A SPEC previa testes de tela. O projeto não tem `@testing-library`, e instalá-la
para três asserções contraria a regra de não acrescentar biblioteca sem um caso
que a justifique.

A decisão foi outra: o que valia testar naquelas telas **não era visual**. "Nome
indisponível em vez da URL digitada" é a RN-08; "pode haver mais" em vez de "há
mais" é uma afirmação sobre o que a consulta sabe. Ambas saíram do componente
para `src/app/historico/labels.ts`, que é puro e testado.

O que ficou sem teste automatizado é a montagem do JSX — e essa parte o
`npm run build` e a verificação manual cobrem.

## 11. Impacto

| Área                    | Impacto                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| **Banco**               | **nenhum** — o índice e a policy já existem desde a SPEC-004            |
| **API externa**         | **nenhum** — nenhuma chamada, nenhuma unidade de quota                  |
| **Autenticação**        | `/historico` entra em `PROTECTED_PREFIXES`; nada mais muda              |
| **Contratos**           | dois métodos novos em portas existentes; nenhum contrato existente muda |
| **Motor de métricas**   | **nenhum** — `calculateChannelMetrics` não é tocado                     |
| **Versão do algoritmo** | **nenhuma** — nada é recalculado nem regravado                          |

## 12. Verificação

### Automatizada

| Suíte                      | Resultado                           |
| -------------------------- | ----------------------------------- |
| `npm run verify`           | 584 testes, typecheck e lint limpos |
| `npm run test:integration` | 59 testes contra o Postgres real    |
| `npm run build`            | limpo, sem avisos                   |

`npm run db:test` não foi executado: esta SPEC não tocou em SQL algum — nenhuma
migração, nenhuma função, nenhuma policy. O `git status supabase/` limpo é a
afirmação, e é mais forte que uma execução daquela suíte, que hoje só passa
sobre um banco recém-resetado (defeito conhecido em `04-cascades.test.sql`).

### Manual, contra o servidor de desenvolvimento

17 verificações por HTTP, imitando um navegador sem JavaScript — jarro de
cookies manual, campos ocultos do formulário, e o link lido da caixa do Mailpit.
Com uma análise real do canal `UCX6OQ3DkcsbYNE6H8uQQuVA`:

- `/historico` sem sessão redireciona, com `next` preservado;
- usuário novo vê o estado vazio, e o teto **não** é declarado nele;
- a análise aparece na lista **com o nome do canal**, e não com a URL digitada;
- `/analise/[id]` reabre as métricas persistidas, com Shorts e longos separados;
- id malformado responde 404, e não erro de sintaxe do PostgreSQL;
- **um segundo usuário vê a lista vazia e recebe 404 na análise do primeiro.**

### Uma lacuna anterior, confirmada aqui

O `next` guardado pelo proxy **não viaja até o e-mail**: `emailRedirectTo` é
constante, e o callback cai em `DEFAULT_SIGNED_IN_PATH`. Quem clica em
"Histórico" sem sessão volta do link em `/analise`.

É comportamento da SPEC-009, não regressão desta — mas fica mais visível agora
que existe uma segunda rota protegida. Corrigi-lo mexe no `emailRedirectTo` e na
allow-list de `supabase/config.toml`, que é território daquela SPEC.

## 13. Critérios de aceitação

- [x] `/historico` lista as análises do usuário, da mais recente para a mais antiga.
- [x] A lista exibe o nome do canal quando ele existe, e diz que está indisponível quando não.
- [x] Análise de outro usuário nunca aparece na lista nem abre em `/analise/[id]`.
- [x] Usuário sem análises vê um estado vazio, não um erro.
- [x] O teto de 50 é declarado na tela quando é atingido.
- [x] `/historico` exige sessão, verificada na própria página.
- [x] Nenhuma migração, nenhuma chamada externa, nenhuma mudança no motor.
- [x] `npm run verify` continua passando sem Docker.

## 14. Fora de escopo, registrado

- **Proveniência dos números** (seção 8): o sistema não registra em que modo de
  composição cada análise rodou, e por isso a tela de detalhe não pode afirmar a
  origem dos dados. Corrigir exige coluna, migração e decisão sobre as linhas
  existentes.
- **`next` até o e-mail** (seção 12) — território da SPEC-009.
- Paginação, filtro, busca, ordenação alternativa, apagar análise.
- Recorte por período na tela de detalhe (seção 8).
