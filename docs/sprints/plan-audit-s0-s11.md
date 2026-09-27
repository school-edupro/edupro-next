# Plan audit: Sprints 0 to 11 against `SCHOOL_ERP_SPRINT_PLAN.md`

|        |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date   | 2026-09-27                                                                                                                                                                                                                                                                                                                                                                                                               |
| Method | Every cell of the plan's sprint table (Platform, Squad A, Squad B, Experience, Data/QA/security, Review) compared with the sprint records in `docs/sprints/`, the code and the test suites. Status: **Done**, **Done with caveat** (delivered in a different form or partially), **Open: needs the business** (cannot be closed by engineering alone), **Open: engineering**                                             |
| Result | Engineering scope of Sprints 0 to 11 is delivered and verified locally (21 migrations, 141 API e2e tests in 22 suites, unit suites, axe accessibility, browser walk-throughs per role). Every open item depends on inputs the team does not have: production dumps, an Azure subscription, a pilot school and its users, provider accounts, One Auth confirmation, business sign-offs, and the legacy production servers |

## 1. Sprint by sprint

### Sprint 0: team ready, legacy safe

| Plan cell                                                                                          | Delivered                                                                                     | Status                                                                                               |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Monorepo, GitHub, CI with lint and tests, dev environment, ADR-001 stack, ADR-002 tenancy          | Repository, workspaces, CI workflow, ADR-001 to ADR-008, foundation design                    | Done (CI runs green locally; the GitHub remote has never been pushed: the user must push with a PAT) |
| Key Vault                                                                                          | Wiring in code (Sprint 5); no vault provisioned                                               | Open: needs the business (Azure subscription)                                                        |
| Legacy hotfixes (backdoor files, payment callback, disable `ExecuteQry.php` etc.), secret rotation | Not performed: the team has no access to the production servers; documented in S0-06/S0-07    | Open: needs the business (legacy operators)                                                          |
| Fee rule extraction workshop 1                                                                     | Playbook drafts with open questions (`docs/playbooks/`)                                       | Open: needs the business (workshop)                                                                  |
| Design tokens into `packages/ui`; Figma library; shell wireframes                                  | Tokens imported verbatim with lint; component library in Storybook; Figma library not started | Done with caveat (Figma is a designer deliverable)                                                   |
| Bootstrap files and schema dumps per school; QA tooling; SDLC standard                             | QA tooling and standards done; dumps never received (S0-08)                                   | Open: needs the business (dumps)                                                                     |

### Sprint 1: baseline understood

| Plan cell                                                                | Delivered                                                               | Status                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| Threat model, logging and PII standard, environment plan                 | `docs/design/03`, `docs/standards/logging-and-pii.md`, `docs/design/04` | Done                                       |
| Playbooks: people and admissions, fees, exams                            | Drafts with open questions                                              | Done (drafts); sign-off needs the business |
| `packages/ui` v0 and Storybook; token lint in CI                         | Done                                                                    | Done                                       |
| Schema diff report; data inventory; type mapping; test strategy; backlog | Inventory, mapping, strategy, backlog done; diff report needs dumps     | Done except the diff (needs the dumps)     |
| M0 gate: decisions signed off, schema diff, pilot kickoff                | Decisions recorded as ADRs; sign-off, diff and kickoff pending          | Open: needs the business                   |

### Sprint 2: walking skeleton

| Plan cell                                                                    | Delivered                                                                                          | Status |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| PostgreSQL baseline, RLS with context, NestJS skeleton, migrations           | Done in Sprint 0 (pulled forward); roles, assignments, scopes, delegation, memberships in Sprint 2 | Done   |
| Reference module `academics/classes`                                         | Done                                                                                               | Done   |
| `sp_next_receipt_no` prototype                                               | Done (row-locked sequence pattern reused by application, admission, query and TC numbers)          | Done   |
| Admin shell with OIDC BFF, selectors, navigation from permissions            | Done                                                                                               | Done   |
| ETL framework, `legacy_map`, checksums; API harness and authorisation matrix | Done (matrix runs as the permission-coverage and access e2e)                                       | Done   |

### Sprint 3: RBAC and audit real

