# M5 gate report: pilot go-live

|                |                                                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-09-29                                                                                                                                                                                                                                                                                |
| Scope          | Phase 5, Sprints 22 and 23 (`SCHOOL_ERP_SPRINT_PLAN.md`)                                                                                                                                                                                                                                  |
| Recommendation | Pass with conditions: the cut-over, hypercare, monitoring and month-end tooling is built, tested and rehearsed on the demo school; the pilot itself (environment, training delivery, final ETL, go-live weekend, hypercare, first live month-end) needs the school and its infrastructure |

## 1. What M5 was to deliver

"Pilot fully on EduPro Next; legacy read-only; hypercare closed."

## 2. Evidence

| Area                   | Evidence                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cut-over procedure     | `docs/runbooks/go-live.md` executed as timed runs in **System → Cut-over** (27 steps, snapshots, reconciliation, sign-off refusing mismatches); `sprint22.e2e-spec.ts` |
| Monitoring and on-call | `scripts/synthetic-check.mjs`, `docs/runbooks/on-call.md`, metrics already exposed by the API                                                                          |
| Hypercare              | Issue board with SLAs, teacher-app reporting, daily digest, `platform.hypercare_until`; workers `sprint22.test.ts`                                                     |
| Feature flags          | `platform.modules_enabled` honoured by the admin shell                                                                                                                 |
| Training and help      | `docs/training`, tours, help centre in three apps                                                                                                                      |
| Month-end close        | Checks, lock, pack, reopen; `docs/runbooks/month-end-close.md`                                                                                                         |
| Rollout playbook       | `docs/runbooks/rollout-playbook.md`                                                                                                                                    |
| Security               | M4 report; hardening of Sprint 21; the go-live security certificate depends on the external VAPT                                                                       |

## 3. Conditions to close M5

| Condition                                                                                         | Owner                            | Why it is open                                  |
| ------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| Production and staging environments applied; providers and gateway connected                      | Client with platform engineering | No Azure subscription in this laptop-only setup |
| Training delivered per role; help desk rota                                                       | Delivery lead with the school    | No pilot staff yet                              |
| Rehearsals 2 and 3 with the real legacy dump; final ETL; reconciliation signed off in the product | Data team with the school        | Dump not shared                                 |
| Go-live weekend executed; legacy read-only; compat gateway switched                               | Platform engineering             | Depends on the above                            |
| Hypercare run to exit (two weeks without S1/S2)                                                   | Delivery lead                    | Depends on the go-live                          |
| First live month-end close accepted by the accounts head and compared with the legacy month       | Accounts head with the team      | Depends on the go-live                          |
| Go-live security certificate (external VAPT, M4 condition)                                        | Client with the auditor          | Not engaged                                     |

## 4. Carried into Release 2

The conditions above run alongside Release 2 (HR and payroll from Sprint 24); the rollout playbook
drives the waves from Sprint 26.
