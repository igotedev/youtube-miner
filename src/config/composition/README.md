# src/config/composition — raiz de composicao

Este e o **unico** lugar da aplicacao autorizado a importar `infrastructure` e
a montar casos de uso com adaptadores concretos.

Motivo: se cada rota ou componente instanciasse o proprio cliente Supabase ou
YouTube, a regra "presentation nao conhece infrastructure" (R6) viraria letra
morta e trocar um adaptador exigiria caçar `new` espalhado pelo projeto.

Formato esperado quando as integracoes existirem:

```ts
// src/config/composition/channel-analysis.ts
import { StartChannelAnalysis } from '@/modules/channel-analysis';
// ... imports de infrastructure permitidos APENAS aqui

export function buildStartChannelAnalysis() {
  return new StartChannelAnalysis({/* adaptadores reais */});
}
```

Ainda vazio: nesta etapa nenhum adaptador real existe e o unico caso de uso e
montado dentro do proprio teste. Ver R6 em
`docs/architecture/dependency-rules.md`.
