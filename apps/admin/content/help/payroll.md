# Payroll

Payroll works out each employee's monthly pay from their salary structure, the rates in force and the
attendance, then the deductions — PF, ESI, profession tax, labour welfare fund, NPS and income tax — and
gives the payslips, the bank file and the statutory returns. It follows the school's old payroll module
step by step. This page covers the **set-up** (the rules and rates, pay heads and the pay matrix, each
employee's payroll profile and salary structure, approving the drafts), the **month's inputs**, the
**pay run**, the **payslips**, **paying the salaries** (bank files, cash and cheque) and the **statutory
and accounts** work (PF ECR, ESI, profession tax, LWF, the salary voucher, the compliance calendar). and **income tax**
(declarations and proofs, the earlier employer, perquisites, TDS challans, the quarterly return and Form 16 / 130).

## Who does what

| Who                                    | What                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Payroll maker** (its own role)       | Makes the drafts: rates, pay-head versions, formula tests, profiles, salary structures, the Excel sheet |
| **Payroll checker** (its own role)     | Approves the drafts someone else made; changes the pay matrix; may see a full PAN or account number     |
| **School admin** (and the group admin) | The payroll admin: the settings, tax years, templates, confidential staff; may also approve their own   |
| **Payroll auditor** (its own role)     | Reads everything for an audit — runs, registers, reports, the audit trail — and changes nothing         |
| **Payroll SPOC** (its own role)        | Runs the whole month alone: maker, checker and payroll admin together; locks the month's attendance     |

A checker never approves their own draft: the same person cannot make and approve a change (the school
admin can, and it is in the audit log). Every change is in the audit log with who and when.

**The Payroll SPOC** (single point of contact) is for a school where one person does payroll. They make and
approve the set-up and the people's records, pull and finalise attendance, create, process, approve and lock the
run, make the bank file, file the returns and run the reports. When they approve something they made themselves,
the audit trail marks it **Self-approved** (Payroll audit trail → **Self-approvals** lists them), so the principal
or an auditor can look through them. Three things still need another person: the principal countersigns the
go-live, a second person commits the move from the old payroll, and another checker decides the SPOC's own claims
and tax declaration. The SPOC can **lock** a month that is over in the staff attendance register from the payroll
attendance tab (**Lock** on the warning); unlocking, corrections and balances stay with the leave office.

## Where to find it

The side menu's **Payroll** has these entries:

- **Payroll home** — the month's figures, the work waiting, the filings due and small charts.
- **Monthly inputs** — the month's attendance for pay, salary holds, loans, one-off items, recurring
  items, claims, overtime, loss-of-pay given back and typed tax, one tab each.
- **Pay runs** — the month's runs; a run opens its employees, and each employee their pay in full.
- **Statutory and accounts** — a month's PF and ECR, ESI, profession tax, LWF and salary voucher, and the
  year's compliance calendar.
- **Income tax** — the year's declarations and proofs, earlier employers, perquisites, TDS challans, the
  quarterly return and the certificates.
- **Pay changes and leavers** — leavers' settlements, pay revisions (DA and the like) and their arrears, the yearly
  increments with their letters, and staff come from a sister school.
- **Payroll reports** — every report in one place, each shown on screen and downloaded as Excel, PDF or CSV.
- **Payroll audit trail** — every payroll change, event and read (checkers, the payroll admin and the auditor).
- **My tax** — every employee's own tax: declarations, the regime, the certificate (the staff app has it too).
- **My payslips** — every employee's own payslips (the staff app has it too, under Office).
- **Payroll set-up** — one page with four numbered section cards; every set-up screen opens from it.
- **Payroll drafts to approve** — for checkers: everything that waits, in one place.

## Dated rows: how a change works

Every rate, pay-head version and salary amount applies **from a date**. A change is never an edit of the
old row: it is a **new dated row**, made as a **draft**. When a checker approves it, the row in force
before it **ends the day before**, and stays — so a month already run, or run again, reads the rate it
had then. You cannot date a draft behind a later approved row, nor make two rows from the same date.
**End** a row by hand only when the rule stops altogether.

## The set-up (Payroll → Payroll set-up)

The page shows six figures (active staff, with a profile, with a structure, pay heads, matrix cells,
drafts waiting), a **To look at** list — what would stop a run (no income-tax slabs for the year, a
head with no version in force) and what to check (no state, no TAN, staff without a profile or
structure, drafts waiting) — and four sections. Fill them in order. A school starts with the old
module's defaults: the rates, PF, ESI, profession tax, LWF and tax slabs, 22 pay heads and the pay
matrix.

**1. Rules and rates**

- **Settings** (payroll admin) — the state (profession tax and LWF follow it), PF establishment code,
  TAN, PTRC and ESI codes; the pay matrix in use; the age pension (EPS) stops (58); whether the PF
  ceiling shrinks with loss of pay; the pay cycle's first day (empty: the calendar month); the overtime
  hours limit; the month after which staff can no longer switch tax regime; the payslip PDF password
  (from {EMPID} {NAME4} {PAN4} {AADHAAR4} {DOB_DDMMYYYY}); the bank file; **confidential staff** (hidden
  from makers in lists, reports and files, still paid and in the returns); **formula attributes** (a
  name that is 1 in a formula when an employee field has a value: `IS_PERMANENT | nature_of_appointment
| Permanent`).
- **Rates and statutory rules** — six tabs: **Rates** (DA_RATE, HRA_RATE … any code a formula names;
  type a rate as 0.55 or 55% (with the % sign), an amount as 1500 — commas and ₹ are fine; **LABOUR_CODE_WAGES** = 1 from a date switches on the labour codes'
  wage rule — allowances above half of the month's pay then count as wages for PF and for gratuity — and 0 from a
  later date switches it off), **PF** (shares, pension and EDLI ceilings, admin charges),
  **ESI** (shares, the wage limit, the higher limit for persons with disability), **Profession tax**
  (monthly slabs by state and gender; one month may differ — February), **LWF** (by state: a rate with
  a cap or flat amounts, monthly or in the months ticked), **Overtime rates** (a day and an hour by
  employee type). On these tabs a per cent is typed as a per cent (12 for 12 %). **＋ New draft**
  starts from the row in force.
- **Income tax** — the slabs, standard deduction, rebate (with marginal relief), cess, the rate
  without a PAN and the surcharge, for the new and the old regime, and the lines of the tax sheet with
  their caps, by financial year. The payroll admin **adds a year** as a copy of the last; correct what
  the budget changed. A pay run in a year with no slabs is blocked.

**2. Pay heads and the pay matrix**

- **Pay heads** — one for each line of the payslip, earnings and deductions. A head is worked out by
  its **version** in force: **fixed** (the amount on the employee's structure), **formula**, **slab**
  (an amount or a per cent by a range of basic, basic + DA, gross or pay level), **manual** (typed each
  month) or **system** (PF, ESI, PT, LWF, NPS, TDS, advances: worked out by payroll). A version also
  says what the head counts for (PF wage, ESI wage, profession-tax wage, income tax, cut for loss of
  pay) and how it is rounded.
- **A formula** names heads in brackets and rates by their code: `ROUND([BASIC]*DA_RATE)`. It may use
  PAID_DAYS, MONTH_DAYS and OT_HOURS; a deduction may also use GROSS_EARNED, PF_WAGE and BASIC_DA. + - *
  /, comparisons, ROUND, FLOOR, CEIL, MIN, MAX and IF(test, then, else). **Check the formula** as you
  type: it shows a mistake and where, the names it uses, a name nobody knows, and the value with the
  numbers you try. A loop (DA needs HRA and HRA needs DA) is refused.
- **Formula tests** — sample values with the answer expected (BASIC=44900, DA_RATE=0.55 → 24695). They
  run each time a version of the head is saved or approved: a version that gets one wrong is not saved.
- **Pay matrix** — basic pay by level (across) and cell (down). A checker adds or changes a cell; a
  cell or level a profile sits on cannot be removed.

**3. Staff**

- **Payroll profiles** — for each employee: PF (on the ceiling or the whole wage), pension, voluntary
  PF, ESI (and person with disability), profession tax (or why not), NPS instead of PF, the tax regime,
  tax worked out from the projection or typed, the pay level and cell, the increment month, contract
  dates, paid by bank, cheque or cash, and the payroll status (paid, on hold, left). **Make the missing
  profiles** gives every active employee without one the defaults; check each. Saving asks the date the
  changes apply from; each changed field goes into the profile's **History**. **Nominees** for
  gratuity, EDLI and general dues: each purpose's shares make 100 %. PAN, Aadhaar and the bank account
  stay on the employee record and show masked; a checker presses **Show**, gives a reason, and the look
  is logged (never the number).
- **Salary structures** — the monthly amount of each fixed head for an employee, from a date. Type only
  what changes (0 stops a head), the date and why, and **Save as drafts**. **Fill from a template**
  puts a template's amounts in the boxes. **From Excel**: download the sheet (a row for each employee
  and head with the amount in force), change it, **Check** it, then save the good rows as drafts.
  **Templates** (payroll admin): a name, the staff types it suits and the amounts.

**4. Drafts to approve**

Salary structures (tick the staff and **Approve the ticked**: each employee is approved whole or not
at all), rates and statutory rules (approve each), and the pay heads with draft versions (open the head
to see the formula and its tests, then approve).

### Finding, paging and downloading a set-up list

Every list in Payroll set-up — pay heads, a head's versions and formula tests, each tab of Rates and statutory
rules, the pay matrix, profiles, structures and templates, a structure's timeline, the profile history, tax slabs
and lines, bank accounts, drafts to approve, the rows read from the old payroll and each comparison — has the same
bar:

- **Filters** for that list (a search, the type, kind, status, department, staff type, "in force on" a date …):
  press **Show**; **Clear** removes them. The address keeps them, so a link opens the same view.
- **Records per page** (25, 50 or 100), **Showing 1 – 25 of N results** and the page numbers under the list.
- **Excel** and **PDF**: every row the filters leave (all pages, not only the one on screen). The PDF is on the
  school's letterhead with the filters written under the title and the **Prepared by** / **Checked by** boxes. PAN
  and bank accounts stay masked, and a maker's file leaves out the staff marked confidential, as on the screen.
  Each download is recorded in the payroll audit trail.

A table that is a form saved whole (the nominees, a structure's amounts) has only its **Excel** and **PDF**. The
settings page has its own Excel and PDF, and **Set-up book** on the Payroll set-up page downloads the whole set-up —
settings, pay heads with the formula in force, each rate tab in force today, the pay matrix, templates, this year's
tax and (for checkers) the bank accounts — as one workbook, a sheet each, or one PDF.

## The month's inputs (Payroll → Monthly inputs)

Get the month ready before its pay run. Each tab is one kind of input; pick the month at the top.

- **Attendance** — **Pull from staff attendance** fills each employee's days from the punches and the
  approved leave (the leave types say which leave is paid), once the leave office has locked the
  month's staff attendance. Days nobody marked count as the settings
  say. Change a day by hand, **mark present** the staff with no punches (drivers, say), or upload the
  month from Excel (the format file shows the columns). **Finalise** the month when it is right: the
  run reads only a finalised month, and the leave office cannot unlock that month's staff attendance
  until payroll un-finalises it.
- **Salary hold** — stop an employee's pay from a month, with a reason; **lift** it when it ends.
- **Loans** — an advance or a loan: the amount, the interest (none, flat or reducing), the months.
  **See the schedule** before saving. The run takes each month's instalment; pause or close a loan
  from its page.
- **One-off items** — an amount paid or kept back once, in this month only (an arrear, a fine, a
  bonus). Once the month's pay is locked you can still add one: only a new supplementary or bonus run
  of that month pays it (a locked run never changes).
- **Recurring** — an amount paid or kept back every month until its end month.
- **Claims** — an employee's claim (travel, a bill); approved claims are paid in the next run.
- **Overtime** — the hours worked over, for staff whose structure pays overtime.
- **LOP reversal** — loss of pay a past month took wrongly: preview what it gives back, then a
  checker approves it and the next run pays it.
- **Typed tax** — the income tax to keep back this month for an employee, typed in place of the
  worked-out figure.
- **Fee recovery** (from One-off items) — a ward's unpaid fee, kept back from the parent's pay: the fee receipt
  is made when the run is locked.

## The pay run (Payroll → Pay runs)

**One regular run a month.** Once it is locked, a **supplementary** run pays the staff it missed
(name them) and a **bonus** run pays everyone with a bonus or other one-off earning still to pay for
the month (add it on One-off items first); their tax is only the extra they add.

1. **New run** — the month and the kind. The checks show first: red ones (attendance not finalised, no salary
   structure in force, a pay head with no version in force) stop the run until they are fixed;
   amber ones are worth a look.
2. **Process** — works out every employee's pay. An employee it cannot work out shows **Failed** with
   the reason; fix the cause and process again, or a checker **drops** them from the run with a reason.
3. **Check** — open the run's employees and any employee's pay in full: each pay head, the statutory
   deductions with how they were worked out, the income tax projection, loans and arrears.
   **Reconcile** compares the run with last month's, head by head and employee by employee.
   Someone whose pay comes out below nothing: **recover it** as a loan over the next months.
4. **Approve** — a checker who did not process it (the school admin may). A run with failed
   employees, or nobody in it, cannot be approved. **Reject** sends it back with a comment; processing
   it again works everyone out afresh.
5. **Lock** — the month's pay is final: the payslips are made and kept as they are, and the fee
   receipts for fee recovery are made. A checker can **hold** an employee's payment (and release it)
   from approval on.

The school admin can **unapprove** an approved run, or **reopen** a locked one (it goes back to a
draft, the fee receipts are reversed and the loans restored) as long as no later run exists.

## Payslips

A locked run's page has **Payslips**:

- **Office copy** — every employee's payslip in one PDF, not locked, for the office file.
- **Each locked (zip)** — one PDF per employee, each locked with that employee's password.
- **Send pending e-mails** — e-mails each employee their locked payslip, once. Staff with no e-mail
  address on their record, or with something missing from the password (no PAN, say), are listed and
  skipped.

The **password rule** is in the settings (Payroll set-up → Settings), built from parts such as
`{EMPID}`, `{PAN4}` or `{DOB_DDMMYYYY}`; staff see the rule in words on My payslips. An employee's
payslip shows the school's letterhead, the days, the pay and deductions, and the net in words.

## My payslips

Every employee sees their own payslips of locked runs, year by year, with the year's gross, income tax
and net so far: **Payroll → My payslips** here, or **Office → My payslips** in the staff app. Each
payslip opens with the password the page describes.

Under the payslips, **Letters and certificate**: the salary certificate of the year (the months paid and locked) and
every increment or pay revision letter, to view or save.

## Paying the salaries (a run's Payments)

Open the run and press **Bank files and payments** (a payroll checker).

- **Still to pay by bank** lists the salaries not yet paid, by bank (the first four letters of each employee's
  IFSC), with the file that bank takes. **Make the file** for a bank (or one file for every bank), with a value
  date if the bank wants one. A salary is in one live file only.
- A file made while the run is only **approved** is **PROVISIONAL**: check it, but it goes to the bank only after
  the run is locked.
- On the file's page: **Download the bank file** (or the **bank letter**, Excel or PDF, with the signature boxes),
  upload it on the bank's portal, then **Mark uploaded to the bank**. When the bank has paid, **Confirm** with
  the bank's **UTR**: every salary in the file is marked paid. When nothing is left to pay, the run is **Paid**.
- A file not yet uploaded can be **cancelled** (with a reason); its salaries go in a new file.
- The bank **returned** a payment (a closed account, a wrong IFSC)? Press **Returned** on its line: the salary is
  held and no longer counted as paid. Correct the account on the employee record, then **release** the salary on
  the run: the next bank file pays it to the corrected account.
- **Cash and cheque** salaries are marked paid with the voucher or cheque number, once the run is locked.

While a bank file of the run exists, a salary in it is not held, and the run is neither unapproved nor reopened:
cancel the file first, or (once the bank has it) correct with arrears or a supplementary run.

## Statutory and accounts (Payroll → Statutory and accounts)

Pick the month (it opens on last month). Every figure comes from the month's runs; while a run is only approved,
the page says **PROVISIONAL** and the files wait for the lock.

- **PF and ECR** — the members (staff without PF are left out), the PF challan's accounts (the admin and EDLI
  minimums applied) and the **ECR**: the month's file holds every locked run, one line a member. **Download the
  ECR**, upload it on the EPFO portal, and once the return is approved there, **Record as filed** with its
  acknowledgement and date. A run locked later in the month gives a **supplementary** ECR of only the members not
  yet filed; someone paid again after their ECR was filed (a top-up) is listed for a revised return on the portal.
  A member with a wrong UAN stops the file until it is corrected. The payroll admin can **withdraw** the latest
  filing if it was recorded by mistake.
- **ESI** — the covered staff only (above the ESI limit they are not in it), their days and wages, and for someone
  with no paid day the reason (left service with the last working day, or on leave). **Download the ESIC upload**
  and upload it on the ESIC portal's monthly contribution page (compare its columns with the portal's sample
  template the first time). The challan figures are on the page.
