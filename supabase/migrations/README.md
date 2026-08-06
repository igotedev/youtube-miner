# Migrações

Convenção: `YYYYMMDDHHMMSS_descricao_curta.sql`. Uma migração por mudança,
sempre para frente — **nunca edite uma migração já aplicada**, mesmo em
desenvolvimento: o banco de outra pessoa já a executou e não voltará atrás.

| Arquivo                             | Conteúdo                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `20260806120000_initial_schema.sql` | Esquema inicial da SPEC-004: 10 tabelas, constraints, índices, RLS, policies, grants e triggers |

## Estado de validação

> A migração inicial **nunca foi executada**. O ambiente em que foi escrita não
> tem Docker nem Supabase CLI. Ela está revisada, mas não verificada em execução.

Para validar:

```bash
npm run db:start    # sobe o Supabase local (exige Docker)
npm run db:reset    # aplica migrations + seed em banco limpo
npm run db:test     # roda os testes pgTAP de supabase/tests/database/
```

Os testes em `supabase/tests/database/` cobrem estrutura, constraints, RLS e
cascatas. Nenhum deles rodou ainda.

Ver `docs/specs/SPEC-004-postgresql-persistence.md` e
`docs/adr/ADR-005-persistence-boundaries-and-analysis-reuse.md`.
