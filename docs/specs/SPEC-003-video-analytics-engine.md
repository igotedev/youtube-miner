# SPEC-003 — Motor de métricas de vídeos e canais

| Campo      | Valor                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Status     | Implementada                                                                                                                 |
| Data       | 2026-08-06                                                                                                                   |
| Módulo     | `video-analytics`                                                                                                            |
| Camada     | `domain`                                                                                                                     |
| Depende de | SPEC-001 (RN-04, RN-06, RN-08, RN-12, RN-13, RN-14)                                                                          |
| Substitui  | O contrato-placeholder de `ChannelMetrics`/`FormatMetrics`, cujo próprio comentário reservava a implementação para esta SPEC |

---

## 1. Contexto

Os passos 6, 7 e 8 do MVP são "ver Shorts e vídeos longos separados", "ver
métricas calculadas" e "identificar vídeos fora da curva". Este é o núcleo do
produto: sem números confiáveis, o relatório de IA não tem sobre o que escrever.

Três fatos moldam esta SPEC:

1. **Estes números são o valor do produto.** O dado bruto é público; a leitura
   consistente é o que se vende. Um número errado aqui não é um bug de exibição
   — é uma recomendação errada de conteúdo.
2. **RN-14 proíbe delegar isso à IA.** Média, mediana, frequência e outlier são
   aritmética. Um modelo generativo devolveria um valor plausível, diferente a
   cada chamada e impossível de verificar. A separação entre "o que o sistema
   calculou" e "o que a IA escreveu" começa aqui.
3. **É tudo offline.** Nada nesta SPEC precisa de rede, banco, relógio ou
   credencial — logo, tudo pertence ao `domain` e é testável sem infraestrutura.

## 2. Objetivo

Uma função pura, `calculateChannelMetrics`, que recebe uma lista de vídeos já
coletados e o instante da coleta, e devolve métricas objetivas com Shorts e
vídeos longos **rigorosamente separados**.

Determinística, reproduzível, sem I/O, sem relógio, sem React, sem Next.js.

## 3. Entradas

```ts
interface AnalyticsVideo {
  id: YouTubeVideoId;
  format: VideoFormat; // 'short' | 'long' | 'unknown'
  publishedAt: Date;
  viewCount: number | null;
}

interface CalculateChannelMetricsInput {
  videos: readonly AnalyticsVideo[];
  collectedAt: Date;
}
```

### `AnalyticsVideo` é um subconjunto estrutural de `YouTubeVideo`

Um `readonly YouTubeVideo[]` é atribuível a `readonly AnalyticsVideo[]` sem
mapeamento nenhum — há teste cobrindo isso. O tipo existe mesmo assim por dois
motivos: declara **o que o motor realmente lê** (`YouTubeVideo` carrega título,
canal e duração, e nenhum participa de cálculo algum), e permite testar com
objetos mínimos em vez de inventar título e ID de canal em cada caso.

### `likeCount` e `commentCount` ficam de fora

Nenhuma métrica desta versão os usa. Campo que nenhuma função lê é peso morto, e
incluí-lo sugeriria uma capacidade que não existe. Quando uma SPEC futura
precisar deles — taxa de engajamento, por exemplo — o tipo cresce junto com ela.

### O motor não infere formato

O `format` chega **já classificado pela coleta**. O motor nunca deduz formato a
partir de URL, título, descrição, thumbnail, proporção, duração ou IA. Se essa
regra fosse quebrada, a separação exigida pela RN-06 dependeria de um palpite.

## 4. Saídas

```ts
interface ChannelMetrics {
  collectedAt: Date;
  totalVideoCount: number;
  unclassifiedVideoCount: number; // format === 'unknown'
  shorts: FormatMetrics;
  long: FormatMetrics;
}

interface FormatMetrics {
  format: 'short' | 'long';
  videoCount: number;
  videosWithoutViewCount: number;
  analyzedPeriod: {
    firstPublishedAt: Date | null;
    lastPublishedAt: Date | null;
    spanInDays: number | null;
  };
  viewCount: { total; average; median; minimum; maximum }; // number | null
  viewsPerDay: { average; median }; // number | null
  publicationFrequency: {
    medianIntervalDays: number | null;
    averageIntervalDays: number | null;
    videosLast30Days: number;
  };
  outliers: { count: number; largeCount: number; unavailableCount: number };
  videos: readonly VideoMetrics[];
}

interface VideoMetrics {
  videoId: YouTubeVideoId;
  ageInDays: number;
  viewsPerDay: number | null;
  outlierScore: number | null;
  outlierBand: OutlierBand | null;
}
```

