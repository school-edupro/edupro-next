# M4 gate report: Release 1 complete and VAPT

|                |                                                                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-09-29                                                                                                                                                                                                                                                                                    |
| Scope          | Phase 4, Sprints 17 to 21 (`SCHOOL_ERP_SPRINT_PLAN.md`); Release 1 as frozen at `release-1-freeze`                                                                                                                                                                                            |
| Recommendation | Pass with conditions: Release 1 is feature-complete, regression-tested and hardened against every finding of the internal readiness pass; the CERT-In empanelled VAPT, the legacy report-card comparison and the pilot UATs need the pilot's environment and inputs, which were not available |

## 1. What M4 was to deliver

"Report cards match legacy for all class bands; all approvals on the workflow engine; CERT-In
empanelled VAPT passed."

## 2. Evidence

| Criterion                            | Evidence                                                                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report cards for all class bands     | Sprints 17 and 18: HPC (primary), CCE (middle), components (secondary), theory/practical (senior); snapshots per band; releases with defaulter withholding; family download. The comparison against the legacy PDFs waits for the legacy cards (UAT script rows 4 to 6) |
| All approvals on the workflow engine | Sprints 9, 17 and 19: admissions, messages, lesson plans, fee profile changes, transport requests, appointments, gate passes, CCTV requests, employee queries; SLAs, escalation, delegation, history; `sprint17`, `sprint19` e2e                                        |
| Release 1 completeness               | Sprint 20: compatibility parity (38 served endpoints with contract tests), DPDP tooling, training and tours, Hindi pass, go-live runbook, freeze tag                                                                                                                    |
| Security hardening                   | Sprint 21: dependency audit clean of high and critical, CSP on every app, HSTS and COOP, proxy trust to one hop, offline cache cleared on sign-out and never for `no-store` pages; `docs/security/release-1-vapt-readiness.md`                                          |
| Automated attack suites              | `security`, `pentest`, `pentest-fees`, `redteam`, `hardening`, `devices`, `sprint16`, `sprint20`: all green on the freeze commit                                                                                                                                        |
| Regression                           | Sprint 21 record section 3: full API suite, workers, db, lint, typecheck, format, axe, smoke                                                                                                                                                                            |
| Accessibility                        | axe (WCAG 2 A and AA, serious and critical) on 57 admin screens                                                                                                                                                                                                         |
| Performance                          | `perf:local` baseline and the fees load probe within targets (Sprint 20 record)                                                                                                                                                                                         |

## 3. Conditions to close M4

| Condition                                                                                 | Owner                          | Why it is open                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| CERT-In empanelled VAPT on staging per `docs/security/vapt-scope.md`; retest; certificate | Client with the platform team  | No auditor engaged; no staging environment in this laptop-only setup |
| One released report card per band compared with the legacy card (UAT rows 4 to 6)         | Examination cell with the team | Legacy cards and the real marks arrive with the ETL rehearsal        |
| UAT scripts for exams, transport and library signed                                       | Pilot super-users              | No pilot users have used the local build yet                         |
| M3 conditions (shadow term to zero, live gateway, fees UAT, Tally reconciliation)         | Pilot accounts office          | Carried from the M3 report                                           |
| DR drill on staging with `pg_dump`/`pg_restore` 16                                        | Platform engineering           | Client binaries missing on the development laptop                    |

## 4. Carried into the pilot (Sprint 22 onwards)

The conditions above; hypercare plan in `docs/runbooks/go-live.md`; Release 2 scope per
`docs/release-1-freeze.md` section 2.
