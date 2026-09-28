# Adjustments, hostel, misc, exams start and the assistant (Sprint 14)

Phase 3, weeks 29-30. Builds on [09-collect-and-pay.md](09-collect-and-pay.md) (receipts, refunds, gateways)
and [07-ai-layer.md](07-ai-layer.md) (principles of the AI layer).

## 1. The ledger dimension: hostel on the same engine

`fee_demands.ledger` (school, hostel, misc, admission) is copied from the head at generation. The generator
includes school-ledger heads for everyone and hostel-ledger heads only when `student_fee_profiles.hosteller`
is set; rounding reconciles per period **and ledger**. `app.post_receipt(p_ledger)` and
`app.allocate_fee_payment` settle only the demands of the receipt's ledger, so a hostel receipt
(`HF/FY…`) never touches tuition, and the cashier chooses the ledger on the receipt. The late fee rule stays
on the school ledger (hostel instalments carry none in this release). The student ledger lists both, with
the ledger on each instalment.

## 2. Adjustments

`fee_adjustments` (waiver, reversal, bounce): the accounts desk requests (`fees.adjustment.request`), an
administrator decides (`fees.adjustment.approve`, **requires_mfa = true**, so the guard demands a
multi-factor sign-in within `MFA_FRESHNESS_MINUTES`; a stale session answers `mfa-required` and the admin
app sends the user to step-up). Approval applies the change inside the same transaction:

| Kind     | Procedure                                                   | Effect                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| waiver   | `app.waive_demand(demand, amount)`                          | raises the row's discount and lowers its net, never below what is paid; the row becomes paid when the paid amount now covers it                                                                                   |
| reversal | `app.reverse_fee_payment(payment, 'reversed', …)`           | removes the allocations and late fee postings (demand rows reopen), keeps the receipt with its number and status `reversed`; refused after a refund                                                               |
| bounce   | `app.reverse_fee_payment(payment, 'bounced', charge, head)` | as reversal, plus a demand row of the misc head named by `fees.bounce_charge_head` (created on first use) for `fees.bounce_charge` (default ₹500), due today, source `bounce_charge`; cheque and DD receipts only |

One open adjustment per row or receipt. Every row change is on the audit trigger.

## 3. Category, discount and hostel changes through the workflow

`fee_profile_changes` carries the requested fields (`feeGroup`, `studentType`, `discountId`, `hosteller`,
`transportSlabId`, `transportDisabled`) and the previous values. When the `fee_profile_change` workflow is
installed (it is among the defaults), the request starts an instance and the completion handler applies it;
otherwise a holder of `fees.profile.manage` decides directly. Approval writes the profile, regenerates the
demand (paid rows are kept) and re-applies the instalment override. One open change per student and year.

## 4. Misc receipts

`misc_receipts`: students, employees, vendors and others pay against misc-ledger heads (ID cards,
certificates, stalls…). Numbered by `app.next_receipt_no('misc', financial year)` (`MF/FY…`), with mode,
instrument and reference; listed and filtered on **Fees → Misc receipts**. Not part of the student demand.

## 5. Reconciliation

`app.reconcile_payments(as_of)` writes one `payment_reconciliation_runs` row per school and day (idempotent):
online receipts, settled and unsettled counts and amounts, receipts unsettled for more than three days,
unmatched and mismatched settlement lines, intents that succeeded without a receipt (a handler failure), and
the variance between settled amounts and matched receipts. The workers run it daily (`payments.reconcile`),
warning on any variance; the desk can run it now. Shown under **Fees → Misc receipts → Reconciliation** and
answered by the assistant (`online_payments_status`).

## 6. Exams start

`exam_types` (code, name, weightage), `grade_scales` with `grade_bands` (percentage bands, grade, points;
bands must not overlap), `exams` per academic year and type with dates, portal and lock flags,
`exam_classes` (which classes sit it, each with a grade scale), `exam_subjects` (max marks, pass marks,
weightage, elective, date, entry lock with who and when). Locking the exam locks every subject. Permissions
`exams.master.view` (coordinators, teachers, auditors) and `exams.master.manage` (coordinators, admins).
Legacy `exam_type`, `exam_master`, `exam_subject_master` and `exam_grade_master` map through the ETL steps
in `packages/etl/src/domains/exams.ts` (marks ranges become percentage bands; one scale per legacy class
group). Marks entry, registers and report cards follow in Sprints 15 to 18.

## 7. The assistant v0 (AI track S14)

- **Catalogue v1** (`apps/api/src/modules/insights/catalogue.ts`): 34 parameterised entries across school,
  attendance, fees, academics, admissions, transport, communication, HR and exams, each with `anyOf`
  permissions, typed parameters, keywords and a Hindi title. The catalogue is built per call with the
  tenant's academic year and today's date; the model chooses an entry and parameters, never SQL.
- **Pipeline**: `POST /insights/assistant` (`insights.assistant.use`) runs `packages/ai`'s `Assistant`
  with the caller's allowed entries as tools. Each tool runs its query inside the caller's tenant
  transaction, so RBAC and RLS apply as in the screens; the answer cites the entries it used with their
  parameters and row counts. Prompts, tool calls, answers and refusals go to `ai_audit` redacted; turns go
  to `ai_conversations` / `ai_messages`; budgets (`AI_USER_DAILY_TOKENS`, `AI_SCHOOL_MONTHLY_TOKENS`) are
  counted in Redis. A refusal names the nearest entries.
- **Providers**: `AI_PROVIDER=claude` with `ANTHROPIC_API_KEY` in production (mock refused); the
  development mock routes questions by keyword to the catalogue and narrates the rows, in Hindi when the
  question is in Devanagari, so the flow is testable offline. Acceptance check from the plan: the accountant
  asking for Class VI defaulters gets exactly the rows of the fees department dashboard (e2e).
- **Admin app**: **Insights → Assistant** (conversation, sources, what you can ask) and **Assistant audit**
  (`insights.assistant.audit`: prompts, refusals, tool calls, tokens, cost).

## 8. Family receipts

`POST /fees/mine/receipts/:paymentId/pdf` renders one of the family's own receipts through the export
service without the template permission (ownership is the check); `GET /fees/mine/exports/:id` returns the
status and the signed download link for the caller's own export. Families received `reports.export.view`
limited to their own rows (the list filters by requester for anyone without `reports.export.create`).

## 9. Decisions

- **Hostel is a ledger, not a module**: the same demand, receipt, late fee and refund code serves it.
- **MFA on the approval, not the request**: the desk keeps working; the money-moving step needs the
  fresh sign-in, enforced by the permission catalogue (`requires_mfa`) rather than a per-route flag.
- **Bounce charges are demand rows** on a misc head so they appear in dues, ageing and the dashboard.
- **Profile changes are approvals, not edits**: the profile stays editable for the initial setup
  (`fees.profile.manage`), but changes after demand generation go through the workflow.
- **The assistant cannot see more than the caller**; the catalogue's `anyOf` is checked against the
  permission set before the tools are offered, and every query runs under the caller's RLS.
