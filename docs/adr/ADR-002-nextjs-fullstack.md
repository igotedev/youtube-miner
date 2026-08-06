# ADR-002 — Next.js como frontend e backend

| Campo        | Valor            |
| ------------ | ---------------- |
| Status       | Aceita           |
| Data         | 2026-08-06       |
| Relacionadas | ADR-001, ADR-004 |

## Contexto

O produto precisa de interface web e de um backend. O backend é obrigatório por
uma razão de segurança, não de arquitetura: as chaves da YouTube Data API e da
Claude API **não podem** chegar ao navegador (RN-11). Toda chamada a terceiro
tem de partir do servidor.

Some-se a isso: análises são dados de leitura pesada e renderização no servidor
ajuda; o time é pequeno e uma stack única reduz atrito.

## Decisão

**Next.js com App Router**, servindo interface e backend no mesmo projeto.
React para a interface, Tailwind CSS para estilo, TypeScript em modo estrito.

O App Router é a escolha dentro do Next: Server Components permitem que a busca
de dados aconteça no servidor por padrão, o que empurra as chaves para o lado
certo da fronteira **por construção**, e não por lembrança.

Restrições que acompanham a decisão:

- Next.js é **presentation** e nada além disso. Rotas e páginas chamam casos de
  uso; não contêm regra de negócio.
- Nenhum arquivo em `domain` ou `application` importa `next` ou `react` — R1,
  verificada automaticamente. Se o Next for substituído um dia, o que muda é a
  camada mais externa.
- Server Actions só quando houver justificativa; do contrário, Route Handlers,
  cujo contrato de entrada e saída é explícito.
- Toda entrada de interface é validada com Zod antes de chegar a um caso de uso.

### Sobre a versão

`create-next-app` fixou **Next 16.3.0 com React 19.2.8 e TypeScript 5.x**.

TypeScript 7 (compilador nativo) já está publicado, mas o ecossistema de lint
ainda não o acompanha; o scaffold oficial mantém `^5` e a decisão é ficar nessa
faixa. Migrar para o TS 7 é assunto de um ADR próprio, quando
`eslint-config-next` e `typescript-eslint` o suportarem.

Uma consequência prática do Next 16: `next dev` gera e mantém `AGENTS.md`. O
`CLAUDE.md` do projeto o referencia com `@AGENTS.md` em vez de duplicar o
conteúdo.

## Alternativas consideradas

### SPA (Vite + React) com API separada (Fastify/Express)

Rejeitada. Separação mais nítida entre cliente e servidor, mas dois projetos,
dois deploys, dois pipelines e CORS para manter — sem ganho real, já que o
monólito modular (ADR-001) não quer essa separação de processo. A fronteira que
importa é entre camadas, e ela é obtida sem dois repositórios.

### Remix / TanStack Start

Rejeitada por maturidade de ecossistema e familiaridade, não por defeito
técnico. Nenhuma oferece vantagem decisiva para este caso.

### Next.js com Pages Router

Rejeitada. Estável e conhecido, mas sem Server Components. Buscar dados no
servidor deixa de ser o caminho natural e passa a ser algo que se lembra de
fazer — exatamente o tipo de decisão que a RN-11 não pode depender.

## Consequências positivas

- Uma linguagem, um repositório, um deploy.
- Server Components empurram a busca de dados para o servidor por padrão,
  favorecendo a RN-11.
- Route Handlers cobrem o backend sem framework adicional.
- Ecossistema maduro; deploy simples em qualquer provedor que rode Node.

## Consequências negativas

- **Acoplamento a um framework em evolução rápida.** Mitigado por R1: o
  acoplamento é confinado à camada de apresentação.
- **A fronteira servidor/cliente é sutil.** Um `'use client'` mal colocado
  arrasta código para o navegador. Mitigado por R8 (`process.env` restrito a
  `src/config/`) e pela guarda de runtime em `src/config/env.ts`.
- **Tempo de build cresce com o projeto.** Aceitável nesta escala.
- **`tsc --noEmit` isolado não conhece os tipos gerados pelo Next.** Por isso o
  layout raiz é tipado explicitamente, em vez de usar o global `LayoutProps` —
  assim `npm run typecheck` passa em um checkout limpo, antes de qualquer build.

## Condições que justificariam revisão

- A necessidade de expor uma API pública versionada (fora do escopo do MVP) —
  aí um backend dedicado passa a fazer sentido.
- Um requisito de runtime não-Node.
- Mudança de rumo do framework que quebre compatibilidade de forma inaceitável.
