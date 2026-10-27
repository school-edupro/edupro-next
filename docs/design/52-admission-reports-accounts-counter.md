# 52 — Admissions list "Download report"; accounts take admission fees at the fee counter (plan, 27 Oct 2026)

Asked on the screens:

1. `/admissions/list` should have **Download report** as on `/people/students`.
2. How does Accounts take the registration fee and the admission fee offline, when Accounts cannot open
   the Admissions module?

## What is there today

- The Admissions list already has the Download report button (the shared `PeopleList`), but it shows only
  when the user has a saved report of the `admissions` dataset. There are none yet; Students has four,
  so the button shows there.
- The API already lets Accounts take both fees. The accountant role has `admissions.fee.collect`
  (migration 0226), and the routes are `POST admissions/applications/:id/registration-fee` (a submitted
  registration with no number yet) and `POST admissions/registrations/:id/admission-fee`.
  - The screens that call these routes need admission rights Accounts does not have: the Admission desk
    needs `admissions.application.enter`, and the registration page needs `admissions.application.view`.
  - So the accountant has no screen. The office takes the money, or the accountant borrows an office login.
- The receipts are already in the fee module: series `RF/<session>/…` and `AF/<session>/…`, and they show
  in the Day book, head tally, mode summary and Tally export (docs/design/39, decision 7).

What the best do (Entab, Fedena, Edunext, NoPaperForms): the fee counter finds a student **or an
applicant** by number, name or mobile. The cashier sees only what is due and takes cash, cheque, DD, UPI
or card, with a receipt. The admission team never handles money and the cashier never sees the form. The
admissions register ships with standard reports (registration register, class and category summaries,
fee due, admitted, merit), and the school can add its own.

## Decisions (asked and answered, 27 Oct 2026)

| #   | Question                  | Decision                                                                                                                                                                                     |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Download report           | **Ready-made + saved**: always shown; standard admission reports plus any report the school saves; Excel or PDF for the list's filters                                                       |
| 2   | Where Accounts takes fees | **Fees → Cashier, a new "Admission fees" tab**: Accounts stays in the Fees module                                                                                                            |
| 3   | What Accounts sees        | **Fee essentials only**: candidate, registration / admission no., class, session, fee category, parent name and mobile, the fee due and receipts paid; no form answers, documents or remarks |
| 4   | Part payment              | **Full only**, as today: the admission number comes with the full payment; concessions go through the fee category                                                                           |

Defaults taken (change on request):

- The counter takes cash, cheque, DD, UPI, card and bank transfer, the same modes and fields (reference,
  instrument no., bank) as the student counter.
- A cheque gives the receipt at once. A bounce, a cancelled receipt or a refund follows the existing
  admission refund and fee module rules; nothing new.
- The tab shows only registrations with something due: a submitted registration with no number (the
  registration fee), or one offered or fee-due (the admission fee).
- The receipt prints from the tab, with View and Download icons.
- Accounts gets **Admission fee collection** (the existing report) under Fees → Reports, for the day's
  tally.
- The ready-made reports live in code, not in the database: they cannot be deleted, and a school copies
  one with "Save as report" to change it.

## Parts

**Part 1 — Ready-made admission reports and Download report (admin).**

The Admissions list's Download report is always shown. It has two groups:

- **Ready-made:**
  - Registration register: number, date, candidate, class, category, parents, mobile, status.
  - Class-wise summary: registered, under review, selected, fee due, admitted, closed.
  - Category-wise count by class.
  - Fee due list: registration fee or admission fee due, with amount and mobile.
  - Admitted list: admission no., section, fee paid.
  - Merit list: class, points, rank.
- **My / shared reports**, as today.

Each report runs for the list's current filters, as Excel or PDF through the report builder's export.
When no saved report exists, a short line points to "Save as report".

**Part 2 — Counter API for Accounts.**

- `GET fees/admission-counter?q=` (permission `admissions.fee.collect`) finds registrations by
  registration / admission no., candidate name, or parent mobile / email. It returns only the fee
  essentials, the fee due (kind, head, amount, from the class and fee category) and the receipts paid.
- `POST fees/admission-counter/:id/collect {kind, mode, reference?, instrumentNo?, bankName?}` takes the
  registration or admission fee through the same `postReceipt` as the desk. The same rules apply: full
  amount, the registration number after the registration fee, the admission number after the admission
  fee.
- `GET fees/admission-counter/:id/receipts/:receiptId/pdf` gives the receipt.
- Every receipt is audited.

**Part 3 — Fees → Cashier "Admission fees" tab (admin).**

- A search box (searchable) and a results table: candidate, number, class, category, due, amount.
- **Collect** opens the payment form (mode, reference, instrument no., bank; amount shown, not editable).
- After saving, the receipt is shown with View / Download, and today's admission receipts by this
  cashier are listed below.
- Fees → Reports gets the Admission fee collection link for `fees.ledger.view`.
- Accounts sees no Admissions menu.

**Part 4 — Tests and check.**

- e2e: the accountant (dev-accounts) finds a registration, sees no form answers, takes the registration
  fee (number given) and then the admission fee; it is refused twice and refused when nothing is due;
  the office's desk still works.
- a11y for the tab and the Download report dialog.
- A browser check as dev-accounts.
