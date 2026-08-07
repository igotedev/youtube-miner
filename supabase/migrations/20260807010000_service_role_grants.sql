-- =============================================================================
-- SPEC-008 — Permissoes da service role
--
-- CORRIGE UM DEFEITO DA MIGRACAO INICIAL, encontrado na primeira execucao de um
-- teste de integracao com cliente real.
--
-- O que acontecia: toda consulta da service role falhava com
-- `permission denied for table youtube_channels`. Nenhum adaptador Supabase
-- funcionava — nem leitura.
--
-- A causa esta no default ACL do schema `public` para tabelas criadas pelo papel
-- `postgres`:
--
--     postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm
--
-- `Dxtm` e TRUNCATE, REFERENCES, TRIGGER e MAINTAIN. Falta exatamente `arwd` —
-- SELECT, INSERT, UPDATE e DELETE. A service role recebia permissao para
-- truncar as tabelas e nenhuma para ler uma linha.
--
-- POR QUE ISTO NAO FOI PEGO ANTES. Os 108 testes pgTAP rodam como `postgres`,
-- superusuario, que tem tudo. Eles verificam que o esquema esta correto, e ele
-- esta — o que faltava era permissao, que so aparece quando alguem se conecta
-- COMO a service role. Foi o primeiro teste de integracao que revelou.
-- =============================================================================

-- A service role e a identidade do servidor da aplicacao. Ela ja ignora RLS por
-- design (ADR-005) e opera sobre tudo o que a aplicacao persiste: artefatos
-- globais, progressao de estado das analises e relatorios. Restringir por tabela
-- aqui nao acrescentaria seguranca — quem tem a chave ja tem o poder — e
-- adicionaria um modo de falha novo a cada tabela criada.
grant select, insert, update, delete on all tables in schema public to service_role;

-- =============================================================================
-- Tabelas FUTURAS
--
-- O `grant` acima alcanca apenas o que existe hoje. Sem alterar o default, a
-- proxima migracao que criar uma tabela reintroduz exatamente este defeito — e
-- ele so apareceria quando alguem rodasse a aplicacao.
-- =============================================================================
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- O mesmo raciocinio pelo lado oposto: uma tabela nova nasceria com `Dxtm` para
-- `anon` e `authenticated`, ou seja, com permissao de TRUNCATE para o navegador.
-- A migracao inicial revogou isso das tabelas existentes; aqui garantimos que
-- nao volte nas proximas.
--
-- O acesso legitimo de `authenticated` continua sendo concedido tabela a tabela,
-- explicitamente, como na migracao inicial.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
