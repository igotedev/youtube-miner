# Migrações

Convenção: `YYYYMMDDHHMMSS_descricao_curta.sql`. Uma migração por mudança,
sempre para frente — **nunca edite uma migração já aplicada**, mesmo em
desenvolvimento: o banco de outra pessoa já a executou e não voltará atrás.

| Arquivo                             | Conteúdo                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `20260806120000_initial_schema.sql` | Esquema inicial da SPEC-004: 10 tabelas, constraints, índices, RLS, policies, grants e triggers |

## Estado de validação

> **Verificada em execução** (2026-08-07). A migração aplica em banco limpo e as
> **108 asserções pgTAP passam** — estrutura, constraints, RLS e cascatas.

Para revalidar:

```bash
npm run db:start    # sobe o Supabase local (exige Docker)
npm run db:reset    # aplica migrations + seed em banco limpo
npm run db:test     # roda os testes pgTAP de supabase/tests/database/
```

A primeira execução não encontrou defeito algum no esquema — só nos testes.
Ver a seção "Validação do SQL" da SPEC-004.

Ver `docs/specs/SPEC-004-postgresql-persistence.md` e
`docs/adr/ADR-005-persistence-boundaries-and-analysis-reuse.md`.
