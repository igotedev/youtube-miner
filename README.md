# YouTube Niche Miner

SaaS para **encontrar, analisar e comparar canais do YouTube**. O usuário informa
a URL de um canal e recebe uma leitura estruturada dos dados públicos daquele
canal e de seus vídeos recentes.

O valor não está no acesso ao dado — ele já é público. Está em transformar dados
dispersos em leitura útil: o que é normal para aquele canal, o que fugiu da
curva, com que frequência ele publica, quanto depende de um vídeo viral.

O produto **não promete sucesso**, **não apresenta estimativa como dado oficial**
e **não exibe dado indisponível como zero**.

---

## Estado atual

> **Funciona de ponta a ponta: você entra, analisa um canal real e o resultado
> fica guardado.**
>
> Entre em `/entrar` com o seu e-mail — chega um link de acesso, não há senha.
> Informe a URL de um canal em `/analise` e o pipeline coleta os vídeos recentes
> na YouTube Data API, calcula as métricas e **grava tudo no PostgreSQL**. As
> análises sobrevivem ao reinício do servidor.
>
> Falta o relatório de IA — por isso a análise termina em
> `partially_completed` — e a tela de histórico: a análise é persistida, mas
> `/analise` só mostra o resultado da execução recém-disparada.
>
> **O Supabase é obrigatório.** Sem ele a aplicação falha, dizendo qual variável
> falta. Não há modo em memória nem sessão de demonstração — ver a seção 6 da
> SPEC-009.
>
> Já `YOUTUBE_API_KEY` é opcional: sem ela a coleta usa dados de exemplo e a tela
> diz isso.

O que existe:

- ✅ Projeto Next.js 16 com App Router, TypeScript estrito, Tailwind 4 e ESLint
- ✅ Seis módulos de negócio com fronteiras verificadas automaticamente
- ✅ Contratos (portas) para YouTube, Claude, persistência e autenticação
- ✅ Um fluxo vertical executável com adaptadores falsos, provando a arquitetura
- ✅ Os oito estados de uma análise, definidos e testados
- ✅ **Validação e normalização de referências de canal** (SPEC-002): função pura
  que reconhece ID oficial, handle, `/c/` e `/user/`, e recusa vídeo, Shorts,
  playlist, busca e domínio não autorizado — tudo offline
- ✅ **Motor de métricas** (SPEC-003): média, mediana, visualizações por dia,
  frequência de publicação e classificação de outliers — puro, determinístico,
  com Shorts e vídeos longos rigorosamente separados
- ✅ **Esquema PostgreSQL** (SPEC-004): 10 tabelas com RLS, separação entre dado
  global e do usuário, reuso de coletas (RN-10), proteção de concorrência e
  idempotência — **migração aplicada e 108 asserções pgTAP passando**
- ✅ Mapeadores de persistência validados: `bigint`, datas, estados e JSON de
  métricas, com recusa de linha corrompida
- ✅ **Pipeline de análise fechado** (SPEC-005): da URL até as métricas
  persistidas, com reuso de coleta e de cálculo entre usuários — verificado
  ponta a ponta com adaptadores em memória
- ✅ **Raiz de composição e tela `/analise`** (SPEC-006): Server Action que valida
  a entrada com Zod, executa o pipeline e apresenta Shorts e vídeos longos
  separados, com ausência exibida como "indisponível" e nunca como `0`
- ✅ **Integração real com a YouTube Data API v3** (SPEC-007): resolve handle,
  `/user/` e `/c/` para o ID oficial, coleta canal e vídeos recentes, e gasta
  **3 unidades de quota por análise** — `search.list`, que custa 100, não é
  usada em caminho algum
- ✅ **Adaptador Supabase das coletas** (SPEC-008): grava e lê execuções de
  coleta no Postgres real, conclui em **uma transação** e de forma idempotente —
  **21 testes de integração** contra o banco de verdade
- ✅ **Acesso por link de e-mail** (SPEC-009): sem senha em lugar nenhum, cadastro
  e login no mesmo ato, e a tela não revela quem tem conta. Autorização
  verificada em três camadas independentes — e o proxy **não** é uma delas
