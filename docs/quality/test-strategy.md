# Test strategy

Targets come from the project plan section 10. This document says how each layer is tested, where the tests live, and what gates a merge or a release.

## 1. Layers

| Layer                           | Tool                                                                                                                 | Location                                                    | Runs                             | Gate                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Database structure and policies | vitest + pg against a real PostgreSQL                                                                                | `packages/db/test/rls.test.ts`                              | every PR                         | structural test: every table with `school_id` has forced RLS and a policy                                                       |
| PL/pgSQL procedures             | vitest + fixtures                                                                                                    | `packages/db/test/procedures*.test.ts`                      | every PR                         | every legacy rule (late fee modes, slabs, instalments, rounding) has a case from real history once the fee module lands         |
| Pure transforms (ETL, masks)    | vitest                                                                                                               | `packages/etl/test`, `packages/db/test/audit-masks.test.ts` | every PR                         | 100 percent of transforms have cases for accept, reject and null                                                                |
| API unit                        | jest                                                                                                                 | `apps/api/src/**/*.spec.ts`                                 | every PR                         | services and guards; 80 percent line coverage on services                                                                       |
| API end to end                  | jest + Fastify inject against a real PostgreSQL                                                                      | `apps/api/test/*.e2e-spec.ts`                               | every PR                         | authorisation matrix for every permission (allow and deny), cross-tenant negative, year lock, audit row, problem-details shapes |
| Permission coverage             | jest                                                                                                                 | `apps/api/test/permission-coverage.spec.ts`                 | every PR                         | zero unprotected handlers; public routes are an explicit allow-list                                                             |
| Contract                        | openapi-typescript generation and front-end typecheck                                                                | `packages/api-client`                                       | every PR                         | front ends compile against the current OpenAPI document                                                                         |
| Components                      | Storybook build with the accessibility addon; interaction tests (Sprint 3)                                           | `packages/ui/src/**/*.stories.tsx`                          | every PR                         | Storybook builds; axe violations fail the story (Sprint 3)                                                                      |
| Design tokens                   | oxlint adherence rules                                                                                               | `packages/ui/.oxlintrc.json`                                | every PR                         | no raw hex, no raw px, only Poppins and Source Sans 3                                                                           |
| Front-end e2e                   | Playwright against the admin app and API (Sprint 3)                                                                  | `apps/admin/e2e`                                            | every PR (smoke), nightly (full) | login, school switch, reference module journey; later every critical journey in the plan                                        |
| Visual                          | Playwright screenshots per key screen (Sprint 3)                                                                     | `apps/admin/e2e/visual`                                     | nightly                          | pixel diff threshold 0.1 percent                                                                                                |
| Performance                     | k6 scripts (Sprint 5)                                                                                                | `tools/perf`                                                | weekly on staging                | p95 read under 300 ms, write under 800 ms at 500 concurrent users per school; fee due-date peak at 5x                           |
| Security                        | SAST (ESLint security rules), SCA (`pnpm audit`), secrets (gitleaks), DAST (OWASP ZAP baseline on staging, Sprint 3) | CI and staging                                              | every PR; weekly                 | no critical or high open                                                                                                        |
| Data migration                  | reconciliation measures per run                                                                                      | `etl.reconciliations`, markdown report                      | every rehearsal                  | zero unexplained delta before cutover                                                                                           |

## 2. Test data

- Local and CI use synthetic fixtures created by tests themselves (`createFixture()` in `packages/db/test/helpers.ts`) so tests never depend on order.
- `seed:dev` gives two schools and a dev admin for manual work; tests must not rely on it.
- Staging uses an anonymised copy of the pilot school (names, contacts, ids re-generated; amounts preserved) produced by the anonymisation job (Sprint 5).
- Historical fee and exam cases for procedure tests are exported from the legacy database into `packages/db/test/fixtures/<domain>/*.sql` with personal data removed.

## 3. Definition of ready and done for tests

- A story is ready when its acceptance criteria name the permission codes involved and the expected problem-details types for failure paths.
- A story is done when: unit tests for new branches, e2e allow and deny per new permission, RLS structural test still green (new tables covered), audit assertion for mutations, story added for any new component, OpenAPI regenerated.

## 4. Environments and cadence

| When            | What                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Pull request    | lint, typecheck, unit, database, e2e, permission coverage, Storybook build, secret scan, dependency audit, build |
| Merge to `main` | above plus deploy to staging and Playwright smoke                                                                |
| Nightly         | full Playwright, visual diff, DAST baseline                                                                      |
| Weekly          | performance on staging, dependency updates                                                                       |
| Phase gate      | internal pentest checklist (threat model section 4), reconciliation report                                       |

## 5. Flakiness policy

A test that fails without a code change is quarantined the same day with an issue, fixed within the sprint, and never deleted silently. Database tests run serially (`fileParallelism: false`) to avoid cross-test interference.
