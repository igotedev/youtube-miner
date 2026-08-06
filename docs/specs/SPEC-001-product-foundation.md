# SPEC-001 — Fundação do produto

| Campo     | Valor                                                              |
| --------- | ------------------------------------------------------------------ |
| Status    | Aceita                                                             |
| Data      | 2026-08-06                                                         |
| Escopo    | Fundação arquitetural e documental. Nenhuma funcionalidade do MVP. |
| Substitui | —                                                                  |

---

## 1. Visão do produto

O YouTube Niche Miner é um SaaS para **encontrar, analisar e comparar canais do
YouTube**. O usuário informa a URL de um canal e recebe uma leitura estruturada
dos dados públicos daquele canal e de seus vídeos recentes.

O valor não está no acesso ao dado — ele já é público. Está em **transformar
dados dispersos em leitura útil**: o que é normal para aquele canal, o que fugiu
da curva, com que frequência ele publica, quanto depende de um vídeo viral.

### O que o produto não é

Esta seção tem peso de requisito, não de disclaimer.

- **Não promete sucesso.** Nenhuma tela, texto ou relatório pode sugerir que
  seguir um padrão observado produzirá resultado.
- **Não apresenta estimativa como dado oficial.** Todo número derivado precisa
  ser identificável como cálculo do sistema, e todo texto de IA como
  interpretação.
- **Não preenche lacuna com zero.** Dado indisponível é exibido como
  indisponível, com a razão quando conhecida.

---

## 2. Público-alvo

| Perfil                    | Necessidade                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| Criador de conteúdo       | Entender o que funciona em canais do seu nicho antes de produzir.    |
| Gestor de canal / agência | Comparar canais de clientes e concorrentes com critério consistente. |
| Pesquisador de nicho      | Avaliar se um nicho tem espaço antes de investir tempo.              |

Todos compartilham o mesmo problema: os dados estão no YouTube, mas ler dezenas
de vídeos manualmente e calcular médias em planilha é lento e inconsistente.

## 3. Proposta de valor

1. **Uma leitura consistente.** As mesmas regras de cálculo para todo canal —
   sem interpretação variando de análise para análise.
2. **Shorts e vídeos longos separados.** Misturar os dois produz média sem
   significado; separá-los é a diferença entre um número e uma informação.
3. **Outliers explícitos.** Identificar o vídeo fora da curva é mais acionável
   que a média.
4. **Honestidade sobre a origem de cada número.** Dado coletado, cálculo do
   sistema e texto de IA são visualmente distintos.

---

## 4. Objetivo do MVP

Um usuário deve conseguir:

| #   | Capacidade                                      |
| --- | ----------------------------------------------- |
| 1   | Criar uma conta                                 |
| 2   | Informar a URL de um canal do YouTube           |
| 3   | Ter a URL validada e normalizada                |
| 4   | Consultar os dados públicos do canal            |
| 5   | Consultar até 50 vídeos públicos recentes       |
| 6   | Ver Shorts e vídeos longos separados            |
| 7   | Ver métricas calculadas                         |
| 8   | Identificar vídeos fora da curva                |
| 9   | Salvar o canal em uma lista                     |
| 10  | Solicitar um relatório textual produzido por IA |

### Métricas que a plataforma deve produzir

Média de visualizações; mediana de visualizações; frequência de postagem; vídeos
fora da curva; distribuição entre Shorts e vídeos longos; padrões de títulos;
consistência do canal; nicho e subnicho provável; possíveis oportunidades de
conteúdo; dependência de vídeos virais.

As sete primeiras são **cálculo determinístico** (módulo `video-analytics`). As
três últimas são **interpretação** (módulo `ai-insights`) e nunca podem ser
apresentadas com o mesmo peso das primeiras.

## 5. Fora do escopo

Não implementar: extensão Chrome; pesquisa em milhões de canais; histórico
avançado; monitoramento diário; alertas; estimativa de receita; estimativa de
RPM; geração de roteiros; aplicativo mobile; equipes; API pública; programa de
afiliados; marketplace; pagamentos; comparação automática de thumbnails.

Nada dessa lista pode ser implementado sem antes existir uma SPEC própria.

