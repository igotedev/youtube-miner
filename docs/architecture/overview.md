# Visão geral da arquitetura

> Referência: SPEC-001. Decisões formais: `docs/adr/`. Regras de dependência com
> os IDs R1–R9: `dependency-rules.md`.

## 1. Arquitetura geral

Uma única aplicação Next.js, implantada como uma unidade, dividida internamente
em **módulos de negócio** com fronteiras verificadas.

```
Navegador
   │  HTTP
   ▼
┌──────────────────────────────────────────────────────────┐
│  Next.js (App Router) — um processo, um deploy           │
│                                                          │
│  presentation  páginas, rotas, Server Actions            │
│        │  chama caso de uso                              │
│        ▼                                                 │
│  application   casos de uso + PORTAS (interfaces)        │
│        │  usa tipos e regras                             │
│        ▼                                                 │
│  domain        entidades, regras, funções puras          │
│        ▲                                                 │
│        │  implementa as portas (dependência invertida)   │
│  infrastructure  adaptadores: Supabase, YouTube, Claude  │
└──────────────────────────────────────────────────────────┘
        │                    │                   │
        ▼                    ▼                   ▼
   PostgreSQL          YouTube Data API      Gemini API
```

A seta de `infrastructure` aponta **para cima**. É o ponto central: o domínio
não sabe que Supabase existe. Trocar Supabase por outro banco significa escrever
outro adaptador — nenhuma regra de negócio muda.

## 2. Por que monólito modular

Decisão registrada em **ADR-001**. Em resumo: microserviços comprariam
independência de deploy que ninguém pediu, ao custo de rede, observabilidade
distribuída e consistência eventual, num produto sem usuários e com um único
time. As fronteiras que realmente importam — entre módulos — são obtidas por
disciplina verificada em CI, não por separação de processos.

## 3. As quatro camadas

### domain

Entidades, objetos de valor, regras, serviços de domínio, erros de domínio,
funções puras, contratos que pertencem ao domínio.

Não pode importar: React, Next.js, Supabase, SDK do YouTube, SDK do Claude,
biblioteca de interface, nem `infrastructure` ou `presentation` (R1–R4).

Teste do olfato: se um arquivo em `domain` não pode ser testado em Node puro,
sem rede e sem navegador, ele está na camada errada.

### application

Casos de uso, comandos, consultas, DTOs, **portas** e coordenação.

É aqui que vivem as interfaces das dependências externas (`ChannelResolver`,
`YouTubeChannelSource`, `InsightGenerator`, `AnalysisRepository`). A camada
declara o que precisa; não escolhe quem fornece.

Um caso de uso recebe suas dependências pelo construtor. Não há container de
injeção — a montagem é explícita e acontece em `src/config/composition/`.

### infrastructure

Implementações de repositórios, clientes externos, Supabase, YouTube Data API,
Gemini API, cache, persistência, observabilidade.

Toda classe aqui **implementa uma porta declarada acima**. Se um adaptador não
implementa nenhuma interface de `application`, algo está errado: ou a porta está
faltando, ou o código não é adaptador.

### presentation

Páginas, componentes, rotas HTTP, controladores, Server Actions quando
justificadas, validação da entrada da interface.

Regras: sem cálculo de negócio em componente React; sem chamada a API externa a
partir de componente; sem instanciar adaptador (R6). Um componente recebe dados
já prontos ou chama um caso de uso.

## 4. Fluxo completo de uma análise

Estado final desejado (hoje implementado apenas até o passo 5):

