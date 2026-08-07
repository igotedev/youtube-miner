# SPEC-008 — Persistência das execuções de coleta

| Campo      | Valor                                                    |
| ---------- | -------------------------------------------------------- |
| Status     | Implementada                                             |
| Data       | 2026-08-07                                               |
| Módulos    | `youtube-collection`                                     |
| Depende de | SPEC-004 (esquema), SPEC-007 (adaptador da API), ADR-005 |

---

## 1. Contexto

O esquema PostgreSQL da SPEC-004 existe e está validado em execução — migração
aplicada, 108 asserções pgTAP passando. O adaptador real da YouTube Data API da
SPEC-007 existe e traz dado verdadeiro. Entre os dois havia um vazio: **nenhum
código escrevia no banco.**

`CollectionRunRepository` tinha uma única implementação, em memória. Toda
coleta era descartada ao fim do processo, e a RN-10 — reaproveitar uma coleta
recente em vez de gastar quota — funcionava apenas dentro de uma execução do
servidor. Reiniciar o `next dev` zerava tudo.

Esta SPEC entrega o adaptador Supabase dessa porta e, com ele, a primeira
gravação real do projeto.

## 2. Escopo

**Inclui:**

- `SupabaseCollectionRunRepository` — implementação completa dos sete métodos da
  porta.
- Os mapeadores entre linha e entidade (`collection-run-row.ts`).
- A função `complete_collection_run` no Postgres, para conclusão transacional.
- Correção das permissões da `service_role` (defeito da migração inicial).
- Testes de integração contra o Postgres real, em configuração separada.

**Não inclui:**

- Ligar o adaptador na raiz de composição. Ver seção 7 — está bloqueado por
  autenticação, não por falta de código.
- `SupabaseAnalysisRepository`. A porta de análises tem FK para `auth.users` e
  cai no mesmo bloqueio.

## 3. Dois identificadores, e confundi-los seria desastroso

O domínio conhece um canal por `UC...` (RN-01). O banco usa um `uuid` interno
como chave estrangeira, porque o `UC...` é dado de terceiro e não deve virar
chave primária de nada nosso.

Toda consulta por canal atravessa essa fronteira. É por isso que existe
`findInternalChannelId`, e é por isso que `RUN_COLUMNS` carrega o join
`youtube_channels ( youtube_channel_id )`: a entidade que sai do repositório
precisa falar `UC...`, não `uuid`.

`ensureChannel` registra o canal quando ele ainda não existe. Usa `upsert` com
`ignoreDuplicates` em vez de consultar-e-inserir: duas análises do mesmo canal
novo chegando juntas violariam o UNIQUE, e isso não é conflito de negócio — é a
mesma coisa sendo registrada duas vezes.

## 4. Por que concluir uma coleta é uma função no banco

Concluir uma coleta grava quatro coisas: o estado da execução, o snapshot do
canal, os snapshots dos vídeos e os campos denormalizados do canal.

**O cliente do Supabase não abre transação.** Cada chamada é independente. Em
quatro chamadas, uma falha entre a segunda e a terceira deixaria uma execução
`completed` **sem vídeos** — e a RN-10 reaproveitaria exatamente essa execução,
servindo um snapshot vazio como se fosse um canal sem vídeos.

O erro não apareceria na hora. Apareceria como métricas silenciosamente erradas
na análise de outra pessoa, horas depois.

O corpo de uma função `plpgsql` roda em uma única transação. Ou grava tudo, ou
não grava nada.

### Idempotência

Os dois `insert` usam `on conflict do nothing`. Um retry de rede depois de uma
gravação bem-sucedida não duplica vídeo nem estoura constraint. Sobrescrever o
snapshot já gravado seria pior que ignorá-lo: misturaria duas leituras da API em
uma só linha.

### `last_seen_at` não anda para trás

`last_seen_at = greatest(last_seen_at, p_captured_at)`, e não atribuição direta.

Semanticamente, "última vez que vimos o canal" não pode retroceder — uma coleta
antiga concluída fora de ordem (retry demorado, fila atrasada) reescreveria o
campo com data anterior à captura mais recente que já temos.

E, na prática, a constraint `youtube_channels_seen_order` exige
`last_seen_at >= first_seen_at`. Sem `greatest`, uma captura anterior ao
registro do canal derrubaria a transação inteira — e com ela a coleta, que não
tem culpa nenhuma. Isso foi encontrado por teste de integração, não por leitura.

### Permissões da função

A função escreve em quatro tabelas **globais**, sem policy para `authenticated`
(ADR-005). Expô-la ao cliente permitiria a qualquer usuário autenticado marcar
uma execução como concluída com dados inventados, que a RN-10 depois serviria a
outras pessoas. Execução revogada de `public`, `anon` e `authenticated`;
concedida só à `service_role`.

