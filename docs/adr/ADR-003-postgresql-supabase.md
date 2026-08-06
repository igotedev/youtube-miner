# ADR-003 — PostgreSQL via Supabase

| Campo        | Valor            |
| ------------ | ---------------- |
| Status       | Aceita           |
| Data         | 2026-08-06       |
| Relacionadas | ADR-001, ADR-004 |

## Contexto

O produto precisa persistir usuários, análises, snapshots brutos de coleta,
métricas calculadas, relatórios de IA e listas de canais. E precisa de
autenticação.

O formato dos dados tem duas naturezas distintas, e isso importa na escolha:

- **Relacional** — usuário tem listas; canal tem várias análises (RN-03);
  análise pertence a um usuário. Consultas cruzam essas relações o tempo todo.
- **Documento** — o snapshot bruto da API do YouTube é um payload aninhado,
  cujo formato o produto não controla e que pode mudar sem aviso.

Também é preciso separar fisicamente três corpos de dados que nunca devem se
misturar: bruto, calculado e gerado por IA (RN-04, RN-05).

## Decisão

**PostgreSQL, provisionado pelo Supabase**, com **Supabase Auth** para
autenticação.

PostgreSQL cobre as duas naturezas: relacional para o modelo, e `jsonb` para o
snapshot bruto — com índice GIN quando necessário. Não é preciso um segundo
banco.

Supabase entra como provedor gerenciado: banco, autenticação, Row Level Security
e migrações versionadas em `supabase/migrations/`, sem operar infraestrutura.

Restrições que acompanham a decisão:

- **Nenhum SDK do Supabase em `domain` ou `application`** (R2). O acesso passa
  por `AnalysisRepository`, `WatchlistRepository`, `AuthGateway` — interfaces
  definidas pela aplicação, implementadas em `infrastructure`.
- **RN-04 e RN-05 são físicas.** Snapshot bruto, métricas e relatório de IA
  ficam em colunas ou tabelas separadas. Nunca em um único blob "resultado".
- **`SUPABASE_SERVICE_ROLE_KEY` nunca vai ao navegador.** Ela ignora RLS. Só
  `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` podem ser
  públicas — e mesmo assim protegidas por RLS.
- **RLS ativada em toda tabela com dado de usuário**, desde a primeira migração.
  Ligar depois significa auditar o que já vazou.
- **Migrações versionadas e para frente.** Nunca editar migração já aplicada.

## Alternativas consideradas

### PostgreSQL autogerenciado (Docker, VPS, RDS)

Rejeitada por ora. Mais controle e sem dependência de fornecedor, mas exige
operar backup, réplica, atualização e monitoramento — e ainda deixaria a
autenticação para resolver. Custo desproporcional para a fase.

### MongoDB

Rejeitada. Confortável para o snapshot bruto, desconfortável para todo o resto.
O modelo é essencialmente relacional, e `jsonb` já cobre a parte de documento
sem abrir mão de junções e transações.

### Firebase / Firestore

Rejeitada. Boa autenticação, mas modelo de dados que penaliza consulta
relacional e cobrança por leitura difícil de prever em telas que agregam muitos
registros.

### PlanetScale / MySQL gerenciado

Rejeitada. Sem `jsonb` equivalente e sem autenticação integrada — sobraria um
segundo fornecedor para resolver o login.

## Consequências positivas

- Banco relacional maduro, com transações e junções.
- `jsonb` guarda o snapshot bruto sem forçar um esquema sobre dado de terceiro.
- Autenticação resolvida sem construir gestão de sessão e senha.
- RLS como segunda camada de autorização, no banco, além da checagem em
  `application`.
- Migrações versionadas no próprio repositório.
- Sem infraestrutura para operar nesta fase.

## Consequências negativas

- **Dependência de fornecedor.** Mitigada: é PostgreSQL padrão por baixo, e todo
  acesso passa por repositórios (R2/R3). Migrar significa reescrever adaptadores,
  não regra de negócio. A autenticação é a parte mais presa — daí o `AuthGateway`
  existir desde já.
- **RLS é fácil de configurar errado.** Uma policy permissiva anula a proteção.
  Mitigação: policies revisadas junto com a migração que as cria, e nunca confiar
  só em RLS — autorização também é verificada em `application`.
- **Latência de rede em cada consulta.** Aceitável na escala atual.
- **Limites do plano gratuito.** Previsível; problema de contrato, não de código.
- **`service_role` é uma chave perigosa.** Mitigação: R8 restringe leitura de
  `process.env`, e `src/config/env.ts` lança se importado no navegador.

## Condições que justificariam revisão

- Volume ou custo que torne o plano gerenciado pior que operar o próprio banco.
- Necessidade de autenticação que o Supabase Auth não atenda (SSO corporativo,
  requisito regulatório específico).
- Limitação de RLS que force mover toda a autorização para a aplicação — nesse
  caso, boa parte do valor do Supabase se perde.