```
1.  Usuário envia a URL                          presentation
2.  Zod valida o formato da entrada              presentation
3.  Caso de uso StartChannelAnalysis inicia      application
4.  Há análise recente reaproveitável? (RN-10)   application → AnalysisRepository
    └── sim: devolve a existente. Fim.
5.  Resolve URL → ID oficial (RN-01)             ChannelResolver     [collecting_channel]
6.  Coleta canal + até 50 vídeos                 YouTubeChannelSource[collecting_videos]
7.  Persiste o snapshot BRUTO (RN-04)            AnalysisRepository
8.  Calcula métricas, Shorts e longos separados  video-analytics     [calculating_metrics]
    └── função pura, sem I/O, sem relógio interno (RN-13)
9.  Persiste as métricas, em campo separado      AnalysisRepository
10. Gera relatório de IA                         InsightGenerator    [generating_insights]
    ├── sucesso → completed
    └── falha   → partially_completed (RN-09), dados objetivos preservados
11. Persiste o relatório, em terceiro campo      AnalysisRepository
```

Três observações que valem mais que o diagrama:

- **O passo 10 nunca derruba os passos 6–9.** Falha de IA é degradação, não erro
  da análise. É por isso que `partially_completed` existe.
- **O passo 8 não pode ser delegado à IA** (RN-14). Média, mediana, frequência e
  outlier são aritmética; a IA escreve _sobre_ esses números, depois de prontos.
- **Cada passo grava o estado.** Uma análise interrompida é diagnosticável.

### Estado atual do fluxo

Os passos 1 a 9 executam. Os passos 1 e 2 chegaram na SPEC-006; os casos de uso
cobrem 3 a 9:

- **`StartChannelAnalysis`** — 3 → 7, parando em `collecting_videos`. Antes de
  coletar, consulta uma coleta recente do mesmo canal (RN-10) e a reaproveita.
- **`CalculateAnalysisMetrics`** (SPEC-005) — 8 → 9, terminando em
  `partially_completed`. Reaproveita o cálculo se outra análise já rodou aquela
  coleta na mesma versão do algoritmo.
- **`GetAnalysisMetrics`** (SPEC-006) — consulta, não comando. Lê a análise com
  as métricas já calculadas, escopada pelo dono. Existe porque o caso de uso de
  cálculo devolve a `Analysis`, que carrega só a **referência** ao resultado.

O passo 10 não existe: sem adaptador Claude, `partially_completed` é o destino
honesto — dados objetivos válidos, relatório ausente (RN-09). Marcar `completed`
afirmaria que um relatório foi produzido.

Os dois casos de uso são chamados em sequência pela Server Action de `/analise`.
Encadeá-los automaticamente é assunto da SPEC de filas.

**A coleta usa a YouTube Data API de verdade** (SPEC-007) quando há
`YOUTUBE_API_KEY`; sem ela, cai no fixture e a tela declara isso pelo campo
`mode`.

**A persistência ainda é em memória.** Os adaptadores Supabase existem desde a
SPEC-004 e o esquema já está validado — migração aplicada em banco limpo, 108
asserções pgTAP passando. Ligá-los na raiz de composição é a próxima etapa.

## 5. Limites entre módulos

Cada módulo expõe **um único ponto de entrada**: `src/modules/<nome>/index.ts`.
O que não está reexportado ali é interno.

```
✅ import { StartChannelAnalysis } from '@/modules/channel-analysis';
❌ import { StartChannelAnalysis } from '@/modules/channel-analysis/application/use-cases/start-channel-analysis';
```

Dentro do próprio módulo, use caminhos relativos. O barrel é a fronteira externa,
não um atalho interno.

Um módulo **é dono das suas tabelas**. Nenhum outro lê ou escreve nelas
diretamente; a via é o contrato exposto pelo barrel (R7).

### Dependências entre módulos hoje

```
watchlists ─────► identity
     └──────────► youtube-collection
channel-analysis ─► identity, youtube-collection, video-analytics, ai-insights
ai-insights ──────► video-analytics, youtube-collection
     └ ─ ─ ─ ─ ─► channel-analysis   (só tipos — ver abaixo)
youtube-collection ─► (nenhum)
identity ───────────► (nenhum)
```

**O grafo de valor é acíclico, e assim deve permanecer.** Se dois módulos
precisarem um do outro em tempo de execução, ou a fronteira está no lugar
errado, ou falta um terceiro conceito. Verificado pela **R10**.

