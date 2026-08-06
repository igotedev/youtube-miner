# SPEC-002 — Referência de canal do YouTube

| Campo      | Valor                                        |
| ---------- | -------------------------------------------- |
| Status     | Implementada                                 |
| Data       | 2026-08-06                                   |
| Módulo     | `youtube-collection`                         |
| Camada     | `domain`                                     |
| Depende de | SPEC-001 (RN-01, RN-02, RN-11, RN-13, RN-14) |

---

## 1. Contexto

O passo 2 do MVP é "informar a URL de um canal" e o passo 3 é "ter a URL
validada e normalizada". Antes de qualquer coleta, o sistema precisa decidir
**se a entrada do usuário se refere a um canal** e **qual identificador ela
carrega**.

Três fatos moldam esta SPEC:

1. **O YouTube expõe o mesmo canal por quatro formatos diferentes** — ID oficial
   (`/channel/UC…`), handle (`/@nome`), nome personalizado legado (`/c/nome`) e
   nome de usuário legado (`/user/nome`). Só o primeiro é o identificador
   permanente (RN-01).
2. **Resolver handle → ID oficial custa quota.** A YouTube Data API tem teto
   diário. Gastar uma unidade para descobrir que a entrada era
   `https://www.google.com/@canal` é desperdício evitável.
3. **A validação sintática é 100% offline.** Ela é aritmética de texto: não
   precisa de rede, banco, relógio ou credencial. Portanto pertence ao `domain`,
   onde é testável sem infraestrutura (RN-13).

Esta SPEC cobre exclusivamente o item 3.

## 2. Objetivo

Uma função pura que recebe uma entrada arbitrária de usuário e devolve uma
**referência normalizada e discriminada** a um canal, ou lança um erro de
domínio explicando por que a entrada não é utilizável.

A função **não** consulta a YouTube Data API, banco, Supabase, `fetch`, SDK
externo, `process.env` nem relógio.

## 3. Entradas aceitas

| #   | Forma                    | Exemplo                                      | `kind`            | `value`                    | `canonicalPath`       |
| --- | ------------------------ | -------------------------------------------- | ----------------- | -------------------------- | --------------------- |
| 1   | URL com ID oficial       | `https://www.youtube.com/channel/UC…`        | `channel_id`      | `UC…`                      | `/channel/UC…`        |
| 2   | URL com handle           | `https://www.youtube.com/@nomedocanal`       | `handle`          | `@nomedocanal`             | `/@nomedocanal`       |
| 3   | Handle sem URL           | `@nomedocanal`                               | `handle`          | `@nomedocanal`             | `/@nomedocanal`       |
| 4   | ID oficial sem URL       | `UCabcdefghijklmnopqrstuv`                   | `channel_id`      | `UCabcdefghijklmnopqrstuv` | `/channel/UC…`        |
| 5   | URL personalizada legada | `https://www.youtube.com/c/NomeDoCanal`      | `custom_name`     | `NomeDoCanal`              | `/c/NomeDoCanal`      |
| 6   | URL de usuário legada    | `https://www.youtube.com/user/NomeDoUsuario` | `legacy_username` | `NomeDoUsuario`            | `/user/NomeDoUsuario` |

Qualquer uma das formas acima é aceita com: protocolo `http` ou `https`, sem
protocolo, com ou sem `www`, em `m.youtube.com`, com barra final, com query
string, com fragmento, com espaços nas pontas, e com uma sub-rota conhecida.

## 4. Entradas recusadas

| Entrada                                          | `reason`               |
| ------------------------------------------------ | ---------------------- |
| `""`                                             | `empty_input`          |
| `"   "`                                          | `empty_input`          |
| `https://www.youtube.com/watch?v=123`            | `not_a_channel_url`    |
| `https://www.youtube.com/shorts/123`             | `not_a_channel_url`    |
| `https://www.youtube.com/playlist?list=123`      | `not_a_channel_url`    |
| `https://www.youtube.com/results?search_query=x` | `not_a_channel_url`    |
| `https://www.youtube.com/live/abc`               | `not_a_channel_url`    |
| `https://www.google.com/@canal`                  | `unsupported_host`     |
| `https://music.youtube.com/@canal`               | `unsupported_host`     |
| `https://youtu.be/@canal`                        | `unsupported_host`     |
| `https://youtube.com/`                           | `unknown_path`         |
| `https://www.youtube.com/qualquercoisa`          | `unknown_path`         |
| `https://www.youtube.com/@canal/estatisticas`    | `unknown_path`         |
| `https://`                                       | `malformed_url`        |
| `ftp://www.youtube.com/@canal`                   | `unsupported_protocol` |
| `javascript:alert(1)`                            | `unsupported_protocol` |
| `https://usuario:senha@www.youtube.com/@canal`   | `credentials_in_url`   |
| `UC123`                                          | `invalid_channel_id`   |
| `@`                                              | `invalid_handle`       |
| `canal qualquer`                                 | `unrecognized_input`   |

