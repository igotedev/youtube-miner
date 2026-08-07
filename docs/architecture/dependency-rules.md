# Regras de dependência

Este documento é a **fonte da verdade em prosa**. Suas regras são verificadas
por duas implementações que precisam concordar com ele e entre si:

- `eslint.config.mjs` — casa o texto do import;
- `tests/architecture/dependency-rules.test.ts` — resolve o import para um
  caminho real no disco.

Ambas rodam em `npm run verify`. **Mudou uma regra aqui, mude as duas.**

---

## Tabela de regras

| ID     | Regra                                                                                 | ESLint | Teste |
| ------ | ------------------------------------------------------------------------------------- | :----: | :---: |
| **R1** | `domain` e `application` não importam React nem Next.js                               |   ✅   |  ✅   |
| **R2** | `domain` e `application` não importam SDKs externos (Supabase, Anthropic, googleapis) |   ✅   |  ✅   |
| **R3** | Camadas internas não importam `infrastructure`                                        |   ✅   |  ✅   |
| **R4** | `domain` e `application` não importam `presentation`                                  |   ✅   |  ✅   |
| **R5** | Módulos só se alcançam pelo barrel público `@/modules/<nome>` ¹                       |   ✅   |  ✅   |
| **R6** | `presentation` não importa `infrastructure` ¹                                         |   ✅   |  ✅   |
| **R7** | Um módulo não acessa tabelas de outro módulo                                          |   ❌   |  ❌   |
| **R8** | Apenas `src/config/` e `shared/infrastructure/` leem `process.env`                    |   ❌   |  ✅   |
| **R9** | `domain` e `application` não acessam relógio nem aleatoriedade                        |   ✅   |  ✅   |

¹ Duas exceções documentadas, ambas raízes de composição: arquivos de teste e
`src/config/composition/`. Ver as seções ao fim deste documento.

R7 depende de SQL, que nenhuma das duas redes lê. Ela é garantida por revisão e
pela consequência de R5: sem acesso ao repositório de outro módulo, não há como
montar a consulta. Quando as migrações existirem, Row Level Security e
`grant`/`revoke` por schema passam a sustentá-la no próprio banco.

---

## R1 e R2 — camadas internas não conhecem framework nem SDK

**Proibido em `domain` e `application`:** `react`, `react-dom`, `next` e
subcaminhos, `server-only`, `client-only`, `@supabase/*`, `@anthropic-ai/*`,
`googleapis`, `google-auth-library`.

**Por quê.** Uma regra de negócio acoplada ao React só roda dentro de um
componente; uma acoplada ao SDK do Supabase só roda com banco. As duas deixam de
ser testáveis em Node puro — e é essa testabilidade que sustenta a RN-13.

**Como fazer certo.** Declare uma porta em `application/ports/` e implemente o
adaptador em `infrastructure/`.

```ts
// ❌ src/modules/youtube-collection/application/collect.ts
import { google } from 'googleapis';

// ✅ src/modules/youtube-collection/application/ports/youtube-channel-source.ts
export interface YouTubeChannelSource {
  fetchChannel(channelId: YouTubeChannelId): Promise<YouTubeChannel>;
}
```

**Nota:** `zod` **é permitido** em qualquer camada. É uma biblioteca pura, sem
I/O e sem dependência de runtime — objetos de valor podem legitimamente validar
a si mesmos com ela.

## R3 — a dependência se inverte

`domain` e `application` nunca importam de `infrastructure`, nem por caminho
relativo. É `infrastructure` que importa as portas e as implementa.

```ts
// ❌ application/use-cases/x.ts
import { SupabaseAnalysisRepository } from '../../infrastructure/supabase/analysis-repository';

// ✅ application/use-cases/x.ts
import type { AnalysisRepository } from '../ports/analysis-repository';
// o adaptador concreto entra pelo construtor
```

O ESLint sozinho não fecha essa porta: ele casa texto, e um caminho relativo
criativo escapa. Por isso o teste de arquitetura resolve o import até o arquivo
real antes de julgar.

## R4 — camadas internas não conhecem a interface

Se um caso de uso precisa de algo de `presentation`, esse algo estava na camada
errada. Mova para `application` ou `domain`.

## R5 — módulos só se alcançam pelo barrel

```ts
// ❌
import { StartChannelAnalysis } from '@/modules/channel-analysis/application/use-cases/start-channel-analysis';

// ✅
import { StartChannelAnalysis } from '@/modules/channel-analysis';
```

Dentro do próprio módulo, **use caminhos relativos**. O barrel é a fronteira com
o mundo externo, não um atalho interno — usá-lo internamente cria ciclos de
importação e esconde qual é a superfície pública de verdade.

**Por quê.** O que está no `index.ts` é contrato: mudar aquilo quebra outros
módulos, e você sabe disso ao editar o arquivo. O que está fora dele é livre
para refatorar. Sem essa linha, todo detalhe interno vira contrato por acidente.

O grafo de dependência entre módulos deve permanecer **acíclico** (ver
`overview.md`, seção 5).

## R6 — presentation não instancia adaptadores

Uma página, rota ou componente chama um **caso de uso**. Não constrói cliente
Supabase, não monta requisição HTTP, não lê `process.env`.

