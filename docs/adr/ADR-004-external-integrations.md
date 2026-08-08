# ADR-004 — Integrações externas atrás de contratos

| Campo        | Valor                              |
| ------------ | ---------------------------------- |
| Status       | Aceita                             |
| Data         | 2026-08-06                         |
| Relacionadas | ADR-001, ADR-002, ADR-003, ADR-007 |

> **Nota posterior (2026-08-08).** Este documento cita a **Claude API** como o
> provedor previsto para `InsightGenerator`. O provedor escolhido na
> implementação foi outro — **Gemini, na camada gratuita** — pelo motivo
> registrado no **ADR-007**.
>
> O texto abaixo fica como escrito: a decisão que ele tomou não foi _qual_
> provedor, e sim que **todo provedor fica atrás de uma porta**. A troca custou
> um arquivo, que é a prova de que a decisão estava certa.

## Contexto

O produto depende de três sistemas que não controla:

| Integração           | Natureza do risco                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **YouTube Data API** | Quota diária rígida; formato de resposta muda sem aviso; campos podem sumir (inscritos ocultos). |
| **Claude API**       | Latência alta e variável; custo por token; saída não determinística.                             |
| **Supabase**         | Fornecedor; SDK próprio; autenticação acoplada.                                                  |

Cada um traz um risco diferente, mas com a mesma forma: se o SDK for chamado de
dentro da regra de negócio, o risco do fornecedor vira risco do domínio. Testar
uma média passa a exigir rede, e trocar de fornecedor passa a exigir reescrever
regra.

A Claude API traz um risco adicional e específico: sendo boa em produzir texto
plausível, é tentador pedir a ela números que o sistema sabe calcular. Um LLM
não é uma calculadora — pedir a média de 50 vídeos a um modelo generativo
produziria um número plausível, não determinístico e não verificável, violando
a RN-13 de uma vez.

## Decisão

**Toda integração externa fica atrás de uma porta declarada em
`application/ports/`, implementada por um adaptador em `infrastructure/`.**

Portas já definidas:

| Porta                  | Módulo               | Substitui                  |
| ---------------------- | -------------------- | -------------------------- |
| `ChannelResolver`      | `youtube-collection` | resolução URL → ID oficial |
| `YouTubeChannelSource` | `youtube-collection` | YouTube Data API           |
| `InsightGenerator`     | `ai-insights`        | Claude API                 |
| `AnalysisRepository`   | `channel-analysis`   | Supabase / PostgreSQL      |
| `WatchlistRepository`  | `watchlists`         | Supabase / PostgreSQL      |
| `AuthGateway`          | `identity`           | Supabase Auth              |
| `Clock`                | `shared`             | relógio do sistema         |
| `Logger`               | `shared`             | destino dos logs           |

### Regras que acompanham

1. **Nenhum SDK acima de `infrastructure`** (R2). Verificado em `npm run verify`.
2. **Adaptador traduz, não repassa.** Ele recebe o payload do terceiro, valida
   com Zod e devolve **tipos de domínio**. O formato do YouTube não vaza para
   dentro. Se a API mudar, muda um arquivo.
3. **Erros são traduzidos.** Falha externa vira `ExternalServiceError`,
   `NotFoundError` ou `QuotaExceededError`. Nenhuma camada interna inspeciona
   código HTTP.
4. **A resposta da IA é validada como entrada não confiável.** Schema Zod
   obrigatório antes de virar `InsightReport`. Resposta fora do formato é falha
   da porta — e falha da porta é degradação, não erro fatal (RN-09).
5. **A IA nunca calcula** (RN-14). `InsightRequest` recebe `ChannelMetrics`
   **já calculadas**: a IA escreve sobre números prontos, não os produz. O tipo
   da porta é a barreira — a IA nunca vê a lista bruta de visualizações.
6. **Credenciais só no servidor** (RN-11). Nenhum segredo com prefixo
   `NEXT_PUBLIC_`. `process.env` restrito a `src/config/` (R8), e
   `src/config/env.ts` lança se importado no navegador.
7. **Adaptadores falsos são de teste**, vivem em `infrastructure/fake/` e nunca
   são reexportados pelo barrel do módulo.

## Alternativas consideradas

### Chamar os SDKs diretamente dos casos de uso

Rejeitada. Menos código hoje, muito mais amanhã: cada teste passaria a exigir
rede ou mock de SDK, e uma mudança na API do YouTube tocaria toda a camada de
aplicação. A quantidade de portas aqui é pequena e cada uma já se paga na
primeira suíte de testes.

### Uma camada anticorrupção genérica compartilhada

Rejeitada. Abstração antes da segunda necessidade. Os três clientes têm modelos
de erro, autenticação e paginação diferentes; uma camada genérica seria a
interseção pobre dos três. Portas específicas dizem mais.

### Adaptadores sem validação de schema, confiando nos tipos do SDK

Rejeitada. Tipo de SDK é promessa de compilação, não garantia de runtime — a API
pode devolver `null` onde o tipo diz `string`, e o produto teria um `undefined`
circulando por dentro. Validar na fronteira é o que sustenta a RN-08.

### Pedir métricas à IA

Rejeitada categoricamente. Viola RN-13 e RN-14 e destrói o valor central do
produto: números verificáveis. Um LLM produz um número plausível, não o número
certo, e não produz o mesmo duas vezes.

## Consequências positivas

- Regra de negócio testável sem rede, sem chave e sem custo.
- Trocar de fornecedor é escrever um adaptador.
- Quota e custo ficam contidos no adaptador, que é onde podem ser medidos.
- Falha da IA degrada para `partially_completed` sem perder dados objetivos.
- Segredos ficam em um único ponto auditável.
- O fluxo vertical de `StartChannelAnalysis` já roda hoje com adaptadores falsos
  — prova executável de que a inversão funciona.

## Consequências negativas

- **Mais arquivos.** Porta, adaptador e schema onde caberia uma chamada.
  Aceito conscientemente: é o preço da testabilidade.
- **Risco de porta anêmica.** Uma interface que espelha o SDK campo a campo não
  protege de nada. A porta deve falar a linguagem do domínio, não a do
  fornecedor — por isso `YouTubeChannelSource` devolve `YouTubeChannel`, e não o
  JSON da API.
- **Adaptadores falsos podem divergir do real.** Mitigação futura: testes de
  contrato em `tests/integration/`, rodando a mesma bateria contra os dois.
- **Uma indireção a mais ao depurar.** Compensada pelo log em cada etapa.

## Condições que justificariam revisão

- Uma porta que nunca teve mais de uma implementação e cujo fake nunca foi usado
  — sinal de abstração especulativa; remova-a.
- Uma integração tão trivial e estável que a porta só some ruído.
- Um fornecedor cujo SDK já ofereça uma interface adequada ao domínio — caso
  raro, mas possível.