- **Profession tax** — the register by monthly rate (men and women), the state's slabs, and for Maharashtra the
  **Form IIIB** figures to key in.
- **LWF** — the register and the amount to pay in the state's LWF months, when LWF is switched on.
- **Salary voucher** — one journal voucher for the month: salaries by staff type and the employer's PF, ESI, NPS
  and LWF on the debit side; each deduction payable (with the employer's share) and the net salaries on the credit
  side. It must balance; if it does not, it says so. Download it as Excel, CSV or PDF and post it in the accounts
  package.
- **Compliance calendar** — the year's dues: PF ECR and ESI by the 15th of the next month, TDS by the 7th
  (March's by 30 April), profession tax by the next month's end, LWF after its months, the quarterly TDS returns.
  **Set up** the year once; **Mark done** each with its challan or acknowledgement number, the date and the amount
  paid (set against payroll's figure). Overdue dues show on the payroll set-up page. Nothing here pays or files
  by itself.

Each register downloads as Excel or PDF (the PDF with the letterhead and the Prepared by / Checked by boxes).

## Bank accounts and ledgers (Payroll set-up → 4. Payment and statutory)

- **The school's bank accounts** (the payroll admin): one a bank, with the school's account number (for the letter
  and the file's debit account) and the file that bank takes — the **generic CSV**, the **bank letter** only, or
  the **bank's own layout**: take the bank's sample salary file and set its columns in the same order (name,
  account, IFSC, amount, narration, value date and its format, the school's account, a fixed value such as NEFT),
  whether it has a header row, the separator and the file type. **Try it** on two made-up payments before saving.
  A bank with no account here gets the default file of the payroll settings.
- **Arrears in the PF ECR**: folded into the month's wages (one file), or a separate arrear file.
- **The voucher's ledger names**: salaries by staff type, deductions by pay head, the employer's cost and the
  payables for PF, ESI, NPS and LWF, and the net salaries. Left blank, the default names are used.

## Income tax (Payroll → Income tax)

The run works out each month's tax from the year: the salary paid, this month and the months left, the earlier
employer's salary, perquisites and the employer's NPS, less the HRA exemption, the standard deduction, profession tax
(old regime) and the deductions; then the year's tax, and what is left of it spread over the months left (March takes
the rest). Pick the year at the top.

- **Declarations** — what employees declared (or a maker declared for staff without a sign-in). A declared amount
  counts in the monthly tax **until the proof deadline** (31 January unless set otherwise); after it, only what a
  checker **verified** counts and the remaining months make up the difference. Open the proofs, then **Verify** (all or
  part of the amount) or **Reject** with a reason the employee sees; **Reopen** to change a decision. Your own
  declaration is verified by another checker. HRA shows the city (50 % in the year's listed cities, 40 % elsewhere),
  the landlord and the relationship.
- **Earlier employers** — salary and tax from an employer earlier in the year (Form 122; 12B before 2026-27); it counts
  like a declaration. Verify or reject the same way.
- **Perquisites** — the year's taxable value of what the school gives besides pay (a ward's free education, housing,
  a vehicle, a loan …). It counts once a checker who did not enter it verifies it.
- **TDS challans** — each deposit: quarter, BSR code, challan serial, date, amount (tax and cess), interest, late fee
  and the months it pays. A month is paid by one challan; the page shows the TDS deducted in each month and any month
  with no challan yet.
- **Quarterly return** — each quarter's files (challans, Annexure I, and Annexure II in the fourth quarter) for the
  return utility (Form 24Q to 2025-26, Form 138 from 2026-27). They are made once every month of the quarter is locked
  and each month's TDS equals its challan.
- **Form 16 / 130** — 1. upload the Part A files from TRACES (each named with the employee's PAN); 2. **Make the
  certificates** once every run of the year is locked: Part A then Part B (the year's pay and tax), one PDF locked with
  the payslip password; 3. **Release in My tax**; 4. **Send pending e-mails**.
- **The year** — the declaration window, the proof deadline and the listed cities (the payroll admin); **Check the
  PANs** (without a PAN, tax is at least 20 %); **Close the year** after the fourth quarter's return.

Open an employee's name for their year: worked out as the next run would (looking never changes anything), the other
regime beside it, month by month. A checker can set **the year's tax** (the school's final figure, with a reason) and
go back to the worked-out one; the payroll admin can set the **regime** (a reason after the cut-off month).

## My tax (Payroll → My tax; the staff app's Office → My tax)

Every employee sees their year's tax as payroll works it out, month by month, and the other regime beside it.

- **Declare** in the year's window: choose the section and the amount for the year, or for HRA the rent of each month,
  the city, the landlord (name, address, your relationship, and the PAN when the rent is above ₹1,00,000 a year). Add
  proofs (PDF or photo, 10 MB each) now or later. Declaring a section again replaces it until it is verified. The PF
  and VPF payroll deducts are added to 80C by themselves.
- **Earlier employer** — if you worked elsewhere earlier in the year, enter that salary and tax.
- **My regime** — change it until the cut-off month (December unless the school set another).
- **My declaration form** (Form 124; 12BB to 2025-26) and **my tax certificate** (once released; it opens with your
  payslip password).

## Pay changes and leavers (Payroll → Pay changes and leavers)

### Leavers' settlements

When an exit is accepted (People → Exits), its full and final settlement comes here as a draft, with the last working
day and the days of notice short.

1. **Work it out** (a maker). Payroll reads the leave balance on the last day, the loans still owed and the no-dues
   clearance's dues by itself, and works out:
   - **Gratuity** — 15 days' wages (basic + DA ÷ 26) for each completed year; a part year above six months counts. Due
     after 5 years' service (1 year for a fixed-term employee, ticked here or by a contract end), and at once on death
     or disablement whatever the service. Capped at the school's limit (₹20 lakh); tax-free up to the tax limit.
     On a dismissal or termination for misconduct a checker may forfeit it, with a reason.
   - **Leave encashment** — the balance on the last day of the leave types whose policy encashes on exit, each up to
     the policy's maximum, at basic + DA ÷ 30 a day. To pay other days, type them with the reason. The tax-free part is
     the least of four (the law's ₹25 lakh limit among them); on death all of it is tax-free.
   - **Notice shortfall** — the days short at basic + DA ÷ 30.
   - Anything else payable or to recover, typed.

   The figures go on the exit's statement as payroll's lines (accounts sees them there and cannot change them); the
   statement says how much of its net payroll pays through its run, and how much is left for accounts.

2. **Approve** — another payroll checker (not the one who worked it out).
3. **Send to be paid** (a checker). The items go in the last day's month as one-off lines (gratuity and leave each as
   tax-free and taxable parts) and the loans close. If that month's regular run is already locked, **Make the
   full-and-final run**, then process, approve and lock it like any run. Once its run is locked the settlement shows
   **Settled**.
   When the balance is below nothing, nothing is paid: the dues are noted with a numbered letter (DUES/year/number) for
   the employee, and **Dues collected** records the receipt.

On a death the gratuity is shared among the employee's gratuity nominees by their shares (the profile's nominees). The
statement and the dues letter print from the settlement.

### Revisions

A change of a rate (DA) or of a head's formula, from a month, back-dated if need be. **Draft** it (a maker); its page
shows what it pays: each locked month worked out again through the engine, head by head, against what was paid. A
checker who did not draft it **applies** it: the arrears go to the next run and the new figure holds from the first open
month. A second revision of the same months pays only its own difference.

### Increments

Pick the month: everyone due is listed — once a year in the increment month (July unless set otherwise, or each
employee's own), with the service needed — with the next cell of their pay level, or a % for staff off the pay matrix.
A maker ticks and **proposes**; another checker applies them on the revision's page. Each gets a numbered letter
(PR/year/number), signed by the checker who applied it; the employee sees it in My payslips.

### From a sister school

When this school takes an employee transferred within the group (People → Transfers), a payroll checker opens them
here and **brings their payroll across**: the earlier-employer record of the year's tax (verified, so the tax here
counts the salary and tax there), the payroll profile, the pay structure as drafts for another checker to approve, and
the loans still owed (closed there). The figures are read from the other school when you open it: if its last month is
not locked yet, the page says so. The date of joining comes with the employee, so gratuity counts the whole service.

### Papers

- **Salary certificate** — the employee's own in My payslips; a checker prints anyone's from their tax year
  (Income tax → the employee).
- **Loan statement** — on a loan's page; its **no-dues certificate** once it is closed with nothing owed.

## Payroll home (Payroll → Payroll home)

The month's six figures first: **cost to school** (gross pay and what the school pays on top — PF, EPS, EDLI and
admin charges, ESI, NPS, LWF; gratuity is not in it), **net paid**, **staff paid** (people, not pay records: a person
paid twice in a month counts once), **average cost**, **statutory outgo** (the staff's PF, ESI, PT, TDS, LWF and NPS
plus the school's share) and **loss of pay**, each against the month before. Then the work waiting (runs to approve,
lock or pay; settlements, revisions, declarations and drafts) and the filings due, the gratuity liability today, and
small charts: twelve months, staff paid, gross by department, salary bands, what the pay is made of and what is taken
out. A month with an approved run not yet locked says **PROVISIONAL**. A maker sees it without the confidential staff.

## Payroll reports (Payroll → Payroll reports)

Pick a report under **All reports**, choose the period and the filters, then **Show**. Every report:

- has **one line per employee** — the month's regular pay and any additional run together (choose a run to see one);
- shows held salaries apart (**Paid** and **Held — not paid yet** sub-totals);
- keeps the details as they were paid (department, designation, staff type, level and cell of that month);
- hides the confidential staff from makers;
- downloads as **PDF** (on the letterhead, with Prepared by / Checked by), **Excel** or **CSV** — always the same rows,
  sub-totals and totals as the screen, with the same filters;
- says **PROVISIONAL** on the screen and in every file while a run of the period is approved but not locked.

The reports: the **salary register** (views: every head, gross–deductions–net, basic and allowances, earnings,
deductions, arrears, overtime, bonus, PF, ESI, PT, TDS, LWF, loan recovery, other deductions, net and payment, loss of
pay — or **Choose columns** and **Save these columns** as your own set; a checker can share a set with everyone); pay
by **department, designation, staff type or category**; the **head-wise summary**; **year to date**; **attendance and
salary**; **arrears paid** (the month each belongs to and why); **cost to school** (checkers); **month-on-month
variance** (each head of each employee, changes of at least the amount given); **headcount reconciliation** (who is new
this month and who was not paid, and why); the **TDS, PF, ESI, PT, LWF and NPS registers**; **ESI coverage**; the
**gratuity liability**; the **bonus register**; **bank-wise payments** with each bank file and UTR (checkers); **loans
outstanding**; and the **third-party payout** — what the runs actually deducted for each payee (checkers).

The same payroll data is in **Reports → Report builder** and its schedules (datasets _Payroll register_ and _Payroll by
pay head_), for checkers, the payroll admin and the auditor.

### Gratuity liability

Choose the date: each employee's gratuity if they left that day — the years (a part year above six months counts), the
monthly wage (basic + DA, or the labour codes' wages when switched on), whether it is due yet (5 years; 1 for contract
staff), **payable if all left** and **accrued for the years** served. Staff it cannot work out (no date of joining, no
locked month) are listed below the total. The figure for the accounts (AS 15 / Ind AS 19) is an actuary's valuation:
**Data for the actuary** (checkers) gives them the staff, the leavers of the year and the rule as Excel.

### Bonus

Schools are outside the Code on Wages' statutory bonus, so the school sets its own rule for each year on the **Bonus
register**: a **% of basic + DA**, a **fixed sum** each (by the months counted, if ticked), or **the statutory
formula**; with the months counted only while basic + DA is within a limit, the wage counted at most a cap, and at
least so many months or days. The register shows each employee's months, days, the wage counted, the bonus and why
not. A checker **sees what it posts**, then **posts** it to a month: each employee's bonus once, as a one-off item the
month's run pays (or a bonus run once that month is locked). Once posted, the year's rule stays.

## Audit trail (Payroll → Payroll audit trail)

Every payroll **change** (each table's row before and after), **event** (runs, approvals, settings, roles, bank files,
filings) and **read** (a report run or downloaded, a PAN or account revealed). Filter by dates, kind, table, who,
action, record or text; open an entry to see each field before and after. **Excel** exports what is found with the
fields. Looking at the trail is itself recorded. The trail is kept as long as the audit log — the app never deletes
it (labour registers must be kept 5 years; tax records may be reopened for longer).

The **auditor pack** (checkers) is one ZIP for a financial year: the salary, TDS, PF, ESI and PT registers of each
month, the year to date, the gratuity liability and the bonus, the TDS challans, the filings with their
acknowledgements, the year's audit trail with the fields before and after, and a **MANIFEST.csv** with each file's
rows and SHA-256 checksum, so the auditor can check nothing was changed.

## Moving from the old payroll (Payroll set-up → 6. Moving from the old payroll)

For a school paying salaries with the old payroll module, the move happens in six steps on one page:

1. **The old payroll.** The payroll admin starts the move and asks for the old payroll to be read. IT sets the
   connection to the old database on the server (it is never typed in EduPro; it reads only; the encrypted PAN and bank
   copies are never read — PAN and bank come from the employee record). Reading takes a minute or two.
2. **Bring it across.** **See what would come** (nothing is kept) lists what comes and what cannot, and why — an
   employee code not found here, a pay head not set up here. The payroll admin **prepares** it and a **second person
   commits** it: the payroll profiles, salary structures, loans, nominees, payees and recurring deductions, ESI coverage,
   earlier employers, declarations and TDS challans, the attendance, and the locked runs of the current and last
   financial year as **history** — read-only here; their payslips reprint, and year-to-date tax and Form 16 / 130
   follow from them. Older years download as an archive file. Brought again later, each row updates what it became;
   history already brought never changes. EduPro's own set-up (rates, heads) is not overwritten.
3. **Parity.** **Replay** the old payroll's locked months: each employee, pay head and month worked out again here from
   that month's own inputs, compared to the paisa — every head, the gross, deductions, net, TDS and the employer's PF,
   NPS and LWF. A difference stays **open** until a checker ticks it and **explains** it with a reason (rounding, a
   defect of the old payroll fixed here, the labour codes' wage rule, a set-up difference, an input missing here) and
   the evidence. An explanation stays on a re-run while the difference is the same; if it changes, it is open again.
4. **Two months side by side.** Set the two parallel months (ideally across a quarter's end). The old payroll locks
   and pays them; EduPro runs them to **Approved only** — it locks no month and makes no bank file until the switch.
   **Compare the two months** checks every employee against what the old payroll paid.
5. **Sign-off.** Once the second month has nothing open, a payroll checker **signs** the comparison (EduPro keeps its
   scoreboard, the engine's version and a checksum) and the principal **countersigns** (another person).
6. **The switch.** The payroll admin chooses the month EduPro pays from (after the parallel months). Set the old
   payroll read-only from then. EduPro refuses the old months and removes its own parallel runs; then read the old
   payroll again, prepare and commit, so the parallel months come across as history. Until EduPro locks its first
   live month the payroll admin may **switch back**, with a reason.

## Common questions

**I changed DA from July; will June's pay change?** No. The July row is a new dated row; June still
reads the old rate. Approve it before July's run.

**Approving says "You cannot approve your own draft".** A draft needs a checker who did not make it.

**A pay head shows "None in force".** No approved version covers today: add a version from the
right date and have it approved; a run is blocked until then.

**Why can't a maker see some staff?** They are confidential (Settings): a checker or the payroll admin
handles them.

**Where do I change an employee's PAN or bank account?** On the employee record (People); payroll
reads it from there.

**The pay run will not start.** A red check stops it: the run's page says which (often attendance not
finalised, or no salary structure in force).

**An employee's payslip did not e-mail.** They have no e-mail address on their record, or the
password needs a detail they do not have (their PAN, say); the run's Payslips section lists them.

**Can I change a locked month?** The school admin can reopen the run while no later run exists; it
goes back to a draft and every employee is worked out again.

**The bank file shows PROVISIONAL.** The run is approved but not locked: lock it before the file goes to the bank.

**The bank returned a salary. How do I pay it again?** Record it as returned on the file's line, correct the account
on the employee record, release the salary on the run, then make a new bank file.

**The ECR is refused.** A member's details are wrong (most often a UAN that is not 12 digits); the page lists them.

**Someone joined the month after the ECR was filed.** Once their run is locked, the PF tab offers a supplementary ECR
of only the members not yet filed.

**The salary voucher is not balanced.** Do not post it; tell the payroll admin (the page shows both totals).

**My declaration does not lower my tax.** After the proof deadline only verified amounts count: give the proofs to
payroll. In the new regime most sections (80C, 80D, HRA) do not count at all.

**Which regime is better for me?** My tax shows the year's tax in both; change it until the cut-off month.

**The certificate cannot be made.** A run of the year is not locked yet; lock (or remove) it first.

**The quarterly return is refused.** A month of the quarter is not locked, or its TDS has no challan or a different
amount; the message names it.

**An exit is accepted but no settlement shows.** Payroll must be set up (Payroll set-up opened once); the settlement
comes with the exit's acceptance.

**The leave days are 0.** No leave type's policy encashes on exit, or the balance is 0: set it in Leave set-up, or type
the days with the reason.

**Gratuity is 0.** The service is below 5 years (1 for fixed-term), and the exit is not a death or disablement.

**"Send to be paid" asks for a full-and-final run.** The last day's month is already locked: make the run from the
settlement's page, process it, then approve and lock it.

**A report shows someone twice / the old system did.** EduPro shows one line per employee: the month's regular pay
and any additional run are added together. Pick a run to see one run alone.

**Why does a file say PROVISIONAL?** A run of that month is approved but not locked: its figures can still change.

**The bonus register says to set the rule first.** Set the year's rule on the bonus register (a payroll maker).

**I cannot see the audit trail.** It is for checkers, the payroll admin and the payroll auditor.

**The old payroll will not read.** The page shows why: most often the server has no connection to the old database
yet — IT sets it (`LEGACY_PAYROLL_DB_URL`).

**Commit says "you prepared it".** A second person commits what the payroll admin prepared.

**A run will not lock during the move.** Until the go-live is signed and switched, EduPro runs only the parallel
months, and only to Approved; the old payroll pays them.