### A única exceção: um ciclo de tipos entre `channel-analysis` e `ai-insights`

`channel-analysis` importa `InsightGenerator` e `InsightReport`; `ai-insights`
importa `AnalysisId`. Os dois lados usam `import type`, e o TypeScript **apaga
os dois na compilação** — não existe aresta em tempo de execução, e nenhum
bundler vê o ciclo.

A invariante que mantém isso verdade: **o barrel de `ai-insights` exporta apenas
tipos**. Constantes e classes vivem em `infrastructure/`, que só a raiz de
composição alcança.

Até a auditoria de 2026-08-08 essa invariante estava escrita e verificada por
ninguém. Hoje ela tem duas barreiras, ambas na R10: uma detecta ciclo de valor
entre quaisquer módulos, outra falha antes disso se o barrel exportar um valor.

Ver SPEC-011, seção 5, e `dependency-rules.md`, R10.

## 6. Dependências permitidas e proibidas

Resumo; a tabela completa com os IDs está em `dependency-rules.md`.

| De               | Pode depender de                  | Nunca                                       |
| ---------------- | --------------------------------- | ------------------------------------------- |
| `presentation`   | `application`, `domain`, `shared` | `infrastructure` (R6)                       |
| `application`    | `domain`, `shared`                | React, Next, SDKs, `infrastructure` (R1–R3) |
| `domain`         | `shared/domain`, `shared/errors`  | tudo o mais (R1–R4)                         |
| `infrastructure` | todas as camadas internas         | outro módulo por dentro (R5)                |

### Verificação automática

As regras rodam em `npm run verify`, por duas redes independentes:

1. **ESLint** (`eslint.config.mjs`) — `no-restricted-imports` casando o texto do
   import. Pega pacotes proibidos e imports com alias.
2. **Teste de arquitetura** (`tests/architecture/dependency-rules.test.ts`) —
   resolve cada import para um caminho real no disco antes de julgar.

Duas redes porque cada uma cobre a falha da outra: o ESLint é cego para
`../../infrastructure/x` disfarçado e pode ser silenciado com `eslint-disable`;
o teste não pode ser suprimido, mas não roda no editor enquanto você digita.

**Duas exceções documentadas**, ambas raízes de composição:

- arquivos `*.test.ts`, que montam casos de uso com adaptadores falsos;
- `src/config/composition/`, que os monta com os reais.

As duas ficam livres de R3, R5 e R6 — a segunda de forma estreita, só para
`infrastructure` — e continuam sujeitas a R1, R2, R4 e R8. Detalhe em
`dependency-rules.md`.

## 7. Tipagem

Além de `strict`, o projeto liga `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noUnusedLocals` e `noUnusedParameters`.

`noUncheckedIndexedAccess` merece destaque: o motor de métricas vai indexar
arrays ordenados para achar mediana e percentil. `sorted[mid]` é
`number | undefined`, e o compilador obriga a tratar o array vazio — exatamente o
caso em que a implementação ingênua devolveria `NaN` ou `0`, violando a RN-08.

## 8. Estratégia futura para filas e workers

**Ainda não implementada, e deliberadamente.** Uma fila resolve um problema que
o produto ainda não tem.

O gatilho é objetivo: quando a coleta deixar de caber com folga no tempo de uma
requisição HTTP, ou quando análises em lote entrarem no escopo.

Quando chegar a hora, o caminho já está preparado:

1. `StartChannelAnalysis` passa a **enfileirar** e devolver a análise em
   `pending`, em vez de executar as etapas em linha.
2. Um worker consome a fila e executa os mesmos casos de uso — **o mesmo código
   de `application`**, com os mesmos adaptadores. Nenhuma regra é reescrita.
3. A interface acompanha por polling do estado, que já é persistido a cada etapa.
4. O worker roda no mesmo repositório e no mesmo deploy. Fila não é microserviço.

Nada disso exige mudar `domain` ou `application` — é essa a razão de as etapas
já gravarem estado hoje, mesmo sem fila.