---

## 6. Módulos

| Módulo               | Responsabilidade                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`           | Autenticação, usuário, sessão, permissões.                                                                                                         |
| `youtube-collection` | Validar e normalizar URLs, resolver o ID oficial, consultar a API, coletar canais e vídeos, controlar quota, aplicar cache, tratar erros externos. |
| `channel-analysis`   | Iniciar uma análise, coordenar as etapas, registrar o estado, armazenar resultados, recuperar análises anteriores.                                 |
| `video-analytics`    | Separar Shorts e longos, calcular média, mediana, frequência e visualizações por dia, identificar outliers.                                        |
| `ai-insights`        | Preparar dados estruturados para a IA, solicitar relatório, validar a resposta, armazenar, controlar custos e tokens.                              |
| `watchlists`         | Salvar canais, criar listas, remover canais, adicionar observações.                                                                                |

Cada módulo separa `domain`, `application`, `infrastructure` e `presentation`
quando faz sentido. Ver `docs/architecture/overview.md`.

---

## 7. Regras de negócio

| ID    | Regra                                                                 |
| ----- | --------------------------------------------------------------------- |
| RN-01 | Uma análise deve estar associada ao ID oficial do canal no YouTube.   |
| RN-02 | A URL informada não é o identificador permanente do canal.            |
| RN-03 | Um canal pode possuir várias análises em datas diferentes.            |
| RN-04 | Dados brutos ficam separados das métricas calculadas.                 |
| RN-05 | Relatórios de IA ficam separados dos dados objetivos.                 |
| RN-06 | Métricas de Shorts não se misturam com métricas de vídeos longos.     |
| RN-07 | O sistema não apresenta estimativas como dados oficiais.              |
| RN-08 | Dados indisponíveis não são exibidos como zero sem contexto.          |
| RN-09 | Uma falha na IA não invalida os dados objetivos.                      |
| RN-10 | Análises recentes podem ser reutilizadas por um período configurável. |
| RN-11 | Credenciais nunca são expostas ao navegador.                          |
| RN-12 | Toda análise registra a data e hora da coleta.                        |
| RN-13 | Cálculos são determinísticos e testáveis.                             |
| RN-14 | Integrações externas são acessadas por interfaces.                    |

### Onde cada regra já está ancorada no código

Uma regra só documentada é uma regra que será violada. Estado atual:

| Regra        | Ancoragem                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| RN-01, RN-02 | `Analysis.channelId` é `YouTubeChannelId`; a URL vive em `requestedUrl`, que não é chave. Teste em `start-channel-analysis.test.ts`. |
| RN-03        | `Analysis.id` é a chave, não `channelId`.                                                                                            |
| RN-04, RN-05 | `rawSnapshot`, `metrics` e `insight` são campos irmãos e independentes em `Analysis`.                                                |
| RN-06        | `ChannelMetrics` tem blocos `shorts` e `long` separados; não existe agregado no nível do canal.                                      |
| RN-08        | Todo agregado é `number \| null`. `VideoFormat` inclui `'unknown'`.                                                                  |
| RN-09        | Estado `partially_completed`; `isReusableStatus` o aceita como válido.                                                               |
| RN-11        | `src/config/env.ts` lança se importado no navegador; regra R8 do teste de arquitetura impede `process.env` fora de `config/`.        |
| RN-12, RN-13 | Porta `Clock` injetada; nenhum caso de uso chama `new Date()`.                                                                       |
| RN-14        | Portas em `application/ports/`; regras R2 e R3 verificadas por ESLint e teste.                                                       |
| RN-07, RN-10 | **Ainda só documentadas.** RN-07 depende da UI (não construída); RN-10 depende do repositório real.                                  |

### Regra de outliers — primeira versão

```
outlierScore = visualizações do vídeo / mediana de visualizações do formato
```

| Faixa          | Classificação   |
| -------------- | --------------- |
| `< 1,5`        | normal          |
| `1,5` a `2,49` | acima do normal |
| `2,5` a `4,99` | outlier         |
| `>= 5`         | grande outlier  |

Shorts e vídeos longos possuem **medianas separadas** (RN-06). Vídeo sem
contagem de visualizações fica fora do cálculo da mediana e recebe score `null`,
nunca `0` (RN-08).

Contrato declarado em `src/modules/video-analytics/domain/outlier.ts`.
Implementação adiada para a SPEC-003, como função pura e testada.

---

## 8. Estados de uma análise

`pending` → `collecting_channel` → `collecting_videos` → `calculating_metrics` →
`generating_insights` → `completed`

Estados finais alternativos:

- `partially_completed` — dados objetivos válidos, relatório de IA ausente ou
  inválido (RN-09). **Reaproveitável** para cache: seus números estão corretos.
- `failed` — a coleta não produziu dados utilizáveis. Nunca reaproveitável.

Definidos em `src/modules/channel-analysis/domain/analysis-status.ts`.

---

## 9. Requisitos não funcionais

| Área            | Requisito                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Segurança       | Chave de API, service role e token nunca chegam ao navegador. Toda chamada a terceiro parte do servidor.                  |
| Determinismo    | Dada a mesma entrada, o motor de métricas produz sempre a mesma saída. Tempo é injetado, nunca lido de dentro.            |
| Custo           | A YouTube Data API tem quota diária e a Claude API cobra por token. Ambos precisam de teto configurável e contabilização. |
| Degradação      | Falha da IA degrada para `partially_completed`. Falha de quota é comunicada como tal, jamais como dado zerado.            |
| Testabilidade   | Regra de negócio vive fora de componente React e fora de adaptador, portanto testável sem navegador e sem rede.           |
| Tipagem         | TypeScript estrito, incluindo `noUncheckedIndexedAccess` — o código estatístico indexa arrays.                            |
| Rastreabilidade | Toda análise carrega a data e hora da coleta, exibida junto dos números.                                                  |

## 10. Critérios de aceitação desta etapa

- [x] Projeto Next.js com App Router, TypeScript estrito, Tailwind e ESLint.
- [x] Seis módulos com fronteiras declaradas e barrel público.
- [x] Camadas `domain`, `application`, `infrastructure` separadas onde há código.
- [x] Regras de dependência verificadas automaticamente, não apenas escritas.
- [x] Contratos para YouTube, Claude e persistência, sem implementação real.
- [x] Um fluxo vertical executável provando que as camadas se comunicam por portas.
- [x] Os oito estados de análise definidos e testados.
- [x] `npm run verify` passa: typecheck, lint e testes.
- [x] Nenhuma credencial no repositório; `.env.example` só com nomes.
- [x] SPEC, ADRs, documentos de arquitetura, README e CLAUDE.md escritos.

## 11. Riscos

| Risco                                                      | Impacto                                     | Mitigação                                                                     |
| ---------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Quota da YouTube Data API (10.000 unidades/dia por padrão) | Análises param no meio do dia               | Cache de análise (RN-10), teto configurável, `QuotaExceededError` explícito   |
| Classificação Shorts × longos por duração é aproximada     | Métricas contaminadas                       | Terceiro estado `'unknown'`; critério fixado em SPEC própria, não improvisado |
| Custo variável da Claude API                               | Margem imprevisível                         | Teto de tokens, contabilização por relatório, relatório sob demanda           |
| IA produzir texto que soa como previsão                    | Risco de produto e de confiança             | RN-07 e RN-14; relatório separado dos dados e rotulado como interpretação     |
| Canal muda de handle ou URL                                | Análises órfãs                              | RN-01: a chave é o ID oficial                                                 |
| Erosão das fronteiras entre módulos                        | Volta ao emaranhado que a arquitetura evita | Regras verificadas em `npm run verify`, não só documentadas                   |

## 12. Premissas

- Apenas dados **públicos** são coletados; nada exige login no YouTube.
- O volume inicial é baixo — um monólito modular basta (ADR-001).
- A coleta cabe no tempo de uma requisição HTTP no MVP; filas ficam para quando
  isso deixar de ser verdade (ADR-001).
- Supabase Auth atende os requisitos de autenticação do MVP.
- Até 50 vídeos recentes por análise são suficientes para as métricas propostas.