## 5. Formato de saída

União discriminada por `kind`:

```ts
type YouTubeChannelReference =
  | { kind: 'channel_id'; value: YouTubeChannelId; originalInput: string; canonicalPath: string }
  | { kind: 'handle'; value: string; originalInput: string; canonicalPath: string }
  | { kind: 'custom_name'; value: string; originalInput: string; canonicalPath: string }
  | { kind: 'legacy_username'; value: string; originalInput: string; canonicalPath: string };
```

### Dois ajustes ao modelo proposto, e por quê

**1. `value` é `YouTubeChannelId` na variante `channel_id`, não `string`.**

`YouTubeChannelId` é o tipo nominal já usado por `YouTubeChannel`, `Analysis` e
`WatchlistItem`. Esta função é o **único ponto do sistema que valida o formato do
ID oficial**; se ela devolvesse `string`, todo consumidor teria de re-validar ou
fazer um cast cego — e o tipo nominal deixaria de valer alguma coisa. Com a
tipagem, quem estreita por `kind === 'channel_id'` recebe o ID já garantido pelo
compilador.

**2. `originalInput` existe, mas nunca é identificador.**

RN-02 é explícita: a URL informada não é o identificador permanente. O campo
serve a rastreabilidade — mostrar ao usuário o que ele digitou, registrar em log
de diagnóstico. Guarda a entrada **exatamente como recebida**, sem `trim`.

## 6. Regras de normalização

1. **Espaços nas pontas removidos** antes de qualquer análise.
2. **Entrada sem protocolo aceita** quando reconhecível como URL; assume-se
   `https`.
3. **Hostname normalizado para minúsculas.** `WWW.YouTube.COM` → `www.youtube.com`.
4. **Barra final ignorada**, assim como barras duplicadas.
5. **Query string ignorada.** `?sub_confirmation=1`, `?view=0` não afetam o
   resultado.
6. **Fragmento ignorado.** `#conteudo` não afeta o resultado.
7. **Uma sub-rota conhecida é ignorada** após o segmento do canal.
8. **Caixa do identificador preservada.** `@CanalExemplo` permanece
   `@CanalExemplo`. Só o hostname é normalizado.
9. **Nenhuma chamada externa.**
10. **Nenhuma conversão de handle ou nome em ID oficial.**

### 6.1 Sub-rotas aceitas

`videos`, `shorts`, `streams`, `playlists`, `community`, `channels`, `about`.

Exatamente estas sete. **No máximo uma** por URL — `/@canal/videos/extra` é
recusada. Acrescentar uma oitava é mudança de SPEC, não de código.

### 6.2 Exemplo canônico

Entrada: `https://www.youtube.com/@CanalExemplo/videos?view=0#conteudo`

```json
{
  "kind": "handle",
  "value": "@CanalExemplo",
  "canonicalPath": "/@CanalExemplo",
  "originalInput": "https://www.youtube.com/@CanalExemplo/videos?view=0#conteudo"
}
```

### 6.3 Domínios permitidos — e a decisão sobre `youtu.be`

Aceitos: `youtube.com`, `www.youtube.com`, `m.youtube.com`.

**`youtu.be` é recusado.** É o encurtador de **vídeos**: a única forma
significativa é `youtu.be/<VIDEO_ID>`, onde o segmento do caminho é sempre um ID
de vídeo. Não existe forma canônica de canal nesse domínio. Aceitá-lo criaria
uma ambiguidade real — `youtu.be/UCabcdefghijklmnopqrstuv` seria interpretado
como canal, quando o YouTube o trataria como vídeo. Recusar produz um erro
imediato e correto; aceitar produziria uma análise do canal errado.

