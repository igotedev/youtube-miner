# Migrações

Convenção: `YYYYMMDDHHMMSS_descricao_curta.sql`. Uma migração por mudança,
sempre para frente — **nunca edite uma migração já aplicada**, mesmo em
desenvolvimento: o banco de outra pessoa já a executou e não voltará atrás.

| Arquivo                                        | Conteúdo                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `20260806120000_initial_schema.sql`            | Esquema inicial da SPEC-004: 10 tabelas, constraints, índices, RLS, policies, grants e triggers |
| `20260807000000_collection_run_completion.sql` | SPEC-008: `complete_collection_run`, conclusão transacional e idempotente de uma coleta         |
| `20260807010000_service_role_grants.sql`       | SPEC-008: corrige as permissões da `service_role` e o default privilege do schema               |

## Estado de validação

> **Verificada em execução** (2026-08-07). As migrações aplicam em banco limpo,
> as **108 asserções pgTAP passam** — estrutura, constraints, RLS e cascatas — e
> **21 testes de integração** exercitam o adaptador com cliente real.

Para revalidar:

```bash
npm run db:start           # sobe o Supabase local (exige Docker)
npm run db:reset           # aplica migrations + seed em banco limpo
npm run db:test            # roda os testes pgTAP de supabase/tests/database/
npm run test:integration   # roda os testes de integração com cliente real
```

Os testes pgTAP não encontraram defeito no esquema — só nos próprios testes.
O primeiro teste de **integração**, porém, encontrou um defeito real: a
`service_role` não tinha `select/insert/update/delete` sobre as tabelas, e
nenhum adaptador funcionava. pgTAP não pegou porque roda como superusuário.
**Teste de esquema não é teste de permissão** — ver a seção 5 da SPEC-008.

Ver `docs/specs/SPEC-004-postgresql-persistence.md` e
`docs/adr/ADR-005-persistence-boundaries-and-analysis-reuse.md`.