A montagem acontece em `src/config/composition/` — a raiz de composição, único
lugar da aplicação autorizado a importar `infrastructure` e conhecer os dois
lados ao mesmo tempo.

Consequência prática: nenhum componente React contém regra de negócio ou chamada
a API externa, o que atende diretamente às restrições da especificação.

## R7 — cada módulo é dono das suas tabelas

`watchlists` não faz `select` na tabela de análises. Ele pede ao
`channel-analysis`, pelo contrato que aquele módulo expõe.

**Por quê.** Compartilhar tabela é compartilhar esquema: a partir daí, qualquer
migração de um módulo pode quebrar outro em silêncio, e a fronteira que o código
declara deixa de existir no banco.

## R8 — segredos entram por um único lugar

`process.env` só pode ser lido em `src/config/` e `shared/infrastructure/`. Todo
o resto recebe configuração já validada.

**Por quê.** `process.env.X` espalhado é como uma chave acaba referenciada em um
componente de cliente e embutida no bundle. Um ponto de entrada torna auditável
o que é segredo e o que é público — RN-11 e ADR-004.

`src/config/env.ts` lança se for importado no navegador, e nenhum segredo usa o
prefixo `NEXT_PUBLIC_`.

## R9 — camadas internas não leem o relógio

Proibido em `domain` e `application`: `new Date()` **sem argumento**,
`Date.now()`, `Math.random()`, `performance.now()`.

```ts
// ❌ domain/calculate-channel-metrics.ts
const ageInDays = (Date.now() - publishedAt.getTime()) / MS_PER_DAY;

// ✅ o instante chega por parâmetro
function calculateChannelMetrics({ videos, collectedAt }: Input) { … }
```

**Por quê.** RN-13 exige que a mesma entrada produza sempre a mesma saída. Uma
única chamada de relógio dentro de `domain` quebra isso **sem que nenhum teste
necessariamente falhe** — o resultado continua parecendo plausível, só muda a
cada execução. É o tipo de defeito que só aparece quando dois usuários comparam
relatórios do mesmo canal e veem números diferentes.

`new Date(valor)` **com** argumento continua permitido: é construção pura. A
única implementação autorizada a ler o relógio é
`shared/infrastructure/system-clock.ts`, atrás da porta `Clock`.

Esta regra vale **inclusive para arquivos de teste**, e sem exceção: um teste que
depende de "agora" é um teste que falha sozinho um dia. Fixe a data.

---

## Exceção: arquivos de teste

Arquivos `*.test.ts` e `*.spec.ts` são **raízes de composição**: montam casos de
uso com adaptadores falsos, exatamente como `src/config/composition/` fará com os
reais. Estão liberados de **R3, R5 e R6**.

Continuam sujeitos a **R1, R2, R4, R8 e R9**: um teste de domínio que importe
React, leia `process.env` ou chame `new Date()` continua sendo violação.

A exceção está codificada nos dois lugares — `TEST_FILES` no ESLint e `isTest`
no teste de arquitetura.

## Exceção: a raiz de composição

`src/config/composition/` é a **outra** raiz de composição, e a única no código
de produção. Monta os casos de uso com adaptadores concretos, e para isso precisa
alcançar `infrastructure` — que os barrels não reexportam de propósito:
adaptador não é contrato público de módulo.

A exceção é **estreita**: libera apenas `infrastructure`. O `domain` e o
`application` de outro módulo continuam vindo do barrel público.

```ts
// ✅ permitido apenas aqui
import { InMemoryAnalysisRepository } from '@/modules/channel-analysis/infrastructure/memory/in-memory-analysis-repository';

// ❌ continua proibido, mesmo na raiz de composição
import { OUTLIER_THRESHOLDS } from '@/modules/video-analytics/domain/outlier';
```

Sem essa exceção, a alternativa seria reexportar adaptadores nos barrels — e aí
qualquer arquivo do projeto poderia instanciar um cliente Supabase, que é
exatamente o que R6 existe para impedir.

Codificada no bloco `niche-miner/composition-root` do ESLint e em
`isCompositionRoot` no teste de arquitetura. O teste ainda faz uma afirmação
**positiva** complementar: nenhum arquivo de produção fora da raiz de composição
importa `infrastructure`. R3 e R6 dizem quem não pode; essa diz quem pode, e a
lista tem um item.

---

## Como verificar

```bash
npm run verify     # typecheck + lint + testes
npm run lint       # só as fronteiras verificáveis por lint
npm test           # só as verificáveis por teste
```

Toda violação nomeia o arquivo, o import e o ID da regra:

```
R3 — src/modules/channel-analysis/application/use-cases/x.ts importa "../../infrastructure/y"
```

## Como mudar uma regra

Regra de dependência é decisão arquitetural. Para mudar uma:

1. Escreva um ADR em `docs/adr/` com contexto, decisão e consequências.
2. Atualize a tabela deste documento.
3. Atualize `eslint.config.mjs` **e** `tests/architecture/dependency-rules.test.ts`.
4. Rode `npm run verify`.

Nunca use `eslint-disable` para contornar uma dessas regras. Se a regra atrapalha
um caso legítimo, ou o desenho está errado, ou a regra precisa de uma exceção
explícita e documentada — como a dos testes acima.
