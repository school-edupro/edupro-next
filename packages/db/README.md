# @edupro/db

PostgreSQL 16 schema, row-level security, procedures and tenant-aware access for EduPro Next.

## Layout

| Path | Purpose |
|---|---|
| `init/01_roles.sql` | Creates `edupro_app` and `edupro_readonly` (docker init and CI) |
| `migrations/0001_foundation.sql` | Tenancy, years, identity, RBAC, sequences, files, outbox |
| `migrations/0002_rls.sql` | Context functions, policies, grants |
| `migrations/0003_audit.sql` | Partitioned append-only audit log, row-change trigger |
| `migrations/0004_procedures_and_seed.sql` | `assert_year_open`, `next_receipt_no`, `setting`, role templates, permissions, SoD |
| `migrations/0005_reference_module_classes.sql` | Reference module tables |
| `migrations/0006_schools_self_membership_policy.sql` | Users can read the schools they belong to before a school is selected (login) |
| `migrations/0007_permissions_declared_in_code.sql` | `declared_in_code` so only code-declared permissions can be flagged orphaned |
| `src/index.ts` | `Db.withTenant()`, `Db.withoutTenant()`, `Db.withAuthLookup()`, `Db.assertApplicationRole()` |
| `src/local-setup.ts` | Creates the database and roles on a user-space cluster without `psql` |
| `src/prisma.ts` | `prismaWithTenant()` for typed CRUD inside a tenant transaction |
| `src/migrate.ts` | Migration runner with checksums and an advisory lock |
| `src/seed-dev.ts` | Local development seed (two schools, dev admin) |
| `prisma/schema.prisma` | Prisma model mirror of the SQL schema |
| `test/` | RLS proof and procedure tests (require a live database) |

## Rules

1. Migrations are plain SQL, applied in order, never edited after they are applied. Behaviour changes are new files.
2. Every tenant table: `school_id` second column, `CALL app.apply_tenant_rls('<table>')`, indexes led by `school_id`.
3. Never connect the API as `edupro_migrator`. `Db.assertApplicationRole()` refuses to start if the role can bypass RLS.
4. Procedures live in schema `app`, are `SECURITY INVOKER`, start with `PERFORM app.assert_context()` and, for year-scoped writes, `PERFORM app.assert_year_open(...)`.
5. Errors from procedures use `MESSAGE` as a stable slug (`year.stage_locked`) and `DETAIL` as JSON; the API maps them to problem details.

## Commands

```bash
pnpm --filter @edupro/db migrate      # DATABASE_MIGRATOR_URL
pnpm --filter @edupro/db seed:dev     # DATABASE_MIGRATOR_URL, development only
pnpm --filter @edupro/db test         # DATABASE_URL and DATABASE_MIGRATOR_URL
pnpm --filter @edupro/db prisma:generate
```
