# ADR-006 — Sessão por cookie com Supabase Auth

| Campo        | Valor                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| Status       | Aceita                                                                  |
| Data         | 2026-08-07                                                              |
| Relacionadas | ADR-002, ADR-003, ADR-005                                               |
| Altera       | Nenhum ADR anterior. Concretiza a autenticação que o ADR-003 pressupôs. |

## Contexto

A persistência estava pronta e não podia ser ligada. `channel_analyses.user_id`
é `not null references auth.users (id)`, e não havia usuário: a composição usava
um UUID fabricado. Trocar os repositórios em memória pelos do Supabase
produziria violação de chave estrangeira na primeira análise.

Autenticação deixou de ser uma funcionalidade desejável e passou a ser o
bloqueio literal do produto.

Três perguntas precisavam de resposta registrada, porque cada uma tem
alternativa razoável e consequência de segurança:

1. **Qual método de autenticação?**
2. **Onde a sessão vive, e como o servidor confia nela?**
3. **Onde a autorização é decidida?**

## Decisão

### 1. Magic link por e-mail, não senha

O usuário informa o e-mail e recebe um link de acesso. Não há senha em lugar
nenhum do produto.

Razões, em ordem de peso:

- **O que não se guarda não vaza.** Sem senha não há hash para vazar, política
  de complexidade para discutir, nem reuso de credencial de outro site para nos
  contaminar.
- **Elimina superfície inteira.** Sem "esqueci minha senha" — que é, ele
  próprio, um fluxo de magic link, só que mais fácil de errar. Sem troca de
  senha, sem reautenticação para trocá-la.
- **Cadastro e login são o mesmo ato.** `shouldCreateUser` cria a conta se ela
  não existir. Não há duas telas, dois fluxos, dois estados.
- **Não vaza quem tem conta.** A tela responde a mesma coisa para endereço
  cadastrado e não cadastrado. Um formulário de login com senha responde
  "usuário não encontrado" e vira um oráculo de enumeração de contas.

O custo é real e aceito: **o login depende da entrega de e-mail.** Caixa de
spam, atraso de provedor e endereço digitado errado viram falha de acesso. Para
o MVP, cujo público faz login raramente e cujo dado não é crítico, o custo é
menor que o de manter senhas.

### 2. A sessão vive em cookie, gerida por `@supabase/ssr`

A alternativa era guardar o token no `localStorage`, que é o padrão do
`supabase-js` no navegador.

**Rejeitada.** O produto é renderizado no servidor (ADR-002), e o `localStorage`
não existe lá: nenhum Server Component, Server Action ou Route Handler
conseguiria saber quem é o usuário. A análise roda no servidor por
obrigação — a chave da API do YouTube e a service role não podem ir ao
navegador — então o servidor **precisa** conhecer o usuário. Cookie é o único
transporte que atravessa as duas pontas.

`@supabase/ssr` entra como dependência por isto, e apenas por isto: é o pacote
oficial que implementa o fluxo PKCE com cookies em ambientes de renderização no
servidor. Escrever isso à mão significaria reimplementar troca de código por
sessão, rotação de refresh token e coordenação de escrita de cookie entre
middleware e handler — trabalho de segurança sem nada de específico do nosso
produto.

### 3. `getUser()`, nunca `getSession()`

**Esta é a decisão com maior consequência prática, e a mais fácil de errar.**

`getSession()` lê o cookie e devolve o que estiver lá. Não verifica assinatura
com o servidor de autenticação. Cookie é dado enviado pelo cliente, e dado
enviado pelo cliente pode ser forjado — um `user.id` inventado passaria.

`getUser()` valida o token contra o servidor Auth antes de devolver.

Regra: **no servidor, a identidade vem sempre de `getUser()`.** O custo é uma
chamada de rede por requisição autenticada. Aceito sem hesitação: a alternativa
é confiar em dado do cliente para decidir de quem é uma análise.

Fica confinado ao adaptador `SupabaseAuthGateway`. O resto da aplicação pede
"quem é o usuário atual" à porta `AuthGateway` e nunca lê cookie.

### 4. O middleware não é a fronteira de autorização

O middleware renova o cookie de sessão e redireciona quem não está autenticado
para `/entrar`. Isso é **conveniência de navegação**, não segurança.

