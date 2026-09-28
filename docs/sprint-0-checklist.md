# Sprint 0 checklist

Goal: team ready, legacy safe, foundation designed. Status as of 2026-09-26.

| ID    | Task                                                                                                                                                                                                                     | Owner                      | Status          | Evidence                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0-01 | Separate repository and folder created (`edupro-next`), git initialised on `main`                                                                                                                                        | Architect                  | Done            | ADR-008, this repository                                                                                                                                 |
| S0-02 | Stack, tenancy, year, RBAC, audit, procedures, BFF decisions recorded                                                                                                                                                    | Architect                  | Done            | `docs/adr/ADR-001` to `ADR-008`                                                                                                                          |
| S0-03 | Foundation design written: data model, RLS, identity, RBAC mechanics, audit, procedures, API conventions, security baseline, environments                                                                                | Architect                  | Done            | `docs/design/00-foundation-design.md`                                                                                                                    |
| S0-04 | First build on a developer machine: install Node 22, pnpm 9, PostgreSQL 16, Redis; `pnpm install`; `pnpm db:migrate`; `pnpm db:test`; `pnpm test`; `pnpm build`; run API and admin                                       | Architect                  | Done 2026-09-26 | See "First build notes" below. Docker Desktop still needs an administrator to install; the user-space stack in `scripts/local-stack.sh` was used instead |
| S0-05 | CI pipeline runs green on the first pull request                                                                                                                                                                         | DevOps                     | Pending         | `.github/workflows/ci.yml`                                                                                                                               |
| S0-06 | Legacy hotfixes deployed: remove backdoor files from every server; route payment success pages through the verified callback; disable `ExecuteQry.php`, `ShowUserMaster.php`, root `upload.php`; check web logs for hits | Legacy maintainer          | Pending         | Change tickets in the legacy process                                                                                                                     |
| S0-07 | Secret rotation: database, PayU salt and key, SMS and WhatsApp keys, FCM service account, HRMS key, AES and HMAC keys, Maps key, Gemini key                                                                              | Security lead              | Pending         | Rotation log                                                                                                                                             |
| S0-08 | Obtain `connection.php`, `AppConf.php`, `environment.php`, `db_folder_mapping.php`, `Login.php` and a full schema dump per school                                                                                        | Data engineer              | Pending         | Stored outside both repositories, access-controlled                                                                                                      |
| S0-09 | Azure Key Vault provisioned for staging and production; local `.env` from `.env.example`                                                                                                                                 | DevOps                     | Pending         |                                                                                                                                                          |
| S0-10 | Pilot school named; kickoff scheduled; super-users nominated                                                                                                                                                             | Product owner              | Pending         |                                                                                                                                                          |
| S0-11 | Fee rule extraction workshop 1 (late-fee modes, instalments, slabs, hostel)                                                                                                                                              | Business analysts, Squad B | Pending         | Playbook draft                                                                                                                                           |
| S0-12 | Figma library started from the design tokens; component inventory for Sprint 1                                                                                                                                           | UI/UX designer             | Pending         |                                                                                                                                                          |
| S0-13 | One Auth capabilities confirmed: `amr`, `auth_time`, `acr_values`, JWKS endpoint, client registration for four apps                                                                                                      | Architect, One Auth team   | Pending         | Open item 1 in the foundation design                                                                                                                     |
| S0-14 | Backlog for Sprints 1 to 5 refined from the sprint plan into epics and stories                                                                                                                                           | Product owner              | Pending         | Tracker                                                                                                                                                  |

## What is in this repository after Sprint 0

- Monorepo skeleton with workspaces for `apps/api`, `apps/workers`, `apps/admin`, `apps/parent`, `apps/teacher`, `apps/public`, `packages/db`, `packages/ui`, `packages/api-client`, `packages/config`.
- Foundation SQL migrations: schema, roles, RLS, audit, procedures, reference module tables.
- NestJS API skeleton: authentication guard, tenant interceptor, permission guard and registry, audit interceptor, problem-details filter, `me` and `access` endpoints, reference module `academics/classes`.
- Next.js admin skeleton: OIDC login route handlers, encrypted session, school and year switcher, shell layout on design tokens, classes page calling the API.
- Design-system package: Mobilise tokens copied verbatim, token lint, first components.
- CI workflow, docker compose, environment template, security policy, contribution guide.

## First build notes (2026-09-26)

Toolchain installed without administrator rights: Node 22.23.3 and pnpm 9.15.9 under `~/.local/node`, PostgreSQL 16.15 (Zonky user-space binaries, no `psql`) under `~/.local/pgsql` with data in `~/.local/pgdata`, Redis 8.10 built from source under `~/.local/bin`. `scripts/local-stack.sh start|stop|status` controls them. Docker Desktop and Homebrew were not installed because both need an administrator password.

Results after the fixes listed next:

| Check                                       | Result                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                              | 1,008 packages resolved                                                                                                                  |
| `pnpm db:migrate`                           | 7 migrations applied                                                                                                                     |
| `pnpm db:test`                              | 19 passed (RLS isolation, forged insert, no-context, append-only audit, concurrent receipt numbering, year guard, audit trigger masking) |
| `pnpm --filter @edupro/api test`            | 5 passed                                                                                                                                 |
| `pnpm --filter @edupro/api test:e2e`        | 13 passed (authorisation matrix, tenant isolation through the API, year lock, audit row, `/me`) and permission coverage                  |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | all 8 packages green, Next.js app builds 10 routes                                                                                       |
| Running system                              | API on :4000 with Swagger at `/api/docs`; admin on :3000; signed in as `dev-admin`, switched school, listed classes                      |

Fixes made during the first build (all committed to the tree):

1. Permission code `access.impersonate` violated the `module.resource.action` check; renamed to `access.session.impersonate`.
2. Login-time membership lookup joined `schools`, whose policy needs the allowed-school list that is not set yet at login; migration 0006 adds a self-membership policy.
3. Catalogue sync flagged seeded permissions as orphaned; migration 0007 adds `declared_in_code` so only codes once declared by code can become orphaned.
4. Two Fastify copies (Nest pins 5.11.3) broke plugin typings; a pnpm override pins `fastify` to 5.11.3.
5. `nestjs-zod` 4 required an internal `@nestjs/swagger` path removed in Swagger 11; upgraded to `nestjs-zod` 5 and `cleanupOpenApiDoc`.
6. Swagger UI on Fastify needs `@fastify/static`; added.
7. Next 15 App Router needs React 19; upgraded React and types.
8. `NODE_ENV=development` sourced from `.env` broke `next build`; removed from the env template.
9. The environment provider moved into a global `EnvModule` so the database module can inject it.
10. Admin app now auto-selects the first school membership on first login.
11. `exactOptionalPropertyTypes` and `isolatedModules` removed from the Node TypeScript config (decorator metadata and optional fields).

Sprint 1 starts from a building, tested foundation.
