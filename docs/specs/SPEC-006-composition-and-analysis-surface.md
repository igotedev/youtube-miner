# SPEC-006 — Raiz de composição e primeira superfície HTTP

| Campo      | Valor                                                        |
| ---------- | ------------------------------------------------------------ |
| Status     | Implementada                                                 |
| Data       | 2026-08-06                                                   |
| Módulos    | `config/composition`, `app` (presentation)                   |
| Depende de | SPEC-002 (referência), SPEC-003 (motor), SPEC-005 (métricas) |

---

## 1. Contexto

Depois da SPEC-005 o pipeline estava completo — e **inalcançável**. Os dois casos
de uso existiam, eram testados, e nenhum código de produção os chamava:

- `src/config/composition/` continha apenas um `README.md`;
- `src/app/` era a página estática da fundação;
- a regra R6 ("presentation não instancia adaptadores") não tinha nada para
  proteger, porque não havia presentation.

Havia ainda um vão mais silencioso: `parseYouTubeChannelReference` (SPEC-002,
26 casos de teste) **nunca era executado no fluxo**. O resolver falso aceitava
qualquer string não vazia e devolvia o canal do fixture. O parser era código
correto, testado e morto.

Esta SPEC liga as pontas.

## 2. Objetivo

Uma superfície HTTP que receba uma URL de canal, execute o pipeline inteiro e
apresente as métricas — sem que nenhuma regra de negócio migre para a camada de
apresentação.

## 3. Fluxo

```
1. Formulário envia a URL                              presentation
2. Zod valida o formato da entrada                     Server Action
3. Raiz de composição monta os casos de uso            config/composition
4. StartChannelAnalysis        pending → collecting_videos
5. CalculateAnalysisMetrics    → calculating_metrics → partially_completed
6. Métricas viram modelo de exibição                   presentation (puro)
7. Página renderiza, separando Shorts e longos
```

Os passos 4 e 5 são **dois casos de uso chamados em sequência**, como o
`overview.md` já previa. Encadeá-los automaticamente continua sendo assunto da
SPEC de filas.

## 4. A composição é de demonstração, e isso é declarado

A raiz de composição monta **apenas** adaptadores em memória e falsos. Não liga
os adaptadores Supabase, embora eles existam desde a SPEC-004.

O motivo, **à época desta SPEC**, era o mesmo que ordenou a SPEC-005 à frente do
adaptador da YouTube Data API: a migração da SPEC-004 nunca havia sido executada
(Docker indisponível no ambiente). Ligar `SupabaseAnalysisRepository` criaria um
caminho de produção que ninguém conseguia exercitar — uma terceira afirmação sem
verificação, empilhada sobre duas.

> **Atualização (2026-08-07):** o esquema foi validado — migração aplicada em
> banco limpo e 108 asserções pgTAP passando. O motivo desta pendência deixou de
> existir, e ligar os adaptadores Supabase passou a ser a próxima etapa natural.

Quando o banco puder ser validado, a troca é de uma função na raiz de
composição. Nenhum caso de uso muda: é exatamente para isso que as portas
existem.

### Consequência de produto, não só técnica

Toda URL devolve o mesmo canal do fixture. A tela **precisa dizer isso**.

A regra de produto nº 2 — "estimativa nunca é apresentada como dado oficial" —
tem aqui a sua forma mais severa: dado de demonstração apresentado como leitura
de um canal real seria mentira, não imprecisão. A página exibe o aviso antes das
métricas, e o modo vem da raiz de composição, não de um literal na tela.

## 5. A SPEC-002 entra no fluxo

`createFakeChannelResolver` passa a chamar `parseYouTubeChannelReference` antes
de devolver o fixture. O efeito prático:

| Entrada                               | Antes           | Agora                          |
| ------------------------------------- | --------------- | ------------------------------ |
| `https://www.youtube.com/@canal`      | fixture         | fixture                        |
| `https://vimeo.com/canal`             | fixture         | `InvalidChannelReferenceError` |
| `https://www.youtube.com/watch?v=abc` | fixture         | `InvalidChannelReferenceError` |
| `nao-e-url`                           | fixture         | `InvalidChannelReferenceError` |
| `''`                                  | `NotFoundError` | `InvalidChannelReferenceError` |

