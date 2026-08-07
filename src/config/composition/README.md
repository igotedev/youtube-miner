# src/config/composition — raiz de composicao

Este e o **unico** lugar do codigo de producao autorizado a importar
`infrastructure` e a montar casos de uso com adaptadores concretos.

Motivo: se cada rota ou componente instanciasse o proprio cliente Supabase ou
YouTube, a regra "presentation nao conhece infrastructure" (R6) viraria letra
morta e trocar um adaptador exigiria caçar `new` espalhado pelo projeto.

## O que existe hoje

`analysis-pipeline.ts` monta `StartChannelAnalysis` e `CalculateAnalysisMetrics`
(SPEC-006). Quem consome pede um caso de uso pronto:

```ts
import { buildAnalysisPipeline } from '@/config/composition';

const pipeline = buildAnalysisPipeline();
const analysis = await pipeline.start.execute({ requestedBy, channelUrl });
```

## Composicao de demonstracao

Os adaptadores montados sao **em memoria e falsos**, e o campo `mode` declara
isso para a tela.

Os adaptadores Supabase existem desde a SPEC-004 e ainda nao sao montados aqui.
O esquema JA foi validado (migracao aplicada, 108 assercoes pgTAP passando), o
que remove o motivo original desta pendencia — liga-los e a proxima etapa. Ver
secao 4 da `docs/specs/SPEC-006-composition-and-analysis-surface.md`.

Quando o banco puder ser validado, a troca acontece **neste diretorio e em mais
nenhum**. Nenhum caso de uso muda — e para isso que as portas existem.

## Leitura de ambiente

Variaveis de ambiente sao lidas aqui, via `getServerEnv()`, e chegam ao caso de
uso como valores puros (R8). O dominio nao le configuracao.