Subdomínios como `music.youtube.com`, `gaming.youtube.com` e `studio.youtube.com`
também são recusados: servem a outros produtos, e nenhum deles tem rota de canal
com a mesma semântica.

A comparação é de **igualdade exata** contra a lista, nunca sufixo. Isso recusa
`youtube.com.exemplo.net`, um vetor clássico de confusão de domínio.

### 6.4 Codificação percentual

Cada segmento do caminho é decodificado com `decodeURIComponent` antes da
validação. Sem isso, `https://www.youtube.com/@caf%C3%A9` — um handle acentuado
perfeitamente válido — seria recusado por conter `%`. Codificação quebrada
(`%zz`) produz `malformed_url`.

## 7. Validação do ID oficial

```
/^UC[A-Za-z0-9_-]{22}$/
```

- Prefixo obrigatório `UC`;
- 22 caracteres adicionais, **24 no total**;
- alfabeto base64url: letras, dígitos, `-` e `_`;
- nenhum espaço, nenhum separador extra.

Essa é a forma pública dos IDs de canal do YouTube. A regra é estrita porque o
formato é conhecido, fixo e verificável — ao contrário do handle, onde ser
estrito seria supor.

## 8. Validação do handle

- Começa com `@`;
- pelo menos **1** caractere depois do `@`;
- no máximo **30** caracteres depois do `@` (máximo documentado pelo YouTube);
- não contém espaço, `/`, `\`, `?`, `#`, `&`, `=`, `%`, `:` nem `@`;
- extraído **somente do primeiro segmento** do caminho.

### Por que uma lista de recusa e não de permissão

O YouTube aceita handles com letras fora do ASCII. Uma lista de permissão
`[A-Za-z0-9._-]` recusaria handles válidos com base em suposição — exatamente o
que esta SPEC quer evitar. A lista de recusa enumera apenas caracteres que
**nunca** aparecem em um identificador, porque são delimitadores de URL.

O mínimo é 1, e não os 3 que o YouTube documenta para handles novos. Motivo: o
mínimo do YouTube se aplica à criação, e handles antigos podem não segui-lo.
Recusar um handle existente é pior que aceitá-lo e deixar a API responder.

`/c/` e `/user/` seguem a mesma lista de recusa, com máximo de **100**
caracteres — não há máximo publicado para os formatos legados.

## 9. Erros

Uma única classe, `InvalidChannelReferenceError extends DomainError`, com um
discriminante `reason`.

### Por que uma classe e não seis

O `ErrorCode` de `shared/errors` é um conjunto fechado e transversal. Criar
`InvalidYouTubeHandleError`, `InvalidYouTubeHostnameError` e companhia obrigaria
a acrescentar códigos específicos do YouTube em `shared` — e a camada
compartilhada passaria a conhecer handles e hostnames. O conceito ficaria no
lugar errado.

Com o discriminante, `code` permanece `VALIDATION_ERROR` (vocabulário comum, que
a apresentação usa para escolher o status HTTP) e o detalhe fica dentro do
módulo, onde pertence.

### Por que lança em vez de devolver `Result`

O projeto já tem um padrão de erro: `AppError` e subclasses, lançadas. Não existe
`Result` no código. Introduzir um só aqui criaria dois padrões convivendo, e a
porta `ChannelResolver` já declara `@throws`. Se uma tela futura precisar de um
caminho sem exceção, o certo é acrescentar `tryParse` ao lado — não trocar o
padrão do projeto.

### Motivos

| `reason`                  | Quando                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `empty_input`             | Vazia ou só espaços                                           |
| `malformed_url`           | Parece URL, mas não pode ser interpretada                     |
| `unsupported_protocol`    | Protocolo diferente de `http`/`https`                         |
| `credentials_in_url`      | URL com usuário e senha embutidos                             |
| `unsupported_host`        | Domínio fora da lista permitida                               |
| `not_a_channel_url`       | URL do YouTube, mas de vídeo, Shorts, playlist, busca ou live |
| `unknown_path`            | URL do YouTube sem formato de canal reconhecível              |
| `invalid_channel_id`      | Não passa em `/^UC[A-Za-z0-9_-]{22}$/`                        |
| `invalid_handle`          | Handle vazio, longo demais ou com caractere proibido          |
| `invalid_custom_name`     | Nome personalizado inválido                                   |
| `invalid_legacy_username` | Nome de usuário inválido                                      |
| `unrecognized_input`      | Texto que não se parece com URL, handle nem ID                |