Não é `security definer` — não há escalonamento de privilégio. Quem chama já
precisa de permissão de escrita.

## 5. O defeito que só a execução revelou

A primeira consulta do adaptador com cliente real falhou com
`permission denied for table youtube_channels`. Nenhum adaptador Supabase
funcionava — nem leitura.

A causa está no default ACL do schema `public` para tabelas criadas pelo papel
`postgres`:

```
postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm
```

`Dxtm` é TRUNCATE, REFERENCES, TRIGGER e MAINTAIN. Falta exatamente `arwd` —
SELECT, INSERT, UPDATE e DELETE. A `service_role` recebia permissão para
**truncar** as tabelas e nenhuma para ler uma linha.

**Por que os 108 testes pgTAP não pegaram.** Eles rodam como `postgres`,
superusuário. Verificam que o esquema está correto — e ele está. O que faltava
era permissão, e permissão só aparece quando alguém se conecta **como** a
service role.

A correção (`20260807010000_service_role_grants.sql`) concede `arwd` sobre as
tabelas atuais e altera o **default privilege** do schema, para que a próxima
migração que criar uma tabela não reintroduza o mesmo defeito. Pelo lado
oposto, revoga o default de `anon` e `authenticated` — sem isso, uma tabela nova
nasceria com permissão de TRUNCATE para o navegador.

Lição registrada: **teste de esquema não é teste de permissão.**

## 6. Testes de integração

`tests/integration/`, executados por `npm run test:integration`, com
configuração própria (`vitest.integration.mts`).

**Deliberadamente fora de `npm run verify`.** Estes testes exigem o Supabase
local no ar. Se rodassem em `verify`, o comando que diz se o código está pronto
passaria a exigir Docker — e um `verify` que não roda em qualquer máquina deixa
de ser usado.

21 testes cobrindo:

| Grupo                    | O que afirma                                                                  |
| ------------------------ | ----------------------------------------------------------------------------- |
| `startRun`               | registro do canal, reuso da linha existente, recusa de segunda execução ativa |
| `completeWithSnapshot`   | carimbos, ida e volta de canal e vídeos, idempotência, `last_seen_at`         |
| `findReusableForChannel` | RN-10: validade, invalidação, execução em andamento, canal nunca coletado     |
| `findActiveForChannel`   | detecção de execução em andamento                                             |
| `findSnapshot`           | `null` para execução inexistente e para execução sem snapshot                 |

Três asserções merecem destaque, porque atravessam o banco e não apenas a
memória:

- **RN-08.** Ausência continua `null` depois de ida e volta pelo Postgres. Um
  mapeador descuidado transformaria `null` em `0` no caminho, e o produto passaria
  a afirmar que um canal com inscrições ocultas tem zero inscritos.
- **`bigint`.** Contagem acima de 2³¹ sobrevive. Um canal grande estoura `integer`.
- **Os três formatos**, inclusive `unknown`. Vídeo sem duração conhecida não pode
  virar `short` por omissão — misturaria as métricas que a RN-06 separa.

Cada teste gera IDs de canal únicos via `randomUUID`, e `afterAll` remove o que
criou. Testes que dependem de estado deixado por outro teste falham na ordem
errada e passam na certa, o que é pior que falhar sempre.

## 7. O que falta para isto aparecer na tela

O adaptador está pronto e testado, mas a raiz de composição continua montando
repositórios em memória. **Isso é intencional.**

`channel_analyses.user_id` é `not null references auth.users (id)`. O
`DEMONSTRATION_USER_ID` da SPEC-006 é um UUID inventado, que não existe em
`auth.users`. Trocar o adaptador agora produziria violação de chave estrangeira
na primeira análise.

A ordem correta é: **autenticação primeiro, persistência depois.** Enfraquecer a
FK para destravar a demonstração seria trocar uma restrição de integridade real
por conveniência temporária — e a restrição existe justamente para garantir que
toda análise pertença a alguém.

## 8. Critérios de aceitação

- [x] `SupabaseCollectionRunRepository` implementa os sete métodos da porta.
- [x] A conclusão de uma coleta é atômica: ou grava as quatro coisas, ou nenhuma.
- [x] Repetir a conclusão da mesma execução não duplica nem falha.
- [x] `null` atravessa o banco como `null` (RN-08).
- [x] A `service_role` lê e escreve; `anon` e `authenticated` não alcançam as
      tabelas globais.
- [x] 21 testes de integração passam contra o Postgres real.
- [x] `npm run verify` continua passando sem Docker.

## 9. Fora de escopo, registrado

- Ligar os adaptadores na composição — bloqueado por autenticação (seção 7).
- `SupabaseAnalysisRepository` — mesmo bloqueio.
- Paginação além de 50 vídeos, invalidação por evento, limpeza de coletas
  antigas. Nada disso tem demanda ainda.
