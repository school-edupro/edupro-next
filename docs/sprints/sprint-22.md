# Sprint 22 record: cut over the pilot (Phase 5, weeks 45-46)

|             |                                                                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal        | Production environment hardened with monitoring and on-call; feature flags for the pilot; role-based training delivery; parent communication and help centre; timed cut-over rehearsals, final ETL, reconciliation sign-off, go-live, hypercare |
| Environment | Local only. The pilot school, its production environment, trainers and legacy dump are not available, so the sprint built and rehearsed the tooling on the demo school; the live activities are M5 conditions                                   |
| Commit      | see `git log` (this record is committed with the code)                                                                                                                                                                                          |

## 1. Scope and outcome

| Id     | Task (sprint plan row S22)                                              | Outcome                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S22-01 | Production environment hardened; monitoring and on-call                 | Tooling done: `scripts/synthetic-check.mjs` (health, metrics, compat app_version, authenticated reads; latency budget; non-zero exit), `docs/runbooks/on-call.md` (alert rules with thresholds on the existing metrics, on-call routine, escalation, capacity knobs). The environment itself waits for the subscription (M1/M2 condition)                                                                       |
| S22-02 | Feature flags for the pilot                                             | Done. Setting `platform.modules_enabled`; `GET /ops/features`; the admin shell hides the navigation groups of disabled modules (overview and system always shown); the API and the compat layer stay complete                                                                                                                                                                                                   |
| S22-03 | Role-based training delivery                                            | Material done in Sprint 20 (`docs/training`, tours); delivery needs the pilot's staff. The help centre (`/help` in the admin app, rendered from the same pages; bilingual FAQ pages in the parent and teacher apps) carries the sessions' content into the product                                                                                                                                              |
| S22-04 | Parent communication campaign; help centre live                         | Help centre done (above). The go-live notice goes through the communication module's approved requests; the message text is in the go-live runbook step 2.1                                                                                                                                                                                                                                                     |
| S22-05 | Cut-over rehearsals 2 and 3 (timed); final ETL; reconciliation sign-off | Done as tooling: `cutover_runs` with the 27 steps of the go-live runbook installed per run, ticked with actor, time and duration per step and per phase; `cutover_snapshots` with `app.live_counts()` against the legacy counts; the sign-off refuses pending steps and any measure outside `platform.cutover_tolerance_pct`. Rehearsed on the demo school (seeded rehearsal signed off, final run in progress) |
| S22-06 | Go-live over a weekend; legacy read-only; hypercare starts              | Hypercare tooling done: `hypercare_issues` with severity SLAs (`hypercare.sla_s*_hours`), reporting from the admin and the teacher app (**Report an issue**), triage board with filters, assignment, workaround and resolution, overdue badges, the 08:30 IST digest to the admins (`hypercare.digest`), `platform.hypercare_until` to end it                                                                   |
| S22-07 | Demo data                                                               | Done. A signed-off rehearsal and a running final run with steps and snapshots; four hypercare issues across severities and statuses                                                                                                                                                                                                                                                                             |

## 2. Data model, permissions and settings

Migration `0033_sprint22_23_pilot_cutover_hypercare.sql`: `cutover_runs`, `cutover_steps`,
`cutover_snapshots`, `app.live_counts()`, `hypercare_issues`, `hypercare_updates`, plus the Sprint 23
tables (`fee_period_locks`, `fee_month_closes`, `app.fee_locked_through`). Permissions
`platform.cutover.manage` (admins), `platform.hypercare.report` (every staff role),
`platform.hypercare.manage` (admins). Settings `platform.modules_enabled`,
`platform.cutover_tolerance_pct`, `platform.hypercare_until`, `hypercare.sla_s1..s4_hours`.

## 3. Verification

`sprint22.e2e-spec.ts` (cut-over run, hypercare, feature flags, month-end), workers
`sprint22.test.ts` (digest), the full API suite, lint, typecheck, format, axe on the new screens, a
browser walk-through; totals in the Sprint 23 record.

## 4. Carried into Sprint 23 and the pilot

The live cut-over itself (M5 conditions in `m5-gate-report.md`); stabilisation and the first live
month-end close (Sprint 23).
