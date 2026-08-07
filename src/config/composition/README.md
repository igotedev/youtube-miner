# src/config/composition — raiz de composicao

Este e o **unico** lugar do codigo de producao autorizado a importar
`infrastructure` e a montar casos de uso com adaptadores concretos.

Motivo: se cada rota ou componente instanciasse o proprio cliente Supabase ou
YouTube, a regra "presentation nao conhece infrastructure" (R6) viraria letra
morta e trocar um adaptador exigiria caçar `new` espalhado pelo projeto.

## Dois modulos, e a diferenca importa

| Arquivo                | Monta                                 | Chave usada  |
| ---------------------- | ------------------------------------- | ------------ |
| `analysis-pipeline.ts` | os tres casos de uso da analise       | service role |
| `auth.ts`              | o `AuthGateway` e a sessao do request | anon         |

A separacao nao e organizacao: e o ADR-005 aparecendo na configuracao. A
persistencia usa a **service role** porque escreve em tabelas globais e avanca o
estado da analise — coisas que o navegador nao pode fazer. A autenticacao usa a
chave **anon** porque atua COMO o usuario e respeita o RLS.

```ts
import { buildAnalysisPipeline } from '@/config/composition';

const pipeline = buildAnalysisPipeline();
const analysis = await pipeline.start.execute({ requestedBy, channelUrl });
```

### Quem precisa so de autenticacao importa `@/config/composition/auth`

Um barrel com reexport estatico arrasta TUDO o que reexporta para o bundle de
quem o importa. Pelo `index.ts` vem `analysis-pipeline.ts`, que traz os
repositorios do Supabase, o cliente da YouTube Data API e, no fim da cadeia,
`node:crypto`.

Para o `src/proxy.ts` isso nao e so peso: ele roda no Edge Runtime, onde modulos
do Node nao existem — o build avisa, e o aviso e legitimo. Por isso o proxy, a
rota de callback e a tela de acesso importam o modulo especifico.

Nao e violacao de fronteira: os dois arquivos sao a mesma raiz de composicao.

## O que NAO tem modo de demonstracao

**A persistencia e sempre o PostgreSQL, e a identidade e sempre real.** Sem
Supabase configurado, a composicao FALHA, nomeando a variavel que falta.

Os adaptadores em memoria continuam existindo e continuam sendo usados — pelos
TESTES, que sao a outra raiz de composicao do projeto. O que nao existe e um
caminho de producao que os escolha.

O motivo e assimetrico de proposito:

- um **fixture de coleta** visivel, com a tela avisando, nao engana ninguem;
- uma **sessao falsa** escolhida por engano faria de todos os visitantes o mesmo
  usuario, com acesso as analises uns dos outros, e nada na tela denunciaria.

Ver a secao 6 da `docs/specs/SPEC-009-authentication-and-live-persistence.md`.

## O campo `mode`

Declara a origem dos dados do YouTube — `live` ou `demonstration` — e sai daqui
para a tela. A apresentacao nao decide se os dados sao reais: ela exibe o que a
composicao declara. Um literal na tela sobreviveria a troca dos adaptadores e
passaria a mentir.

`mode` afirma UMA coisa: de onde vieram os numeros. Nao afirma nada sobre
persistencia nem sobre identidade, que nao tem modo de demonstracao.

## Leitura de ambiente

Variaveis de ambiente sao lidas aqui, via `getServerEnv()`, e chegam ao caso de
uso como valores puros (R8). O dominio nao le configuracao.
