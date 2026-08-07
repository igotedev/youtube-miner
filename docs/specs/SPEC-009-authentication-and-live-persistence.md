# SPEC-009 — Autenticação e persistência ligada

| Campo      | Valor                                                          |
| ---------- | -------------------------------------------------------------- |
| Status     | Implementada                                                   |
| Data       | 2026-08-07                                                     |
| Módulos    | `identity`, `channel-analysis`, `youtube-collection`, `config` |
| Depende de | SPEC-004 (esquema), SPEC-006 (composição), SPEC-008, ADR-006   |

---

## 1. Contexto

Havia um adaptador de persistência pronto, testado contra o Postgres real, e
desligado. A razão era uma linha do esquema:

```sql
user_id uuid not null references auth.users (id) on delete cascade
```

O dono das análises era `DEMONSTRATION_USER_ID`, um UUID inventado que não
existia em `auth.users`. Ligar os repositórios do Supabase produziria violação de
chave estrangeira na primeira análise.

Autenticação deixou de ser funcionalidade desejável e passou a ser o **bloqueio
literal** do produto. Esta SPEC a implementa e, com ela, liga a persistência.

O método escolhido — magic link por e-mail — e as três decisões de segurança que
o acompanham estão no **ADR-006**. Este documento descreve o que foi construído.

## 2. Escopo

**Inclui:**

- Autenticação por link de acesso: telas `/entrar` e `/auth/callback`, saída,
  proxy de sessão.
- `AuthGateway` completo e o adaptador `SupabaseAuthGateway`.
- Troca dos repositórios em memória pelos do Supabase na raiz de composição.
- `ChannelDirectory`, a porta que faltava para a análise poder referenciar um
  canal (seção 5).
- `supabase/config.toml` versionado, com a allow-list de redirecionamento.

**Não inclui:**

- Tela de histórico de análises. A análise é persistida, mas a tela ainda só
  mostra o resultado da execução recém-disparada. Ver seção 8.
- Perfil, troca de e-mail, exclusão de conta.
- Google OAuth — adiado com motivo registrado no ADR-006.

## 3. O que o usuário faz

```
/analise sem sessão
   └─ proxy redireciona → /entrar?next=%2Fanalise
        └─ informa o e-mail → Server Action → link enviado
             └─ clica no link → GoTrue → /auth/callback?code=...
                  └─ troca o código pela sessão, grava cookies
                       └─ volta para /analise, já autenticado
```

Não há senha, não há cadastro separado, não há recuperação. A conta é criada no
primeiro acesso.

### A tela não revela quem tem conta

A resposta é a mesma para endereço cadastrado e não cadastrado: _"se este
endereço puder receber e-mails, um link acabou de ser enviado"_. A porta
`sendMagicLink` não informa qual dos dois casos ocorreu — quem chama **não tem
como** responder de forma diferente, nem por engano.

## 4. Onde a autorização é verificada

Em **três camadas independentes**, e a de cima é a mais fraca de propósito:

| Camada                             | O que faz                                         | Vale como segurança? |
| ---------------------------------- | ------------------------------------------------- | -------------------- |
| `src/proxy.ts`                     | redireciona quem não tem sessão                   | **Não** — navegação  |
| Server Action / página             | `getCurrentUser()` antes de qualquer trabalho     | **Sim**              |
| Assinatura da porta + RLS no banco | `findById(id, ownerId)` não aceita busca sem dono | **Sim**              |

O proxy não é a fronteira de autorização. O motivo completo está no ADR-006,
item 4; em resumo: um ponto único de verificação longe do recurso protegido é uma
classe de defeito, porque toda rota nova que o `matcher` não cobrir nasce
desprotegida.

`getCurrentUser()` usa `getUser()`, que **verifica o token contra o servidor
Auth**. Nunca `getSession()`, que devolveria o conteúdo do cookie sem verificar —
e cookie é dado enviado pelo cliente.

### Redirecionamento aberto

O parâmetro `next` chega pela URL. `safeRedirectPath` (função pura, 22 testes) só
deixa passar caminho relativo da própria aplicação.

Sem ela, um link como `/entrar?next=https://site-do-atacante/entrar` levaria a
vítima a fazer login **de verdade** no nosso domínio — cadeado, URL correta, tudo
conferindo — e em seguida a despejaria em uma cópia da nossa tela de acesso,
hospedada por outra pessoa. A confiança é emprestada do nosso domínio; o
formulário é do atacante.

Barrado também: `//outro.site` e `/\outro.site`, que são protocolo-relativos e
começam com barra; esquemas executáveis; e caracteres de controle, que cada
navegador interpreta de um jeito.

A segunda barreira é a `additional_redirect_urls` em `supabase/config.toml` — o
GoTrue não tem como saber que o `emailRedirectTo` veio do nosso servidor.

## 5. O defeito que só apareceu contra o banco

**A análise era criada apontando para um canal que ainda não existia.**

`channel_analyses.channel_id` referencia `youtube_channels`. Quem registrava o
canal era a **coleta** — que só começa depois de `analyses.create`. Contra o
PostgreSQL, a primeira análise de qualquer canal novo falhava com violação de
chave estrangeira.

O repositório em memória aceita qualquer identificador de canal, então nenhum
teste unitário pegava. Apareceu na primeira execução do pipeline contra o banco.

A correção é a porta **`ChannelDirectory`**, que o ADR-005 já previa pelo nome
como a forma correta de um módulo garantir que o canal existe sem consultar a
tabela alheia. `StartChannelAnalysis` chama `ensureRegistered` antes de criar a
análise.

