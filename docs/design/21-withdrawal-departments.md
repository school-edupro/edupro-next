# 21. Withdrawal through configured departments, approvals bell, sibling verify (2026-10-01)

Benchmarked on the no-dues / leaving flows of Entab CampusCare, Fedena and MyClassboard.

## Decisions (with the school)

| #   | Question                | Decision                                                                                   |
| --- | ----------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Department order        | Configurable steps; same step works in parallel, the next opens when it has cleared        |
| 2   | Who starts a withdrawal | School office / admin (student page or bulk screen)                                        |
| 3   | Bulk (Class XII)        | Fees and library clear by themselves when nothing is due; other departments clear in bulk  |
| 4   | TC                      | Issued from the withdrawal once the departments marked "TC after this" (fees) have cleared |
| 5   | Sibling                 | Verify the admission number and record it; parent records stay separate                    |

## Model (migrations 0045, 0046)

- `withdrawal_departments`: code, name, step 1–9, approvers (office = holds `people.withdrawal.manage`,
  class teacher of the student's section, role, named employee; any one may act), `auto_check`
  (`fees`: live ledger balance + late fee up to the leaving date; `library`: books not returned and
  unpaid fines), `auto_clear`, `bypass_allowed`, `document_required`, `gates_tc`, active. Defaults on
  first use: fees (accountant / office, check, auto-clear, gates TC), library (check, auto-clear,
  bypass), transport (bypass) at step 1; class teacher at step 2; principal (school admin) at step 3.
- `student_withdrawals` + initiated_on, remarks, documents, current_step, tc_id, batch_id.
- `withdrawal_clearances` + department_id, step, documents, bypassed, auto, check_result.
- Class teachers and coordinators may view and clear (0046).

## Flow

1. Start: dates, reason, remarks, documents → one clearance per active department at its step; the
   current step's automatic checks run and clear what has nothing due; repeat while steps open.
2. Each department at the current step: its approvers (or the office) clear / hold with dues, remarks,
   documents; a bypassable one may be skipped with a reason. Done step → next step → checks.
3. TC: `POST /people/withdrawals/:id/tc` once the gating departments cleared; the student stays active
   until completion (`TcService.issue(..., { keepStatus })`).
4. Complete (all cleared): enrolment withdrawn, student inactive, student login revoked, a parent's
   login revoked when no other child studies here. Cancel any time before completion (not while a TC
   is issued).
5. Bulk: `/people/withdrawals/bulk` (one date and reason), `/clearances/bulk`, `/tc/bulk`; admin screen
   `/people/withdrawals/bulk` with three tabs.

## Approvals bell and My approvals

`lib/approvals.ts` counts, per permission: profile changes routed to me, workflow steps at my level,
withdrawals waiting for my department (`?mine=true`). The header inbox icon shows the total and opens
`/approvals`. Proof documents of profile approvals open inline (PDF / images) and preview in the panel.

## Sibling verify

`GET /people/profile/sibling?admissionNo=&exclude=`; the profile writer checks the number on every
save and fills the sibling's name and class from that record.
