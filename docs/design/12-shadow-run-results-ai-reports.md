# 12. Shadow run, exam results, AI reports v1 (Sprint 16)

Sprint plan row S16 (weeks 33-34) and AI track S16. Builds on 09 (collect and pay), 11 (exam entry, report
framework, assistant everywhere). Migration `0027_sprint16_shadow_results_ai_reports.sql`.

## 1. Shadow run

The legacy system stays the system of record for the term. Its receipts are **dual-posted** into the new
ledger every day and the two ledgers are reconciled; the goal is a variance report at zero from day 3.

- **Feed.** `POST /shadow/feeds` (staff, `fees.shadow.manage`) or `POST /shadow/feeds/ingest` (machine,
  header `x-service-key`) with `{kind: 'receipts' | 'balances', source, rows}` where `rows` are the legacy
  tables' own columns (`fees` headers with their `fees_transaction` lines; `fees_student` balances per
  admission and month). The ETL transforms of Sprint 13 (`feeReceiptStep`, `feeReceiptLineStep`) validate
  each row; rejects are kept on the feed. Accepted receipts land in `shadow_legacy_receipts` (unique per
  school and legacy receipt number) and are posted through **`app.post_receipt`** on the school ledger with
  the legacy number as `reference`, `remarks = 'shadow: <legacy no>'`, `p_strict_year = false`; the new
  `payment_id` is kept on the shadow row. Cancelled legacy receipts reverse the earlier posting through
  `app.reverse_fee_payment`. A receipt already posted is skipped (idempotent feed).
- **Service keys.** `service_keys` (school, name, key hash, scopes, status, last_used_at): a generic machine
  credential following the RFID device-key pattern, issued once under **System → Service keys**
  (`platform.service_key.manage`). Scope `shadow.feed` is the only one this sprint uses.
- **Reconciliation.** `app.run_shadow_reconcile(p_from, p_to)` compares, for the window, legacy receipts
  against the shadow-posted payments (counts and amounts per day and mode; per receipt: missing in new,
  reversed but not cancelled, amount or date differences) and, when a balance snapshot exists for the day,
  legacy per-student balances against the new ledger's balance as of that day. It writes `shadow_runs`
  (one per school and day, totals and variance) and `shadow_variances` (one row per finding, `open |
explained | resolved`). The workers job `shadow.reconcile` (queue `reconciliation`, daily after the
  feed) runs it for every school and raises `insight_alerts` kind `shadow.variance` when the run is not
  zero.
- **Variance workbench.** `GET /shadow/runs`, `GET /shadow/variances`, `POST /shadow/variances/:id`
  (explain / resolve), `POST /shadow/reconcile` (run now). Admin **Fees → Variance workbench**: feed
  upload (CSV or JSON), runs with the day's numbers, variances with explanation and resolution.
- **Runbook** `docs/runbooks/shadow-run.md`; **UAT checklist** `docs/quality/uat-fees.md`.

## 2. Load and security evidence

- **Due-date peak at 5×.** `apps/api/test/performance-fees.e2e-spec.ts`: 100 concurrent receipts across 20
  pupils (5× the Sprint 13 concurrency test), then ledger reads and the day book under budget; numbers go to
  the sprint record. `perf/k6/due-date-peak.js` for the same shape against a running stack.
- **Fee VAPT retest.** `pentest.e2e-spec.ts` gains a fee section: cross-tenant and cross-family reads of
  ledgers, receipts, bank statements, exports and report rows; injection through report parameters;
  service-key guessing; write attempts on locked years. `docs/security/phase-3-fees-vapt.md` records it.

## 3. Exam results, registers, analysis, promotion

- `exam_results` (exam, student): total, max, percentage, grade (class scale), rank in section and class,
  `failed_subjects`, `result` (`pass | fail | incomplete`), computed by `app.compute_exam_results(exam_id)`
  from `mark_entries` (absent counts as 0 and fails the subject; exempt subjects are excluded from the
  maximum; incomplete when any non-exempt subject has no entry). `POST /exams/:id/results/compute`
  (`exams.master.manage`) recomputes; the compute is idempotent.
- **Register** `GET /exams/:id/register-sheet?classSectionId`: pupils × subjects with marks, total, %, grade,
  rank; dataset `exam_register` for export. **Analysis** `GET /exams/:id/analysis[?classId]`: per subject
  entered / absent / mean / highest / lowest / pass %; grade distribution; section comparison; toppers;
  dataset `exam_analysis`. Both `exams.marks.view` (teachers see their sections through the same scope
  rule as entry).
- **Promotion linkage** `GET /exams/:id/promotion-proposals?classId&minPct&maxFailed` reads `exam_results`
  and proposes `promote | retain` per pupil with the reason; the admin page hands the accepted proposals to
  the existing `PUT /people/promotions` (Sprint 7) with the next year and section, so the year rollover
  flow is unchanged.

## 4. AI reports v1, red team, cost, evaluation

- **Facts before words.** `packages/db/src/report-facts.ts` collects the numbers for a period from the
  marts and tables (attendance, fees, academics, communication, approvals) with a named query per fact, so
  every sentence can cite its query. `packages/ai/src/narrative.ts` turns facts into a narrative through
  the provider (Claude in production; a deterministic template in the mock) in English or Hindi, and
  returns the citations.
- **Scheduled.** Workers job `insights.reports` (Mondays 06:00 IST) writes `ai_reports` (kind
  `principal_brief` and one `department_weekly` per department, period = previous week), creates an export
  through the new renderer `ai_report` (PDF from `documentHtml`), and sends the WhatsApp summary (first
  lines plus the export link when ready) to the roles in `insights.alert_roles`. `POST /insights/reports/run`
  runs it on demand; `GET /insights/reports[/:id]` lists and reads. Admin **Insights → Reports**.
- **Red team in CI.** `apps/api/test/redteam.e2e-spec.ts`: prompt injection in the question and through
  data (a pupil whose name carries an instruction), cross-scope requests from a teacher and a parent,
  SQL-shaped parameters, budget exhaustion, consent withdrawal mid-conversation; every case asserts no
  leak (citations only from the caller's entries, rows only from the caller's scope) and no server error.
  CI runs it with the permission-coverage spec (`test:redteam`).
- **Cost dashboard.** `GET /insights/assistant/costs?days`: cost and tokens by day, by surface (through
  `ai_conversations`), top users, refusal rate; admin **Insights → Assistant costs**.
- **Evaluation set.** `packages/ai/eval/questions.json`: 200 questions across five roles (admin,
  accountant, coordinator, teacher, parent) and three languages, each with the expected entry or
  `refuse`. `apps/api/test/assistant-eval.e2e-spec.ts` runs the set through the API with the mock router
  and asserts ≥ 95 % correct-or-declined and zero permission leaks; the same file is the fixture for a
  nightly run against the real model when a key is present.

## 5. Out of scope, recorded

Cutover itself, ETL rehearsal against the legacy dump, report cards (Sprint 17), results analytics marts
(Sprint 17-19).