| Plan cell                                                                          | Delivered                                                                                      | Status                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Permission catalogue from decorators, roles, scopes, SoD, delegation, audit, files | Done                                                                                           | Done                                       |
| Role and assignment admin API; menu projection                                     | Done                                                                                           | Done                                       |
| `sp_next_receipt_no` final; grade band prototype                                   | Receipt numbering done; grade bands deferred with exams (Phase 3)                              | Done with caveat                           |
| `packages/ui` v1 data grid, forms, drawer, breadcrumbs; role screens               | Done                                                                                           | Done                                       |
| ETL schools/years/classes/sections/subjects for pilot with reconciliation; DAST    | Transforms and reconciliation done on the seed; real pilot run needs dumps; DAST needs staging | Done with caveat (needs dumps and staging) |

### Sprint 4: jobs, messages, exports, compatibility skeleton

| Plan cell                                                                                        | Delivered                                                             | Status                         |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------ |
| BullMQ workers, notification adapters, templates, delivery log, exports, settings, feature flags | Done (adapters behind one interface; no provider accounts to connect) | Done with caveat (providers)   |
| Compat handshake                                                                                 | Done                                                                  | Done                           |
| Fee master schema                                                                                | Done (Sprint 8 form)                                                  | Done                           |
| `next-intl` English and Hindi; notification and export centres; Storybook visual regression      | Done (visual baselines need one CI run)                               | Done with caveat               |
| ETL students, guardians, enrolments, employees; reconciliation v1; Playwright E2E                | Transforms and admin smoke done; pilot run needs dumps                | Done with caveat (needs dumps) |

### Sprint 5: production-grade foundation

| Plan cell                                                                                            | Delivered                                                                                            | Status                           |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| MFA step-up, impersonation, break-glass, observability, backups and DR, staging, WAF and rate limits | Done in code and scripts; staging and WAF need Azure                                                 | Done with caveat (Azure)         |
| Compat read endpoints                                                                                | Skeleton in Sprint 5; live data completed in Sprint 11                                               | Done (closed in Sprint 11)       |
| Fee master admin API                                                                                 | Done (Sprint 8)                                                                                      | Done                             |
| Admin settings/schools/years; teacher and parent shells; PWA manifests                               | Done                                                                                                 | Done                             |
| ETL rehearsal 1; performance baseline; internal security review                                      | Rehearsal on the seed; k6 scripts written, not run (no k6, no staging); review done with 13 findings | Done with caveat                 |
| M1 gate                                                                                              | Pass with conditions (`m1-gate-report.md`)                                                           | Conditions still open (business) |

### Sprint 6: student and employee 360

| Plan cell                                                          | Delivered                                                                                                                   | Status           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Search service; bulk import framework                              | Done (search in Sprint 4, import in Sprint 6)                                                                               | Done             |
| People 360, documents, photos, status history; employees           | Done                                                                                                                        | Done             |
| Teacher assignments feeding RBAC; timetable                        | Done; substitutions added in Sprint 11                                                                                      | Done             |
| Admin student and employee screens, import                         | Done                                                                                                                        | Done             |
| ETL documents and photos to object storage; E2E people journeys    | E2E done; document migration awaits the legacy file store access                                                            | Done with caveat |
| Carried M1 items (rate-limit keys, outbox encryption, nonce cache) | Closed in Sprint 11: nonce cache done; per-user keys accepted as is; encryption closed by design (payload carries ids only) | Done             |

### Sprint 7: academics daily work

| Plan cell                                                             | Delivered | Status |
| --------------------------------------------------------------------- | --------- | ------ |
| Template engine on the export service                                 | Done      | Done   |
| ID cards, TC, two-step withdrawal, promotion                          | Done      | Done   |
| Homework, classwork, assignments; notices; holidays; almanac; gallery | Done      | Done   |
| Teacher PWA posting; admin academics screens                          | Done      | Done   |
| Threat model people and academics; file upload security tests         | Done      | Done   |

### Sprint 8: admissions open

| Plan cell                                                               | Delivered                                                             | Status                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ |
| Public app with rate limiting, proof of work, OTP                       | Done                                                                  | Done                     |
| Cycles, JSON form, passcodes, age criteria, scoring, intake, duplicates | Done; form field editor completed in Sprint 11                        | Done                     |
| `fee_demands` and `sp_generate_fee_demand` with historical fixtures     | Done; fixtures reconstructed from legacy rules because no dump exists | Done with caveat (dumps) |
| Public bilingual form, OTP login, status; admin dashboard               | Done                                                                  | Done                     |
| ETL fee masters; public form abuse tests                                | Done                                                                  | Done                     |