### Quatro desvios do modelo conceitual proposto, e por quê

**1. `collectedAt`, não `capturedAt`.** O projeto já usa `collectedAt` em
`RawSnapshot.collectedAt`, no `ChannelMetrics` anterior e na redação da RN-12.
Introduzir `capturedAt` colocaria dois nomes para o mesmo conceito lado a lado
dentro da mesma entidade `Analysis` — a próxima pessoa gastaria tempo procurando
a diferença que não existe.

**2. `long`, não `longVideos`.** A chave espelha o valor do discriminante
`VideoFormat = 'short' | 'long'` e já existia no contrato anterior. Renomear
agora seria churn sem ganho.

**3. `outlierBand: OutlierBand | null`, não uma quinta faixa `'unavailable'`.**
A RN-08 estabelece uma convenção usada em todo o código: ausência é `null`.
`viewCount`, `medianViews`, `subscriberCount` — todos seguem isso. Um sentinela
de string criaria um segundo idioma para o mesmo conceito e obrigaria todo
`switch` sobre faixas a tratar um valor que não é uma faixa. `outlierScore:
null` e `outlierBand: null` andam sempre juntos.

**4. `unavailableCount` acrescentado ao bloco de outliers.** Sem ele,
`count: 0` em um canal onde **nada** pôde ser classificado seria indistinguível
de um canal genuinamente sem outliers — duas afirmações completamente diferentes.
Isso é RN-08 aplicada a uma contagem.

### `unclassifiedVideoCount`

`VideoFormat` tem **três** valores. `'unknown'` existe porque a coleta prefere
admitir que não sabe a duração a chutar um formato e contaminar a mediana do
outro (RN-06).

Vídeos `'unknown'` **não são erro** — são um estado legítimo do dado. Ficam fora
dos dois blocos e são contados aqui, para que a ausência deles seja visível em
vez de silenciosa.

**Invariante:** `shorts.videoCount + long.videoCount + unclassifiedVideoCount ===
totalVideoCount`. Há teste.

## 5. Definições matemáticas

| Métrica                     | Fórmula                                              |
| --------------------------- | ---------------------------------------------------- |
| Média                       | `Σ valores / quantidade`                             |
| Mediana (ímpar)             | valor central da lista ordenada                      |
| Mediana (par)               | `(central₁ + central₂) / 2`                          |
| Idade em dias               | `(collectedAt − publishedAt) / 86.400.000`           |
| Visualizações por dia       | `viewCount / max(ageInDays, 1)`                      |
| Intervalo entre publicações | `(publicaçãoₙ − publicaçãoₙ₋₁) / 86.400.000`         |
| Período analisado           | `(max(publishedAt) − min(publishedAt)) / 86.400.000` |
| Score de outlier            | `viewCount / mediana de visualizações do formato`    |

Toda aritmética de tempo é feita em **milissegundos** e convertida para dias.
Milissegundos são imunes a horário de verão e fuso — `getTime()` é um instante
absoluto. Contar "dias de calendário" introduziria dias de 23 e 25 horas e
quebraria o determinismo exigido pela RN-13.

## 6. Separação entre Shorts e vídeos longos

Os dois formatos são particionados **antes** de qualquer cálculo. Cada bloco tem
sua própria média, mediana, mínimo, máximo, visualizações por dia, frequência e
mediana de outliers.

O tipo torna a violação impossível: **não existe nenhum campo de média, mediana
ou outlier no nível do canal**. Não há onde escrever um número misturado.

A mediana usada no score de um vídeo chega por parâmetro a
`calculateOutlierScore`, justamente para que não haja caminho de código capaz de
usar a mediana do outro formato.

