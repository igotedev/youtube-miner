@AGENTS.md

# YouTube Niche Miner — instruções do projeto

> Documento permanente. Leia antes de escrever código neste repositório.
>
> `AGENTS.md`, referenciado acima, é gerado e mantido pelo `next dev` e traz as
> notas da versão do Next.js instalada. Não o edite manualmente.

## 1. O produto

SaaS para **encontrar, analisar e comparar canais do YouTube**. O usuário informa
a URL de um canal e recebe uma leitura estruturada dos dados públicos daquele
canal e dos seus vídeos recentes: média e mediana de visualizações, frequência
de postagem, vídeos fora da curva, distribuição entre Shorts e longos, e um
relatório textual gerado por IA.

**Estado atual: produto funcional de ponta a ponta, com conta e dados reais.** O
usuário entra por link de e-mail, informa a URL de um canal, e a análise executa
— URL → referência normalizada → coleta na YouTube Data API → métricas → estado
terminal — **gravando tudo no PostgreSQL**. As análises sobrevivem ao reinício do
servidor.

`/historico` lista as análises anteriores do usuário e `/analise/[id]` reabre
qualquer uma delas, sem recoletar nada e sem gastar quota.

O relatório de IA existe (SPEC-011): a análise chega a `completed` com uma
leitura textual gerada pelo Gemini, exibida separada dos números. Sem
`GEMINI_API_KEY` o texto é um exemplo que se anuncia como tal.

O que ainda **não** existe: watchlists — a nona capacidade do MVP.

**Duas exigências de configuração, com naturezas diferentes:**

- **Supabase é obrigatório.** Sem ele a aplicação **falha**, nomeando a variável
  que falta. Não há modo em memória nem sessão de demonstração: uma sessão falsa
  escolhida por engano faria de todos os visitantes o mesmo usuário, e nada na
  tela denunciaria (SPEC-009, seção 6).
- **`YOUTUBE_API_KEY` e `GEMINI_API_KEY` são opcionais.** Sem elas, coleta e
  relatório usam fixtures e a tela declara isso. Um fixture visível não engana
  ninguém.

**Custo de quota é restrição de projeto** (SPEC-007): uma análise gasta 3
unidades de 10.000 diárias. `search.list` custa 100 e não pode ser usada.

### Três regras de produto que não se negociam

1. **Nada promete sucesso.** Nenhum texto pode sugerir que seguir um padrão
   observado produzirá resultado.
2. **Estimativa nunca é apresentada como dado oficial.** Dado coletado, cálculo
   do sistema e texto de IA são coisas distintas e devem parecer distintas.
3. **Dado indisponível não vira zero.** `null` com contexto, nunca `0` mudo.
   Um canal com inscrições ocultas não tem zero inscritos.

## 2. Arquitetura

**Monólito modular** (ADR-001). Uma aplicação Next.js, seis módulos de negócio,
fronteiras verificadas automaticamente.

```
src/
├─ app/            presentation — páginas e rotas (Next.js App Router)
├─ config/         env.ts (schema Zod) + composition/ (raiz de composição)
├─ shared/         domain · errors · validation · observability · infrastructure
└─ modules/
   ├─ identity/            autenticação, usuário, sessão, permissões
   ├─ youtube-collection/  URL → ID oficial, coleta, quota, cache
   ├─ channel-analysis/    orquestra a análise e registra o estado
   ├─ video-analytics/     métricas objetivas e determinísticas
   ├─ ai-insights/         relatório textual gerado por IA
   └─ watchlists/          listas de canais salvos
```

Cada módulo separa `domain`, `application`, `infrastructure` e `presentation`
**quando faz sentido** — não crie pasta vazia por simetria.

