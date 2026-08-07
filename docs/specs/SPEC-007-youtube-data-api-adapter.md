# SPEC-007 — Adaptador da YouTube Data API v3

| Campo      | Valor                                                 |
| ---------- | ----------------------------------------------------- |
| Status     | Implementada                                          |
| Data       | 2026-08-06                                            |
| Módulos    | `youtube-collection`, `config/composition`            |
| Depende de | SPEC-002 (referência), SPEC-006 (composição), ADR-004 |

---

## 1. Contexto

Até aqui o produto não tocava em dado real. `YouTubeChannelSource` só tinha
adaptador falso, e qualquer URL devolvia o mesmo fixture. Esta SPEC substitui
isso pela integração de verdade.

É a primeira SPEC do projeto cujo comportamento **foi conferido contra o serviço
real** durante o desenvolvimento, e não apenas descrito.

## 2. Economia de quota é o requisito, não um detalhe

A YouTube Data API v3 não cobra dinheiro. Cobra **unidades de quota**: 10.000
por dia, por projeto, no plano gratuito. É essa restrição que dita o desenho.

O custo não é uniforme entre endpoints — e é aí que está a armadilha:

| Chamada              | Unidades |
| -------------------- | -------: |
| `channels.list`      |        1 |
| `playlistItems.list` |        1 |
| `videos.list`        |        1 |
| **`search.list`**    |  **100** |

### Uma análise custa 3 unidades

```
1. channels.list       dados do canal E a playlist de uploads, numa chamada
2. playlistItems.list  até 50 IDs de vídeo em uma página
3. videos.list         os 50 vídeos em UMA chamada, não 50
```

≈ **3.000 análises por dia** dentro da cota gratuita.

Dois desperdícios que o desenho evita de propósito:

- **`videos.list` em lote.** O endpoint aceita até 50 IDs separados por vírgula
  e cobra 1 unidade pelo lote. Uma chamada por vídeo custaria 50 — a análise
  passaria de 3 para 52 unidades, e o teto cairia de 3.000 para 190 por dia.
- **`search.list` em lugar nenhum.** Uma única busca custa mais que 33 análises
  completas. Há teste afirmando que nenhum caminho a invoca.

### Resolução de URL: o caso barato é o comum

`parseYouTubeChannelReference` (SPEC-002) roda **antes** de qualquer chamada:

| Entrada          | Custo | Como                         |
| ---------------- | ----: | ---------------------------- |
| `/channel/UC...` | **0** | o ID já está na URL          |
| `/@handle`       |     1 | `channels.list?forHandle=`   |
| `/user/nome`     |     1 | `channels.list?forUsername=` |
| `/c/nome`        |     1 | tenta `forHandle`            |
| entrada inválida | **0** | o parser rejeita offline     |

## 3. Três descobertas da API que mudaram o desenho

Verificadas por sondagem direta antes de escrever o adaptador.

### 3.1 Canal inexistente devolve HTTP 200

Não 404. A resposta vem com status 200 e **sem o campo `items`**. Tratar isso
pelo status transformaria "esse canal não existe" — que é resposta legítima e
tem mensagem própria na tela — em "a API do YouTube falhou".

### 3.2 Contadores vêm como string

`"viewCount": "21318398"`, não `21318398`. Provavelmente para não estourar a
precisão de `Number` em JSON. A conversão acontece uma vez, no schema Zod, e
falha explicitamente para valor não inteiro, negativo ou acima de
`Number.MAX_SAFE_INTEGER` — arredondar produziria um número errado apresentado
como certo.

### 3.3 `forHandle` aceita com e sem `@`

Simplifica: o valor guardado pelo parser é repassado como está.

## 4. RN-08 na fronteira da integração

É aqui que a regra "ausência não é zero" é mais fácil de violar, porque a API
oferece as duas armadilhas ao mesmo tempo.

| Situação                   | API devolve                                                | Domínio recebe |
| -------------------------- | ---------------------------------------------------------- | -------------- |
| Inscrições ocultas         | `hiddenSubscriberCount: true` **e** `subscriberCount: "0"` | `null`         |
| Curtidas ocultas           | campo ausente                                              | `null`         |
| Comentários desativados    | campo ausente                                              | `null`         |
| Estatísticas indisponíveis | `statistics` ausente                                       | `null`         |

O primeiro caso é o traiçoeiro: a API manda **zero** junto com a flag de oculto.
Repassar esse zero seria tecnicamente fiel à resposta e factualmente falso sobre
o canal. O adaptador força `null` quando a flag está ligada, e há teste.

## 5. Classificação Shorts × longos — uma aproximação assumida

`classifyVideoFormat` usa **só a duração**: até 180 segundos é Short.

Isso não é o critério completo do YouTube, que também considera proporção
vertical e origem da publicação. Nenhum dos dois vem em `videos.list`.
Obtê-los exigiria uma chamada por vídeo — 50 unidades por análise contra 1.

Por isso `unknown` existe como terceiro estado: **um vídeo fora dos dois blocos
é melhor que um vídeo no bloco errado**, que deslocaria a mediana daquele
formato e contaminaria toda a leitura (RN-06).