A rejeição acontece **offline, antes de qualquer I/O** — nenhuma unidade de
quota é gasta com entrada inválida. Era o desenho previsto no comentário da
porta `ChannelResolver` desde a fundação; só não estava exercido.

## 6. Estado em memória sobrevive entre requisições

`StartChannelAnalysis` e `CalculateAnalysisMetrics` são invocações separadas e
precisam enxergar os mesmos repositórios. Em memória, isso exige que as
instâncias sobrevivam à requisição.

A raiz de composição guarda uma instância única em `globalThis`, e não em uma
variável de módulo. Motivo: o `next dev` recarrega módulos a quente, e uma
variável de módulo seria zerada a cada edição — a análise iniciada em uma
requisição desapareceria antes da seguinte.

**O estado é do processo.** Reiniciar o servidor apaga tudo. É aceitável para
uma composição de demonstração e deixa de existir quando o Supabase entrar.

## 7. Fronteiras respeitadas

| Regra  | Como esta SPEC a exercita                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| **R6** | A Server Action importa `@/config/composition`. Nenhum `new` de adaptador em `src/app/`.                                 |
| **R8** | `ANALYSIS_FRESHNESS_HOURS` é lido por `getServerEnv()` dentro de `src/config/`, e chega ao caso de uso como número puro. |
| **R5** | A composição importa `infrastructure` por caminho absoluto — é a exceção documentada, e o único lugar dela.              |
| **R9** | A apresentação formata datas recebidas; não lê o relógio.                                                                |

A raiz de composição é o **único** ponto do código de produção que importa
`infrastructure`. Antes desta SPEC, esse ponto não existia e a regra era teórica.

## 8. Formatação é apresentação, não domínio

Os formatadores são funções puras em `src/app/analise/format.ts`, com teste.

Não são regra de negócio — decidem como um número vira texto, não qual número.
Mas carregam a RN-08 do lado visível: `null` vira **"indisponível"**, nunca `0`
e nunca traço mudo. Um canal sem contagem de visualizações não teve zero
visualizações, e a tela não pode sugerir que teve.

`0` legítimo — uma contagem de vídeos que é realmente zero — é exibido como `0`.
Distinguir os dois casos é a função inteira do módulo.

## 9. Testes

**385 no total** (+38 nesta etapa), todos executados.

| Grupo                 | Cobre                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Raiz de composição    | monta os dois casos de uso; pipeline completo ponta a ponta; estado compartilhado entre as duas chamadas; modo de demonstração declarado |
| Resolver com SPEC-002 | aceita as formas válidas; rejeita host estranho, URL de vídeo, texto solto e string vazia                                                |
| `GetAnalysisMetrics`  | devolve métricas e as duas datas distintas; `null` sem cálculo; `null` com vínculo órfão; análise alheia dá `NotFoundError`              |
| Formatadores          | `null` vira "indisponível"; `0` legítimo continua `0`; as duas nunca colidem; contagem, intervalo, data, estado e faixa de outlier       |

Além disso, a exceção nova da raiz de composição foi verificada com **sondas
negativas**: um arquivo em `src/app/` importando `infrastructure` e um arquivo na
raiz de composição importando o `domain` de outro módulo. As duas redes
rejeitaram os dois casos; as sondas foram removidas em seguida.

## 10. Critérios de aceitação

- [x] Raiz de composição monta os dois casos de uso com adaptadores concretos
- [x] Server Action valida a entrada com Zod e não contém regra de negócio
- [x] Página executa o pipeline e exibe Shorts e longos separados (RN-06)
- [x] Ausência exibida como "indisponível", nunca `0` (RN-08)
- [x] Modo de demonstração declarado na tela, vindo da composição
- [x] `parseYouTubeChannelReference` rejeita entrada inválida antes de qualquer I/O
- [x] Nenhum adaptador instanciado em `src/app/` (R6)
- [x] `typecheck`, `lint`, `test`, `build`, `verify` passam

## 11. Fora do escopo

Autenticação real (o dono da análise é um identificador fixo de demonstração);
adaptadores Supabase na composição; adaptador da YouTube Data API; relatório de
IA; listagem ou histórico de análises; watchlists; qualquer estilo além do
necessário para ler os números.
