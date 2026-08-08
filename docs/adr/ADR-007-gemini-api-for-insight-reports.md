# ADR-007 — Gemini API para o relatório de IA

| Campo        | Valor                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| Status       | Aceita                                                                       |
| Data         | 2026-08-08                                                                   |
| Relacionadas | ADR-004 (integrações atrás de contratos), ADR-005 (fronteiras de dado)       |
| Altera       | Nenhum ADR anterior. Concretiza a integração que o ADR-004 previu pelo nome. |

## Contexto

A porta `InsightGenerator`, o tipo `InsightReport` e a tabela
`ai_insight_reports` existem desde a fundação e nunca tiveram implementação.
O estado `generating_insights` existe. `partially_completed` existe **porque**
esta etapa falta: toda análise termina nele hoje.

O que falta não é desenho — é a decisão concreta, e ela envolve custo, uma
integração nova e o ponto do produto onde a regra "estimativa nunca é
apresentada como dado oficial" deixa de ser teoria.

Quatro perguntas com alternativa razoável e consequência registrável:

1. **SDK oficial ou HTTP direto?**
2. **Qual provedor e modelo, e a que custo por relatório?**
3. **Como a resposta atravessa a fronteira — texto livre ou contrato validado?**
4. **O que impede a IA de produzir um número?**

### Uma restrição que veio de fora do desenho

**O relatório precisa ser gratuito.** Não é preferência: é requisito do
projeto, decidido depois de uma primeira versão deste documento que escolhia a
Claude API a ≈ US$ 0,03 por relatório.

A restrição eliminou a decisão 2 anterior por inteiro e não tocou nas outras
três — que é o que se espera quando a porta está no lugar certo. **A troca de
provedor custou um arquivo.**

## Decisão 1 — `fetch` direto, sem SDK

**Aceita.** O projeto continua com **zero dependência nova**.

A primeira versão deste ADR aceitava o SDK oficial da Anthropic, e a
justificativa era real: erros tipados, retry com backoff e contagem de tokens
prontos. Com a mudança de provedor, a conta virou:

- é um **endpoint REST único**, sem estado e sem streaming;
- a resposta seria validada com Zod de qualquer jeito (decisão 3);
- a tradução de erro é por **código HTTP**, não por classe de exceção — e um
  `switch` em três casos não precisa de biblioteca.

É exatamente o raciocínio que já governa `youtube-api-client.ts`, que resolve o
mesmo problema do mesmo jeito. Um SDK aqui traria peso sem trazer nada que o
adaptador não faça em vinte linhas.

**Consequência de verdade:** `@anthropic-ai/sdk` foi instalado e depois
removido. O `package.json` tem as mesmas seis dependências de produção de antes
desta SPEC.

## Decisão 2 — Gemini na camada gratuita, e o preço não é em dinheiro

**Aceita.** Modelo padrão `gemini-3.6-flash`, com `GEMINI_MODEL` mantendo a
escolha nas mãos de quem opera.

**Custo em dinheiro: zero.** Entrada e saída são gratuitas na camada gratuita do
Gemini, e não há cartão envolvido.

### O que a camada gratuita cobra, e não é dinheiro

> **O Google declara que entradas e saídas dos modelos gratuitos são usadas
> para melhorar os produtos dele.**

Isso não é letra miúda — é a contrapartida do preço, e precisa estar escrita
onde alguém a leia antes de configurar a chave. O que sai desta aplicação para
lá:

| Vai                                  | Não vai                                  |
| ------------------------------------ | ---------------------------------------- |
| Título e descrição públicos do canal | E-mail ou identificador do usuário       |
| Métricas já calculadas (agregados)   | Qualquer dado da conta de quem pediu     |
| Títulos dos vídeos recentes          | A lista bruta de visualizações por vídeo |

Tudo o que sai é **dado público do YouTube ou agregado derivado dele**. Nada
identifica quem pediu a análise. Isso reduz o problema, e **não o elimina**:
quem opera está enviando dados de canais de terceiros a um serviço que os usa
para treinar.

Está registrado em `.env.example`, ao lado da variável, e é o gatilho de revisão
mais provável deste ADR.

### O segundo preço: limite diário

A camada gratuita tem teto de uso por chave. Ele é **compartilhado por toda a
aplicação**, não por usuário — o que significa que um usuário pode esgotar o dia
dos outros.

Por isso `429` tem tratamento próprio e vira `QUOTA_EXCEEDED`, e não uma falha
genérica: a tela precisa poder dizer _"o limite gratuito de hoje acabou"_ em vez
de _"o serviço falhou"_. São coisas diferentes para quem lê, e a segunda faz o
usuário tentar de novo à toa.

### Por que Gemini e não Groq

Os dois têm camada gratuita. Duas razões decidiram:

- **saída restrita por esquema é nativa** — que é o mecanismo da decisão 3, e
  sem ele voltaríamos a recortar texto;
- **português.** O relatório é escrito em pt-BR, e os modelos abertos servidos
  pelo Groq escrevem pior nele.

### Por que não um modelo local

Ollama seria gratuito **sem contrapartida nenhuma** — sem chave, sem limite, sem
terceiro vendo dado algum, e funcionando offline. Foi considerado e recusado
pelo custo de instalação (~3 GB de modelo, execução na máquina de quem roda) e
pela qualidade menor de modelos pequenos.