Duração `0` também cai em `unknown`. A API emite `P0D` para transmissão ao vivo
e vídeo não finalizado; classificar isso como Short poluiria a mediana dos
Shorts com algo que não é um.

## 6. Um vídeo defeituoso não derruba a análise

Dois descartes silenciosos, ambos registrados em log:

- **ID que a playlist lista e `videos.list` não devolve** — vídeo removido,
  privado ou bloqueado por região. Não há dado algum sobre ele.
- **Item sem `snippet`** — sem `publishedAt` não existe idade, e sem idade não
  existem visualizações por dia nem frequência.

Em nenhum dos casos se inventa substituto. Uma data de epoch produziria um vídeo
de 56 anos; a data da coleta produziria idade zero. Os dois gerariam números
plausíveis e errados — exatamente o que este projeto não faz.

Descartar o **vídeo** é aceitável; derrubar a **análise** por causa de um item
entre cinquenta, não.

## 7. Disciplina da chave

A chave viaja na query string. **A URL completa é, portanto, um segredo.**

- Nenhuma URL entra em mensagem de erro, em `AppError.context` ou em log
- Falha de rede tem a causa original **descartada**, não encadeada: mensagens de
  erro de rede embutem a URL
- Só o nome do endpoint e o `reason` do Google são registrados
- Corpo bruto de resposta nunca é logado
- A chave é lida por `src/config/env.ts` e injetada pela composição (R8)

Há teste que serializa mensagem e contexto de um erro e afirma que a chave não
aparece — **com contraprova** de que ela realmente foi enviada, senão o teste
passaria mesmo com o adaptador esquecendo de autenticar.

## 8. Freio local de quota

O cliente conta unidades e recusa **antes de gastar** quando o teto de
`YOUTUBE_DAILY_QUOTA_LIMIT` seria estourado.

**Não é a quota real.** A do Google é diária e compartilhada por todos os
processos do projeto; esta é por processo e zera ao reiniciar. É um freio contra
defeito em laço queimar a cota do dia em segundos. O controle diário de verdade
precisa de persistência e chega quando o banco entrar.

## 9. Testabilidade

`fetch` é injetado no cliente. Sem isso, tradução de erro, validação Zod,
contagem de quota e as regras da RN-08 só poderiam ser exercitadas gastando
unidades — ou seja, na prática, nunca.

**Sobre os dados de teste:** o _formato_ das respostas foi conferido contra a API
real. O _conteúdo_ é fictício. Nenhum canal ou vídeo real aparece nos testes como
se fosse dado de produção.

## 10. Composição

`YOUTUBE_API_KEY` presente → adaptadores reais, `mode: 'live'`, e o aviso de
demonstração some da tela porque deixou de ser verdade.

Ausente → fixture, `mode: 'demonstration'`. **A aplicação sobe sem chave
nenhuma**, e continua sendo assim de propósito.

`mode: 'live'` afirma exatamente uma coisa: os números vieram da YouTube Data
API. Não afirma nada sobre persistência, que segue em memória.

## 11. Testes

**442 no total** (+57 nesta etapa), todos executados.

| Grupo            | Cobre                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duração          | 10 formatos ISO 8601 válidos; 8 inválidos; ausência ≠ zero; classificação nas fronteiras; `P0D` vira `unknown`                                                               |
| Quota            | 1 unidade por chamada; recusa antes de tocar a rede; 3 unidades por análise; lote em vez de 50 chamadas                                                                      |
| Tradução de erro | 3 razões de quota; chave inválida ≠ quota; resposta não-JSON; resposta fora do schema; chave nunca vaza                                                                      |
| Resolução        | `/channel/` custa 0; entrada inválida custa 0; handle, `/user/` e `/c/`; 200 sem `items` é `NotFound`; `search` nunca é chamada                                              |
| Coleta           | tradução para o domínio; inscrições ocultas viram `null`; contadores ausentes viram `null`; ordem da playlist preservada; vídeo defeituoso descartado sem derrubar a análise |

## 12. Critérios de aceitação

- [x] Uma análise completa custa 3 unidades de quota
- [x] `search.list` não é usada em caminho algum
- [x] URL com ID oficial resolve sem gastar unidade
- [x] Entrada inválida é rejeitada offline
- [x] Resposta validada com Zod antes de virar tipo de domínio
- [x] Ausência preservada como `null`, inclusive inscrições ocultas (RN-08)
- [x] Shorts e longos separados pela duração, com `unknown` para o indefinido
- [x] Erro traduzido para `AppError` sem vazar a chave
- [x] Vídeo defeituoso descartado sem invalidar a análise
- [x] Aplicação sobe sem chave configurada
- [x] `typecheck`, `lint`, `test`, `build`, `verify` passam

## 13. Fora do escopo

Paginação além de 50 vídeos; OAuth e dados privados do canal; controle de quota
persistido entre processos; classificação de Shorts por proporção de vídeo;
`search.list` e descoberta de canais por palavra-chave; cache de resposta HTTP
(o reuso de coleta da RN-10 já cobre o caso de uso); relatório de IA.
