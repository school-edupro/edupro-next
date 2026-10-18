# 29 · Fee dashboard and consent dashboard

Decided with the product owner on 18 Oct 2026. Both read live from the tables (not the nightly marts), so
the numbers agree with the registers at any moment.

## Fee dashboard (`/fees/dashboard`, `GET /fees/dashboard?ledger=all|school|hostel|misc`)

Permission `fees.ledger.view`. The academic year is the one chosen in the header; "today" is the date in
India, held inside the year (a past year shows its last day).

- **One dashboard, a filter**: All (each block adds the three ledgers, plus a "By ledger" table) or School
  fee / Hostel fee / Misc. School and hostel fees share `fee_demands` / `fee_payments` by `ledger`; misc
  fees have `misc_fee_students` / `misc_receipts`.
- **Rules** (as the marts): a receipt is money in unless reversed or bounced; a demand counts when
  pending, partial or paid; a misc fee once announced (or closed), its lines unless cancelled. An opening
  credit (a negative demand) does not lower what is due or paid.
- **Blocks**: collected today / this month / this year; due till today and of the year; collected of due
  (%); overdue and pupils overdue · collected of due by class · dues by age (not yet due, 1–30, 31–60,
  61–90, 90+) by ledger · by payment mode (year, month) · cheques / DD to clear, bounced, cash without a
  deposit slip · this month by day, the year by month against the year before · who owes most (15, with
  the parent's mobile, the oldest days and the ledgers; link to the pupil's ledger and to fee reminders) ·
  refunds paid / waiting, discounts in the demand, waivers approved / waiting · online payments by
  gateway (paid, failed, started not finished) and paid online not yet matched to a settlement · today
  by the person who took it (cash and total).
- Test: `apps/api/test/fee-dashboard.e2e-spec.ts` (each block against hand-worked figures).

## Consent dashboard (`/engagement/consent-forms/dashboard`, `GET /engagement/consent-forms/dashboard`)

Managers see every published or closed form; anyone else only the forms shared with them (doc 28).

- Open forms and those closing within 7 days; answered of asked on the open forms; answers waiting for
  approval; fees raised and paid.
- The five open forms answering least (link to their Not yet answered list); waiting for approval by
  the step and who holds it, with the oldest; by class (open family forms) and by department (open staff
  forms), counting each person once per form; answers per day for 30 days by app / public link / office,
  and all answers by way; a table of every form.
- Test: the last case of `apps/api/test/consent-forms.e2e-spec.ts`.

## Shared style

The progress rows (`.ep-chart__rows`) now always leave room for the bar, also in a half-width card.
