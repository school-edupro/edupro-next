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

## Part 3 (17 Oct 2026, migration 0159)

- **The last day in the hostel** may be any day from the start of the stay. The 31-day limit is gone,
  so a pupil who left months ago and was never recorded can be recorded now.
  - A day before the request date charges no notice month.
- **Hostel reports with a column choice** (`/hostel/reports/:report`, `:report/file`,
  `:report/columns`): register, occupancy, withdrawals, leave.
  - Each report offers the father, mother and guardian contacts and the address.
  - The user's own columns are stored in `user_preferences` (`hostel.report.<id>`).
  - The school default is the setting `hostel.report_columns` (needs the set-up right).

## Part 4 (17 Oct 2026, migration 0163): the parent's request, the room check-out, the clearance

- **The parent's request.** On the parent app's Hostel page, _Leaving the hostel_: the last day, the
  reason and a note. One request waits at a time; the parent may take it back while it waits. It shows
  on Hostel → Withdrawals → _Requests from parents_; the office **starts the withdrawal** from it (the
  form opens filled in, and the request points at the withdrawal) or **declines** it with a note the
  parent sees. API: `GET/POST /hostel/mine/exit`, `POST /hostel/mine/exit/:id/withdraw`,
  `GET /hostel/exit-requests`, `POST /hostel/exit-requests/:id/decline`, `exitRequestId` on the start.
- **The room check-out list.** The school's items (bed, mattress, cupboard, keys... made the first
  time) each with the charge for one missing or damaged, on Withdrawals → Steps and notice. While a
  withdrawal waits for approval, the warden or office marks each item in order, damaged or missing (the
  charge can be changed); the total becomes the **damage charge**, and the list goes into the charge
  remarks, so the approvers see it. API: `GET/PUT /hostel/checkout-items`,
  `GET/PUT /hostel/withdrawals/:id/checkout`.
- **The clearance certificate.** Once the withdrawal is completed, an A4 PDF (number `HC/<id>`): the
  pupil, the hostel and room, the stay, the reason, how the hostel fee was settled, the charges, the
  check-out, who approved. On the withdrawal page and in the parent app. API:
  `GET /hostel/withdrawals/:id/certificate`, `GET /hostel/mine/withdrawals/:id/certificate`.

## Part 5 (17 Oct 2026, migration 0164): revoke

- **Ask.** On a completed withdrawal, _Revoke: back in the hostel_: a reason and how the pupil comes
  back. **As if never left**: the same bed, the stay goes on, the hostel fee of the months away is
  charged. **Back from a day**: a new stay from that day (the same bed or a free one); the months away
  are not charged (`hostel_fee_gaps`, read by `generate_fee_demand` through `app.fee_in_hostel_stay`)
  and what was paid for them goes forward to the next unpaid fee. The bed must be free.
- **Approve.** The same approval levels as the withdrawal (Fee setup → Approval levels → Hostel
  withdrawal), from the withdrawal page; done at once when the levels are switched off. Not approved:
  the withdrawal stands; the office may ask again.
- **On approval.** The pupil is back in the bed; the hostel fee is made again; refunds of the
  withdrawal not paid yet are dropped (one already paid is noted, to settle by hand); unpaid damage and
  mess charges are cancelled (paid ones stay); a carried-forward amount stays where it went (the dues
  are the same in all); the clearance certificate no longer downloads. Status _Revoked_.
- API: `POST /hostel/withdrawals/:id/revoke {reason, mode, fromDate?, bedId?}`,
  `POST /hostel/withdrawals/:id/revoke/decide {outcome, note}`.

## Part 6 (17 Oct 2026, migration 0165): a boarder's school withdrawal revoked

- The school withdrawal of a boarder ends the stay (_Left the school_). Its **revoke** now asks, for a
  boarder, about the hostel too: **rejoins as a day scholar** (no hostel, as before), **back in the
  hostel as if never left** (the same stay goes on, the months away charged), or **back from a day**
  (a new stay, the same bed or a free one; the months away not charged, what was paid for them goes to
  the next unpaid fee). The bed is checked when asked and again on approval.
- It rides the school revoke's own approval (Fee setup → Approval levels); on approval the pupil is
  back in the school (as before) and in the hostel, and the hostel fee is made again.
- Shared code: `hostel/hostel-return.ts` (`checkHostelReturn`, `returnToHostel`, `syncHostelFee`), used by
  the hostel withdrawal revoke too.
- API: `POST /people/withdrawals/:id/revoke {reason, hostel?: {mode, fromDate?, bedId?}}`; the
  withdrawal shows `hostelStay` and `revokeHostel`.
