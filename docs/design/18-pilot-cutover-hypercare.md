# Design note 18: pilot cut-over and hypercare tooling (Sprints 22 and 23)

|            |                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprints    | S22 (weeks 45-46) cut over the pilot; S23 (weeks 47-48) stabilise, first live month-end close, M5 gate                                                                                                                                 |
| Depends on | `docs/runbooks/go-live.md`, `disaster-recovery.md`, `incident-breach.md`; the ETL framework (`packages/etl`, `etl.runs`, `etl.reconciliations`); fees, payments and reports modules                                                    |
| Outcome    | The steps of a cut-over are executed, timed and signed off inside the product; hypercare issues are logged, triaged against SLAs and reported daily; month-end fee close locks the period; a help centre answers the routine questions |

Sprints 22 and 23 are operational sprints. The pilot school, its production environment, its
trainers and its legacy dump are not available in this laptop-only environment, so the sprint builds
the tooling the runbooks call for and rehearses it on the demo school; the live activities are the M5
conditions.

## 1. Cut-over runs

`cutover_runs` (kind `rehearsal` | `final`, name, status `planned` | `running` | `done` | `aborted`,
started, finished, notes) with `cutover_steps` (sequence, code, title, owner role, status `pending` |
`done` | `skipped` | `failed`, who, when, duration in seconds, note). A new run installs the default
steps from the go-live runbook (readiness, T-7, T-1, cut-over, hypercare). Ticking a step records the
actor and the time; the run's elapsed time per phase is the timing the plan asks for ("cutover
rehearsals 2 and 3 (timed)").

`cutover_snapshots` (run, source `legacy` | `live`, counts as JSON) hold the reconciliation:
`app.live_counts()` counts pupils, guardians, employees, active enrolments, fee demand and receipts of
the working year, attendance marks and exam results under the school's RLS; the legacy counts are
entered from the legacy reports (or from `etl.reconciliations` when the ETL ran). The run page shows
both columns with the difference and a sign-off step that refuses while any count differs outside the
documented tolerance (`platform.cutover_tolerance_pct`, default 0).

Permission `platform.cutover.manage` (admins). Screen **System → Cut-over**.

## 2. Hypercare

`hypercare_issues` (`HC/NNN`, title, module, severity `s1`..`s4`, reporter, channel, status `open` |
`triaged` | `in_progress` | `fixed` | `verified` | `closed`, assigned role and user, due at, workaround,
resolution) with `hypercare_updates` (author, body, status change). The due time comes from
`hypercare.sla_s1_hours` (4), `s2` (24), `s3` (72), `s4` (168). Anyone with
`platform.hypercare.report` (every staff role) reports from the admin or the teacher app; admins
(`platform.hypercare.manage`) triage on **System → Hypercare**: filters, assignment, status, comments,
overdue badge.

The daily job `hypercare.digest` (08:30 IST) sends the admins a WhatsApp (and email when set) with
the counts by severity and the overdue list; the setting `platform.hypercare_until` ends the digest
and marks the exit of hypercare on the gate report.

## 3. Feature flags for the pilot

Setting `platform.modules_enabled` (list, default every module). The admin shell hides the navigation
groups of disabled modules and the API refuses their routes? No: the API stays complete (the apps and
the compat layer depend on it); the flag is a presentation and training control for the pilot's first
weeks (for example hiding Library and Transport until their UATs are signed). The parent and teacher
apps hide the corresponding tiles through `GET /ops/features`.

## 4. First live month-end fee close

`fee_period_locks` (ledger or all, `locked_through` date, who, when, note) and `fee_month_closes`
(month, status `open` | `closed`, checks as JSON, pack export ids, closed by and when).

**Fees → Month-end close** for a month runs the checks: receipts and amount of the month per ledger
and mode, reversed receipts, bank statement lines still unmatched, settlements not reconciled, open
shadow variances (while the shadow run is open), pending adjustment requests, and the day-book total
against the sum of receipts. Closing needs a second factor (`fees.period.lock`), writes the lock at the
last day of the month, queues the month-end pack (day book, head-wise tally, Tally XML, defaulters) as
exports, and records who closed it. `PaymentsService.postReceipt` and the misc-receipt path refuse a
`received_on` on or before the lock (`fees.period_locked`), so back-dated receipts after the close are
impossible; a reopen (same permission, reason, audited) moves the lock back.

## 5. Help centre

`/help` in the admin app renders the training pages (`apps/admin/content/help/*.md`, synced from
`docs/training` by `scripts/sync-help.mjs`) with a small in-house Markdown renderer (headings, lists,
tables, emphasis, links); the header question mark keeps the tour and a book icon opens the help
centre. The parent and teacher apps get `/help` with the bilingual "five common questions" of their
modules and the school's contact line.

## 6. On-call and synthetic checks

`scripts/synthetic-check.mjs` calls the health and metrics endpoints, the public `app_version`, and a
developer sign-in read on the dev stack (`--base`, `--school`), prints one line per check with the
latency and exits non-zero on a failure; the on-call runbook (`docs/runbooks/on-call.md`) runs it from
the monitor and lists the alert rules, the escalation and the hotfix lane.

## 7. Verification

`sprint22.e2e-spec.ts`: a rehearsal run with timed steps and a sign-off refused on a count difference
then accepted; a hypercare issue through triage to closed with the SLA badge; a receipt refused behind
the period lock and accepted after the reopen; month-end checks and close; features endpoint and a
disabled module hidden. Workers test: the digest message. Records for both sprints, the M5 gate
report with conditions, the pilot retrospective and the rollout playbook.
