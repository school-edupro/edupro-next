# Payroll

Payroll works out each employee's monthly pay from their salary structure, the rates in force and the
attendance, then the deductions — PF, ESI, profession tax, labour welfare fund, NPS and income tax — and
gives the payslips, the bank file and the statutory returns. It follows the school's old payroll module
step by step. This page covers the **set-up** (the rules and rates, pay heads and the pay matrix, each
employee's payroll profile and salary structure, approving the drafts), the **month's inputs**, the
**pay run** and the **payslips**. The bank file and the statutory returns come in the next phase.

## Who does what

| Who                                    | What                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Payroll maker** (its own role)       | Makes the drafts: rates, pay-head versions, formula tests, profiles, salary structures, the Excel sheet |
| **Payroll checker** (its own role)     | Approves the drafts someone else made; changes the pay matrix; may see a full PAN or account number     |
| **School admin** (and the group admin) | The payroll admin: the settings, tax years, templates, confidential staff; may also approve their own   |

A checker never approves their own draft: the same person cannot make and approve a change (the school
admin can, and it is in the audit log). Every change is in the audit log with who and when.

## Where to find it

The side menu's **Payroll** has these entries:

- **Monthly inputs** — the month's attendance for pay, salary holds, loans, one-off items, recurring
  items, claims, overtime, loss-of-pay given back and typed tax, one tab each.
- **Pay runs** — the month's runs; a run opens its employees, and each employee their pay in full.
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
  type a rate as a decimal, 0.55 for 55 %), **PF** (shares, pension and EDLI ceilings, admin charges),
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