A verificação que vale acontece dentro de cada Server Action e de cada rota, com
`getCurrentUser()`, imediatamente antes de qualquer trabalho.

Razão: middleware de framework já foi contornável — o Next.js teve uma falha
justamente disso (CVE-2025-29927), em que um cabeçalho forjado pulava a execução
do middleware. Mas a razão não depende de uma CVE específica. **Um ponto único de
verificação distante do recurso protegido é uma classe de defeito**, não um
incidente: qualquer rota nova que o `matcher` não cubra nasce desprotegida, e
ninguém percebe até alguém procurar.

A autorização mora junto do dado. As portas já foram desenhadas assim —
`findById(id, ownerId)` não aceita busca sem dono (ADR-005) — e o RLS no banco é
a terceira camada.

## Alternativas consideradas

### E-mail e senha

Rejeitada pelo item 1. Acrescentaria armazenamento de credencial, fluxo de
recuperação, política de força de senha e um oráculo de enumeração de contas, em
troca de não depender da entrega de e-mail. Troca ruim para este produto.

### Google OAuth

Adiada, não descartada. O encaixe com o público é evidente — quem tem canal no
YouTube tem conta Google — e resolve a dependência de entrega de e-mail.

Não entra agora por dois motivos: exige credenciais OAuth registradas no Google
Cloud, o que impede o fluxo de rodar na stack local sem configuração externa; e
autenticar com Google induziria o usuário a esperar acesso aos **dados privados**
do canal dele, que o produto não coleta (exigiria escopo do YouTube Analytics e
consentimento). Prometer isso pela tela de login seria quebrar a primeira regra
de produto.

Quando entrar, entra **ao lado** do magic link, não no lugar dele.

### Sessão própria, sem Supabase Auth

Rejeitada. O esquema já referencia `auth.users` e o RLS já usa `auth.uid()`
(SPEC-004). Uma sessão própria exigiria reimplementar as duas coisas e manter
uma tabela de usuários paralela à do Supabase — dois lugares para a mesma
verdade.

### Verificar autenticação apenas no middleware

Rejeitada pelo item 4.

## Consequências positivas

- **Nenhuma senha existe no sistema.** Nem em trânsito, nem em repouso, nem em
  log, nem em backup.
- O servidor conhece o usuário em qualquer camada de renderização, o que é
  pré-requisito para a análise rodar no servidor.
- A tela de login não distingue conta existente de inexistente.
- `channel_analyses.user_id` passa a apontar para um usuário real, e a
  persistência destrava.
- Autorização verificada junto do recurso, em três camadas independentes:
  assinatura da porta, verificação na ação e RLS no banco.

## Consequências negativas

- **Acesso depende de entrega de e-mail.** É o modo de falha dominante do
  produto agora. Spam, atraso e digitação errada viram "não consigo entrar".
- **Uma chamada de rede a mais por requisição autenticada**, por causa do
  `getUser()`. Mensurável, e o preço de não confiar em cookie.
- **Uma dependência nova** (`@supabase/ssr`) e o acoplamento ao fluxo de
  autenticação do fornecedor, que o ADR-004 já registrava como risco do Supabase.
- Cookie exige atenção com CSRF. As Server Actions do Next já trazem proteção
  por origem, e a saída é POST justamente por isso — um `GET /sair` seria
  acionável por uma tag `<img>` em qualquer página.
- Links de acesso ficam na caixa de entrada. Quem tem acesso ao e-mail tem acesso
  à conta — verdade também na recuperação de senha, mas aqui é o caminho
  principal e não a exceção.

## Condições que justificariam revisão

- Se a entrega de e-mail se mostrar o principal motivo de abandono, Google OAuth
  deixa de ser adiável.
- Se o produto passar a guardar dado sensível, o magic link sozinho deixa de
  bastar e entra segundo fator.
- Se aparecer necessidade de acesso a dados privados do canal, o OAuth do Google
  passa a ser exigência técnica, não conveniência — e aí o modelo de identidade
  muda por inteiro.
- Se o Next.js oferecer uma fronteira de autorização confiável antes da rota, o
  item 4 pode ser reavaliado. A verificação junto do dado permanece de qualquer
  forma.