- ✅ **Persistência ligada de verdade** (SPEC-009): a análise é gravada no
  PostgreSQL e sobrevive ao reinício. Verificado derrubando o processo
- ✅ SPEC-001 a SPEC-009, seis ADRs e documentos de arquitetura

O que **não** existe:

- ❌ **Histórico na tela** — a análise fica guardada, mas `/analise` só mostra o
  resultado da execução recém-disparada. O dado está lá; falta a tela que o busca
- ❌ Relatório de IA — por isso a análise termina em `partially_completed`
- ❌ Login com Google — adiado com motivo registrado no ADR-006
- ❌ Mais de 50 vídeos por análise; dados privados do canal (exigiria OAuth)
- ❌ Extensão Chrome, pagamentos, dashboard

## Stack

| Camada             | Tecnologia                 |
| ------------------ | -------------------------- |
| Framework          | Next.js 16 (App Router)    |
| Linguagem          | TypeScript 5, modo estrito |
| Interface          | React 19, Tailwind CSS 4   |
| Validação          | Zod 4                      |
| Testes             | Vitest 4                   |
| Banco              | PostgreSQL via Supabase    |
| Autenticação       | Supabase Auth (magic link) |
| Dados              | YouTube Data API v3        |
| IA (planejada)     | Claude API                 |
| E2E (etapa futura) | Playwright                 |

### Dependências instaladas e por quê

| Pacote                                | Tipo | Justificativa                                                                                                                                                                                                                                    |
| ------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `next`, `react`, `react-dom`          | prod | Framework e interface (ADR-002)                                                                                                                                                                                                                  |
| `@supabase/supabase-js`               | prod | Cliente oficial do PostgreSQL/Supabase (ADR-003). Usado **apenas** em `infrastructure`; R2 impede que alcance domain/application                                                                                                                 |
| `@supabase/ssr`                       | prod | Sessão por cookie no App Router (ADR-006). O `supabase-js` guarda a sessão no `localStorage`, que não existe no servidor — e a análise roda no servidor por obrigação. Escrever à mão significaria reimplementar PKCE e rotação de refresh token |
| `zod`                                 | prod | Valida entrada de UI **e** resposta de API externa antes de virar tipo de domínio. Único validador; sem duplicar responsabilidade                                                                                                                |
| `typescript`, `@types/*`              | dev  | Tipagem estrita                                                                                                                                                                                                                                  |
| `tailwindcss`, `@tailwindcss/postcss` | dev  | Estilo                                                                                                                                                                                                                                           |
| `eslint`, `eslint-config-next`        | dev  | Lint e base para as regras de fronteira                                                                                                                                                                                                          |
| `prettier`                            | dev  | Formatação consistente                                                                                                                                                                                                                           |
| `vitest`                              | dev  | Testes unitários e arquiteturais                                                                                                                                                                                                                 |

**Deliberadamente ausentes:** `googleapis` e `@anthropic-ai/sdk` — nenhuma dessas
integrações foi iniciada; Playwright, adiado para etapa futura;
`eslint-plugin-boundaries`, porque `no-restricted-imports` já é nativo do ESLint;
o **Supabase CLI como dependência**, porque exige Docker para funcionar — os
scripts `db:*` o baixam sob demanda via `npx`; e **qualquer ORM** (Prisma,
Drizzle, TypeORM), que exigiria ADR próprio contra a decisão de migrations SQL
explícitas do ADR-003.

## Requisitos locais

- **Node.js 22.13 ou superior** (ou 20.19+). O `eslint-visitor-keys` exige
  22.13+; em 22.12 o `npm install` emite `EBADENGINE` mas o projeto funciona.
- npm 10+
- Git

## Instalação

```bash
git clone <url-do-repositorio>
cd minerador-youtube
npm install

npm run db:start             # sobe o Supabase local (exige Docker)
cp .env.example .env.local   # preencha com o que `db:start` imprimiu

npm run verify               # confirma que a fundação está íntegra
npm run dev                  # http://localhost:3000
```

Em desenvolvimento, o link de acesso **não é enviado de verdade**: ele aparece na
caixa de entrada local em `http://localhost:54324`.

## Variáveis de ambiente

Schema completo em `src/config/env.ts`.

