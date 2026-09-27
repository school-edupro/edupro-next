# EduPro Next

Multi-school, multi-year School ERP by Mobilise App Lab. Rebuild of the legacy PHP school ERP on:

- **Front end**: React 18 with Next.js 15 (App Router), TypeScript, Mobilise Design System (`packages/ui`)
- **Backend**: Node.js 22, NestJS 11 (Fastify adapter), OpenAPI
- **Database**: PostgreSQL 16 with row-level security, partitioning and PL/pgSQL procedures
- **Jobs**: BullMQ on Redis (`apps/workers`)

This repository is deliberately **separate from the legacy PHP tree**. Nothing here imports from or deploys with the old code. Legacy analysis lives in the old tree as `MERN_MIGRATION_BLUEPRINT.md`, `SCHOOL_ERP_PROJECT_PLAN.md` and `SCHOOL_ERP_SPRINT_PLAN.md`; the design decisions taken from them are recorded here as ADRs under `docs/adr/`.

## Repository layout

```
apps/
  api/        NestJS domain API (tenancy, access, audit, reference module)
  workers/    BullMQ processors (notifications, exports, RFID, reconciliation)
  admin/      Next.js admin application (thin BFF for session and tenant context)
  parent/     Next.js parent application (PWA shell since Sprint 5, features from Sprint 9)
  teacher/    Next.js teacher application (PWA shell since Sprint 5, daily work from Sprint 7)
  public/     Next.js public admissions app (Sprint 8): OTP sign-in with a proof-of-work check, bilingual form, status
  public/     Next.js public application (admission forms), starts Sprint 8
packages/
  db/         SQL migrations, RLS policies, PL/pgSQL procedures, Prisma schema, tenant-aware pool, audit masks
  etl/        Legacy MySQL to PostgreSQL migration: transforms, identity map, pipeline runner
  ui/         Mobilise Design System tokens, React components, Storybook
  api-client/ Generated TypeScript client from the API's OpenAPI document
  config/     Shared TypeScript, ESLint and Prettier configuration
docs/
  adr/        Architecture decision records
  design/     Foundation design, reference module guide, permission catalogue, threat model, environment plan
  standards/  Logging and personal data standard
  data/       Type mapping catalogue, DPDP data inventory, ETL framework, schema diff template
  quality/    Test strategy
  playbooks/  Fees, exams, people and admissions rule drafts with open questions
  backlog/    Sprint 2 to 5 stories (markdown and CSV)
  security/   Foundation security review (Sprint 5)
  runbooks/   Disaster recovery
  sprints/    Sprint records
```

## Prerequisites

| Tool              | Version     | Notes                                                   |
| ----------------- | ----------- | ------------------------------------------------------- |
| Node.js           | 22 LTS      | `.nvmrc` pins it; use nvm or fnm                        |
| pnpm              | 9           | `corepack enable && corepack prepare pnpm@9 --activate` |
| Docker            | 24 or later | runs PostgreSQL 16, Redis 7 and Mailpit locally         |
| PostgreSQL client | 16          | optional, for `psql` against the local database         |

Without Docker (for example a laptop without administrator rights), PostgreSQL and Redis can run in user space instead: see `scripts/local-stack.sh` and the first-build notes in `docs/sprint-0-checklist.md`. The scaffold was first built and run that way on 2026-09-26.

## First run

```bash
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
cp .env.example .env
docker compose up -d                       # or: scripts/local-stack.sh start
pnpm --filter @edupro/db local:setup       # only for the user-space stack (creates the database and roles)
pnpm db:migrate          # applies packages/db/migrations in order
pnpm db:test             # cross-tenant RLS tests must pass before anything else
pnpm --filter @edupro/db seed:dev          # two schools and a dev admin (developer sign-in: dev-admin)
pnpm --filter @edupro/db seed:demo         # sample students, staff, fees, admissions and one login per role (docs/demo-logins.md)
pnpm dev                 # api on :4000 (docs at /api/docs), admin on :3000, workers (outbox publisher and queues)
```

Developer sign-in on the login page appears only when `AUTH_DEV_BYPASS=1` and the app runs in development mode (`pnpm dev`). A production build (`next start`) never shows it.

## Non-negotiable rules

1. Every tenant table carries `school_id` and has row-level security enabled and forced. The API never queries without a tenant context.
2. Every API handler declares a permission with `@RequirePermission()` or is explicitly `@Public()`. CI fails otherwise.
3. Money and marks are written only through PL/pgSQL procedures inside one transaction.
4. UI uses design-system tokens only. Raw hex colours, raw pixel values and other fonts fail lint.
5. No secrets in the repository. `.env` is ignored; production reads Azure Key Vault.
6. No per-school code branches. Variation is configuration, templates or workflow definitions.

## Documents to read first

1. `docs/adr/` in numeric order
2. `docs/design/00-foundation-design.md`
3. `docs/design/01-reference-module.md`
4. `docs/design/02-rbac-permission-catalogue.md`
5. `docs/sprint-0-checklist.md`
6. `docs/sprints/` for what each sprint delivered and what it carried over
7. `docs/demo-logins.md` to try every role on the sample data

## Repository scripts

| Command                                                                                                     | Purpose                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm test:scripts`                                                                                         | Runs the schema-diff fixture test and the SQL lint rule fixture check (also in CI)             |
| `pnpm schema-diff <ref.sql> <cmp.sql> [REF] [CMP] [legacy-root]`                                            | Per-school schema diff report into `docs/data/reports/` (git-ignored)                          |
| `pnpm api:openapi && pnpm client:generate`                                                                  | Regenerates the OpenAPI document and the typed client                                          |
| `pnpm --filter @edupro/workers dev`                                                                         | Starts the outbox publisher and the queue workers (notifications, exports, maintenance)        |
| `pnpm --filter @edupro/admin e2e`                                                                           | Playwright smoke against a running API and admin app                                           |
| `pnpm --filter @edupro/ui build-storybook && pnpm --filter @edupro/ui test:storybook`                       | Storybook interaction tests                                                                    |
| `pnpm --filter @edupro/etl run:domain -- --school <id> --domain tenancy\|identity\|people --fixture <json>` | Runs an ETL domain against a fixture file (or `--mysql <url>` once dumps arrive)               |
| `POST /api/v1/compat/v1/auth/handshake`                                                                     | Compatibility handshake for the current mobile apps (Sprint 4); see `docs/sprints/sprint-4.md` |
| `pnpm perf:local`                                                                                           | Local latency baseline for /me, classes and search with autocannon (k6 script in `perf/k6`)    |
| `scripts/backup.sh`, `scripts/restore-drill.sh`                                                             | Logical backup and the quarterly restore drill (`docs/runbooks/disaster-recovery.md`)          |
| `ALLOW_ANONYMISE=1 pnpm --filter @edupro/db anonymise`                                                      | Anonymises a restored copy for staging                                                         |
