# Fees: a guide for the accounts office

## Who does what

| Person          | Does                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Accountant      | Fee masters, demand, cashier, receipts, adjustments requests, reports, bank statements, Tally export   |
| School admin    | Approves waivers, reversals and profile changes (second factor), closes the shadow run, locks the year |
| Cashier (clerk) | Posts receipts at the counter, prints them, hands over the day's cash with the day book                |
| Families        | See dues and receipts in the parent app, pay online, download receipt PDFs                             |

## Daily routine

1. **Fees → Cashier**: search the pupil, check the ledger, post the receipt (cash, cheque, UPI, card).
   The number is assigned when you save; allocation is oldest-first per ledger (school, hostel).
2. Cheques: enter the instrument number and bank; the receipt shows **Cleared** once the bank
   statement upload matches it.
3. End of day: **Fees → Reports centre → Day book** for today; export PDF; the total must equal the
   cash and instruments handed over.
4. Online payments arrive on their own; the nightly reconciliation matches them with the gateway's
   settlement file. Anything unmatched appears under **Payments → Settlements**.

## Monthly and periodic routine

- **Demand**: at the start of the year (and after any structure change) generate the demand per
  class; a pupil's profile change (transport slab, hostel, concession) goes through an approval and
  regenerates their demand only.
- **Defaulters**: **Fees → Reports centre → Defaulters**, filter by class and amount, send reminders
  (one per pupil per day at most).
- **Head-wise tally** for the month and the **Tally XML** export for the accounts system.
- **Adjustments**: request a waiver, reversal or bounce with the reason; the school admin approves.
- **Year lock**: after the audit, the admin locks the fees stage; nothing can be posted after that.

## Five common questions

1. _The parent paid online but the receipt is not showing._ Check **Payments → Intents** for the
   transaction; a failed or pending intent never posts a receipt. The family can retry from the app.
2. _I posted the wrong amount._ Request a **reversal** with the reason; after approval post the
   correct receipt. Receipts are never edited or deleted.
3. _A pupil changed the bus stop._ Raise a **profile change** (transport slab) from the pupil's fee
   profile; the demand regenerates on approval and the ledger shows the difference.
4. _Which receipt paid which instalment?_ The pupil's **ledger** lists every receipt with its
   allocation per instalment and any late fee posted.
5. _The day book does not match the cash._ Compare receipt by receipt; reversed receipts never appear
   in the day book; cheques count on the day they were received, not cleared.

## Where to click

Fees → Heads, Structures, Demand, Cashier, Adjustments, Misc receipts, Reports centre, Bank
statements, Variance workbench (shadow run). Payments → Intents, Settlements, Refunds. Reports →
Exports (every PDF and Excel you asked for).

## Set-up added in October 2026

**Fees → Fee setup** is one menu with five tabs: Heads, discounts, slabs, banks · Class calendar, late
fee, payment modes · Class fee structure · Discount by head · Receipt numbers. Each thing is set in one tab only.

- **Class rules**: pick a class and give its own last date, late fee and cheque-bounce charge. An empty
  box follows the school. Unpaid bills of the class move to the new last date when you save.
- **Payment modes**: tick what the counter accepts and which fields must be filled (reference number,
  cheque number, cheque date, bank name). The cashier cannot save a receipt without them.
- **How heads print** (tab Heads, discounts, slabs, banks → Fee heads → edit a head, "Prints as"): give the same print name ("Composite fee") to heads that should show as one line
  on the bill and the receipt; the ledger and reports still keep each head. Tick "Tax certificate" on
  the heads that count for the parents' income-tax certificate.

**Class fee structure** tab: a class can have several structures, one per fee group (general, staff ward,
EWS ...). Choose the group at the top, or type a new one. A pupil follows the group on their fee
profile (pupil → Fees tab).

**Several discounts for one pupil** (pupil → Fees tab → Discounts by month): set up to five discounts,
each with its first and last month, give the reason and send for approval. After the school admin
approves, the bill is rebuilt: the discounts on one head add up and never exceed the head's fee;
months outside the range keep the full fee; a month that is already paid is not changed.

## Year end: carry forward to the new year

**Fees → Carry forward to new year** (accountant, school admin).

1. Open the new year first (System → Years) and create its fee calendar (Fees → Heads, periods, slabs).
2. Choose the closing year and the new year. The list shows every pupil with unpaid fee, unpaid late
   fine or excess paid, with what the new year would open with.
3. Untick anyone you want to leave out, then **Carry the ticked pupils** (or **Carry all**).
4. In the new year the pupil's first instalment shows **Previous dues**, **Previous late fine** and, for
   excess paid, a minus line (**Advance**). Hostel dues go to the hostel ledger.
5. The old year's unpaid bills are closed as "carried", so defaulter lists do not count them twice.
6. **Undo** takes one pupil's carry back, as long as no receipt has been posted against it.