**Fica registrado como a alternativa de recuo:** se a cláusula de treino se
tornar inaceitável, ou o limite diário apertar, o caminho é outro adaptador da
mesma porta — não uma renegociação do desenho.

### Um detalhe do endpoint que virou código

**Não há teto de tokens de saída.** Este endpoint não documenta um campo para
isso, e inventar um nome produziria um pedido que o provedor ignora em silêncio
— o pior tipo de defeito. O tamanho da resposta é contido pelo **esquema**:
campos curtos, com limite verificado na leitura.

## Decisão 3 — Saída estruturada, não texto livre

**A resposta atravessa a fronteira como JSON validado contra um esquema
declarado**, usando a saída estruturada da API, e é validada de novo com Zod do
nosso lado.

A alternativa — pedir texto e recortar seções com expressão regular — é como
integrações com LLM costumam ser escritas, e é frágil exatamente onde o projeto
não aceita fragilidade: um cabeçalho reformulado pelo modelo vira um campo
vazio, silenciosamente.

Isto não é um caso especial. É a **mesma regra que já vale para a YouTube Data
API** (ADR-004): resposta de terceiro é validada na infraestrutura e traduzida
para tipo de domínio antes de subir. A IA não ganha exceção por ser IA.

Validar dos dois lados não é redundância: o esquema da API restringe o que o
modelo **gera**; o Zod garante o que o nosso código **recebe** — inclusive se a
API mudar, se um intermediário alterar o corpo, ou se o esquema e o tipo
divergirem numa edição futura, que é o defeito mais provável dos três.

## Decisão 4 — O esquema não tem campo numérico, e isso é a RN-14 no código

`InsightReport` carrega texto: resumo, nicho provável, padrões de título,
oportunidades, notas sobre dependência de virais. **Nenhum número.**

Isso não é acidente de modelagem — é a RN-14 sendo estrutural em vez de
combinada. Média, mediana, frequência e outlier são aritmética determinística de
`video-analytics`; a IA os **recebe prontos** e escreve sobre eles.

### O limite honesto desta garantia

O esquema impede um campo numérico. **Não impede o modelo de escrever "cerca de
3 mil visualizações" dentro de uma frase.** Nenhum esquema impede.

O que fazemos, então:

- os números vão **no pedido**, com rótulo, para que o texto os cite em vez de
  os estimar — e ausência vai como ausência declarada, nunca como zero (RN-08);
- a tela apresenta o relatório **visivelmente separado** dos painéis de
  métricas, identificado como texto gerado por IA, com o modelo e o instante;
- `ai_insight_reports` guarda `provider`, `model` e `prompt_version`, para que
  um texto suspeito seja rastreável até o que o produziu.

Um número citado errado dentro de uma frase continua sendo possível. Ele fica
**visivelmente atribuído à IA**, ao lado do número calculado, e não no lugar
dele.

## Decisão 5 — Falha da IA é degradação, nunca falha da análise

Já está escrito na porta e na RN-09; fica aqui como decisão registrada porque é
o que impede o caminho fácil.

Erro, recusa, limite diário estourado, tempo esgotado ou resposta que não valida
contra o esquema levam a análise a `partially_completed` — **o estado em que ela
já termina hoje.** Os números objetivos continuam corretos e visíveis. Uma falha
de terceiro não pode apagar dado que já foi coletado e calculado.

Consequência prática: ligar esta SPEC não pode piorar nada. O pior caso do
relatório de IA é exatamente o comportamento atual.

## Consequências

### Positivas

- A décima capacidade do MVP existe, e `completed` deixa de ser inalcançável.
- **Custo zero em dinheiro**, e nenhuma dependência nova.
- Consumo de tokens medido e gravado mesmo sendo gratuito — é o que permite
  saber quanto custaria fora da camada gratuita, **antes** de a conta chegar.
- A fronteira é a mesma de toda integração do projeto — porta, adaptador,
  validação, tradução de erro.
- Trocar de modelo é variável de ambiente. Trocar de **provedor** é um arquivo,
  como esta própria decisão demonstrou.

### Negativas, e assumidas

- **Os dados enviados são usados para treinar modelos do Google.** É o preço da
  camada gratuita e está declarado acima e em `.env.example`.
- **Limite diário compartilhado.** Um usuário pode esgotar o dia dos outros.
  Sem chave ou com o limite estourado, a análise termina em
  `partially_completed` — degradação visível, não falha silenciosa.
- **Latência.** Segundos, não milissegundos.
- **Não determinismo.** Duas execuções sobre os mesmos números produzem textos
  diferentes. É a natureza da etapa, e é por isso que ela está separada do
  cálculo em tabela própria, com versão de prompt.
- **Custo de prompt versionado.** Mudar o texto do prompt muda o produto sem
  mudar uma linha de regra. Por isso `prompt_version` é coluna, não constante
  perdida no código.

## Gatilhos de revisão

- **A cláusula de treino se tornar inaceitável** — por exigência de cliente,
  contrato ou lei. Recuo: Ollama local, outro adaptador da mesma porta.
- Limite diário gratuito apertar a ponto de a maioria das análises degradar.
- Taxa de recusa ou de falha de validação acima de 5% → revisar prompt e esquema.
- Necessidade de streaming do texto para a tela → revisar a decisão 1.
- Qualquer pedido de número **à IA** → não é revisão, é violação da RN-14.
