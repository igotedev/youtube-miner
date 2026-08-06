# ADR-001 — Monólito modular

| Campo        | Valor            |
| ------------ | ---------------- |
| Status       | Aceita           |
| Data         | 2026-08-06       |
| Relacionadas | ADR-002, ADR-004 |

## Contexto

O YouTube Niche Miner começa sem usuários, sem tráfego medido e com um único
time. As responsabilidades já estão claras — coleta, análise, métricas, IA,
listas — e algumas delas terão perfis de carga bem diferentes: a coleta é
limitada por quota externa, o cálculo é puro CPU, a geração de relatório é lenta
e cara.

Essa diferença de perfis é o argumento clássico para separar serviços. A questão
é se ela justifica pagar o custo agora.

O risco oposto também é real: um monólito sem fronteiras internas vira, em
poucos meses, um emaranhado onde componente React chama API do YouTube
diretamente e regra de negócio mora em `useEffect`.

## Decisão

**Monólito modular.** Uma aplicação, um deploy, um banco — dividida internamente
em seis módulos de negócio com fronteiras explícitas e **verificadas
automaticamente** em `npm run verify`.

Cada módulo expõe um único ponto de entrada (`index.ts`) e é dono das suas
tabelas. Comunicação entre módulos acontece por contrato explícito, nunca por
acesso direto a implementação interna ou tabela alheia.

A verificação automática é parte da decisão, não um detalhe. Monólito modular
sem enforcement é apenas um monólito com boas intenções.

## Alternativas consideradas

### Microserviços desde o início

Um serviço por domínio, comunicando por HTTP ou fila.

Rejeitada. Compraria independência de deploy que ninguém pediu, e cobraria:
latência de rede em toda operação; observabilidade distribuída; consistência
eventual entre análise e listas; pipeline de deploy multiplicado; e a
necessidade de acertar as fronteiras **antes** de conhecer o domínio — o momento
em que se sabe menos sobre elas.

### Monólito em camadas técnicas (`controllers/`, `services/`, `models/`)

Rejeitada. Agrupa por tipo de arquivo, não por assunto. Uma mudança em
"análise de canal" toca três pastas distantes, e nada impede que
`services/analysis.ts` use `models/watchlist.ts` — não existe fronteira a violar,
porque não existe fronteira.

### Monólito modular sem verificação automática

Rejeitada. É a decisão escolhida, sem o que a torna sustentável. Regra que
depende de todo mundo lembrar sempre é regra que já foi violada em algum arquivo
que ninguém revisou.

## Consequências positivas

- Uma transação, um banco. Consistência sem esforço.
- Refatoração de fronteira é uma mudança local, não um contrato entre serviços.
- Depurar é ler uma pilha de chamadas, não correlacionar logs de três processos.
- Deploy único, custo de infraestrutura baixo.
- As fronteiras existem de verdade: violá-las quebra o build.
- Se um módulo precisar sair depois, ele já está isolado — a extração vira
  trabalho de infraestrutura, não arqueologia de código.

## Consequências negativas

- **Escala em bloco.** Não dá para dar mais CPU só ao cálculo de métricas.
  Aceitável: o gargalo previsto é a quota do YouTube, que é externa e não se
  resolve com mais instância.
- **Um deploy quebrado derruba tudo.** Mitigado por typecheck, lint e testes em
  `npm run verify`.
- **Disciplina é obrigatória.** Mitigado pelo enforcement automático.
- **A tentação do atalho continua existindo.** É exatamente isso que R5 e R7
  bloqueiam.

## Condições que justificariam extrair um serviço

Nenhuma delas é hipótese de trabalho hoje. Extração deve ser resposta a um
problema medido, não a uma expectativa.

1. **Carga assimétrica comprovada** — um módulo consome recurso
   desproporcional e o escalonamento conjunto ficou caro de forma mensurável.
2. **Ciclo de vida divergente** — um módulo precisa de cadência de deploy
   incompatível com o resto.
3. **Isolamento de falha necessário** — a instabilidade de uma integração
   externa passa a derrubar funcionalidades não relacionadas.
4. **Requisito de conformidade** — dado que precisa viver em outra jurisdição ou
   com outro nível de acesso.
5. **Time grande demais para um repositório** — problema organizacional, não
   técnico, mas legítimo.

O módulo mais provável de sair primeiro é `ai-insights`: latência alta, custo
por chamada e falha tolerável (RN-09) — já é o mais desacoplado do fluxo
síncrono.

**Antes de extrair qualquer coisa,** o passo intermediário é uma fila com worker
no mesmo repositório (ver `overview.md`, seção 8). Ela resolve a maior parte dos
casos 1 e 3 sem nenhum dos custos de um serviço separado.
