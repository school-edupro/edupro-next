# 54 — Admission fee refunds: approval levels from Fees → Approval, paid by Accounts in Fees → Refunds (plan, 27 Oct 2026)

Asked on the registration page ("Cancelled; refund of ₹20,000 sent for approval"): who is the approver,
and where does Accounts see the refund?

## What is there today

- Cancelling after the admission fee (or with parts paid, docs/design/53) makes an
  `admission_refunds` row: the amount paid less the session's deduction %, status `requested`.
- Approve, reject and pay all need `fees.refund.approve` (step-up MFA). By default only School Admin and
  Group Admin hold it.
- The only screen is Admissions → Admission fee refunds, which needs `admissions.application.view`.
  So Accounts, who have neither right, cannot see the refund, and the Principal or the admin does
  everything.
- Fees → Approval (`/fees/approval`) already drives the approval levels of fee changes and hostel
  withdrawals through the workflow engine:
  - The levels are by role, designation or named person.
  - The steps show in the Workflow inbox.
  - It can be switched on or off.

What the best do (Entab, Fedena): the refund is raised by the admission office, approved through the
school's fee approval chain, and paid by Accounts against a refund voucher, which shows in the day
book.

## Decisions (asked and answered, 27 Oct 2026)

| #   | Question              | Decision                                                                                                  |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Who approves          | **The levels set on Fees → Approval**: a new process "Admission fee refund", edited there like the others |
| 2   | Where Accounts see it | **Fees → Refunds, an "Admission refunds" tab** beside the pupils' refunds                                 |

Defaults (change on request):

- **The levels:** the process starts with **Accounts, then Principal** (as the fee processes do). The
  school changes the levels, the people or the order on Fees → Approval.
- **Switched off:** as today, a holder of `fees.refund.approve` approves in one step.
- **Who acts:** each level's people act from the Workflow inbox, the new tab, or Admissions → Admission
  fee refunds. Each acts with a remark, and a reject needs one.
- **Changing the amount:** the deduction is the session's; an approver does not change the amount (a
  different refund is a new cancellation decision).
- **Paying:** after the last level, the refund is **Approved: to pay**. Accounts (`fees.receipt.post`, the
  cashier) pays it on the tab with the mode (cash, cheque, bank transfer), the reference and the date.
  A refund voucher PDF is made, with View / Download, and the payment shows in Admission fee collection
  and the Day book as today.
- **The family:** the family is told when the refund is approved, and again when it is paid (the
  existing admission messages).
- **Refunds already waiting** (like the ₹20,000 one): they join the process when it is first switched on.

## Parts

**Part 1 — Process (API).**

- A workflow definition `admission_refund`, made with the two default levels the first time it is shown
  (as hostel withdrawal is).
- A cancel that makes a refund starts an instance; the refund shows the level it waits at.
- `WorkflowService.onComplete` sets approved or rejected and writes the event on the registration.
- Approve and reject go through the workflow, and Pay keeps its check of the approved status.
- The process switched off: today's one-step approval with `fees.refund.approve`.

**Part 2 — Fees → Approval (admin).**

- A third card, "Admission fee refund", with the levels, who may ask (the admission office, by
  cancelling) and the result.
- Switch on / off and the editor, as for the others.

**Part 3 — Fees → Refunds, Admission refunds tab (admin).**

- The tab lists the refunds by status (Waiting approval, with who it waits on and since when; To pay;
  Paid; Rejected).
- Each row shows the candidate, number, class, paid, deduction and refund, plus the reason.
- Act on my level: approve or reject, with a remark.
- **Pay** opens mode, reference and date, then the voucher with View / Download.
- Admissions → Admission fee refunds shows the same levels and links to the tab.

**Part 4 — Tests.**

- e2e: a cancel starts the process; Accounts (level 1), then the Principal (level 2), approve; Accounts
  pays; the voucher is made and the day book shows it.
- e2e: a reject at level 1 closes it; with the process switched off, it works as today.
- a11y for the tab and the approval page; a browser check as dev-accounts and dev-principal.