| Camada           | Contém                                                               | Nunca contém                                                |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `domain`         | entidades, objetos de valor, regras, funções puras, erros de domínio | React, Next, SDKs, I/O                                      |
| `application`    | casos de uso, comandos, consultas, DTOs, **portas**                  | implementação concreta de dependência externa               |
| `infrastructure` | adaptadores: Supabase, YouTube, Gemini, cache, log                   | regra de negócio                                            |
| `presentation`   | páginas, componentes, rotas, Server Actions, validação de entrada    | regra de negócio, chamada a API externa, `new` de adaptador |

Leia `docs/architecture/overview.md` antes de mexer na estrutura.

## 3. Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm run build        # build de produção
npm start            # servir o build

npm run verify       # typecheck + lint + testes  ← rode antes de considerar pronto
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint, inclui as regras de fronteira
npm run lint:fix
npm test             # Vitest, uma passada
npm run test:watch
npm run test:integration  # testes contra o Supabase local — exige Docker, fora do verify
npm run format       # Prettier
npm run format:check
```

## 4. Regras de dependência

Os IDs R1–R10 estão em `docs/architecture/dependency-rules.md`. Resumo:

- **R1/R2** — `domain` e `application` não importam React, Next ou SDKs externos.
- **R3** — camadas internas não importam `infrastructure`. A dependência se
  inverte: `infrastructure` implementa as portas.
- **R4** — `domain` e `application` não importam `presentation`.
- **R5** — módulos só se alcançam pelo barrel `@/modules/<nome>`. Dentro do
  próprio módulo, caminhos relativos.
- **R6** — `presentation` não instancia adaptadores. A montagem é em
  `src/config/composition/`.
- **R7** — um módulo não acessa tabelas de outro. Só o contrato exposto.
- **R8** — só `src/config/` e `shared/infrastructure/` leem `process.env`.
- **R9** — `domain` e `application` não leem o relógio nem usam aleatoriedade.
  `new Date()` sem argumento, `Date.now()` e `Math.random()` são proibidos, e a
  regra vale também em teste. O instante chega por parâmetro ou pela porta `Clock`.
- **R10** — o grafo de módulos é acíclico **em tempo de execução**. Só imports de
  valor contam: `import type` some na compilação. A única exceção é o ciclo de
  tipos entre `channel-analysis` e `ai-insights` (SPEC-011, seção 5), mantido
  inofensivo pela invariante de que o barrel de `ai-insights` **exporta apenas
  tipos** — e as duas coisas são verificadas.

Verificadas por duas redes independentes, ambas em `npm run verify`:
`eslint.config.mjs` e `tests/architecture/dependency-rules.test.ts`.

**Nunca use `eslint-disable` para contornar uma delas.** Se a regra atrapalha um
caso legítimo, ou o desenho está errado, ou a exceção precisa ser explícita e
documentada — como as duas que existem: arquivos de teste e
`src/config/composition/`, ambas raízes de composição.

**Mudou uma regra? Mude nos três lugares:** o documento, o ESLint e o teste.

## 5. Padrões de nomes

| O quê                      | Padrão                                       | Exemplo                                  |
| -------------------------- | -------------------------------------------- | ---------------------------------------- |
| Arquivos e pastas          | `kebab-case`                                 | `start-channel-analysis.ts`              |
| Tipos, interfaces, classes | `PascalCase`                                 | `ChannelMetrics`, `YouTubeChannelSource` |
| Funções e variáveis        | `camelCase`                                  | `classifyOutlier`                        |
| Constantes de módulo       | `SCREAMING_SNAKE_CASE`                       | `OUTLIER_THRESHOLDS`                     |
| Casos de uso               | verbo no imperativo                          | `StartChannelAnalysis`                   |
| Portas                     | substantivo do papel, sem sufixo `Interface` | `AnalysisRepository`                     |
| Adaptadores                | tecnologia + papel                           | `SupabaseAnalysisRepository`             |
| Testes                     | `<arquivo>.test.ts`, ao lado do código       | `analysis-status.test.ts`                |
| Barrel de módulo           | `src/modules/<nome>/index.ts`                | —                                        |

Identificadores de código em **inglês**. Documentação e comentários em
**português**.

## 6. Como adicionar uma funcionalidade

1. **Existe uma SPEC?** Se não, escreva antes em `docs/specs/`. Não implemente
   funcionalidade que nenhum documento descreve.
2. **Muda uma decisão arquitetural?** Escreva um ADR em `docs/adr/` primeiro.
3. **`domain`** — modele os tipos e as regras puras. Escreva o teste junto.
4. **`application`** — declare as portas necessárias e escreva o caso de uso.
   Dependências entram pelo construtor, sempre.
5. **`infrastructure`** — implemente os adaptadores. Valide a resposta externa
   com Zod e traduza para tipos de domínio. Traduza erros para `AppError`.
6. **`presentation`** — página ou rota que valida a entrada com Zod e chama o
   caso de uso.
7. **`src/config/composition/`** — monte o caso de uso com os adaptadores reais.
8. **`npm run verify`** — só está pronto quando passa.
9. Se a funcionalidade ancora uma regra de negócio da SPEC-001, atualize a
   tabela "onde cada regra está ancorada no código".

### Ordem que não funciona

Não comece pela tela. Uma tela construída antes do caso de uso arrasta regra de
negócio para dentro do componente, e daí ela não sai mais.

## 7. Testes

| Tipo          | Onde                           | Executor                  |
| ------------- | ------------------------------ | ------------------------- |
| Unitário      | ao lado do código, `*.test.ts` | Vitest                    |
| Arquitetural  | `tests/architecture/`          | Vitest                    |
| Integração    | `tests/integration/`           | Vitest                    |
| Ponta a ponta | `tests/e2e/`                   | Playwright (etapa futura) |

Regras:

- **Toda função pura de `domain` tem teste.** Média, mediana, frequência e
  outlier são o núcleo do produto — se não estão testados, não estão prontos.
- **Tempo é injetado, nunca lido.** Nada chama `new Date()` fora de
  `shared/infrastructure/system-clock.ts`. Casos de uso recebem `Clock`.
- **Teste não acessa a rede.** Use os adaptadores falsos.
- Arquivos de teste são raízes de composição: podem montar casos de uso com
  fakes (livres de R3, R5, R6), mas continuam sujeitos a R1, R2, R4 e R8.
- Ao corrigir um defeito, escreva primeiro o teste que o reproduz.

## 8. Segredos

- **Nenhuma credencial no repositório.** `.env.example` só tem nomes e
  placeholders.
- **Nenhum segredo com prefixo `NEXT_PUBLIC_`.** Esse prefixo embute o valor no
  bundle do navegador. Só URL do Supabase e chave anon podem usá-lo.
- **`process.env` só em `src/config/` e `shared/infrastructure/`** (R8).
- **Nenhuma chamada a API externa a partir do navegador.** Toda integração parte
  do servidor.
- Não registre em log corpo bruto de resposta de terceiro, token ou credencial.

### Identidade (ADR-006)

- **`getUser()`, nunca `getSession()`.** `getSession()` devolve o conteúdo do
  cookie sem verificar assinatura, e cookie é dado enviado pelo cliente — um
  `user.id` forjado passaria. `getUser()` valida contra o servidor Auth. A regra
  vale para todo caminho que decide identidade.
- **Quem é o usuário vem da porta `AuthGateway`.** Nenhuma camada acima de
  `infrastructure` lê cookie.
- **`src/proxy.ts` não é fronteira de autorização.** Ele redireciona por
  conveniência de navegação. A verificação que vale acontece dentro de cada
  Server Action e de cada rota, junto do dado.
- **Não existe sessão de demonstração.** Sem Supabase configurado, a composição
  falha. Ver SPEC-009, seção 6.

## 9. Proibições

- **Não implemente o que não está em uma SPEC.** Fora do escopo do MVP:
  extensão Chrome, pagamentos, dashboard completo, pesquisa em massa,
  monitoramento diário, alertas, estimativa de receita ou RPM, geração de
  roteiros, app mobile, equipes, API pública, afiliados, marketplace, comparação
  de thumbnails.
- **Não use IA para cálculo determinístico.** Média, mediana, frequência,
  visualizações por dia e outlier são aritmética: funções puras em
  `video-analytics`. A IA recebe os números **prontos** e escreve sobre eles.
  Pedir um número a um LLM produz um valor plausível, não o valor certo — e não
  produz o mesmo duas vezes.
- **Não coloque regra de negócio em componente React.**
- **Não acesse API externa a partir de componente.**
- **Não adicione biblioteca sem justificar.** Registre o motivo no README e, se
  for decisão estrutural, em um ADR. Antes de instalar, verifique se a
  plataforma já resolve.
- **Não crie abstração sem segundo caso de uso.** Uma porta que nunca teve duas
  implementações é abstração especulativa.
- **Não misture métricas de Shorts com as de vídeos longos** (RN-06).
- **Não altere decisão arquitetural sem registrar um ADR.**

## 10. Documentos

| Arquivo                                                         | Para quê                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `docs/specs/SPEC-001-product-foundation.md`                     | visão, MVP, escopo, regras de negócio RN-01..RN-14, estados, riscos      |
| `docs/specs/SPEC-002-youtube-channel-reference.md`              | validação e normalização de referências de canal                         |
| `docs/specs/SPEC-003-video-analytics-engine.md`                 | motor de métricas: média, mediana, frequência, outliers                  |
| `docs/specs/SPEC-004-postgresql-persistence.md`                 | esquema, RLS, reuso de coletas, concorrência, idempotência               |
| `docs/specs/SPEC-005-analysis-metrics-persistence.md`           | cálculo e persistência das métricas; reuso do cálculo                    |
| `docs/specs/SPEC-006-composition-and-analysis-surface.md`       | raiz de composição, Server Action e primeira tela do pipeline            |
| `docs/specs/SPEC-007-youtube-data-api-adapter.md`               | integração real com a YouTube Data API; economia de quota                |
| `docs/specs/SPEC-008-collection-run-persistence.md`             | adaptador Supabase das coletas; conclusão transacional; permissões       |
| `docs/specs/SPEC-009-authentication-and-live-persistence.md`    | acesso por link de e-mail; persistência ligada na composição             |
| `docs/specs/SPEC-010-analysis-history.md`                       | histórico de análises; leitura no `ChannelDirectory`; teto sem paginação |
| `docs/specs/SPEC-011-ai-insight-report.md`                      | relatório de IA; saída estruturada; degradação sem chave                 |
| `docs/architecture/overview.md`                                 | camadas, fluxo da análise, limites, filas no futuro                      |
| `docs/architecture/dependency-rules.md`                         | regras R1–R10 e como verificá-las                                        |
| `docs/adr/ADR-001-modular-monolith.md`                          | por que monólito modular                                                 |
| `docs/adr/ADR-002-nextjs-fullstack.md`                          | por que Next.js nas duas pontas                                          |
| `docs/adr/ADR-003-postgresql-supabase.md`                       | por que PostgreSQL via Supabase                                          |
| `docs/adr/ADR-004-external-integrations.md`                     | por que integrações atrás de contratos                                   |
| `docs/adr/ADR-005-persistence-boundaries-and-analysis-reuse.md` | dado global × dado do usuário; service role                              |
| `docs/adr/ADR-006-cookie-session-with-supabase-auth.md`         | magic link; sessão em cookie; `getUser()`; onde a autorização mora       |
| `docs/adr/ADR-007-gemini-api-for-insight-reports.md`            | provedor do relatório; custo zero e o que a camada gratuita cobra        |

**Consulte a SPEC antes de implementar. Registre um ADR antes de mudar
arquitetura.** Documento desatualizado é pior que documento ausente — se o
código divergir do documento, corrija o documento na mesma mudança.