| Variável                        | Obrigatória? | Segredo? | Para quê                               |
| ------------------------------- | :----------: | :------: | -------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      |   **sim**    |   não    | Endpoint do projeto Supabase           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` |   **sim**    |   não    | Chave pública, protegida por RLS       |
| `SUPABASE_SERVICE_ROLE_KEY`     |   **sim**    | **sim**  | Acesso administrativo — **ignora RLS** |
| `APP_URL`                       |     não      |   não    | URL base; destino do link de acesso    |
| `YOUTUBE_API_KEY`               |     não      | **sim**  | YouTube Data API v3                    |
| `YOUTUBE_DAILY_QUOTA_LIMIT`     |     não      |   não    | Teto diário de unidades de quota       |
| `ANTHROPIC_API_KEY`             |     não      | **sim**  | Claude API                             |
| `ANTHROPIC_MODEL`               |     não      |   não    | Modelo usado nos relatórios            |
| `AI_MAX_OUTPUT_TOKENS`          |     não      |   não    | Teto de tokens por relatório           |
| `ANALYSIS_FRESHNESS_HOURS`      |     não      |   não    | Janela de reuso de análise (RN-10)     |

> **As três do Supabase são obrigatórias e a aplicação falha sem elas**, nomeando
> a que falta. Não há modo em memória nem sessão de demonstração: uma sessão
> falsa escolhida por engano faria de todos os visitantes o mesmo usuário, e nada
> na tela denunciaria. Ver a seção 6 da SPEC-009.
>
> Em produção, `APP_URL` **precisa** ser a URL real — o link do e-mail aponta
> para ela, e um valor de desenvolvimento mandaria o usuário para `localhost`.

> **Segredo nunca usa o prefixo `NEXT_PUBLIC_`** — esse prefixo embute o valor no
> bundle do navegador. `src/config/env.ts` lança se for importado no cliente, e
> a regra R8 impede leitura de `process.env` fora de `src/config/`.

## Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm run build        # build de produção
npm start            # servir o build

npm run verify       # typecheck + lint + testes  ← o comando que importa
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint, inclui as regras de fronteira
npm run lint:fix
npm test             # Vitest, uma passada
npm run test:watch
npm run format       # Prettier
npm run format:check

# Banco local — exigem Docker e Supabase CLI (baixado sob demanda por npx)
npm run db:start     # sobe o Supabase local
npm run db:reset     # aplica migrations + seed em banco limpo
npm run db:test      # testes pgTAP de supabase/tests/database/
npm run db:types     # gera os tipos TypeScript a partir do banco local
npm run db:stop
npm run test:integration   # adaptadores contra o banco local, com cliente real
```

> `npm run verify` **não** depende do banco: a verificação de rotina não exige
> Docker. Os testes de banco têm comando próprio.

## Arquitetura resumida

**Monólito modular** (ADR-001): uma aplicação, um deploy, seis módulos de
negócio com fronteiras verificadas em CI.

```
presentation  →  application  →  domain
                      ↑
              infrastructure         (a dependência se inverte)
```

`infrastructure` implementa as portas que `application` declara. O domínio não
sabe que Supabase, YouTube ou Claude existem — trocar qualquer um deles é
escrever outro adaptador, sem tocar em regra de negócio.

As regras de dependência (R1–R9) não são só documentação: rodam em
`npm run verify`, por duas redes independentes — `eslint.config.mjs` e
`tests/architecture/dependency-rules.test.ts`.

Detalhes em `docs/architecture/overview.md`.

## Estrutura de pastas

```
.
├─ docs/
│  ├─ specs/          SPEC-001 — visão, MVP, regras de negócio, riscos
│  ├─ adr/            ADR-001..004 — decisões arquiteturais
│  ├─ architecture/   overview.md e dependency-rules.md
│  └─ api/            contratos HTTP (vazio nesta etapa)
├─ src/
│  ├─ app/            páginas e rotas (Next.js App Router)
│  ├─ config/         env.ts (schema Zod) + composition/ (raiz de composição)
│  ├─ shared/         domain · errors · validation · observability · infrastructure
│  └─ modules/
│     ├─ identity/            autenticação, usuário, sessão
│     ├─ youtube-collection/  URL → ID oficial, coleta, quota, cache
│     ├─ channel-analysis/    orquestra a análise e registra o estado
│     ├─ video-analytics/     métricas objetivas e determinísticas
│     ├─ ai-insights/         relatório textual gerado por IA
│     └─ watchlists/          listas de canais salvos
├─ supabase/
│  ├─ migrations/     vazio — esquema virá em SPEC própria
│  └─ seed.sql
├─ tests/
│  ├─ architecture/   verificação executável das regras R1–R9
│  ├─ integration/    vazio
│  └─ e2e/            vazio — Playwright em etapa futura
├─ CLAUDE.md          instruções permanentes do projeto
└─ AGENTS.md          notas da versão do Next.js (gerado por `next dev`)
```