Sem isso, um Short com 3.000 visualizações e um vídeo longo com 30 seriam
comparados à mesma base, e ambos os números perderiam significado. Há teste
cobrindo exatamente esse cenário.

## 7. Média

`Σ valores / quantidade`.

- Conjunto vazio devolve **`null`**, nunca `0` (RN-08).
- Recusa `NaN`, `Infinity`, `-Infinity` e negativos → `invalid_numeric_value`.
- Não arredonda. `media([10, 20, 25]) = 18,333…`, completo.
- `0` é valor válido: um vídeo com zero visualizações é um fato, não uma ausência.

Todas as grandezas tratadas são contagens ou durações, e nenhuma pode ser
negativa. Um negativo nesta posição é sintoma de defeito na coleta, não um valor
a propagar.

## 8. Mediana

Lista ordenada; valor central se a quantidade for ímpar, média dos dois centrais
se for par.

- **Não modifica o array recebido** — `sort` opera sobre cópia. Há teste.
- Comparador numérico explícito: o `sort` padrão do JavaScript ordena como texto,
  e `[10, 9, 100]` viraria `[10, 100, 9]`. Há teste.
- Conjunto vazio devolve **`null`**.
- Mesmas recusas numéricas da média.
- Não arredonda.

## 9. Visualizações por dia

```
viewsPerDay = viewCount / max(ageInDays, 1)
```

### A decisão do piso de um dia

**Decisão:** o denominador nunca é menor que 1 dia.

**Justificativa:** um vídeo publicado há 6 minutos com 100 visualizações
produziria `100 / 0,00417 ≈ 24.000` visualizações/dia. Esse número não diz nada
sobre o canal — é um artefato do denominador minúsculo. Pior: ele dominaria a
média e a mediana de visualizações por dia do formato, e todo vídeo recém-
publicado apareceria no topo de qualquer ranking.

**Consequência assumida:** para vídeos com menos de 24 horas o resultado é um
**piso** — mede o acumulado até agora, espalhado por um dia inteiro, e portanto
**subestima**. É o erro na direção segura: subestimar um vídeo novo é preferível
a colocá-lo artificialmente à frente de todo o catálogo.

**Exemplos** (com `viewCount = 100`):

| Idade real | Sem piso   | Com piso | Comentário           |
| ---------- | ---------- | -------- | -------------------- |
| 6 minutos  | 24.000/dia | 100/dia  | artefato eliminado   |
| 6 horas    | 400/dia    | 100/dia  | ainda dentro do piso |
| 1 dia      | 100/dia    | 100/dia  | fronteira: idêntico  |
| 10 dias    | 10/dia     | 10/dia   | piso não se aplica   |

### Regras

- `viewCount` ausente → resultado **indisponível** (`null`), nunca `0`.
- `viewCount` negativo, `NaN` ou `Infinity` → `invalid_view_count`.
- Idade inválida → `invalid_numeric_value`.
- Idade `0` (publicado no instante da coleta) → denominador `1`. Nunca
  `Infinity`, nunca divisão por zero.
- Não arredonda.

## 10. Frequência de publicação

Calculada **separadamente por formato**.

1. Copiar as datas e ordenar em ordem crescente. O array recebido não muda.
2. Calcular os intervalos entre publicações consecutivas, em dias fracionários.
3. Produzir mediana e média dos intervalos.

**A mediana é a métrica principal.** Ela sofre muito menos influência de pausas
extraordinárias: um canal que publica a cada 2 dias e tirou 200 dias de férias
tem mediana 2 e média 68. A mediana descreve o hábito; a média descreve o hábito
mais o acidente. A média é fornecida como auxiliar. Há teste com exatamente esse
cenário.

### Regras

| Situação               | Resultado                                                           |
| ---------------------- | ------------------------------------------------------------------- |
| Nenhum vídeo           | ambos `null`                                                        |
| Um vídeo               | ambos `null` — um canal com um vídeo não publica "a cada zero dias" |
| Dois vídeos            | um intervalo válido                                                 |
| Dois no mesmo instante | intervalo `0`, permitido                                            |
| Fora de ordem          | mesmo resultado que ordenados                                       |