Pupils with no class in the new year (left, or not promoted yet) are listed but not carried; promote
them and run it again. Lists of online payments, refunds, misc receipts, settlements and bank
statements now show only the year chosen in the year switch at the top.

## Papers and reports added in October 2026

- **Fees → Fee bills (print)**: choose a class and the "dues up to" date; one bill per pupil who owes
  something, head by head (heads with one print name are one line), with the late fee. For one pupil
  open the ledger and press **Fee bill**.
- **Fees → Bank deposit slips**: tick the cheques and drafts in hand, choose the school bank account and
  the deposit date, **Make deposit slip**, then **Print slip**. A cheque sits on one slip only;
  **Cancel slip** frees its cheques (the slip number is not reused).
- **Tax certificate**: ledger → **Tax certificate**; choose the financial year and print. It counts only
  the heads ticked "Tax certificate". Parents get the same from the parent app (Fees → Tax certificate).
- **Provisional bill (withdrawal)**: ledger → **Provisional bill (withdrawal)**; choose the last month
  to charge. Part A is what the parent still owes (fee up to that month and late fee); part B is what
  comes back (fee paid for later months, refundable heads, excess paid). Nothing is posted: settle it
  with a receipt or a refund.
- **Reports centre**: two new tabs, **Mode-wise collection** (day, fee type and mode, with refunds) and
  **Cheque bounce** (cheque, bank, amount, charge raised and charge paid).

## Approvals and uploads (Fees → Approvals and uploads)

The accounts desk asks; the school admin approves or rejects under **Requests**. Nothing changes
before approval and every step is logged.

- **Late-fee waiver**: admission no., the instalment's first month, and the late fee to charge instead
  (0 waives it fully; any smaller amount is a part waiver). The accounts desk can no longer change a
  late fee directly; the school admin still can from the ledger. (Setting
  `fees.late_fee_waiver_approval`: on by default.)
- **Move a receipt to another pupil**: the printed receipt number and the other pupil's admission no.
  On approval the receipt is cancelled for the first pupil and a new receipt, same date, mode and
  amount, is made for the other. Use it when a parent paid twice into one child's account.
- **Date correction**: a new receipt date and / or the bank settlement date of one receipt. The receipt
  date must stay in the same financial year and in a month that is not closed.
- **Settlement dates from Excel**: download the format, one receipt per row, upload with the reason.
  Good rows wait as one file (the admin can approve the whole file at once); refused rows are listed
  with the reason.
- **Collection from Excel**: download the format, one payment per row (admission no., amount, mode,
  date, and what the payment mode demands). Upload to check; when every row is good, send it for
  approval. On approval all receipts are made together; if one row fails, none is made.

## Class-wise fee calendar (Fee setup → Class rules, payment modes)

Choose a class. One row per month, like the old month–quarter mapping screen:

- **Quarter**, **Start fees date** (parents see the instalment from this date), **Last fees date**,
  **Challan date** (printed on the fee bill), **Bounce** (cheque-bounce charge of that month).
- **Late fee of this class**: _As the school_, _Per day_ or _By slabs_.
  - Per day: the rate (for example ₹25) is charged for every day after the last date; "Maximum per
    instalment" stops it growing.
  - Slabs: "Late fees" applies after the last date; after "Last date 1" the fee becomes "Late fee 1",
    then "Late fee 2", "Late fee 3". The later amount replaces the earlier one. Example: last date the
    10th, Late fees 100, Last date 1 the 20th → 500, Last date 2 the 25th → 1,000.
- **Show = No**: parents do not see the instalment (app and parent's bill); the office ledger and the
  cashier still do. **Fee pay = No**: parents see it but cannot pay it online.
- The **↓** in a column head copies the first month's value down the column.
- **Clone to the ticked classes** copies the saved calendar to other classes (it replaces theirs).

An empty box follows the school. Months with the same last date form one instalment. After switching
a class to slabs, fill the late fee of every quarter; an empty one means the school's slab amount.

## Class fee structure and discount by head (grids)

- **Class fee structure** tab: choose the class, student type (all / old / new) and fee group, then
  **Load grid**. Fee heads run down, the twelve months across; type each month's amount (empty or 0 =
  not charged that month). "→" copies the first month across the year, "↓" copies the first head down
  a month. **Save the structure**.
- **Discount by head** tab: choose a discount type and **Load fee heads**; give a percentage _or_ a
  fixed amount per month on each head. Once a discount has head lines, only those lines apply.
- On every grid (calendar, structure, discount): **Excel** downloads the grid as a file you can correct
  and send back with **Upload Excel** (nothing is saved if one row is wrong; the wrong rows are named),
  **PDF** gives a printable copy, and **Clone to the ticked classes** copies the saved grid to other
  classes (calendar and structure).
- The school-wide "periods" and "late fee slabs" forms are gone: dates and late fee are kept class by
  class on the Class calendar tab. A new year's twelve months are made with **Create the twelve months**.