Dois testes travam a ordem: um afirma que o canal ficou registrado, outro que a
análise **não** é criada se o registro falhar. Só o primeiro não bastaria —
mover a chamada para depois de `analyses.create` o manteria passando.

### Dois defeitos menores, mesma origem

- **O fixture de demonstração usava um ID de canal inválido**: `UC` + 21
  caracteres, quando a RN-01 do próprio projeto exige 22. Invisível porque o fake
  devolve o valor pronto, sem validar. Agora há teste do fixture.
- **O barrel da composição arrastava `node:crypto` para o Edge Runtime.** Um
  reexport estático carrega o módulo inteiro; pelo barrel vinha o pipeline de
  análise completo. O proxy passou a importar `@/config/composition/auth`.

## 6. A composição não tem modo de demonstração para identidade

A coleta tem: sem `YOUTUBE_API_KEY`, o pipeline usa um fixture e a tela avisa. O
prejuízo de um fixture visível é nenhum.

**A autenticação não tem, e a ausência é a decisão.** Uma sessão falsa escolhida
por engano — uma variável com o nome digitado errado bastaria — faria de todos os
visitantes o mesmo usuário, com acesso às análises uns dos outros, e nada na tela
denunciaria isso. Falha silenciosa, em identidade.

Sem Supabase configurado, a composição **falha dizendo o nome da variável que
falta**. Uma aplicação que não sobe é um problema visível; uma que sobe
compartilhando contas não é.

Pelo mesmo motivo não há modo em memória para a persistência: uma análise que
some ao reiniciar o servidor não é degradação aceitável.

`FakeAuthGateway` existe, vive em `infrastructure/fake/` e **nenhum caminho de
produção o alcança**.

### Qual credencial cada lado usa

| Lado         | Chave        | Por quê                                                 |
| ------------ | ------------ | ------------------------------------------------------- |
| Persistência | service role | escreve em tabelas globais e avança o estado da análise |
| Autenticação | anon         | atua **como** o usuário e respeita o RLS                |

Há teste afirmando que o pipeline **não** exige a chave anon. Se um dia passar a
exigir, alguém colocou nele um caminho que atua como usuário — e isso merece
revisão, não um ajuste no teste.

## 7. Verificação

### Automatizada

| Suíte                      | Resultado                           |
| -------------------------- | ----------------------------------- |
| `npm run verify`           | 468 testes, typecheck e lint limpos |
| `npm run test:integration` | 52 testes contra o Postgres real    |
| `npm run db:test`          | 108 asserções pgTAP                 |
| `npm run build`            | limpo, sem avisos                   |

O teste de ponta a ponta do pipeline **saiu do unitário e virou de integração**.
Antes ele rodava sobre repositórios em memória e provava que os casos de uso
conversam entre si; agora roda contra o Postgres, com um usuário real criado pela
API administrativa, e prova também que a análise sobrevive a um pipeline montado
do zero. Ficou mais lento e ficou muito mais forte.

### Manual, contra o servidor de desenvolvimento

O fluxo do e-mail não é coberto por teste automatizado — o link só existe depois
de o provedor enviá-lo. Foi exercitado por HTTP, fazendo o que um navegador sem
JavaScript faz: postando o formulário com os campos ocultos e carregando os
cookies de uma requisição para a próxima.

Os cookies importam mais do que parece: o fluxo é PKCE, e o _code verifier_ fica
em cookie **no navegador que pediu o link**. Abrir o link em outro navegador
falha, por desenho.

21 passos verificados, incluindo: redirecionamento com `next` preservado, envio
do e-mail, troca do código pela sessão, análise real do canal
`UCX6OQ3DkcsbYNE6H8uQQuVA` (50 vídeos, 3 unidades de quota), os dois painéis de
formato separados na tela, a linha em `channel_analyses`, e a saída invalidando a
sessão.

**Sobrevivência ao reinício**, medida derrubando o processo e subindo outro: a
sessão continua reconhecida e as análises continuam no banco. Remover o usuário
levou as análises junto e preservou os canais globais — o modelo do ADR-005
funcionando.

## 8. Limitação conhecida

**A tela não lista análises anteriores.** Elas estão persistidas — a consulta do
banco confirma —, mas `/analise` só mostra o resultado da execução que acabou de
ser disparada, porque o estado vem do `useActionState`.

Isso é escopo de uma SPEC de histórico, não desta. Registrado aqui para que
"a análise sumiu" não seja diagnosticado como defeito de persistência: o dado
está lá, falta a tela que o busca.

## 9. Critérios de aceitação

- [x] O usuário entra com um link enviado por e-mail, sem senha em lugar nenhum.
- [x] A tela de acesso não distingue conta existente de inexistente.
- [x] `getUser()` em todo caminho que decide identidade; `getSession()` em nenhum.
- [x] Autorização verificada dentro de cada Server Action e rota, não apenas no proxy.
- [x] `next` validado contra redirecionamento aberto, com teste.
- [x] A análise é gravada no PostgreSQL e sobrevive ao reinício do servidor.
- [x] Sem Supabase configurado, a composição falha nomeando a variável — não cai
      para memória nem para sessão falsa.
- [x] Remover o usuário apaga as análises dele e preserva os artefatos globais.
- [x] `npm run verify` continua passando sem Docker.

## 10. Fora de escopo, registrado

- Histórico de análises na tela (seção 8).
- Google OAuth — ADR-006 registra o motivo do adiamento e a condição de revisão.
- Segundo fator, gestão de sessões ativas, exclusão de conta pelo usuário.
- A dívida do `resolveInternalChannelId` em `SupabaseAnalysisRepository`
  permanece: `ChannelDirectory` resolve o registro, não a tradução entre o
  `UC...` e o UUID interno, que é mapeamento dentro de `infrastructure`.