## 11. Janela dos últimos 30 dias

`videosLast30Days` conta os vídeos com
`collectedAt − 30 dias ≤ publishedAt ≤ collectedAt`.

- **Fronteira inclusiva nos dois lados.** Exatamente 30 dias entra; um
  milissegundo mais antigo sai. Publicado no instante da coleta entra.
- 30 dias = `30 × 86.400.000 ms`, não "trinta dias de calendário".
- A referência é **sempre** `collectedAt`, nunca o relógio do sistema. Há teste
  provando que a mesma lista com outra data de coleta produz outra contagem.
- É uma **contagem**: `0` é resultado legítimo, não ausência.

## 11-A. Período efetivamente analisado

```
firstPublishedAt = min(publishedAt) dos vídeos DO FORMATO
lastPublishedAt  = max(publishedAt) dos vídeos DO FORMATO
spanInDays       = (lastPublishedAt − firstPublishedAt) / 86.400.000
```

### Por que este campo existe

**A seleção de vídeos não tem filtro por data.** A coleta pega os
`MAX_RECENT_VIDEOS` uploads mais recentes (SPEC-001, capacidade 5), e o período
resultante é consequência da cadência do canal: 50 vídeos de um canal diário
cobrem sete semanas; de um canal mensal, quatro anos.

Sem este campo, os dois casos aparecem como "50 vídeos analisados" e parecem
comparáveis. Não são — e a tela estaria omitindo a informação que torna os
números interpretáveis.

### Regras

- **Por formato, nunca no nível do canal** (RN-06). Shorts e vídeos longos
  costumam ter cadências diferentes, e um período único as esconderia.
- **Inclui vídeos sem `viewCount`.** Eles têm data de publicação e fazem parte
  do conjunto analisado; a exclusão da RN-08 vale para os agregados de
  visualizações, não para a extensão temporal.
- **Exclui vídeos `'unknown'`**, como todo o resto do bloco de formato.
- **Não recebe `collectedAt`.** O período descreve o conjunto de vídeos, não a
  distância até a coleta.
- Não ordena nem modifica a entrada; um percurso acha os dois extremos. As datas
  devolvidas são instâncias novas — `Date` é mutável.

| Caso                  | Resultado                                    |
| --------------------- | -------------------------------------------- |
| Nenhum vídeo          | os três campos `null` — não `0` dias (RN-08) |
| Um vídeo              | as duas pontas iguais, `spanInDays: 0`       |
| Todas as datas iguais | as duas pontas iguais, `spanInDays: 0`       |
| Fora de ordem         | mesmo resultado que ordenados                |

> `spanInDays: 0` com um vídeo é **fato**, não ausência: um único ponto no tempo
> abrange zero dias. Difere de `medianIntervalDays`, que é `null` com um vídeo
> porque não existe intervalo algum para medir.

## 12. Classificação de outliers

```
outlierScore = viewCount / mediana de visualizações do formato
```

| Faixa           | Condição            |
| --------------- | ------------------- |
| `normal`        | `score < 1,5`       |
| `above_normal`  | `1,5 ≤ score < 2,5` |
| `outlier`       | `2,5 ≤ score < 5`   |
| `large_outlier` | `score ≥ 5`         |

**O score não é arredondado antes da classificação.** `1,4999` é `normal`, não
`above_normal`. Arredondar antes moveria a fronteira e faria a classificação
depender do número de casas escolhido para exibir. Há teste em cada fronteira
exata e logo abaixo dela.

**Contagens:**

- `count` — vídeos com `score ≥ 2,5`, ou seja as faixas `outlier` **e**
  `large_outlier`;
- `largeCount` — vídeos com `score ≥ 5`;
- `unavailableCount` — vídeos sem score.

`viewCount = 0` com mediana positiva produz `score = 0` → `normal`. Zero é um
fato conhecido, não uma ausência.

## 13. Tratamento de dados ausentes

O motor distingue três estados, e nunca os confunde:

