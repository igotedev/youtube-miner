# SPEC-011 — Relatório de IA

| Campo      | Valor                                                          |
| ---------- | -------------------------------------------------------------- |
| Status     | Implementada                                                   |
| Data       | 2026-08-08                                                     |
| Módulos    | `ai-insights`, `channel-analysis`, `config/composition`, `app` |
| Depende de | SPEC-003 (métricas), SPEC-005 (persistência), ADR-007          |

---

## 1. Contexto

A décima capacidade do MVP. É a única que falta, junto das watchlists — e é a
que mantém **toda** análise em `partially_completed`: o estado existe para
dizer "os números estão certos, o relatório não veio", e hoje ele é o único
final possível do caminho feliz.

Três peças estão prontas desde a fundação e nunca tiveram implementação:

| Peça                         | Criada em | Uso até aqui |
| ---------------------------- | --------- | ------------ |
| Porta `InsightGenerator`     | SPEC-001  | **nenhum**   |
| Tipo `InsightReport`         | SPEC-001  | nenhum       |
| Tabela `ai_insight_reports`  | SPEC-004  | **nenhum**   |
| Estado `generating_insights` | SPEC-001  | nenhum       |

As decisões de fornecedor, modelo, custo e formato de resposta estão no
**ADR-007**. Este documento descreve o que é construído.

## 2. Escopo

### Inclui

- Adaptador `GeminiInsightGenerator` — o prompt, a chamada, a validação.
- Porta `InsightReportRepository` e os adaptadores em memória e Supabase.
- Caso de uso `GenerateAnalysisInsight`, que avança `generating_insights` →
  `completed` ou `partially_completed`.
- O relatório na tela de análise e na de detalhe, **separado** das métricas.

### Não inclui

- Fila ou execução em segundo plano. A geração é síncrona, no mesmo pedido.
- Regeneração, edição ou avaliação do relatório pelo usuário.
- Streaming do texto para a tela.
- Escolha de modelo pela interface. É variável de ambiente (ADR-007).
- Relatório comparando dois canais. Não existe comparação no MVP.

## 3. O que a IA recebe, e o que ela nunca recebe

**Recebe:** os números **já calculados** — os dois blocos de `ChannelMetrics`,
com Shorts e longos separados (RN-06) — e os títulos dos vídeos recentes.

**Nunca recebe:** a lista bruta de visualizações por vídeo.

A distinção é a RN-14 no formato do pedido. Sem a lista bruta, não há o que
somar: a IA não teria como calcular uma média nem que fosse instruída a isso.
O tipo `InsightRequest` já foi escrito assim na SPEC-001, com o comentário
dizendo exatamente isto.

### Ausência é ausência, também no prompt

`null` em uma métrica vai para o pedido **como ausência declarada**, nunca como
zero e nunca omitido em silêncio (RN-08). Um canal com inscrições ocultas não
tem zero inscritos, e um relatório que dissesse isso estaria errado por culpa do
nosso pedido, não do modelo.

## 4. O contrato de saída

O modelo responde JSON validado contra um esquema, e o adaptador valida de novo
com Zod (ADR-007, decisão 3). Os campos são exatamente os de `InsightReport`:

| Campo                  | Tipo            | Ausente quando                       |
| ---------------------- | --------------- | ------------------------------------ |
| `summary`              | texto           | nunca — é o relatório                |
| `likelyNiche`          | texto ou `null` | não dá para inferir dos dados        |
| `likelySubNiche`       | texto ou `null` | idem                                 |
| `titlePatterns`        | lista de textos | lista vazia se não há padrão visível |
| `contentOpportunities` | lista de textos | idem                                 |
| `viralDependencyNotes` | texto ou `null` | a distribuição não sugere nada       |

**Nenhum campo numérico**, e isso é estrutural (ADR-007, decisão 4). `null` é
permitido de propósito: um modelo obrigado a preencher todo campo preenche com
invenção.

### Duas frases que o relatório não pode conter

O prompt proíbe, e a tela reforça:

1. **Promessa de resultado.** Nada que sugira que seguir um padrão observado
   produzirá views. É a primeira regra de produto do projeto.
2. **Número apresentado como cálculo próprio.** Os números citados são os que
   foram entregues, e são citados como tais.

## 5. Onde cada coisa mora

