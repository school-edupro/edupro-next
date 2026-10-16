# Hostel withdrawal (plan, 16 Oct 2026)

A pupil leaves the hostel but stays in school, or leaves the school while a hosteller. Today a stay
ends with one click (Hostel → Allot / transfer / vacate). That click has no request, clearance, approval
or fee settlement. The school withdrawal ignores the hostel: the bed stays allotted and there is no hostel
step.

## Decisions (user, 16 Oct 2026)

- **Who starts it:** the hostel office or the head warden, in the admin app. There is no parent portal
  request.
- **Clearances:** the same step engine as the school withdrawal, with its own **Hostel withdrawal
  settings** page. Default steps:
  - Step 1: Warden (room and inventory check, damage amount), Mess, and Hostel fee dues (automatic
    check).
  - Step 2: Accounts settlement.
- **Fees:**
  - Hostel months already paid after the leaving month **carry forward** to the next unpaid school fee,
    or are **refunded** on request. Accounts chooses, through the fee approval levels.
  - **Notice period:** if the leaving date is less than N days after the request (setting, default 30),
    the hostel fee of the next month is still charged.
  - **Damage / dues:** the warden's amount is raised as a misc fee on the pupil (misc ledger) before the
    warden clears.
- **Leaving the school:** for a hosteller, the school withdrawal automatically gets the hostel clearance
  step. On completion the bed is vacated on the leaving date and the hostel fee stops with the school fee.

## Flow

1. **Start.** Hostel → Withdrawals → New. Choose the pupil (hostellers only), the leaving date, the
   reason (parent's request / discipline / health / other), remarks, documents (e.g. the parent's
   letter). The request date is today; the notice days are worked out and shown.
2. **Clearances in steps.** Each department clears, bypasses with a reason, or asks for a document,
   exactly as in the school withdrawal.
   - Warden: room and inventory checklist; damage amount → misc fee "Hostel damages".
   - Mess: pending mess dues amount → misc fee.
   - Hostel fee: automatic check that hostel dues up to the leaving month are paid.
   - Accounts: settlement (step 4).
3. **Vacate.** When every step is cleared, _Complete_ ends the allotment on the leaving date (reason
   `vacate`) and frees the bed. The pupil becomes a day scholar from the next month.
4. **Fee settlement.**
   - Hostel stay ends at the leaving month (`hostel_to`).
   - The notice charge keeps the next month if the notice was short.
   - Unpaid later hostel lines are cancelled.
   - Paid later months go to carry-forward (to the next unpaid school fee, `app.paid_charge_to_fee`) or
     to a refund (fee approval levels), as chosen by Accounts.
   - Everything appears in the fee profile-change register.
5. **Notices.** The parent is told when the hostel withdrawal is completed (portal, and SMS/WhatsApp by
   a template when ready). The warden and the accounts office see their pending steps under Approvals.
6. **Cancel / revoke.** The request can be cancelled until completion. A revoke after completion is
   done by allotting again, not by undoing.

## School withdrawal link

- A hosteller's school withdrawal gets a **Hostel** department (Warden + Mess at step 1) from the hostel
  withdrawal settings, with the same damage and mess charges.
- On completion of the school withdrawal:
  - the open allotment ends on the leaving date with reason `withdrawn`;
  - the hostel fee profile is closed at the leaving month;
  - the fee settlement of the school withdrawal already cancels later months, so the notice charge does
    not apply.

## Model (migration 0153)

- `hostel_withdrawals`:
  - id, school, student, allotment, requested_on, leaving_on, reason, remarks, documents;
  - status (requested / cleared / completed / cancelled), current_step, notice_days, notice_charged;
  - fee_choice (carry / refund), completed_at / by.
- `hostel_withdrawal_clearances`: same columns as `withdrawal_clearances`.
- The department list is kept in `withdrawal_departments` with a new `process` column ('school' /
  'hostel').
- New auto checks: `hostel_fees`. The settings hold the notice days, the notice charge on/off, the damage
  and mess heads.
- Permissions: `hostel.withdrawal.view`, `hostel.withdrawal.manage`, `hostel.withdrawal.clear`. Given to
  the warden, the hostel office and school admins; Accounts gets clear.

## Screens

- **Hostel → Withdrawals:** a list with filters (status, hostel, month); a register to Excel or PDF.
- **Request page:** the steps with who cleared and when; the damage and mess amounts; _Complete_; the
  fee settlement summary; _Cancel_.
- **Hostel → Settings → Withdrawal:** steps and approvers, notice days, notice charge, the misc heads
  for damages and mess.
- **School withdrawal page:** the Hostel step appears for hostellers.
- **Fee ledger:** a pupil who left the hostel shows "Day scholar since <month>".
- **Parent portal:** the hostel page says "Left the hostel on <date>".

## Tests

- API e2e covers:
  - start, steps, bypass, damage → misc fee;
  - notice charge on and off, carry vs refund;
  - completion vacates the bed and stops the hostel fee;
  - cancel, permissions;
  - a school withdrawal of a hosteller (hostel step added, bed vacated, fee stopped).
- Browser walk-through and a11y on the new pages; test cases in
  `docs/testing/hostel-withdrawal-test-cases.md`.

## Part 2 (16 Oct 2026, migration 0158): approval levels and the Hostel Clerk

Changed by the user after the first build:

- **Hostel Clerk** is a new built-in role (`hostel_clerk`). It can:
  - start, complete and cancel hostel withdrawals;
  - allot, transfer and vacate beds;
  - open the registers and reports (occupancy, register, leave, visitors, incidents, withdrawal
    register);
  - change the hostel set-up.
- **Who may start one** is the "Started by" list of the hostel withdrawal's own card on
  **Fee setup → Approval levels** (workflow `hostel_withdrawal`).
  - The default list is Hostel Clerk, Warden, School Admin and Group Admin.
  - A warden starts one only for a pupil of their own hostel.
- **The steps are replaced by approval levels** set on the same card (default: Accounts, then
  Principal).
  - The **damages and mess dues are entered at the start**.
  - The approver of each level approves or does not approve, from the withdrawal page or the
    Approvals inbox.
  - The **last approver chooses carry-forward or refund**; the default is carry-forward.
  - "Not approved" needs a note, and the pupil keeps the bed.
- **The last approval:**
  - gives up the bed on the leaving date;
  - stops the hostel fee after the leaving month, or after the next month on a short notice;
  - carries forward or refunds the paid later months;
  - raises the damages and mess dues as misc fees;
  - tells the parent.
- **With the card switched off**, the hostel office completes the withdrawal itself, choosing
  carry-forward or refund.
- **The hostel's steps (Warden, Mess)** remain only for a hosteller leaving the school, inside the
  school withdrawal. The steps "hostel fee dues" and "accounts" are switched off.
- **API:**
  - `POST /hostel/withdrawals/:id/decide {outcome, note, feeChoice}`;
  - `GET /hostel/withdrawal-approval`, which makes the levels the first time;
  - `POST /hostel/withdrawals/:id/complete {feeChoice}` when the levels are off.
  - The approval completion is hooked with `WorkflowService.onComplete('hostel_withdrawal')`.
