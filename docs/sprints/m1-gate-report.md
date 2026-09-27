# Milestone M1 gate report (end of Sprint 5)

|                |                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-09-27                                                                                                                                                                                               |
| Scope          | Foundation programme, Sprints 0 to 5 (`SCHOOL_ERP_SPRINT_PLAN.md`)                                                                                                                                       |
| Recommendation | Pass with conditions: the platform foundation is complete and verified locally and in CI; the conditions below concern environments and business inputs that were outside the engineering team's control |

## 1. What M1 was to deliver

Multi-school, multi-year platform on PostgreSQL with row-level security; identity through One Auth; global and module-wise RBAC with scopes, delegation, segregation of duties and MFA step-up; audit trail; files, jobs, notifications and exports; the design system and the admin app; the first masters (people) with search; a compatibility path for the current apps; observability, deployment automation, backups and a security review.

## 2. Evidence

| Area                      | Evidence                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy and RLS           | `packages/db/test/rls.test.ts` (cross-school isolation, forced policies), start-up role assertion                                                                       |
| RBAC                      | permission coverage test (every handler declares a permission), `test/access.e2e-spec.ts`, `test/security.e2e-spec.ts` (MFA staleness, impersonation, break glass, SoD) |
| Audit                     | rows written in service transactions, query and export endpoints, viewer in the admin app                                                                               |
| Jobs                      | outbox publish and dead-letter tests in `apps/workers/test`, retry endpoint                                                                                             |
| Notifications and exports | delivery log and export centre with end-to-end generation (xlsx, csv, pdf, ID cards)                                                                                    |
| Design system             | Storybook with accessibility addon and 27 interaction tests; DataGrid, form layout, typography in two scripts                                                           |
| Admin app                 | 20 screens; Playwright smoke; English and Hindi                                                                                                                         |
| People and search         | `test/people.e2e-spec.ts`, `packages/db/test/people.test.ts` (search under 200 ms on 3,000 rows)                                                                        |
| Compatibility             | handshake and nine legacy shapes with contract fixtures                                                                                                                 |
| Observability             | Prometheus metrics, security alert detector, OpenTelemetry bootstrap, alert rules and a dashboard in `ops/`                                                             |
| Deployment                | Dockerfiles for API, workers and admin; staging deploy workflow with OIDC; Terraform for Azure; Key Vault wiring; schema-version check at start                         |
| Data protection           | backup and restore drill scripts, DR runbook, staging anonymisation with test                                                                                           |
| Security                  | `docs/security/foundation-review.md`: no open high findings                                                                                                             |
| Test totals               | API e2e 69, API unit 5, db 29, workers 10, etl 69, storage 3, storybook 27, Playwright 3                                                                                |

## 3. Conditions to close M1

| Condition                                                                                   | Owner                                                     | Why it is open                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Apply the Terraform environments and run the deploy workflow once                           | Platform engineering with the client's Azure subscription | No subscription was available to the engineering team      |
| Point a build of the current student and teacher apps at staging and complete the handshake | Mobile app team                                           | Needs staging and the central auth server's signing secret |
| Deliver the production schema dumps and run the ETL domains against the pilot school        | Client DBA (S0-08)                                        | Dumps have not been shared                                 |
| Sign off the fees, exams and admissions playbooks                                           | Business owners (S0-10 to S0-13)                          | Workshops pending                                          |
| Run the first nightly visual baseline and commit the Linux snapshots                        | Platform engineering                                      | One workflow run                                           |

## 4. Carried into Sprint 6

Column-level encryption of outbox payloads; handshake nonce cache; per-user rate limiting; folding the admin app onto `@edupro/bff`; finishing string externalisation of the older admin screens; browser uploader for documents; visual baselines.