### Segurança da mensagem

**Nenhuma mensagem de erro interpola a entrada, e o contexto do erro não a
carrega.** Motivo direto: a entrada pode conter credenciais
(`https://usuario:senha@youtube.com/…`) e mensagens de erro acabam em log. Quem
chamou a função já tem o valor e decide, com o contexto que tem, se é seguro
exibi-lo. Há teste cobrindo isso.

## 10. Casos limítrofes

| Caso                             | Decisão                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/@canal/shorts` × `/shorts/abc` | A mesma palavra em posições diferentes: aba do canal no primeiro, vídeo no segundo. Resolvido pela posição no caminho. |
| `youtube.com.exemplo.net`        | Recusado. Igualdade exata de hostname, nunca sufixo.                                                                   |
| `https://www.youtube.com/@`      | `invalid_handle`, não `unknown_path`: a intenção é reconhecível, o conteúdo é que falta.                               |
| `UC123`                          | `invalid_channel_id`, não `unrecognized_input`: parece uma tentativa de ID, e o erro específico ajuda mais.            |
| `UCLA` (nome que começa com UC)  | Recebe `invalid_channel_id`. Consequência aceita da regra acima.                                                       |
| `https://youtube.com/channel/`   | `invalid_channel_id` — a rota é de canal, falta o identificador.                                                       |
| Handle acentuado codificado      | Decodificado antes de validar. Ver 6.4.                                                                                |
| Caixa do hostname                | Normalizada. Caixa do identificador, preservada.                                                                       |
| `originalInput` com espaços      | Preservado com os espaços; só a análise usa a versão aparada.                                                          |

## 11. Critérios de aceitação

- [x] SPEC-002 criada, com todos os formatos suportados documentados
- [x] Função de parsing pura: sem rede, banco, SDK, `process.env` ou `Date`
- [x] URLs de vídeo, Shorts, playlist, busca e live recusadas
- [x] Entradas válidas devolvem referência discriminada por `kind`
- [x] Regras de erro explícitas e documentadas
- [x] Testes cobrindo os 26 casos exigidos, válidos e inválidos
- [x] Módulo exporta apenas a superfície pública
- [x] Testes arquiteturais continuam passando
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` e
      `npm run verify` passam

## 12. Fora do escopo

- Resolver handle, `/c/` ou `/user/` para o ID oficial — exige rede.
- Verificar se o canal **existe**. Esta SPEC valida forma, não existência.
- Qualquer chamada à YouTube Data API, cache, banco, autenticação ou quota.
- Rota HTTP, formulário, Server Action ou tela.
- Extração de referência a partir de URL de vídeo (`/watch?v=…` → canal do
  vídeo). Seria conveniente, mas exige uma chamada à API e mistura dois
  conceitos; se for desejada, vira SPEC própria.

## 13. Estratégia futura para resolver o ID oficial

O adaptador de `ChannelResolver` (SPEC futura, camada `infrastructure`) deverá:

1. Chamar `parseYouTubeChannelReference` **primeiro**. Entrada inválida é
   recusada offline, sem gastar quota.
2. Se `kind === 'channel_id'`, **devolver o valor direto**. Zero unidades de
   quota — é por isso que a variante é tipada como `YouTubeChannelId`.
3. Se `kind === 'handle'`, resolver via `channels.list?forHandle=@nome`.
4. Se `kind === 'legacy_username'`, resolver via `channels.list?forUsername=nome`.
5. Se `kind === 'custom_name'`, não há endpoint direto; a via provável é
   `search.list`, que custa 100 unidades e **não garante correspondência exata**.
   Esse custo precisa ser decidido explicitamente na SPEC do adaptador, não
   improvisado.
6. Cachear a associação `canonicalPath → YouTubeChannelId`. Handles e nomes
   mudam raramente, e o `canonicalPath` desta SPEC foi desenhado para ser a
   chave desse cache.
7. Traduzir falhas para `NotFoundError`, `QuotaExceededError` ou
   `ExternalServiceError`, conforme ADR-004.

O ponto 5 é o risco conhecido: `/c/` é o formato mais caro e menos confiável de
resolver. Vale medir quantos usuários realmente informam esse formato antes de
gastar 100 unidades por tentativa.