```
ai-insights/
  domain/insight-report.ts          InsightReport (ganha provider e promptVersion)
  application/ports/
    insight-generator.ts            já existia
    insight-report-repository.ts    NOVA
  infrastructure/
    insight-prompt.ts / insight-response.ts  o prompt e o contrato, sem provedor
    gemini/gemini-insight-generator.ts       a chamada (fetch, sem SDK)
    supabase/                                a tabela
    memory/, fake/                           para teste

channel-analysis/
  application/use-cases/generate-analysis-insight.ts   NOVO
```

### Um ciclo de tipos, declarado

`channel-analysis` importa `InsightGenerator` e `InsightReport`;
`ai-insights` importa `AnalysisId`. Isso é um ciclo entre os dois barrels.

Ele é **inteiramente de tipos** — os dois lados usam `import type`, e o
TypeScript apaga os dois na compilação. Não há aresta em tempo de execução, e
nenhum bundler vê o ciclo.

**A invariante que mantém isso verdade: o barrel de `ai-insights` exporta
apenas tipos.** Constantes e classes ficam em `infrastructure/`, que a
composição alcança por caminho explícito. Exportar um valor dali e importá-lo em
`channel-analysis` transformaria o ciclo em real — e essa é a linha que não se
cruza sem outro ADR.

## 6. Os estados, e por que a ordem importa

```
calculating_metrics → generating_insights → completed
                                         ↘ partially_completed
```

O caso de uso:

1. exige `analyticsResultId` presente — sem métricas não há sobre o que escrever;
2. grava `generating_insights` **antes** da chamada externa;
3. chama a porta;
4. em sucesso: grava o relatório e leva a análise a `completed`;
5. em falha de qualquer natureza — erro, recusa, tempo esgotado, resposta que
   não valida — grava a tentativa como `failed` em `ai_insight_reports` e leva a
   análise a `partially_completed`.

O passo 2 é o que permite saber, olhando o banco, que uma análise parou **no
meio da chamada**. Sem ele, um processo derrubado deixaria a análise em
`calculating_metrics` para sempre, indistinguível de uma que nunca começou.

### O pior caso é o comportamento de hoje

`partially_completed` é onde toda análise termina atualmente. Ligar esta SPEC
não pode piorar nada — sem chave, sem rede ou com o provedor fora do ar, o
resultado é exatamente o que o usuário já vê.

## 7. Idempotência e custo

**Uma análise gera no máximo um relatório.** Antes de chamar, o caso de uso
consulta `findByAnalysis`; se já existe um relatório concluído, devolve-o sem
gastar um token.

Isso importa mais aqui do que na coleta: um duplo clique custa dinheiro, e a
RN-10 não se aplica — o relatório é **do usuário**, ligado à análise por chave
estrangeira com `on delete cascade`, e não um artefato global reaproveitável
entre pessoas (ADR-005).

## 8. Configuração

| Variável         | Padrão             | Sem ela                          |
| ---------------- | ------------------ | -------------------------------- |
| `GEMINI_API_KEY` | —                  | a etapa não roda; a tela declara |
| `GEMINI_MODEL`   | `gemini-3.6-flash` | —                                |

As variáveis `ANTHROPIC_*` e `AI_MAX_OUTPUT_TOKENS` foram **removidas**: existiam
como marcadores desde a fundação e nunca tiveram uso. Não há teto de tokens de
saída porque o endpoint não documenta um campo para isso — o tamanho da resposta
é contido pelo esquema (ADR-007, decisão 2).

**Ausência da chave é degradação declarada, não falha.** Igual à
`YOUTUBE_API_KEY`: a análise roda, termina em `partially_completed`, e a tela
diz por quê. Diferente do Supabase, que é obrigatório — uma sessão falsa engana,
um relatório ausente não.

### O custo é zero em dinheiro, e não é zero

A camada gratuita do Gemini usa entradas e saídas para treinar modelos do
Google, e tem limite diário compartilhado por chave. As duas coisas estão
registradas no ADR-007, decisão 2, e ao lado da variável em `.env.example`.

O que sai daqui é **dado público do YouTube ou agregado derivado dele** — nada
identifica quem pediu a análise. Isso reduz o problema; não o elimina.

## 9. A tela

O relatório aparece **abaixo** dos painéis de métricas, em bloco próprio, com:

- rótulo dizendo que é **texto gerado por IA**;
- o modelo e o instante da geração;
- uma linha afirmando que é interpretação, não medição.