| Estado        | Representação | Exemplo                                               |
| ------------- | ------------- | ----------------------------------------------------- |
| Zero          | `0`           | vídeo com zero visualizações; formato com zero vídeos |
| Indisponível  | `null`        | visualizações ocultas; média de conjunto vazio        |
| Não aplicável | `null`        | intervalo de publicação com um único vídeo            |

Regra operacional: **`null` nunca vira `0` automaticamente.** Vídeos sem
`viewCount` são **excluídos** dos agregados — não entram como zero. Com 3 vídeos
de 10, 30 e `null` visualizações, a média é 20, não 13,33. `videosWithoutViewCount`
registra quantos ficaram de fora, para que a exclusão seja visível.

## 14. Mediana zero

Quando a mediana de visualizações do formato é `0`:

- **não** dividir por zero;
- **não** devolver `Infinity`;
- **não** classificar automaticamente como grande outlier;
- `outlierScore = null`;
- `outlierBand = null`;
- os vídeos entram em `unavailableCount`.

**Justificativa.** A tentação é dizer que um vídeo com 1.000 visualizações contra
uma mediana `0` é um outlier gigantesco. Mas a regra atual mede "quantas vezes o
típico", e quando o típico é zero não existe razão definida — qualquer valor
positivo daria `Infinity`, e a classificação deixaria de significar alguma coisa.
Devolver indisponível é a leitura honesta: **a regra não se aplica a esse canal**.

Uma estratégia alternativa — média em vez de mediana, percentil, suavização —
exige SPEC própria. Não foi inventada aqui.

## 15. Vídeos recém-publicados

Ver a decisão do piso de um dia na seção 9. Em resumo: `ageInDays` permanece
fracionário e verdadeiro (`0,25` para 6 horas), mas o **denominador** de
visualizações por dia nunca é menor que 1.

`ageInDays` é **fracionário**, não inteiro. Um vídeo de 36 horas tem `1,5` dia;
truncar para `1` inflaria visualizações por dia em 50%. O arredondamento é
responsabilidade da apresentação.

`publishedAt === collectedAt` produz `ageInDays = 0`, que é válido.

## 16. Invariantes

1. `shorts.videoCount + long.videoCount + unclassifiedVideoCount === totalVideoCount`
2. `videosWithoutViewCount ≤ videoCount` em cada formato
3. `outliers.largeCount ≤ outliers.count`
4. `outliers.unavailableCount === ` quantidade de vídeos com `outlierScore === null`
5. `videos.length === videoCount` em cada formato
6. A ordem de `videos` é **a ordem da entrada**
7. Nenhum agregado de um formato depende de vídeo do outro formato
8. Os arrays e objetos de entrada nunca são modificados
9. A mesma entrada produz sempre a mesma saída
10. Mudar `collectedAt` altera **apenas** métricas temporais — visualizações,
    medianas e faixas de outlier permanecem idênticas

Invariantes 1, 6, 8, 9 e 10 têm teste direto.

## 17. Erros

Uma classe, `InvalidVideoAnalyticsInputError extends DomainError`, com
discriminante `reason` — mesmo padrão da SPEC-002, e pela mesma razão: o
`ErrorCode` de `shared/errors` é fechado e transversal, e acrescentar
`INVALID_VIEW_COUNT` lá faria a camada compartilhada conhecer contagens de
visualizações do YouTube.

| `reason`                   | Quando                                             |
| -------------------------- | -------------------------------------------------- |
| `invalid_collected_at`     | `collectedAt` não é data válida                    |
| `invalid_published_at`     | `publishedAt` de algum vídeo não é data válida     |
| `future_publication_date`  | vídeo publicado depois da coleta                   |
| `invalid_view_count`       | `viewCount` negativo, `NaN` ou infinito            |
| `duplicate_video`          | o mesmo `id` aparece duas vezes                    |
| `unsupported_video_format` | `format` fora dos três valores conhecidos          |
| `invalid_numeric_value`    | valor não finito ou negativo em função estatística |

### Contexto do erro

Diferente da SPEC-002, aqui o **`videoId` e o índice entram no contexto**. Um
`YouTubeVideoId` é dado público, sem nada sensível, e sem ele um erro de
duplicidade numa coleta de 50 vídeos seria impossível de investigar. O risco que
motivou a política da SPEC-002 era credencial dentro de URL — não existe aqui.

