# SPEC-005 — Cálculo e persistência das métricas da análise

| Campo      | Valor                                                           |
| ---------- | --------------------------------------------------------------- |
| Status     | Implementada                                                    |
| Data       | 2026-08-06                                                      |
| Módulos    | `channel-analysis` (caso de uso), `video-analytics` (adaptador) |
| Depende de | SPEC-003 (motor), SPEC-004 (esquema), ADR-005                   |

---

## 1. Contexto

Depois da SPEC-004 havia um **vão** no produto: o motor de métricas existia e era
testado, o esquema para guardá-las existia, e **nada os ligava**.
`StartChannelAnalysis` parava em `collecting_videos`, e nenhuma métrica chegava
ao banco. Uma análise nunca terminava.

Esta SPEC fecha esse vão. Ela foi escolhida à frente do adaptador da YouTube
Data API por uma razão prática: o adaptador exigiria chave de API e rede, e
ficaria — como a migração da SPEC-004 — escrito e não executado. Esta é
inteiramente verificável offline.

## 2. Objetivo

Um caso de uso que leva a análise de `collecting_videos` até um estado terminal,
calculando as métricas a partir do snapshot guardado e persistindo o resultado.

## 3. Fluxo

```
1. Carrega a análise, escopada pelo dono
2. Já terminal?  → devolve como está (reentrante)
3. Estado permite calcular? → senão, DomainError
4. Tem coleta vinculada?     → senão, DomainError
5. → calculating_metrics
6. Já existe resultado para (coleta, versão)?
   ├── sim  → reaproveita
   └── não  → lê o snapshot, calcula, persiste
7. → partially_completed, vinculando o resultado
   └── em caso de falha → failed, com o código do erro
```

## 4. Por que termina em `partially_completed`

A SPEC-001 define `partially_completed` como **"dados objetivos válidos,
relatório de IA ausente ou inválido"** (RN-09). É exatamente esta situação: as
métricas estão corretas e não há relatório, porque o adaptador Claude não existe.

Marcar `completed` afirmaria que um relatório foi produzido. O estado é
reaproveitável para cache (`isReusableStatus` já o aceita), então nada se perde.

Quando a SPEC de insights existir, o fluxo passará por `generating_insights` e
chegará a `completed` — ou permanecerá em `partially_completed` se a IA falhar,
que é o mesmo destino por outro caminho.

## 5. Reuso do cálculo entre usuários

O motor da SPEC-003 é **determinístico**: mesma coleta e mesma versão do
algoritmo produzem um resultado idêntico bit a bit. Portanto, se a análise de
outro usuário já calculou aquela coleta, recalcular queimaria CPU para chegar ao
mesmo número.

É o raciocínio da RN-10 aplicado ao cálculo. O par único
`(collection_run_id, algorithm_version)` já existia no esquema da SPEC-004
justamente para isso.

Duas análises de usuários diferentes sobre a mesma coleta **apontam para o mesmo
`analytics_result_id`** — há teste cobrindo isso, e outro contando quantas vezes
o repositório gravou de fato.

## 6. Carimbo de tempo

Duas datas distintas, e confundi-las produziria métricas erradas:

| Campo                          | Significa                                                 |
| ------------------------------ | --------------------------------------------------------- |
| `metrics.collectedAt`          | quando os dados foram **lidos da API** (`run.capturedAt`) |
| `AnalyticsResult.calculatedAt` | quando o **cálculo** rodou                                |

O motor recebe `collectedAt = run.capturedAt`, nunca `clock.now()`. Uma análise
recalculada cinco horas depois produz **as mesmas idades de vídeo** — RN-12 e
RN-13. Há teste que avança o relógio e verifica exatamente isso.

## 7. Tratamento de falha

Falha no cálculo é **falha objetiva**: a análise vai para `failed` com o
`errorCode` derivado do `AppError`, e o erro é repropagado.

Distinto da falha da IA, que degrada para `partially_completed` sem invalidar
nada (RN-09). Sem métricas não há análise; sem relatório, há.

A análise que falha **não** recebe vínculo com métricas inexistentes —
`analyticsResultId` permanece `null`. Há teste.

## 8. Reentrância e isolamento

- **Reentrante:** chamar de novo uma análise já terminal devolve o que existe,
  sem recalcular e sem trocar de estado. `calculating_metrics` também é aceito
  como ponto de entrada, para que uma execução interrompida possa ser retomada —
  o cálculo é determinístico e refazê-lo não tem efeito colateral.
- **Escopado por dono:** `findById(id, ownerId)`. A análise de outro usuário
  produz `NotFoundError`, não erro de permissão — este último já revelaria que
  ela existe.

## 9. Estados fora de ordem

`canCalculateMetrics(status)` — função pura em `analysis-status.ts` — aceita
apenas `collecting_videos` e `calculating_metrics`. Qualquer outro estado
significa etapa fora de ordem: ou a coleta não acabou, ou a análise já terminou.

## 10. Adaptador de persistência

`SupabaseAnalyticsResultRepository` + `analytics-result-row.ts`.

A parte delicada — reconstruir os `Date` de dentro do `jsonb` e não confundir
`0`, `null` e `[]` — já estava em `metrics-serializer.ts` (SPEC-004). O mapper
novo cobre as colunas de fora e valida o formato da versão do algoritmo.

`video_analytics_results` é tabela **global**: sem `user_id`, sem policy para
`authenticated`. O adaptador só funciona com o cliente administrativo, e o
resultado nunca vai cru ao navegador (ADR-005).

Colisão de `UNIQUE` em gravação simultânea vira `ConflictError`. Não é defeito: o
resultado é idêntico, porque o motor é determinístico. Quem chama deve reler, não
sobrescrever.

## 11. Testes

**347 no total** (+30 nesta etapa), todos executados.

| Grupo                    | Cobre                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline completo        | `collecting_videos` → `partially_completed`; métricas ligadas à coleta e à versão; carimbo de captura vs. cálculo; separação Shorts/longos (RN-06); ausência preservada (RN-08) |
| Reuso entre usuários     | não recalcula; as duas análises apontam para o mesmo resultado                                                                                                                  |
| Reentrância e isolamento | chamada repetida é no-op; análise alheia dá `NotFoundError`; análise inexistente idem                                                                                           |
| Etapas fora de ordem     | recusa antes da coleta terminar; recusa sem coleta vinculada                                                                                                                    |
| Falha                    | marca `failed`, registra `errorCode`, não inventa vínculo                                                                                                                       |
| Mapper do resultado      | ida e volta, duas datas distintas, percurso por texto, 9 casos de linha corrompida                                                                                              |

## 12. Critérios de aceitação

- [x] Caso de uso liga o motor da SPEC-003 ao esquema da SPEC-004
- [x] Análise chega a um estado terminal
- [x] Métricas persistidas com `algorithmVersion`
- [x] Cálculo reaproveitado entre usuários
- [x] `collectedAt` das métricas vem da captura, não do cálculo
- [x] Falha objetiva leva a `failed` com código
- [x] Reentrante e escopado por dono
- [x] Adaptador Supabase sem vazar tipos para o domínio
- [x] `typecheck`, `lint`, `test`, `build`, `verify` passam

## 13. Fora do escopo

Claude API e geração de relatórios; YouTube Data API; interface, rota HTTP ou
Server Action; disparo automático do cálculo após a coleta (hoje são dois casos
de uso chamados em sequência — enfileirar é assunto da SPEC de filas);
recálculo em massa ao mudar a versão do algoritmo; invalidação de resultados.