### Sprint 9: admissions decided, attendance live

| Plan cell                                                                          | Delivered                                                           | Status                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Workflow v0; payments v0 with PayU and idempotent webhook                          | Done (mock gateway locally; PayU test/live wired but not exercised) | Done with caveat (merchant account) |
| Shortlist, draw, L1/L2 approvals, offers, fee, admission number, section allotment | Done                                                                | Done                                |
| Attendance sessions, rules, subject attendance, alerts; RFID v1                    | Done                                                                | Done                                |
| Teacher attendance; admin dashboards; parent home, attendance, homework            | Done                                                                | Done                                |
| ETL attendance; E2E admission to enrolment; payments threat model and replay tests | Done                                                                | Done                                |

### Sprint 10: communication and parent engagement

| Plan cell                                                                                           | Delivered                               | Status                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| Message requests with approval; delivery tracking; consent records (DPDP)                           | Done                                    | Done (provider receipts need a vendor) |
| Communication module, compose, approvals, queries, feedback                                         | Done                                    | Done                                   |
| Bus attendance; punch ingestion; RFID dashboards                                                    | Done                                    | Done                                   |
| Parent app notices, timetable, queries, profile and info-update requests; admin compose and approve | Done                                    | Done                                   |
| ETL notices, homework, queries; E2E communication; accessibility pass                               | Done (axe, 20 screens, 3 defects fixed) | Done                                   |

### Sprint 11: hardening for M2

| Plan cell                                                            | Delivered                                                                             | Status                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Compat write parity; performance tuning; DPDP notices and onboarding | Done                                                                                  | Done                                               |
| Lesson planner L1 to L3; substitutions with conflicts                | Done                                                                                  | Done                                               |
| RFID rules v2, alert throttling; fee instalment variant              | Done                                                                                  | Done                                               |
| Hindi pass; empty states and help; PWA offline shell                 | Admin and public complete; parent app toggle with core strings; teacher pages English | Done with caveat (parent and teacher detail pages) |
| Internal pentest; UAT with pilot; ETL rehearsal 2                    | Pentest done and clean; UAT script prepared, not run; rehearsal 2 as a dry run        | Open: needs the business (pilot, dumps)            |
| M2 gate                                                              | Pass with conditions (`m2-gate-report.md`)                                            | Conditions open (business)                         |

## 2. Open items, grouped by who can close them

| Owner                        | Item                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client / legacy operators    | S0-06 legacy hotfixes on the production servers; S0-07 secret rotation                                                                                                                                                                           |
| Client DBA                   | S0-08 bootstrap files and schema dumps per school → schema diff, ETL rehearsals 1 to 3 for real, historical fee fixtures                                                                                                                         |
| Client (Azure)               | S0-09 Key Vault, staging and production environments → deploy workflow, DAST, k6 baselines, WAF                                                                                                                                                  |
| Product owner / pilot school | S0-10 pilot named and super-users; M0 sign-offs; UAT (`docs/quality/uat-phase-2.md`); playbook sign-offs (fees, exams, admissions)                                                                                                               |
| One Auth team                | S0-13 capability confirmation (`amr`, `auth_time`, `acr_values`, JWKS, client registrations)                                                                                                                                                     |
| Vendors                      | SMS/WhatsApp provider and receipt mapping; PayU merchant account for test mode; FCM service account                                                                                                                                              |
| Designer                     | S0-12 Figma library from the tokens                                                                                                                                                                                                              |
| Engineering (next sprints)   | Hindi for parent and teacher detail pages; device and webhook key rotation; message retention schedule; consent wording versions surfaced to parents; transport stops and geo (Sprint 12); `pnpm` push of the repository once a PAT is available |

## 3. Verification summary at the end of Sprint 11

| Suite                  | Result                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| API e2e                | 22 suites, 141 tests                                                                      |
| Unit                   | api 5, db 29, workers 10, etl 79, storage 3                                               |
| Lint, typecheck, build | green across 15 workspaces                                                                |
| Accessibility          | axe WCAG 2.0 A/AA, 24 admin screens                                                       |
| Demo data              | two schools, a login per role, walk-throughs for Sprints 6 to 11 in `docs/demo-logins.md` |
