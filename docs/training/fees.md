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

- **Fee bills** (Fees → Demands → choose a class → **Print fee bills**): set the "dues up to" date; one bill per pupil who owes
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

### Discount types, sample formats and full lists

- A **discount type** is only its code and name (tab Heads, discounts, slabs, banks, or the "Add
  discount type" box on Discount by head). What it takes off is always set on **Discount by head**.
  Older discounts that had one percentage or amount were turned into head lines with the same effect.
- **Download sample format (Excel)** on Class fee structure and Discount by head gives the sheet with
  the heads listed and no values: fill it and send it with **Upload Excel**.
- **All classes: Excel / PDF** lists every class, fee group and student type; **All discount types:
  Excel / PDF** lists every discount with its heads.
- **Another fee structure for a class**: on Class fee structure choose the class, type the new group's
  name (for example "staff ward") and press **Start new group**; an empty grid opens. Fill and save it,
  then put pupils on that group from their fee profile.

### Adding a payment mode

Fee setup → Class calendar, late fee, payment modes → **Add a payment mode**: type the name (for
example "NEFT / RTGS", "Paytm QR", "POS machine"), choose the built-in mode it **works like**, tick the
mandatory fields and press **Add payment mode**. The cashier sees the new name at once; receipts, the
ledger and the day book show it. A mode that works like Cheque can bounce and goes on the deposit slip.
**Remove** deletes a mode the school added; receipts already made keep its name. The seven built-in
modes cannot be removed, only switched off at the counter.

The "Month–instalment mapping" list is no longer shown: the class calendar holds the quarter and the
dates of every month.

### What the class calendar shows for each late fee choice

- **Per day**: the rate, the maximum and the class's bounce charge at the top; the grid shows only
  Quarter, Start fees date, Last fees date, Challan date, Fee pay and Show.
- **By slabs**: the grid also shows Late fees, Last date 1–3, Late fee 1–3 and the month's Bounce; the
  per-day boxes are not shown.
- What is not shown is kept as saved, so switching back loses nothing.

### Transport fee for eleven months

Fee setup → Class calendar, late fee, payment modes → **Transport fee months**: tick the months in
which transport is charged this year (whole school) and untick the vacation month. **Save transport
months**. Unpaid transport lines of the unticked month are removed from every pupil's bill at once; a
paid one stays. A month ticked again is billed when the class bills are generated again. The choice is
per year: set it again after opening a new year.

## The fee counter (rebuilt October 2026)

1. **Fees → Cashier**: type the pupil's name or admission number and press Search. The list shows
   admission no., name, class and father. Press **Take payment** (an exact admission number opens the
   pupil at once).
2. The pupil's fee page opens: name, admission no., class and father at the top, then Payable today,
   Fee balance, Late fee to collect and Paid this year. Tabs: **Take payment · Dues · Receipts · Late
   fee · Bill tools**.
3. **Take payment**: amount, payment mode and date. The other boxes follow the mode: a cheque or draft
   asks for its number, date and the bank it is drawn on (pick from the list or type it); UPI, card and
   bank transfer ask for the reference; every mode except cash shows the school bank account the money
   goes into (chosen by the cashier when the fee type has more than one). Boxes marked * must be filled.
4. **Post receipt and print**: the receipt opens with a school copy and a parent copy on one A4 sheet.
   Press **Print receipt**. Any old receipt prints again from the **Receipts** tab.

### Cancelling a receipt, a bounced cheque, a refund

On the pupil's **Receipts** tab, under the receipt:

- **Cancel this receipt**: type why, send. After the school admin approves (Fees → Adjustments) the
  receipt is marked Cancelled, the fee it had paid becomes due again, and the day book leaves it out.
- **Cheque bounced** (cheque and draft receipts only): type the bank's reason; the bounce charge of the
  class calendar is added unless you type another. After approval the receipt is marked Cheque bounced,
  the fee becomes due again and the charge shows as a new line. It appears in the Cheque bounce report.
- **Refund**: amount, how it is paid back and the reason; approved under Fees → Refunds.

A receipt is never deleted or edited; a wrong one is cancelled and posted again.

### Why pupils of one class have different totals (Fees → Demands)

The class list now shows the parts of each pupil's total: **Fee + Transport + Previous / other −
Discount = Net**, with the pupil's type (old / new), fee group and discounts. Totals differ because of
old or new student, fee group, discounts, transport, dues or advance carried from last year, hostel,
and lines already paid: a paid line keeps the amount it was paid at when the bill is made again.
"Bill older than the structure" marks a pupil whose bill was made before the class structure last
changed. After **Generate for the whole class** the screen says how many bills were made and names any
pupil that could not be done, with the reason.

On a pupil's fee page the **Head and month** tab shows every fee head against every month: the fee
after discount, the discount, and what is paid.

## A pupil's fee changes and their approval (October 2026)

**What goes for approval**: fee structure group, old / new student, discount, discounts by month,
hosteller, and optional fee heads. Raise them on the pupil's page → Fees tab ("Request change",
"Optional fee heads", "Discounts by month"). The accountant and the clerk can no longer save these
directly; only the approver (school admin) still can.

