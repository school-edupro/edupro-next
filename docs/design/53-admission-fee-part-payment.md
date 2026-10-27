# 53 — Admission fee in parts at the counter; cancellation and refund of parts (plan, 27 Oct 2026)

Asked: "how to part fee collection on counter". Docs/design/52 (decision 4) took the admission fee only
in full, so the counter's amount is locked to the fee due.

## What is there today

- The registration fee and the admission fee are each one receipt for the full amount. The admission
  fee moves the registration to `fee_paid` and gives the admission number. The registration keeps
  `admission_receipt_id`.
- Cancelling:
  - **Before the admission fee** (registered … offered): no refund; the registration fee is not refunded.
  - **After the admission fee** (fee_paid, or admitted without a pupil record yet): a refund request is
    made automatically for the receipt's amount less the session's **refund deduction %**. It is then
    approved, and Accounts pays it on Admission fee refunds.
  - **Once a pupil**: the admission is cancelled on the student page (approval; the school fee settled).
- The offer has a pay-by date (`offer_expires_at`). After it, the fee cannot be taken until the office
  renews the offer from Selection.

What the best do (Entab, Fedena, Edunext): the admission fee can be paid in instalments at the counter,
each with its own receipt. The seat is confirmed, and the admission number given, when the fee is
cleared. On withdrawal, everything paid is refunded less the school's deduction, through one refund
approval.

## Decisions (asked and answered, 27 Oct 2026)

| #   | Question            | Decision                                                                                                           |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Which fee           | **Admission fee only**; the registration fee stays in full (it gives the registration number)                      |
| 2   | Admission number    | **On full payment**: parts are receipts on account; the admission number and Admit come when the whole fee is paid |
| 3   | Balance             | **Stays at the admission counter** until cleared; shown in the Fee due report                                      |
| 4   | Minimum             | **No minimum**: any amount up to the balance                                                                       |
| 5   | Cancellation/refund | The user asked how it works; defaults below                                                                        |

Defaults (change on request):

- **Cancelling with parts paid** (still Offered): a refund request is made for **the total of the parts
  paid** less the session's refund deduction %. It is one request covering every part receipt, and it
  goes through the same approval and Pay refund as today.
- **Cancelling after the full fee**: as today, but the refund counts every admission-fee receipt (the
  parts), not just the last one.
- **Offer pay-by date passes with a balance**: no new part is taken. The office renews the offer (the
  balance stays) or cancels it (the parts are refunded as above). The counter shows "Offer lapsed: ₹X
  paid, ₹Y balance".
- **A part paid by cheque that bounces**: when the receipt is marked bounced (or reversed) in the fee
  module, it no longer counts as paid; the balance grows back, and a cheque bounce fee follows the fee
  module's rule if the school has one.
- **The parent portal**: it shows "₹X paid, ₹Y balance". Online payment takes the **balance in full**,
  and parts are paid only at the counter.
- **Receipts**: each part is its own AF receipt ("Admission fee · part 1 of …" is not printed; the
  receipt shows the amount, the total fee, the paid to date and the balance).

## Parts

**Part 1 — Engine and API — built 27 Oct 2026.**

- The paid amount is the sum of the registration's posted admission-fee receipts (`misc_receipts` on
  the admission head, status posted; bounced and reversed ones are left out).
- The balance is the admission fee less that sum.
- Collecting at the counter (`kind: 'admission'`) takes `amount` (1 … balance; the default and the
  maximum is the balance). When the balance reaches 0, the existing full-payment path runs: `fee_paid`,
  the admission number, the messages.
- The portal's online payment takes the balance.
- Cancel and the refund plan use the sum of the parts; a cancel while Offered with parts paid makes the
  refund request.
- The counter, the Fee due report, the registration page and the Admission fee collection report show
  paid and balance.

**Part 2 — Counter (admin) — built 27 Oct 2026.**

- The admission fee's Amount is editable (the balance shown, any amount up to it) on the Post receipt
  card.
- The table shows "Admission fee: ₹Y balance of ₹Z (₹X paid)".
- The receipt PDF prints the total, the paid to date and the balance.

**Part 3 — Office and portal screens — built 27 Oct 2026.**

- The registration page's fee box shows the parts with View / Download.
- Cancel shows the refund worked out from the parts.
- The portal's Payments page shows the paid amount and the balance.
- The Fee due ready-made report gets a Paid column and a Balance column.

**Part 4 — Tests — built 27 Oct 2026.**

- e2e: two parts; then the admission number on the last part; a part over the balance is refused.
- e2e: a cancel with one part paid gives a refund request of the parts less the deduction %.
- e2e: a bounced part restores the balance.
- a11y for the counter and the registration page, and a browser check.

## As built (27 Oct 2026)

**Rules and API:**

- `AdmissionCoreService.admissionPaid` adds up the posted receipts on the `ADMFEE` head.
- Admit's `collect` takes an optional `amount`, from 1 up to the balance. A part leaves the registration
  Offered, with an event saying the balance; the part that clears the fee runs `feePaid`.
- The counter sends `amount` for the admission fee only; the registration fee is still taken in full.
- An online payment takes the balance and gives the admission number only when the fee is cleared.
- The refund plan sums the parts and returns `parts`. Cancel and its preview make the refund for an
  Offered registration with parts paid.
- Undoing the selection is refused while parts are paid.

**Screens and reports:**

- The receipt PDF prints the total, the amount paid to date, the balance, the mode's own name, and the
  cheque or draft number, date and bank.
- The Admissions dataset gains **Admission fee paid** and **Admission fee balance**, and the admission
  receipt column lists every part.
- The Fee due ready-made report shows Total, Paid and Balance.
- Admin:
  - The counter's Post receipt takes any amount up to the balance, and its rows show "balance of ₹Z
    (₹X paid)".
  - The registration page's admission fee box takes a part, and its cancel text names the parts.
- The parent portal's What is due and Payments show the balance, and paying online takes it.

**Checked:**

- Admission e2e: 63 pass.
  - On a fee over the balance, the part is refused; one part then gives no admission number and the
    receipt prints; the last part gives the number.
  - Two parts, the second bounced: the balance grows back, and undo is refused.
  - A cancel refunds the 6,000 paid less 10% = 5,400.
- Reports and misc fee e2e: 33 pass. db: 57 pass. API unit: 4 pass.
- a11y: the counter and the registration and desk pages pass. Their ids moved to 1404, because the sample
  reseed removed 1339.
- Dev school 1 has no Offered registration with a fee, so the browser shows no part to take there.