Isso é a segunda regra de produto — estimativa nunca é apresentada como dado
oficial — em disposição visual. Um relatório intercalado entre as linhas de
métrica seria lido como se tivesse a mesma procedência.

Quando não há relatório, a tela diz **por quê**: sem chave configurada, ou a
geração falhou. Um espaço vazio faria o usuário procurar um defeito.

## 10. Testes

| Arquivo                             | Cobre                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insight-response.test.ts`          | o esquema Zod: resposta válida, campos nulos, lista vazia, resposta corrompida recusada                                                                                                         |
| `generate-analysis-insight.test.ts` | ordem dos estados; sucesso → `completed`; falha → `partially_completed` com métricas intactas; idempotência (segunda chamada não gera); análise sem métricas recusada; análise de outro usuário |
| `insight-report-row.test.ts`        | ida e volta pelo `jsonb`, tokens, `null` preservado                                                                                                                                             |
| `gemini-insight-generator.test.ts`  | com `fetch` dublado: chave em cabeçalho e nunca na URL; esquema no pedido; agregados sim e lista bruta não; estado não concluído recusado; 429 → quota; erro do provedor não sobe               |
| integração                          | a linha em `ai_insight_reports`, a cascata ao apagar a análise, o `check` de `completed`                                                                                                        |

**Nenhum teste acessa a rede.** O gerador falso é determinístico e a composição
o escolhe quando não há chave — o mesmo desenho do fixture da coleta. O
adaptador real é testado com `fetch` dublado.

## 11. Impacto

| Área                    | Impacto                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| **Banco**               | **nenhum** — `ai_insight_reports` existe desde a SPEC-004                 |
| **Dependência nova**    | **nenhuma** — `fetch` direto, como o adaptador do YouTube (ADR-007, d. 1) |
| **Custo em dinheiro**   | **zero** — camada gratuita; tokens medidos e gravados mesmo assim         |
| **Privacidade**         | os dados enviados são usados para treinar modelos do Google (ADR-007)     |
| **Quota do YouTube**    | **nenhum** — a etapa não toca a coleta                                    |
| **Motor de métricas**   | **nenhum** — `calculateChannelMetrics` não é tocado                       |
| **Versão do algoritmo** | **nenhuma** — nada é recalculado                                          |
| **Estados**             | `completed` passa a ser alcançável pela primeira vez                      |

## 12. Critérios de aceitação

- [x] Sem chave, termina em `partially_completed`… **não**: termina em
      `completed` com um relatório que **declara ser de exemplo**. Ver a nota
      abaixo — o critério original estava errado.
- [x] Falha, recusa ou resposta inválida do provedor **não** apagam as métricas.
- [x] O relatório aparece separado dos números, identificado como texto de IA,
      com modelo e instante.
- [x] Nenhum campo numérico atravessa a fronteira vindo do modelo.
- [x] Uma segunda execução sobre a mesma análise não chama o provedor.
- [x] Consumo gravado em `input_tokens`/`output_tokens`.
- [x] Nenhuma migração, nenhuma dependência nova; `npm run verify` passa sem
      Docker e sem rede.
- [ ] **Uma análise com chave configurada termina em `completed`, com relatório
      real.** Não verificado — ver seção 13.

### O critério que estava errado

A SPEC dizia que sem chave a análise terminaria em `partially_completed`. A
implementação faz outra coisa: o gerador falso devolve um texto que **se anuncia
como exemplo**, e a análise chega a `completed`.

As duas soluções são defensáveis; a segunda é a mesma escolha que a coleta já
faz com o fixture, e mantém o caminho feliz exercitável sem chave. Fica
registrada aqui em vez de ser corrigida em silêncio.

## 13. O que NÃO foi verificado

**A chamada real ao Gemini.** Não há `GEMINI_API_KEY` no ambiente, então nada
neste trabalho falou com a API de verdade.

O que existe de proteção:

- o formato do pedido e a leitura da resposta estão travados por teste com
  `fetch` dublado;
- o endpoint, os nomes dos campos e a forma da resposta foram lidos da
  **documentação oficial**, não escritos de memória — e diferiam do que eu
  esperava, o que é justamente o motivo de terem sido conferidos.

O que isso **não** cobre: se o modelo obedece ao esquema na prática, a qualidade
do texto em português, e a latência real. Os três só aparecem com uma chave.