**Two levels**: level 1 is the fee in-charge (accountant role), level 2 the principal (school admin).
When the fee in-charge raises the request, level 1 is approved by itself and it goes straight to the
principal. Requests wait in **Workflow → Inbox**; the line says what is being changed. The bill is
rebuilt after the last approval. Who approves each level is set under **Workflow → Definitions** ("Fee
change of a pupil").

**Optional heads**: tick "Optional" on the head (Fee setup → first tab). An optional head is then
charged only to pupils opted in for it, for the months chosen on their Fees tab, after approval.
Pupils who are not opted in lose the optional heads from their bill the next time it is made.

### One structure per pupil, and where to set the approval levels

- A pupil is billed from **one** fee structure: old pupils from "Old students only" and new pupils from
  "New students only" when the class has it; "All students" is used only for a class that keeps a
  single structure. The All-students grid shows a warning when the class has its own old / new grids.
- **Approval levels**: Fee setup → **Approval levels** tab. This is the only screen that sets who may
  ask for a fee change of a pupil and who approves it; it is no longer a card under Approvals →
  Approval set-up. The top card shows the chain in use; the form below it changes the creators and
  the levels, and **Save** returns to the same tab.

### Approval set-up screen (rebuilt)

**Approvals → Approval set-up** (the fee change approval uses the same form under Fee setup → Approval
levels; gate pass, transport and appointment are set in their own modules). Each kind of request is a card read
left to right: **Created by → Level 1 → Level 2 → Applied**. Press **Edit**:

1. **Who creates the request**: tick the roles that may raise it. Nothing ticked = anyone whose
   permissions allow it. With roles ticked, anybody else is refused when they try to raise it.
2. **Approval level**: give the level a name; under "Approved by" choose _People holding a role_ and
   tick one or more roles (any one of those people can approve), or _One named person_, _People with a
   designation_, or _The creator's reporting officer_; set the hours allowed.
3. Tick "If the person who creates the request is an approver of this level, approve this level by
   itself" where you want that (never offered on the last level).
4. **＋ Add approval level** adds one (up to six); **Remove this level** takes one out. **Save**.

## Pay plan (monthly, quarterly, half-yearly, yearly)

How often a pupil pays is set at three levels; the lowest one that is set wins.

1. **School**: Fee setup → _Class calendar, late fee, payment modes_ → **Pay plan of the school**.
2. **Class**: same tab, choose the class → **Pay plan of this class** → Save. "As the school" removes
   the class's own plan.
3. **Pupil**: student profile → Fees tab → _Request change_ → **Pay plan** → reason → send. It goes
   through Fee setup → Approval levels and applies when approved. "As the class" takes it back.

What a plan does: the months of one instalment (3 for quarterly, 6 for half-yearly, 12 for yearly)
become one bill, due on the last date of the **first month** in the class calendar. Late fee is counted
once per instalment, by that first month's row in the class calendar. Bills not yet paid follow a
change at once; a month already paid keeps the date it was paid against. The ledger, the fee bill and
the parent portal show the instalments of the pupil's plan (for example Apr – Jun), and the parent
pays whole instalments online, the oldest first.

## Old / new student

Not typed any more. A pupil admitted on or after the first day of the session is **new**; any other
pupil is **old**. The profile, the ledger and the bill use this, and every bill run sets it again.

## Where the fee facts show

The ledger header and the Fees tab of the profile show: status (active / withdrawn), fee group, old /
new, pay plan, hosteller, transport, discounts and optional heads. The parent portal shows the pay
plan, fee group, transport, discounts and optional heads above the instalments. The single "Discount"
box on the profile is gone: discounts are given only in the _Discounts by month_ panel of the Fees tab.

## Dues and receipts on the parent portal

The parent's **Fees** page is one child at a time (the sibling switch picks the child). At the top:
**Due now** (late fee included), split into school fee, hostel fee (hostellers) and other fees; each
figure opens its tab. The tabs:

- **School fee** and **Hostel fee**: each instalment is a card with its last date, fee, paid, late fee
  and what is left. The parent ticks the instalments to pay; they go the oldest first, so ticking one
  ticks the earlier ones and clearing one clears the later ones. Everything due today starts ticked.
  An instalment the class keeps off online payment (_Fee pay_ off in the class calendar) shows "paid at
  the school fee counter only" and has no tick box. Below: the gateways the school takes that fee
  through (Fee setup → Payment gateways) with their convenience charge, and a bar with the total
  (fee + charge) and **Pay**. The school fee and the hostel fee are paid separately.
- **Other fees**: the misc fees announced for the child, each with **Pay online** when a gateway takes
  misc fees.
- **Receipts**: every receipt of the session marked School fee or Hostel fee, bounced or refunded,
  with **View** and **Download PDF**; below, the online payment attempts.
- **Fee bill**: the bill of the whole session in the layout the school chose (annual or instalment),
  for All / Regular / Hostel (hostellers), with **Print** and **Download PDF**. The school can make the
  same PDF from the API (`GET /fees/students/:id/bill/file`).

## Receipts for parents, and approvals of late fee and transfer

- **Parent portal receipt**: each receipt has **View** (the same receipt design as the school prints,
  marked Parent copy, with Print) and **Download PDF**. Both are made at once; they do not need the
  background workers. The school's receipt page has **Download PDF** too (school copy and parent copy).
- **Late-fee waiver and sibling transfer** (Fees → Approvals and uploads) now go through the levels set
  under Fee setup → Approval levels, the same as a fee change of a pupil: who may raise it, level 1,
  level 2. The request shows who it waits with; approvers act from **My approvals**. Receipt / settlement
  date changes and Excel uploads are still approved on the Approvals and uploads page.
- **My inbox**: the request number (#) opens the request for anyone who raised it or approves it.
- **Late fee maximum**: empty or 0 means no limit.

## Waivers, paid charges, parent's view and bills (2026-10-10)

- **Waive fee (several heads)**: pupil's ledger → **Waive fee** tab. The grid shows every unpaid fee
  line by head and month with what is left. Type the amount to waive in the boxes (or "Full" for a
  whole head or month), give one reason, **Send waiver for approval**. All the boxes go as one request
  through Fee setup → Approval levels and are approved or rejected together from My approvals. The bill
  reduces after the last approval. An unpaid bounce charge is one of the rows.
- **A late fee or bounce charge already paid, adjusted in fee**: pupil's ledger → **Late fee** tab →
  _Adjust a paid late fee or bounce charge in fee_. Give the amount and the reason; after approval the
  amount is taken off the charge and set against the oldest unpaid fee (what finds no due stays as
  advance). The receipt keeps its number and shows the new split; the late fee is not asked again.
- **Parent's view** (button on the ledger): what the family sees on the parent portal for the pupil,
  with **Pay online** for a parent who cannot pay from home: choose the instalments, enter the payer's
  name, mobile and email, and the gateway opens on the school's screen. The receipt posts by itself.
- **Fee bill**: opens for the full year; "Bill for" narrows it to what is due up to today or a date.
  Since 2026-10-15 it prints as the annual fee bill: letterhead (logo, address, phone, email,
  website), Fee Bill No. (school prefix / session / admission no., the same on every print), the
  pupil's particulars (date of birth, father, mother, route / stop), the heads of the session "till
  March …" with Optional fees and Hostel fees in their own sections, any discount, the grand total,
  the instalment schedule of each fee (Q1… with last date, payable, paid, balance, late fee), the fee
  received (receipt, payment type, cheque / transaction no., date, amount, late fee, bounce charge),
  and Total due − Total received + Refund (+ Advance) = Balance payable, in words, with the school's
  notes on online payment, cheque bounce charge and late fee. **Fee type** chooses All, Regular
  (school fee) or Hosteller (hostel fee); for a class, pupils with nothing on that fee are left out.
- **Opening balances from Excel** (Fees → Opening balances): choose **Regular (school fee)** or
  **Hosteller (hostel fee)** at the top. The format, the upload, the check ("Now" / "Becomes") and the
  files list follow it. A hostel file writes the pupil's hostel opening balance, billed on the hostel
  fee under *Previous dues (hostel)*; the school figure is not touched, and the other way round. The
  hostel format with a class lists its hostellers; a hostel advance (Cr) is refused for a pupil who is
  not a hosteller (hostel dues of a pupil who left are taken).
- **Bounce charge of a hostel cheque** is raised on the hostel fee (head *Cheque bounce charge
  (hostel)*), not the school fee.
- **Bill and receipt layout** (Fee setup → Receipt numbers, layouts): Fee bill = *School annual bill*
  or the earlier *Instalment bill*; Fee receipt = *Two-panel* (A4 landscape) or the earlier *Classic*
  (A4 portrait); receipt copies = parent only / parent + school / parent + school + office. One choice
  for school, hostel and misc fee; screen, print and PDF follow it (the parent app gives the parent copy).
- **Payment gateways** (Fee setup → Payment gateways, school admin only, after a fresh strong sign-in):
  add the school's PayU, CCAvenue, Razorpay, SBI ePay or Atom account in **Test** mode with the sandbox
  keys, pay a small amount from the parent app, then switch to **Live** with the live keys. Keys are
  typed once and never shown again (an empty box keeps them). Tick which gateways take the regular,
  hostel, misc and admission fee; with several, the parent chooses. A **convenience charge** (% and/or
  ₹) is added on top of the fee, shown before paying and kept apart from the fee on the receipt; 0 = the
  school bears it. Give PayU and Razorpay the webhook address shown on the gateway's card.
- **Atom** is the NTT DATA **AIPAY** kit: enter Merchant id, Product id, Transaction password, Request
  encryption key, Response decryption key and Response hash key (from Atom's kit or dashboard). The
  payment opens on Atom's own payment page; its answer is checked with the response keys.
- **Misc fees online**: parents pay an open misc fee in full from the parent app (Other fees → Pay
  online); the MF receipt is written when the gateway confirms, and a limited-seat fee books the seat.
- **Fee type on the reports** (Fees → Reports centre): every collection, dues and accounts report has
  *Fee type: All · Regular (school fee) · Hosteller (hostel fee)* (Tally vouchers also *Misc fee*):
  Day book, Day book (grouped), Mode-wise collection, Head-wise tally, Cheque bounce, Defaulters, Period
  fee head-wise, Yearly projection, Forecast, Tally vouchers and Report check. School + hostel add up
  to All. Misc fee dues has no fee-type filter (misc fees are their own).
- **Fee type on the pupil's fee page**: above the tabs, *All · Regular (school fee) · Hosteller
  (hostel fee)*. Take payment (the fee type starts on the one chosen), Dues, Head and month, Waive
  fee, Receipts, Late fee and the KPI tiles show only that fee; the choice stays as you move between
  tabs, and the Fee bill button opens the bill for it.

- **Receipt cancellation and cheque bounce** (ledger → Receipts) also go through Fee setup → Approval
  levels and are approved from My approvals; the receipt is cancelled, or bounced with its charge, on
  the last approval. The bounce charge box is filled from Fee setup. A request raised before this
  change is still approved on Fees → Adjustments and shows under "Fee requests" in My approvals.

## Refunds (2026-10-10)

- **Refund by fee head**: pupil's ledger → Receipts → **Refund (by fee head)** on the receipt. The page
  shows every fee head and month that receipt paid, with the amount; type what to give back (or "Full"
  for a head, a month or the whole receipt). The receipt's advance and late fee can be given back too.
  Choose what becomes of the refunded fee: **cancelled** (not asked again: transport stopped, pupil
  leaving) or **stays due** (a wrong or double payment). Choose the mode (bank, cheque, cash, or the
  gateway for an online receipt), give the reason and send.
- **Advance from last year**: ledger → Receipts → "Advance from last year … refund it". It needs no
  receipt of this year; on approval the opening advance reduces by the amount.
- **Approval**: every refund goes through Fee setup → Approval levels and is approved from My
  approvals. Nothing changes on the receipt until the last approval.
- **Refund voucher**: on approval the refund gets a voucher number (RF/<financial year>/000001).
  Fees → Refunds → Voucher opens it with Print and Download PDF.
- **Withdrawal**: when a withdrawal is completed (after every department has cleared), the fee of the
  months after the leaving month is taken off the bill, and what the family had paid beyond the leaving
  month (later months, refundable heads such as a security deposit, advance) is raised by the system as
  a refund for approval, with the fee cancelled. It shows under Fees → Refunds with the reason
  "Withdrawal: leaving on …". Dues up to the leaving month are collected before, by the fee department's
  clearance.

### One refund for a pupil over many receipts (2026-10-11)

Fees → the pupil → Receipts → **Refund for the pupil (many receipts, one voucher)**.

- The page lists the receipts of the session and one grid, fee heads down and months across. Each box
  shows what was paid on that fee over all the receipts. Type the amount to give back or press Full.
- Late fee and advance held on the receipts can be given back too.
- The system takes the amount from the newest receipt first. In the books every receipt keeps its own
  refund entry; on paper it is one request, one approval (Fee setup → Approval levels) and one refund
  voucher number, which lists each head and month with the receipt it came from.
- Save as draft and print gives the provisional refund bill; send it from that page after the parent agrees.
- A receipt that already has a refund waiting is left out until that refund is decided. While a pupil
  draft is saved, the receipts in it cannot get a separate refund.
- The refund from a single receipt (Refund by fee head on the receipt) stays for the simple case.

### From the provisional bill of a withdrawal (2026-10-12)

- **Refund for the pupil (many receipts, one voucher)** is on the bill, next to Print and in "Refund more".
  It opens the pupil refund with the fee paid for the months after the chosen month (and any advance)
  filled in and "the fee is cancelled" chosen; change any box, then Save as draft and print.
- For a completed withdrawal the Steps box has **Save as draft and print**: the rule refund is kept as one
  draft, the provisional refund bill opens to print, and it is sent from that page after the parent agrees.
  "Send for approval now" stays beside it. A draft is replaced when saved again, never replaces a refund
  already sent, and is dropped if the withdrawal is revoked.

## Opening balance of a pupil (Dr / Cr)

A plus figure is dues (Dr: the pupil owes it from before); a minus figure is advance (Cr).

- **One pupil**: student profile → Fees tab → request form → **Opening balance** (for example 15000 or
  -15000) → reason → send. It goes through Fee setup → Approval levels; on approval the figure is saved
  and the bill is made again. A user with the fee approve right can also save it directly in the top form.
- **Many pupils (Excel)**: Fees → **Opening balances (Excel)**.
  1. Download the format: blank, or with a class's pupils and their present figure filled in.
  2. Fill three columns: **Admission no.**, **Amount** (no minus sign) and **Dr / Cr** (Dr = dues,
     Cr = advance), and upload. Name and class are optional.
  3. Read the check: rows with a problem (unknown admission number, pupil twice, Dr / Cr not chosen,
     pupil not active) are listed with the reason and left out.
  4. Give the reason and **Send for approval**. After the last approval the figures are written and
     each pupil's bill is made again. The page shows how many were applied.
- **From the second year**: Fees → Carry forward to new year does it for every pupil.

- **Refund default**: the refund form now starts on "the fee stays due" (it shows as outstanding
  again). "Cancelled" must be chosen on purpose. A paid refund that cancelled its fee by mistake:
  Fees → Refunds → "Fee was cancelled by mistake?" → **Make the fee due again** (refund approve right).

## Withdrawal and fee (rule from 2026-10-11)

- When a withdrawal is **completed**, the fee is charged up to the month of the leaving date. Later
  months are taken off the bill, and fee already paid for those later months (and any advance) is
  raised by the system as a refund for approval. The fee of the months up to the leaving month stays
  charged, whatever the head. The "Refundable" tick on a fee head no longer refunds anything by itself.
- The leaving date may be earlier than the day the withdrawal is started, and cannot be edited later.
- **Provisional bill** (ledger → Provisional bill): opens on the leaving month by itself; shows what is
  payable, what comes back, the refunds raised (waiting / paid) with their vouchers, and:
  - **Refund more, by fee head**: for a refund the school grants beyond the rule (for example April
    and May tuition on the principal's word) or a deposit. Open the receipt, type the amounts, choose
    "the fee is cancelled", send; it goes through Fee setup → Approval levels.
  - **Work the withdrawal refund out again**: closes the waiting refund the withdrawal raised and
    raises it afresh (for a refund raised with a wrong figure).

- **Order of work at a withdrawal (from 2026-10-11)**: completing the withdrawal only cuts the bill to
  the leaving month; it does not send any refund. The accounts office then (1) opens the provisional
  bill and **prints** it for the parent, and (2) after the parent has agreed, presses **Send the
  refund of ₹… for approval** on the same page. Only then does the refund go through Fee setup →
  Approval levels. The printed bill says "Refund not yet sent for approval", "Refund sent for
  approval" or "Refund settled". "Withdraw it and send it again" replaces a waiting refund when the
  figures changed.

- **Refund draft (from 2026-10-11)**: on the refund page of a receipt, fill the amounts and press
  **Save as draft and print**. Nothing is sent and nothing changes on the receipt. The draft opens as a
  **Provisional refund bill** to print for the parent (Download PDF also works). After the parent has
  agreed: **Send for approval** on that page. **Change the draft** reopens the refund page with the
  saved amounts; **Discard the draft** drops it. Drafts show under Fees → Refunds as "Draft (not
  sent)" and on the withdrawal's provisional bill; parents do not see them. "Send for approval now"
  on the refund page skips the draft.

- **What is already waiting (from 2026-10-11)**: the ledger shows open requests on the tab where they
  were raised, and the same thing cannot be asked twice. Waive fee: a line with a waiver waiting is
  closed ("waiver waiting") and listed above the grid. Receipts: a receipt with a cancellation, bounce,
  refund (or refund draft), transfer or date correction waiting shows it and hides its buttons. Late
  fee: waiting late-fee requests are listed, and a paid charge with a request waiting shows "Waiting
  for approval" in place of its form.
- **Approve / Reject**: pressing Enter in the Note box no longer decides anything; a decision is made
  only by pressing Approve or Reject.

## Revoking a completed withdrawal (the pupil rejoins)

People → Withdrawals → open the completed withdrawal → **Revoke (the pupil rejoins)** → reason →
**Send revoke for approval**. It goes through Fee setup → Approval levels (My approvals).

- Only in the same, current session. A transfer certificate, if issued, must be cancelled first.
- On approval: the pupil is active again in the same class and section (the roll number too, unless
  another pupil has taken it); the student and parent logins come back; **every month of the session
  is charged again** by the class fee structure and calendar, with late fee by the calendar.
- A refund of that withdrawal that still waits is closed. A refund **already paid** stays paid (its
  voucher is the record of the money going out) and the fee it cancelled becomes **due again**; the
  parent pays it by a normal receipt.
- The withdrawal then shows as "revoked (pupil rejoined)". A rejected revoke changes nothing and can
  be asked again.

- **Taking an approved waiver back**: pupil's ledger → Waive fee → **Waivers already given** → reason
  → **Take this waiver back**. It goes through Fee setup → Approval levels; on approval the waived
  amounts are put back on the fee lines and are due again. All the lines of one waiver request are
  taken back together. On the bill a waiver shows as an amount taken off ("disc.").

- **Reject was recorded as Approve (fixed 2026-10-11)**: on My inbox (and other pages with two
  decision buttons) the pressed button's choice did not reach the server, and a missing choice was
  taken as "approve". Every decision button now sends its own choice, and a form that arrives without a
  clear choice changes nothing and says so. Requests decided from My inbox before this fix should be
  reviewed: a rejection made there was saved as an approval.

## Sample fee data for trying reports (2026-10-12)

For a local (never a production) school:

    pnpm --filter @edupro/db sample:fees add
    pnpm --filter @edupro/db sample:fees remove --dry-run
    pnpm --filter @edupro/db sample:fees remove

- Needs the API running with the development sign-in and the database address in the environment.
- Uses only pupils who have a bill and no receipt this session; entries made by hand are not touched.
- Posts receipts from 1 August to two days before today, in every counter mode (cash, UPI, cheque,
  bank transfer, NEFT / RTGS, card, demand draft), with cheque and draft numbers, dates and banks.
- Makes two deposit slips (August, September) and leaves the other cheques and drafts in hand; raises
  three cheque bounces, two receipt cancellations (one more left waiting), two refunds paid, one waiting
  and one draft, all through Fee setup → Approval levels.
- Every receipt carries the remark SAMPLE-FEE and every request ends with [sample]; "remove" finds them
  by that. Messages the entries would queue are stopped before they leave.
- Receipt, voucher and slip numbers used by the sample are not given again after removal.

## Reports centre (2026-10-13)

Fees → Reports centre holds every fee report in one bar. Each shows on the screen as its Excel and PDF
carry it, and the files are made at once (only the Tally file is prepared in the background).

**Collection**
- **Day book**: every receipt, misc receipt and refund of the dates, a Total row, then three summary
  tables: totals by mode, totals by ledger, and other figures (refunds paid, bounced cheques, receipt
  number ranges).
- **Day book (grouped)**: the school's own sheet: grouped by receipt date and payment mode with a subtotal
  per mode, a total per date and a grand total; a column per fee head.
- **Mode-wise collection**: one row per day: Amt. Paid, Dr Amount, Late Fee, Cheque Bounce Amount, Final
  Amount, a column per payment mode, and Final Amount again.
- **Head-wise tally**: one row per receipt with student, class, admission no., route, slab and payment
  status, then every fee head as a column.
- **Cheque bounce**: receipt date, cheque date, status, bounce charge, and what was paid again.

**Dues and forecast**
- **Defaulters**: who owes, with reminders.
- **Period fee, head-wise** and **Yearly projection**: one row per pupil, payable and paid by head or by month.
- **Forecast**: classes (or fee heads) down, months or quarters across, each with Expected, Collected and
  Balance, and a session total with the collected percentage. Expected is the fee billed for the month.

**Accounts**
- **Tally vouchers**.
- **Report check**: reaches each key figure two ways (from the books, and as a report prints it) and
  shows Agrees or the difference: receipts against fee lines, late fee, refunds, the bills, and every
  report's total. Run it at month-end; a difference means an entry needs looking at.

One rule for all: a bounced or cancelled receipt is not counted; a refund shows on the day it was paid and
reduces that day. A fee head shows what the receipt is set against today.

### Choosing the columns of a report

Every report except Defaulters, Tally vouchers and Report check has a **Columns** button above its table.

- Untick a column and press **Save for me**: it leaves the screen, the Excel and the PDF together, and
  the report opens that way for you next time.
- The fee admin (right to manage fee masters) can press **Save as the school default**: everyone who
  has not chosen their own columns then sees that layout.
- **Back to the school default** drops your own choice.
- Columns that name the row (serial, date, receipt no., admission no., name) and the totals always stay.
- Totals are never changed by hiding a column. The line under the table, and the note in the file, list
  what is left out.
- A fee head added later shows by itself until someone unticks it.

Period fee head-wise, Yearly projection and Forecast are worked out only after the filters are chosen
and Apply is pressed.

## Bank deposit slips: limit and same bank / other banks (2026-10-13)

- Choose the school account under **Deposit into**: each cheque is then marked *Same bank* or *Other bank*,
  and **Drawn on** filters by it.
- **Cheques on one slip** (bottom of the page) is the most a slip may hold: 10, 20, 25 … as the bank's slip
  has lines. 0 means no limit.
- **Make deposit slips** makes as many slips as are needed in one go: cheques of the same bank on
  *Transfer* slips, cheques of other banks on *Clearing* slips, each holding no more than the limit, numbered
  one after the other. The page says how many slips will be made before you confirm.
- Untick "Separate slips for same bank and other banks" to keep all on one run of slips.

## Defaulters and fee reminders (2026-10-13)

**Reports centre → Defaulters** is worked out from the bills when it is opened: father and mother with their
mobiles, route, slab, discount type, gender, status, the months due, oldest due date, days overdue and balance.
Filters: overdue as on, class, discount type, least balance, ledger. Pages, the Columns button, Excel and PDF
as on the other reports.

To remind: tick pupils and press **Send a reminder to the ticked**, or **Send a reminder to all in this list**.
The reminder screen is laid out like Communication → Compose:

1. Tick the channels (SMS, WhatsApp, Email) and choose a template for each. The pupil's name, class, overdue
   amount and months fill the template's blanks for each parent; a blank the dues cannot fill is asked for.
2. Choose who gets it: father, mother, both, or the contact marked for notices.
3. Put seniors on copy (up to 12); **Keep this as the usual list** remembers them for the school.
4. The right side shows how many pupils and parents, who is left out and why, the cost, and the message
   as the first parent reads it.
5. **Send a test to me** (and those on copy) first; then **Send**.

Each person on copy gets the first reminder once, and an email with the summary of the run. A pupil is
reminded once a day unless "Also remind those already reminded today" is ticked. The run follows the
school's message approval rule and shows under Communication → Requests.

## Misc fees announced to pupils (Fees → Misc fees)

A misc fee is a one-off charge outside the school fee: a trip, an activity, an exam form, an ID card.
It has its own ledger and its own receipt series (MF/…); it never mixes with the school fee bill.

**Announce a fee** (tab "Announce a fee")

1. Choose the misc fee head (Fee setup → Fee heads, kind "misc"), give the fee a name, the amount,
   the last date and a remark.
2. Say what it is for parents: *Optional* (it closes on the last date, nobody can pay after it unless
   the date is extended) or *Mandatory* (it stays due after the last date).
3. For a trip with limited places tick *Limited seats* and give the number. A seat is taken by paying
   in full, in the order of payment. When the seats are taken nobody else can pay. A cancelled,
   bounced or refunded receipt gives the seat back.
4. Choose who it is for. The four ways add up, and a pupil chosen twice is counted once:
   whole classes, sections, pupils found by name, or an Excel sheet (download the format: admission
   number, amount, last date). A row of the sheet with its own amount or date gives that pupil a
   different amount or last date for the same fee.
5. *Send for approval.* The fee waits under Fee setup → Approval levels (the same levels as a fee
   change). Parents see it only after the last level approves.

**After approval** (open the fee from the list)

- *Send the announcement to parents* and *Remind those who have not paid* open the same screen as the
  fee defaulter reminder: a template for SMS, WhatsApp and email, a preview with the cost, a test to
  yourself and the seniors on copy, then the send. Template blanks: `{{fee_name}}`, `{{fee_amount}}`,
  `{{fee_due}}`, `{{last_date}}`, `{{student_name}}`, `{{class}}`, `{{admission_no}}`.
  A misc fee reminder and a fee due reminder on the same day do not block each other.
  Ready templates: **Misc fee: announcement** and **Misc fee: due reminder**, each for email, SMS and
  WhatsApp (Communication → Templates). The email can be sent as it is. SMS needs its DLT template id
  and WhatsApp its approved template name entered on the template first; register the wording shown
  there. The email's button opens the parent portal; the fee is paid at the counter.
- An extension moves every pupil whose own last date is earlier; a pupil given a later date keeps it.
- *Extend the last date*, *Add more pupils*, *Close the fee*, and on a pupil's row *Change amount or
  date*: each is a request that goes for approval. A pupil's amount cannot go below what is paid.

**Counter collection** (Fees → Misc fees → Counter collection)

Find the pupil, press *Full* (or type a part amount; a fee with seats is always paid in full), choose
the mode, *Take the payment*. One receipt is made for each fee and opens ready to print (school copy
and parent copy).

**Cancel, bounce, refund**: on the pupil's misc receipts, *Cancel, bounce or refund* raises a request
that goes for approval. On approval a cancelled or bounced receipt makes the fee unpaid again; a
refund (all or part) gets a refund voucher number and reduces what is paid.

**Report**: Fees → Reports centre → *Misc fee dues*: filter by fee, payment and class; choose the
columns; Excel and PDF; tick rows and send a reminder.

**Parents** see the announced fees of their child under Fees → Other fees, with the last date, the
amount, what is paid and the seats. Misc fees are paid at the school counter.

## Hostel fee

Hostel fee has its own heads (ledger "hostel"), its own bills and its own receipts (HF/…). School fee
and hostel fee are always paid apart.

**Who pays hostel, and for which months.** On the pupil's page → Fees → *Request a change*:
- *Hosteller: Yes* for the whole session, or *Hostel from month* / *Hostel to month* for part of it
  (choosing months makes the pupil a hosteller). Months are whole months: joining in July charges July
  onwards; leaving with last month August stops hostel from September.
- Leaving after paying ahead: what was paid for the months that go is carried forward to the pupil's
  next unpaid fee; what finds no due stays as advance on the receipt. The approval note says how much.
- *Own hostel pay plan*: one pupil can pay hostel monthly while the hostel goes by quarter.
All of these go for approval (Fee setup → Approval levels).

**Hostel calendar** (Fee setup → Hostel calendar). *Same as school*: hostel instalments use each
class's calendar (dates, late fee, Show, Fee pay) and nothing else on the page applies. *Own hostel
calendar*: a pay plan for hostel (for example quarterly) and late fee by slabs, per day, or none; the
months grid is kept like the class calendar: start date, last date, late fee and slabs (or rate per day),
challan date, Fee pay and Show. The *Instalment* column shows which months go together (Apr – Jun,
then "with Apr"); only the first month of an instalment counts, the grey rows serve pupils on an own
monthly hostel plan. An empty last date takes the class calendar's date of that month. The ↓ copies the
first month down the column (dates a month later each row). Saving checks the dates as the class
calendar does: slab dates after the last date and in order, the start date not after the last date,
dates near the session, a date and an amount for each slab, and a rate when late fee is per day. Unpaid
hostel bills move to new dates as soon as it is saved. Enter hostel amounts per month in the class fee
structure; the pay plan groups the months into instalments.

**Paying.** At the counter choose *Fee type: Hostel fee*; the amount shows what is open on hostel only,
and a part payment is taken (late fee runs on what is left after the last date). In the parent app a
hosteller's fees show as two blocks, *School fee* and *Hostel fee*, each with its own Pay button, and
the months in the hostel.

**Defaulters** show *School balance* and *Hostel balance* beside the total; filter *Ledger: Hostel* to
list and remind hostel dues only.