O que continua valendo: **a mensagem não interpola conteúdo externo**. Mensagem
genérica, detalhe no contexto.

## 18. Casos limítrofes

| Caso                            | Decisão                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canal sem vídeos                | Ambos os blocos existem, `videoCount: 0`, agregados `null`, contagens `0`. Não lança erro.                                                                |
| Formato sem vídeos              | Idem, apenas para aquele bloco.                                                                                                                           |
| Todos os vídeos sem `viewCount` | Agregados `null`, `unavailableCount === videoCount`, `count: 0`.                                                                                          |
| Mediana zero                    | Ver seção 14.                                                                                                                                             |
| `viewCount: 0`                  | Fato, não ausência. Entra nos agregados; `viewsPerDay: 0`; banda `normal`.                                                                                |
| Idade zero                      | Válida. Denominador `1`.                                                                                                                                  |
| Dois vídeos no mesmo instante   | Intervalo `0`, válido.                                                                                                                                    |
| Vídeos fora de ordem            | Ordenação interna sobre cópia; resultado idêntico.                                                                                                        |
| Exatamente 30 dias              | Incluído na janela.                                                                                                                                       |
| 30 dias + 1 ms                  | Excluído.                                                                                                                                                 |
| Vídeo `'unknown'`               | Fora dos blocos, contado em `unclassifiedVideoCount`. **Ainda assim validado**: dado corrompido não deixa de ser corrompido por ficar fora dos agregados. |
| ID duplicado                    | Recusado. Ver seção abaixo.                                                                                                                               |

### Vídeos duplicados

**Política: recusar, nunca deduplicar em silêncio.**

Deduplicar esconderia um defeito da coleta — paginação repetindo uma página, por
exemplo — e o canal apareceria com métricas plausíveis calculadas sobre dados
errados. Ninguém investigaria, porque nada pareceria estranho. Falhar alto é a
única forma de esse defeito chegar a ser corrigido.

O erro carrega `videoId` e `index` no contexto.

## 19. Precisão numérica

**Nada é arredondado dentro do domínio.** Médias, medianas, intervalos,
visualizações por dia e scores mantêm precisão completa.

Arredondar aqui perderia precisão em cadeia — uma média de valores já
arredondados, um score calculado sobre uma mediana arredondada — sem que ninguém
percebesse. A apresentação é responsável por casas decimais, números abreviados,
percentuais e texto amigável.

## 20. Critérios de aceitação

- [x] SPEC-003 criada, com as definições matemáticas documentadas
- [x] Shorts e vídeos longos processados separadamente
- [x] Média e mediana tratam conjunto vazio como `null`
- [x] Mediana zero não produz divisão por zero nem `Infinity`
- [x] Visualizações por dia usam `collectedAt`, nunca o relógio do sistema
- [x] Frequência calculada por intervalos entre publicações
- [x] Janela de 30 dias implementada com fronteira inclusiva
- [x] Outliers respeitam exatamente as quatro faixas
- [x] Dados ausentes não viram zero
- [x] Entrada não é modificada
- [x] Política explícita para vídeos duplicados
- [x] Funções puras, sem chamadas externas
- [x] Superfície pública do módulo controlada
- [x] Testes cobrindo casos válidos e limítrofes
- [x] Testes arquiteturais continuam passando
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` e
      `npm run verify` passam

## 21. Fora do escopo

- YouTube Data API, Supabase, banco, cache, filas, cron, autenticação;
- interface, API Route, Server Action, dashboard;
- Claude API e qualquer geração de texto;
- estimativa de receita e de RPM;
- taxa de engajamento, curtidas e comentários como métricas;
- classificação de formato a partir de duração — pertence à SPEC de coleta;
- padrões de título, consistência do canal, nicho e dependência de virais —
  são **interpretação**, e pertencem ao módulo `ai-insights`, que receberá estas
  métricas prontas (RN-14);
- estratégia alternativa para mediana zero;
- persistência das métricas.