Testes unitários ficam **ao lado do código** (`*.test.ts`), não em `tests/`.
Função pura e o teste dela devem viver juntos.

## Como implementar uma nova funcionalidade

1. **Existe uma SPEC?** Se não, escreva antes em `docs/specs/`. Não se implementa
   o que nenhum documento descreve.
2. **Muda uma decisão arquitetural?** Escreva um ADR em `docs/adr/` primeiro.
3. **`domain`** — modele os tipos e as regras puras, com teste junto.
4. **`application`** — declare as portas e escreva o caso de uso. Dependências
   entram pelo construtor.
5. **`infrastructure`** — implemente os adaptadores. Valide a resposta externa
   com Zod e traduza erros para `AppError`.
6. **`presentation`** — página ou rota que valida a entrada e chama o caso de uso.
7. **`src/config/composition/`** — monte o caso de uso com os adaptadores reais.
8. **`npm run verify`** — só está pronto quando passa.

Não comece pela tela: uma tela construída antes do caso de uso arrasta regra de
negócio para dentro do componente, e de lá ela não sai mais.

Detalhes e proibições em `CLAUDE.md`.

## Documentação

| Documento                                                                | Conteúdo                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| [SPEC-001](docs/specs/SPEC-001-product-foundation.md)                    | Visão, MVP, escopo, regras RN-01..RN-14, estados, riscos |
| [SPEC-002](docs/specs/SPEC-002-youtube-channel-reference.md)             | Validação e normalização de referências de canal         |
| [SPEC-003](docs/specs/SPEC-003-video-analytics-engine.md)                | Motor de métricas de vídeos e canais                     |
| [SPEC-004](docs/specs/SPEC-004-postgresql-persistence.md)                | Persistência, snapshots e reuso de análises              |
| [SPEC-005](docs/specs/SPEC-005-analysis-metrics-persistence.md)          | Cálculo e persistência das métricas da análise           |
| [SPEC-006](docs/specs/SPEC-006-composition-and-analysis-surface.md)      | Raiz de composição, Server Action e tela de análise      |
| [SPEC-007](docs/specs/SPEC-007-youtube-data-api-adapter.md)              | Integração com a YouTube Data API e economia de quota    |
| [SPEC-008](docs/specs/SPEC-008-collection-run-persistence.md)            | Adaptador Supabase das coletas e conclusão transacional  |
| [SPEC-009](docs/specs/SPEC-009-authentication-and-live-persistence.md)   | Acesso por link de e-mail e persistência ligada          |
| [Visão da arquitetura](docs/architecture/overview.md)                    | Camadas, fluxo da análise, limites, filas no futuro      |
| [Regras de dependência](docs/architecture/dependency-rules.md)           | R1–R9 e como são verificadas                             |
| [ADR-001](docs/adr/ADR-001-modular-monolith.md)                          | Monólito modular                                         |
| [ADR-002](docs/adr/ADR-002-nextjs-fullstack.md)                          | Next.js nas duas pontas                                  |
| [ADR-003](docs/adr/ADR-003-postgresql-supabase.md)                       | PostgreSQL via Supabase                                  |
| [ADR-004](docs/adr/ADR-004-external-integrations.md)                     | Integrações atrás de contratos                           |
| [ADR-005](docs/adr/ADR-005-persistence-boundaries-and-analysis-reuse.md) | Fronteiras de persistência e reuso de análises           |
| [ADR-006](docs/adr/ADR-006-cookie-session-with-supabase-auth.md)         | Sessão por cookie, magic link e onde a autorização mora  |
