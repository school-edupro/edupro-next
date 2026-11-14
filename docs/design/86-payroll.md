# 86 — Payroll

Status: phase A (set-up) built 12 Nov 2026; phases B–G planned. Plan: `PAYROLL_MODULE_PLAN.md` beside the
legacy code (outside this repository).

## Source and approach

The school's payroll module of 2026 (PHP, kept read-only in `new folder/Payroll`: 106 program files, the
Excel/PDF generators and import templates, 3 schema files and a 62-section user manual) was read for its
**process**, which is kept: dated rates and statutory rules, pay heads in dated versions with a formula
language worked out in two passes, saved formula tests, the pay matrix, an employee payroll profile beside
the employee master, salary structures from a date with templates and an Excel upload, maker / checker
approval of every change, the monthly run in stages, payslips, the bank file, the statutory returns, income
tax by both regimes, revisions and arrears, full and final, and the reports. Only the program files and the
manual were read — not the attachments, `vendor/` or any connection file; no staff data is used. The screens
follow the Mobilise Design System.

## Decisions (12 Nov 2026)

1. Phases **A → G** in order, each usable and tested before the next (project-plan sprints S24–S27): A
   set-up, B the monthly run, C payment and statutory, D income tax, E people events, F reports and audit, G
   go-live with the parity harness.
2. Today's system is the PHP payroll module: the cut-over takes its data and **parity compares against its
   locked runs** ("one payroll month matches legacy to the rupee").
3. The labour codes' wage rule (in force 21 Nov 2025) is applied, **switchable**: a dated rate-registry
   setting the school turns on from its date (read by the run, phase B).
4. Reports and the bank file from APPROVED, marked **PROVISIONAL** until the run is locked; payslips and
   payment wait for LOCK.
5. The engine is a **TypeScript library** (`@edupro/payroll-engine`), unit-tested to 100 % without a
   database and reused by the parity replay; the run's stages, locks and writes in SQL. The **7 legacy
   defects** listed in the plan are fixed; parity marks them _explained_.
6. Roles **Payroll maker** and **Payroll checker**; the school admin and group admin are the payroll admin;
   the same person never makes and approves (the admin may, logged); MFA on the approving and revealing
   rights.
7. A school starts with the **legacy defaults** as data it can change.

## As built — phase A, the set-up (12 Nov 2026)

**Engine** (`packages/payroll-engine`, commit b9e24841): money in whole paise (`BigInt`), formulas in
micro-rupees with one rounding to paise at the end, half-up away from zero; `roundHead` (NONE, NEAREST_1,
FLOOR_1, CEIL_1, NEAREST_10, NEAREST_100, CEIL_100), `prorate`; the formula language — `tokenize`,
`compile(source, pass)` to postfix with the heads and names used and errors with their place, `evaluate`
with heads and values — numbers, `[HEAD]`, names (rate codes, attributes, PAID_DAYS, MONTH_DAYS, OT_HOURS; a
deduction also GROSS_EARNED, PF_WAGE, BASIC_DA), + - \* /, comparisons, ROUND, FLOOR, CEIL, MIN, MAX,
IF(test, then, else) nested to 5, 255 characters, 200 tokens; `calcOrder` puts the heads of a kind in
dependency order and names a loop. 67 tests, coverage held at 100 %.

**Data** (migration 0365, commit 2d7abbbe): rights `payroll.setup.view`, `payroll.setup.manage`,
`payroll.setup.approve` (MFA), `payroll.settings.manage` (MFA), `payroll.profile.reveal` (MFA); roles
`payroll_maker` and `payroll_checker`. Tables, all with `school_id`, row-level security and audit triggers:
`payroll_settings`; the dated registry `payroll_rates`, `payroll_pf_settings`, `payroll_esi_settings` (with
the limit for persons with disability — legacy defect 4), `payroll_pt_slabs`, `payroll_lwf_settings`,
`payroll_ot_rates`; income tax by financial year `payroll_tds_slabs`, `payroll_tds_config`,
`payroll_tds_surcharges`, `payroll_tax_labels`; `payroll_pay_heads`, `payroll_pay_head_versions`,
`payroll_pay_head_slabs` (a slab's percent is a per cent figure, 12.5), `payroll_formula_tests`;
`payroll_pay_matrix`; `payroll_profiles` (one per employee, beside the employee master),
`payroll_profile_changes`, `payroll_nominees`; `payroll_structures`, `payroll_structure_templates`. Dated
rows are `draft` / `active` / `ended`. `app.payroll_seed(school)` (idempotent, run on a school's first
payroll call) adds the legacy defaults: DA and HRA rates, PF, ESI, 7 profession-tax slabs, 2 LWF rules, tax
FY 2025-26 and 2026-27 (22 slabs, 14 surcharges, 4 regime settings, 34 labels), 22 pay heads with their
versions (NPS included), 6 formula tests and the 2016 pay matrix (538 cells, code `PM_2016`).

**Dated rows** (`payroll-dated.ts`): a change is a new row made as a draft by a maker; a checker who did not
make it approves it; the active row before it then ends the day before and stays active for its months.
Refused: a draft dated behind a later active row, two rows from the same date, changing anything but a draft,
deleting anything but a draft, approving your own (the payroll admin excepted). **End** closes a row by hand
(status ended). A month reads the active rows that cover it.

**API** (`apps/api/src/modules/payroll`, commit d869ce95), all under `/payroll`:

- `GET setup` — the figures (staff, profiles, structures in force, heads, heads with no version in force,
  matrix cells, drafts by kind) and the **To look at** list (red: no tax slabs for the year, a head with no
  version in force; amber: no state, no TAN, staff without a profile or structure, drafts waiting).
- `GET/PUT settings` (payroll admin): state, PF / TAN / PTRC / ESI codes, LWF on, EPS stop age, PF ceiling
  prorated, matrix in use, pay-cycle day, overtime hours limit, payslip password pattern, bank file, the
  confidential staff, formula attributes, the regime cut-off month.
- `GET/POST config/:kind`, `PUT/DELETE config/:kind/:id`, `POST …/approve`, `POST …/end` — the six kinds
  rates, pf, esi, pt, lwf, ot, each checked (a profession-tax wage band that ends before it starts, an
  LWF rule with no employee rate or amount, or a half-yearly one with no months, are refused).
- `GET tax?fy=`, `POST tax/years` (payroll admin; a year copied from an earlier one, all or nothing).
- `GET/POST heads`, `GET/PUT heads/:id`, `POST heads/:id/versions`, `PUT/DELETE head-versions/:id`,
  `POST head-versions/:id/approve|end`. A version's formula compiles for its pass (an earning cannot use
  what is known only after gross), its heads exist, no loop among the heads of its kind, slabs are checked,
  and the head's **saved tests run against it — a failing test refuses the save** and the approval.
- `POST formula/check` — errors, heads and names used, unknown names as warnings, the value from the
  inputs given, and the names on offer (heads, rates, attributes, system).
- `GET/POST heads/:id/tests`, `POST heads/:id/tests/run`, `DELETE formula-tests/:id`.
- `GET matrix?code=`, `PUT matrix/cell`, `DELETE matrix/:code/:level?cell=` (a checker; a level or cell a
  profile sits on is kept).
- `GET profiles` (filters, pages, figures; PAN and bank masked), `POST profiles/sync` (the missing profiles
  with the defaults; `dryRun` lists them), `GET/PUT profiles/:employeeId` (a level / cell checked against
  the matrix in use; each changed field into `payroll_profile_changes` with the date it applies from),
  `PUT …/nominees` (each purpose's shares make 100 %), `POST …/reveal` (a checker, with a reason; the audit
  log has who, which field and why — never the value).
- `GET structures/:employeeId?asOf=` (each head with the amount in force that day and any draft, the
  timeline, the templates), `POST structures/:employeeId` (drafts from a date, with a reason),
  `GET structures/drafts`, `POST structures/approve` (each employee all or nothing, in a savepoint; own
  drafts refused), `POST structures/drafts/delete`, `GET structures/format` (the sheet with the amounts in
  force) and `POST structures/import` (checked with `dryRun`, then the good rows saved as drafts).
- `GET/POST templates`, `PUT/DELETE templates/:id` (keeping them: the payroll admin).

PF, VPF, NPS, ESI, PT, LWF, TDS and ADV are worked out by payroll and cannot be typed on a structure or a
template. **Confidential staff** are left out of every list, structure and the sheet for a maker (a checker
and the admin see them).

**Screens** (admin app; the menu has **Payroll → Payroll set-up** and **Drafts to approve**; every set-up
screen opens from the set-up page):

- `/payroll/setup` — six figures, **To look at**, four numbered section cards (1. Rules and rates; 2. Pay
  heads and the pay matrix; 3. Staff; 4. Drafts to approve) with Done / To do and counts.
- `/payroll/setup/settings` — read-only for anyone but the payroll admin.
- `/payroll/setup/rates?tab=` — six tabs, a table per kind (values, from, to, status, made / approved by,
  why); **＋ New draft** in a dialog starting from the row in force (per cent fields typed as per cents);
  Approve, Delete, End.
- `/payroll/setup/tax?fy=` — the year picker, the slabs and limits of each regime, the tax-sheet lines; **＋
  Add a year** for the admin.
- `/payroll/setup/heads` and `/payroll/setup/heads/[id]` — earnings and deductions; a head's figures, its
  versions with Approve / Delete / End, **＋ New version** (shared `VersionFields`: worked out as, rounding,
  from, the formula with a live **Check the formula** and **Try it with**, slabs as lines
  `from | to | amount or n%`, depends on, the wage flags), the tests (folded; open when one fails) and name
  and order (folded).
- `/payroll/setup/matrix` — levels across, cells down, how many profiles sit on each cell; add / change /
  remove for a checker.
- `/payroll/setup/profiles` and `/payroll/setup/profiles/[employeeId]` — the list with filters and pages;
  **Make the missing profiles**; the profile: figures, the employee-record identifiers (PAN, Aadhaar, bank
  masked with **Show** + a reason for a checker), statutory deductions, pay and tax, payment and status,
  the date the changes apply from; nominees and history folded.
- `/payroll/setup/structures?tab=staff|import|templates` and `/payroll/setup/structures/[employeeId]` — the
  staff list; the Excel round trip (download, check, save the good rows); templates; an employee's amounts
  on a day, the new amounts (only what changes), **Fill from a template**, from and why; drafts waiting
  with Approve / Delete; the heads worked out in the run and the timeline folded.
- `/payroll/setup/approvals` — structures (tick, **Approve the ticked** / delete), rate drafts (approve
  each), heads with draft versions.

**Tests**: `apps/api/test/payroll-setup.e2e-spec.ts` (11: the defaults and overview, settings for the admin
only, the registry's draft → approve with the old row ended and kept, statutory checks, heads with formula
and saved tests, the formula check, the matrix, profiles with history / level check / reveal / confidential
staff, structures all or nothing, the sheet, tax years); the engine's 67 unit tests; a browser pass of every
screen at 1440 and 375 px with axe.

**Not in phase A**: the leave → pay map is not a separate table — the leave types already say loss of pay and
pay %, which the run reads (phase B; confirmed then). The labour-code wage switch is a dated rate the run reads
(phase B). Nothing here pays anyone: the monthly run, payslips and files come in phases B and C.

## As built — phase B, the monthly run (13–14 Nov 2026)

Decided 12 Nov 2026 (plan §5): the run works out monthly TDS from the year's projection (declarations, proofs,
challans and returns in phase D); a payslip is a PDF locked with the Settings password pattern, frozen at Lock,
e-mailed only when a checker presses **Send pending**; fee recovery is in this phase, with the fee receipt posted
at Lock; there is no leave map of its own (the leave types say loss of pay and pay %). The full and final run moved
to phase E with the rest of the exit.

**Engine** (`packages/payroll-engine`, commits af7c80bf, f980f056): `attendance` (the month's days from the
register, the pay window for joiners and leavers, paid days), `loans` (flat and reducing interest, the month's
instalment, the schedule), `statutory` (PF with the ceiling, segments and the top-up headroom on the ceiling only,
EPS stop age, NCP days; NPS; ESI with the contribution period and the limit for persons with disability; profession
tax by state slab and month; LWF), `tax` (slabs, rebate with marginal relief, surcharge with marginal relief, cess,
the no-PAN rate; the year's projection; a top-up's tax only the extra it adds; months left), and `calc` —
`calculate(input)` gives one employee's month: earnings in dependency order, the wages, statutory deductions, TDS
(a typed month wins), loans, one-off and recurring items, claims, overtime, LOP and its reversal, arrears, net with
the school's rounding — or a refusal with a code and a reason. PF, VPF, NPS, ESI, PT, LWF, TDS and ADV are the
engine's own heads. 136 tests, coverage held at 100 %.

**Data**:

- 0366 (af7c80bf) — `payroll_attendance` (one row per employee and month: the days, the source, finalised),
  `payroll_holds`, `payroll_loans`, `payroll_adhoc`, `payroll_ward_links` (a staff child, linked by a checker),
  `payroll_payees`, `payroll_recurring`, `payroll_claims`, `payroll_ot_entries`, `payroll_tds_manual`; settings
  `unmarked_as`, `net_rounding`, `arrear_display`; rights `payroll.run.view`, `payroll.run.manage`,
  `payroll.run.approve` (MFA). A trigger on `staff_month_locks` refuses unlocking a month payroll has finalised.
- 0367 (3b476e38) — `payroll_runs` (REGULAR, SUPPLEMENTARY with its named staff, BONUS; one live regular run a
  month), `payroll_run_events`, `payroll_records` (one per employee, with the frozen payslip), `payroll_record_lines`
  (each head, taxable or not), `payroll_record_statutory` (each deduction's wage, rate and working),
  `payroll_record_tax` (the projection), `payroll_record_loans`, `payroll_arrears`, `payroll_esi_coverage`.
- 0368 (304fb27c) — the loss-of-pay reversal (a locked month's LOP given back in a later run, approved by a
  checker; a cancelled one frees its month).
- 0369 — `payroll.own.view` (every employee, as My leave is: the API adds it to each staff record's rights, no
  role carries it); `payroll_records.payslip_emailed_at`, `payslip_message_id`.

**The run** (`payroll-run.service.ts`): DRAFT → PROCESSING → REVIEW → APPROVED → LOCKED (→ PAID in phase C);
REJECTED goes back to DRAFT on the next Process. Create shows the checks (red ones — nobody in the run, attendance not finalised,
no salary structure in force, a head on a structure with no version in force — refuse Process; amber are warnings).
Process works through the employees in batches and can be pressed again to go on; one it cannot work out is
FAILED with the reason. Supplementary and bonus runs only after the month's regular run is locked; a bonus is always a top-up and
pays those with a one-off earning or an arrear still to pay. One-off items stay open after the month is
locked (as the legacy): only a new supplementary or bonus run of that month pays them; they are refused while
a run of the month is processing or approved. Approve: a checker who did not create it (the payroll admin excepted), no FAILED records, not
empty. Lock freezes each payslip and posts the fee-recovery receipts (`app.post_receipt`, mode bank, "Salary
deduction"). Reopen (payroll admin): LOCKED → DRAFT, the receipts reversed (`app.reverse_fee_payment`), loans
restored, refused if a later run exists. Unapprove (payroll admin): APPROVED → REJECTED. Drop failed: a checker
with a reason of 10 characters or more. Hold / release: a checker, from APPROVED on. A negative net is recovered as
a RECOVERY loan over the coming months, with the matching one-off item. Every step is a run event and in the audit
log.

**API**, all under `/payroll`:

- Inputs (`payroll-inputs.controller.ts`): `attendance` (the month), `attendance/pull` (from a locked register
  month), `attendance/mark-present`, `attendance/finalise`, `attendance/unfinalise` (payroll admin),
  `attendance/format` and `attendance/import` (the Excel round trip, `dryRun` first), `attendance/:employeeId`;
  `holds` (+ `/:id/lift`); `tds` (typed tax); `loans`, `loans/schedule`, `loans/:id`, `loans/:id/status`;
  `adhoc`; `wards` and `fee-recovery`; `payees`, `recurring` (+ `/:id/status`), `payout`; `claims` (+
  `/:id/decide`); `overtime`; `staff` (the picker).
- Runs (`payroll-run.controller.ts`): `runs` (list, create), `runs/:id` (read, delete a draft), `/checks`,
  `/process`, `/records`, `/records/:recordId` (the employee's month in full, with the trace), `/approve`,
  `/reject`, `/lock`, `/unapprove`, `/reopen`, `/drop-failed`, `/records/:recordId/hold|release|recovery`.
- Review (`payroll-review.controller.ts`): `lop-reversals` (list, preview, add, approve, cancel), `reconcile`
  (a run against the month before, head by head and employee by employee).
- Payslips (`payroll-payslip.controller.ts`): `runs/:id/records/:recordId/payslip` (run.view; locked with the
  employee's password), `runs/:id/payslips?mode=single|zip` (run.approve; one unlocked office copy, or a zip of
  each locked file), `runs/:id/payslips/status`, `runs/:id/payslips/send` (run.approve; each not yet e-mailed:
  the PDF stored as a sensitive file, a queued e-mail with it attached; staff with no e-mail, or a password token
  with no value, listed and skipped), `me/payslips?fy` and `me/payslips/:recordId` (payroll.own.view; only my own,
  only locked runs).

**Payslip PDF** (`payroll-payslip-pdf.ts`): drawn with `@cantoo/pdf-lib` from the frozen payslip — the register
letterhead, the employee, the days, earnings and deductions side by side, totals, the net in words — and encrypted
AES-256 with the employee's password and a random owner password (printing allowed, copying and changes not). The
pattern is built from `{EMPID} {NAME3} {NAME4} {PAN} {PAN4} {AADHAAR4} {DOB_DDMM} {DOB_DDMMYY} {DOB_DDMMYYYY}
{DOB_YYYY} {DOJ_DDMM} {DOJ_DDMMYYYY}` (capitals only, checked on save); staff see it in words.

**Screens** — admin app (menu **Payroll → Monthly inputs**, **Pay runs**, **My payslips**):

- `/payroll/inputs?tab=` — Attendance, Salary hold, Loans, One-off items, Recurring, Claims, Overtime, LOP
  reversal, Typed tax; `/payroll/inputs/attendance/[employeeId]`, `/payroll/inputs/loans/[id]`,
  `/payroll/inputs/fee-recovery`.
- `/payroll/runs` — the month's runs and **New run**; `/payroll/runs/[id]` — the stage, figures, the checks, the
  employees, the actions for the stage; when locked, **Payslips** (office copy, the zip, **Send pending
  e-mails (n)**); `/payroll/runs/[id]/records/[recordId]` — one employee's month: heads, statutory working, tax
  projection, loans, arrears, the payslip (View and Download icons).
- `/payroll/reconcile` — two runs side by side.
- `/payroll/me` — my payslips by financial year, the year's figures, the password in words.

Staff app: **Office → My payslips** (`/my-payslips`, shared staff menu in `packages/bff`), the same list and
figures; `/api/my-payslip` gives the locked PDF.

**Tests**: `apps/api/test/payroll-inputs.e2e-spec.ts` (8: the pull from a locked register month with loss of pay,
joiners and leavers; by hand, mark present, finalise and un-finalise; the sheet; hold and typed tax; loans;
one-off items; fee recovery; recurring, payees, claims, overtime) and `payroll-run.e2e-spec.ts` (9: the checks
block a run; a negative net recovered; reject and afresh; approve by another checker, hold and release, lock;
reopen with the receipt reversed and the loan restored; a supplementary top-up; the LOP reversal and
reconciliation; payslips — the pattern checked, the locked file, the office copy, the zip, e-mail only on Send, My payslips mine only; after the lock a one-off bonus, a bonus run as a top-up, a failed record dropped by a
checker, the run unapproved by the payroll admin); the engine's 136 unit tests; a browser pass with axe at 1440 and 375 px.

**Not in phase B**: the bank file, PF / ESI / PT / LWF returns and the PAID stage (phase C); declarations, proofs
and the tax forms (phase D); the full and final run (phase E).

## As built — phase C, payment and statutory (14 Nov 2026)

Decided 14 Nov 2026 (plan §5; legacy spec `PAYROLL_PAYMENT_SPEC.md`): the bank file is the generic CSV, a column
layout per bank account set from that bank's own sample file, or the bank letter; the PF ECR is the month's — every
locked run together, then supplementary files of members not yet filed (EPFO's revamped ECR keeps the 11-field text
layout and adds regular / supplementary / revised returns); ESI is covered staff only with the ESIC monthly upload;
one salary voucher a month with its ledger names in the settings. The legacy defects found in this part are fixed:
a confirmed line returned no longer pays twice, a bounced salary re-issues to the corrected account, one live line
a salary, a held salary is never left in a file, the run turns PAID, staff without PF no longer block the ECR, the
ESI statement leaves out uncovered staff, a maker no longer reads confidential staff's statutory rows, every report
of an unlocked month says PROVISIONAL, a compliance item needs its acknowledgement and is never acknowledged twice.

**Data**:

- 0370 (a3061719) — `payroll_bank_accounts` (one a bank code: the school's account, `file_format` GENERIC_CSV /
  CUSTOM_CSV / BANK_LETTER, `layout` {columns [{field | value, header, format}], header, delimiter, extension}),
  `payroll_bank_batches` (per run: the format, layout and debit account copied in; value date; `provisional`;
  GENERATED → UPLOADED → CONFIRMED with the UTR, or CANCELLED with a reason), `payroll_bank_batch_lines` (the payee,
  IFSC, encrypted account and amount as sent; SENT / REJECTED / CANCELLED; a unique index keeps one SENT line a
  record), `payroll_records.paid_at`, `paid_by`, `payment_ref`.
- 0371 (c09eae3d) — `payroll_returns` (an ECR filed: month, sequence 1 regular / 2+ supplementary, members, totals,
  acknowledgement, filed on) and `payroll_return_members` (each member's line as filed and its records);
  `payroll_settings.ecr_arrear_mode` (FOLDED / SEPARATE).
- 0372 (fa3bb6e8) — `payroll_compliance` (a financial year's dues: item ECR / ESI / TDS / PT / LWF / TDS_RETURN, period,
  due date, done with acknowledgement, date, amount paid and payroll's figure, reopen reason);
  `payroll_settings.jv_ledgers`.

**Bank** (`payroll-bank.ts` pure, `payroll-bank.service.ts`): payable = COMPUTED or RELEASED, paid by bank, net above
nothing, on no live line; a record whose line the bank returned (or that carried no account) is paid to the
employee's current account, and the record says so. A file is made from an APPROVED (provisional), LOCKED or PAID run,
for one bank or every bank together; its total ties out to the payable total. Uploaded and confirmed only once the
run is locked; confirming marks the file's salaries PAID with the UTR and the run PAID when nothing is left (held
salaries wait). Cancel: a file not yet uploaded, with a reason. A returned line: only on an uploaded or confirmed
file; the salary is HELD (no longer paid) and a PAID run goes back to LOCKED; release, then a new file. Cash and
cheque: marked paid with the voucher or cheque number once locked. While a live file exists a salary in it is not
held and the run is neither unapproved nor reopened. Files: generic CSV (Name, Account, IFSC, Amount, `SALARY
YYYY-MM`; no header; LF), the bank's own layout (fields name, empid, account, ifsc, amount 0.00 / 0, narration, date
in four formats, debit_account — the batch's own bank account —, line_no, fixed values; header, separator , | ; ^
tab; .csv / .txt), the bank letter as Excel and PDF (letterhead, the body with the amount in words, S. No., account,
IFSC, name, amount, total; Prepared by, Accountant, Principal, Authorised signatory). A re-download of the bank file
is the file as made. Generating and downloading are audited with the number of accounts read.

**Statutory** (`payroll-statutory.ts` pure, `payroll-statutory.service.ts`): a month's records of its runs (APPROVED,
LOCKED, PAID for the registers — PROVISIONAL when one is only approved —, LOCKED and PAID for the files). PF: members
summed across a member's regular record and top-ups, staff without PF left out; the ECR line (UAN, name in letters,
spaces and dots, gross, EPF / EPS / EDLI wages, EE share with VPF, EPS, the employer difference, NCP days, refund 0;
whole rupees half up) and its checks (12-digit UAN, EPF ≥ EPS wages, EPS and EDLI within the ceilings, NCP in range,
no contributions on a month without a paid day); in SEPARATE mode the PF arrears paid leave the line for the 8-field
arrear ECR. The next file is everyone if nothing is filed, else the members not in a filed return; a filed member's
later record is listed for a revised return. Recording a filing keeps the members' lines (a filed ECR downloads as
filed); the payroll admin withdraws the latest. The challan's accounts 1, 2 (admin, at least the minimum), 10, 21
(EDLI, at least the minimum), 22. ESI: covered staff only — days paid, ESI wages, reason 0 / 1 on leave / 2 left
service with the last working day, IP number checked (10 digits) — and the ESIC upload Excel (the portal template's
six columns). Profession tax by monthly rate with men and women, the state's slabs, Maharashtra's Form IIIB figures.
LWF register and challan, due by the state's months. Registers as Excel and PDF (letterhead, Prepared by / Checked
by).

**Calendar and voucher** (`payroll-accounts.service.ts`): a year set up by a checker (adds only what is missing):
ECR and ESI by the 15th of the next month, TDS by the 7th (March by 30 April), PT by the next month's end when a state
is set, LWF on the 15th after each due month when it is on, the TDS returns 31 Jul / 31 Oct / 31 Jan / 31 May. Status
DONE / DONE_LATE / OVERDUE / DUE_SOON (7 days) / PENDING; done needs the acknowledgement (3+ characters) and a date not
in the future, the amount set against payroll's figure (PF challan, ESI, IT + cess, PT, LWF of the locked runs);
reopened only by the payroll admin. Overdue, due-soon and a year not set up show on the set-up page. The voucher: debit
salaries by staff type (EARNING lines) and the employer's PF (EPS + difference + EDLI + admin), ESI, NPS, LWF; credit
each deduction head (PF and VPF, ESI, NPS, LWF with the employer's share; PT, TDS, loans, the rounding line, others by
name) and the net salaries; balanced checked to the paisa; CSV, Excel and PDF, PROVISIONAL while a run is approved.

**API**, under `/payroll`: `bank/accounts` (GET; POST, PUT `:id` the payroll admin), `bank/layout/check`,
`runs/:id/bank` (GET the payments, POST make a file), `runs/:id/records/:recordId/paid`, `bank/batches/:id` (+
`/file?as=file|letter|pdf`, `/uploaded`, `/confirm`, `/cancel`), `bank/lines/:id/reject`; `statutory?month`,
`statutory/pf`, `statutory/pf/ecr?part`, `statutory/pf/ecr/filed`, `statutory/returns/:id/file`,
`statutory/returns/:id/withdraw`, `statutory/esi`, `statutory/esi/upload`, `statutory/pt`, `statutory/lwf`,
`statutory/register?kind&format`; `compliance?fy`, `compliance/seed`, `compliance/:id/done`, `compliance/:id/reopen`;
`voucher?month`, `voucher/file?format`. Settings take `ecrArrearMode` and `jvLedgers`.

**Screens** (admin app): the run page's **Payments** section; `/payroll/runs/[id]/bank` (still to pay by bank, make a
file, the files, cash and cheque, who is paid folded); `/payroll/bank/[batchId]` (downloads, uploaded, confirm,
cancel, a returned line); `/payroll/statutory?month&tab=pf|esi|pt|lwf|voucher|calendar` (menu **Statutory and
accounts**); `/payroll/setup/bank` (the bank accounts with the layout builder and its try-out; the ECR arrear mode and
the voucher's ledgers), linked from the set-up page's **4. Payment and statutory**. Files through
`/api/payroll/pay-file?kind=bank|ecr|return|esic|register|voucher` (a refused file says why).

**Tests**: `payroll-bank.e2e-spec.ts` (3: accounts and layouts; a provisional file, cancel, nothing changes under it;
upload, confirm, a returned payment paid again to the corrected account, cash, the run paid),
`payroll-statutory.e2e-spec.ts` (4: registers provisional and confidential; the ECR refused on a UAN, filed and kept; a
supplementary file of the new member only, a top-up listed for revision, withdraw; ESI and the ESIC upload, profession
tax with Form IIIB, LWF in June), `payroll-accounts.e2e-spec.ts` (2: the voucher balanced, by staff type, provisional,
ledger names; the calendar set up once, done against payroll's figure, reopened by the admin); a browser pass of
the statutory tabs, bank set-up and set-up pages with axe at 1440 and 375 px.

**Not in phase C**: the TDS deposit's challans, the quarterly TDS return files and Form 16 / 130 (phase D); a bank's
host-to-host upload or response file; Tally import of the voucher (with the accounts module).

## As built — phase D, income tax (14 Nov 2026)

Decided 14 Nov 2026 (plan §5; legacy spec `PAYROLL_TAX_SPEC.md`): declared amounts count until the year's proof
deadline (default 31 January), then only verified ones; a checker verifies, never their own; My tax in both apps with
HRA by month (city, landlord, relationship, the landlord's PAN above ₹1 lakh a year); Form 16 / 130 as one locked PDF
released in My tax and e-mailed on Send. Under the Income-tax Act 2025 (from 1 April 2026) the forms change — 12BB →
124, 12B / 12BAA → 122, 16 → 130, 24Q → 138 — and HRA counts at 50 % in eight cities instead of four; all of these are
data per year (`payroll_tax_labels`, `payroll_tax_years.listed_cities`), so both years work. Fixed against the legacy:
declared amounts no longer wait for verification all year; a checker never verifies their own; a rejection keeps its
reason; the employee's own PF and VPF go to 80C by themselves; viewing a tax sheet never stores anything; a challan is
checked against its quarter and its months' TDS; the return refuses an unlocked month or a mismatched challan.

**Engine** (commits 5727dbb0, 572a8233): `declare.ts` — `hraExemption` (the least of HRA received, rent less a tenth of
basic + DA, half or two fifths of basic + DA), `allowedDeductions` (each section within its cap and its regime, shared
caps such as 80C + 80CCC + 80CCD(1)), `houseLoss` (old regime, within its cap). `tax.ts` — `TaxExtras` (earlier
employers' salary, TDS and PT, perquisites, exemptions, other income, a house's loss, deductions, the HRA claim, the
employer's NPS, the declared sections with the PF-in-80C rule, the school's final figure and spread); the projection
shows each. `calc.ts` works out the year's HRA (paid, this month, the months left at this month's rates), the
employer's NPS (income, then allowed within 14 % new / 10 % old of basic + DA), the declared sections with the year's
PF and VPF in 80C, and returns `taxWorking`. 149 tests, 100 %.

**Data**: 0373 (572a8233) — `payroll_tax_years` (window, proof deadline, listed cities, frozen), `payroll_declarations`
(declared, verified, SUBMITTED / VERIFIED / REJECTED with reason, HRA detail with the landlord's PAN encrypted and
masked, proofs, made for staff), `payroll_prev_employment`, `payroll_perquisites` (a change supersedes), `payroll_tax_finals`,
`payroll_tds_challans` (one live challan a month), `payroll_regime_events`, `payroll_certificates`;
`payroll_tax_labels.cap_group` and more sections per year (`app.payroll_tax_sections_seed`). 0374 (6be2ffa9) —
`payroll_record_tax` keeps exemptions, perquisites, the earlier employer's salary and TDS, other income, a house's loss
and the working.

**The run** reads the year (`payroll-tax-extras.ts`): each declaration as it counts that month (verified; declared until
the deadline; rejected none), the HRA claim and the year's HRA, basic and DA paid, a house's loss, other income, the
earlier employer the same way, verified perquisites, the employer's NPS paid, the PF paid, the final figure.

**API** (`payroll-tax.service.ts`, `payroll-tax-docs.service.ts`), under `/payroll`: My tax — `me/tax` (the year live,
the other regime, the plan, declarations, the earlier employer, the regime window, the certificate), `me/tax/declarations`
(POST in the window; DELETE), `me/tax/prev`, `me/tax/regime`, `me/tax/declaration-form`, `me/tax/certificate`; the tax
centre — `tax/declarations` (list with the year's sections; POST for staff), `tax/declarations/:id/decide`,
`tax/proofs/:fileId`, `tax/prev` (+ POST, `:id/decide`), `tax/regime` (the payroll admin), `tax/perquisites` (+ POST,
`:id/verify|unverify|delete`), `tax/employees/:id` (the year live, nothing stored), `tax/finals` (+ `/clear`),
`tax/challans` (+ POST, `:id/remove`), `tax/pan-check`, `tax/years/:fy` (GET, PUT, `/freeze`), `tax/returns?quarter&file`,
`tax/declaration-form/:employeeId`, `tax/certificates` (+ `/part-a`, `/make`, `/release`, `/send`, `/:employeeId/file`).
Proofs: the uploader's own PDF / JPEG / PNG up to 10 MB, then owned by the declaration and marked sensitive. The return:
CHALLANS, ANNEXURE_I (PANNOTAVBL and remark C without a PAN) and ANNEXURE_II (Q4) as CSV named by the year's form.
Certificates: Part A matched by the PAN in its file name; Part B from the year's last locked record (gross with
perquisites and the earlier employer, HRA, standard deduction, PT, salaries, the earlier employer, other income less a
house's loss, each section claimed and allowed, taxable, tax, rebate, surcharge, cess, relief 0, total, TDS); Part A
pages first; locked with the payslip password; refused while a run of the year is not locked.

**Screens**: admin — **Income tax** (`/payroll/tax?fy&tab=declarations|prev|perquisites|challans|returns|certificates|year`),
an employee's year (`/payroll/tax/employees/[id]`), **My tax** (`/payroll/me/tax`); staff app — **My tax** (`/my-tax`,
Office). Shared parts: `DeclareForm` (client: a section and amount, or HRA's twelve months, the city and the landlord;
proofs) and `TaxSheet` (figures, the working, month by month).

**Tests**: `payroll-tax.e2e-spec.ts` (6: the year's settings; declarations with proofs, HRA and the landlord's PAN, one
made for staff; the run counting declared amounts; part verification, rejection with a reason, never one's own, proofs
for staff; the earlier employer, perquisites, the final figure, the regime; challans, the PAN check, a closed year) and
`payroll-tax-docs.e2e-spec.ts` (3: the return waiting for the locked quarter and its challans, then its three files;
the declaration form; Part A by PAN, certificates locked from the locked year, released, e-mailed); the engine's 149
tests; a browser pass with axe at 1440 and 375 px.

**Not in phase D**: relief for arrears of earlier years (the certificate shows 0; Form 10E by hand — with the pay
revision in phase E); the e-filing utility's own text format (the return is the utility's CSV input); LTA and other
salary exemptions; a bulk import of declarations.

## As built — phase E, people events (14 Nov 2026)

Decided 14 Nov 2026 (plan §5; legacy spec `PAYROLL_PEOPLE_SPEC.md`): gratuity by the law, fully; leave encashment from
the leave module's balance; every exit through payroll with a statement, a negative balance becoming dues with a
letter; increments by the pay-matrix step, yearly. Fixed against the legacy: a revision recomputes locked months
through the engine (every dependent head follows; a second revision pays only its own difference; each locked regular
month's record is worked out again, top-ups aside); increments once a year,
with service, the next matrix cell, applied by another checker, with numbered letters that print; the settlement's
approver is never the one who worked it out; dismissal forfeiture only by a checker with a reason; loans close on
staging, or carry into the dues; the statement prints; nominees' shares on death; the transfer is read live and
written once.

**Engine** (3c32ccf5): `settle.ts` — `serviceLength` (years, months, days, counting both ends), `gratuity` (15/26 a
year of the monthly wage, a part year above six months, the minimum years, any service on death or disablement, the
cap, the tax-free part), `leaveEncashment` (days × wage ÷ 30), `leaveEncashmentTaxFree` (the least of the amount, the
days at the ten-month average, ten months' average, 30 days a completed year, what is left of the cap), `noticeShortfall`,
`monthArrears`, `codeWages` (the labour codes' wages: the wage heads, or half of the pay when the allowances are more).
162 tests, 100 %.

**Data**: 0375 (4f63251b) — the settlement heads (GRAT_EX/TX, ENCASH_EX/TX, NOTICE_REC, FNF_REC; manual, tax-free ones
not taxable), `payroll_runs.purpose` (FNF), the settings (increment month, minimum months, % off the matrix, gratuity cap
and tax-free cap, encashment tax-free cap and maximum days), `payroll_profiles.last_increment_on`, `payroll_revisions`
(RATE, FORMULA, INCREMENT; DRAFT, APPLIED, CANCELLED), `payroll_arrears.revision_id`, `payroll_revision_letters`
(PR/year/n), `payroll_settlements` (DRAFT → COMPUTED → APPROVED → STAGED or DUES → SETTLED; CANCELLED) and the trigger
that drafts one when an exit is accepted. 0376 (303df5d3) — `payroll_transfer_imports` and two owner-rights functions
limited to an accepted transfer into the current school: `app.payroll_transfer_packet` (the source's name, TAN, last
locked month, profile, structure on the transfer date, loans owed, the tax year's taxable salary, PF, PT and TDS from
its locked months) and `app.payroll_transfer_close_loans`.

**API** (`/payroll`): revisions — `revisions` (+ POST), `revisions/:id/simulate|apply|cancel|letters`,
`increments?month` (+ POST to propose); settlements — `settlements` (`?status`), `settlements/:id`,
`/compute|approve|stage|run|collected|cancel`; papers — `revisions/:id/letters/pdf`, `letters/:id/pdf`,
`me/letters` (+ `/:id/pdf`), `settlements/:id/statement|dues-letter`, `me/salary-certificate`,
`employees/:id/salary-certificate` (a checker), `loans/:id/paper?kind=statement|noc`; transfers — `transfers`,
`transfers/:id` (a checker: the plan, read live), `transfers/:id/bring`. The settlement's figures go to the exit's
statement (`employee_fnf.lines`, marked `fromPayroll`; the statement's form keeps them; a cancel gives them back).
Staging: the last day's month while its regular run is open, else the latest locked month and a full-and-final
(supplementary, purpose FNF) run; `stage` refuses a month whose run is processing or approved. Every paper is on the
register letterhead with signature boxes filled from the system (who worked out, approved, issued; the signature
image of their employee record).

**Screens**: admin — **Pay changes and leavers** (`/payroll/people?tab=settlements|revisions|increments|transfers`),
a settlement (`/payroll/people/settlements/[id]`: figures, what next, the working, work it out, the leave balance,
nominees), a revision (`/payroll/people/revisions/[id]`: figures, apply or cancel, letters, arrears by employee), a
transfer (`/payroll/people/transfers/[id]`); the loan page's statement and no-dues certificate; the employee's tax year's
salary certificate; My payslips' letters and certificate (both apps); the exit statement shows payroll's lines
read-only.

**Tests**: `payroll-revision.e2e-spec.ts` (3), `payroll-settlement.e2e-spec.ts` (3: drafted by the exit, worked out by
the law, on the statement and kept by its form; another checker approves; staged into a locked month, paid by the
full-and-final run, settled, the statement prints; below nothing — dues and the letter; death — nominees' shares; a
checker never approves their own; cancel gives the statement its lines back), `payroll-people-docs.e2e-spec.ts` (2:
letters to staff and in My payslips, the salary certificate, the loan papers; the transfer seen live and brought once,
never one not accepted into this school); the engine's 162 tests; a browser pass with axe at 1440 and 375 px of every
new screen (seeded test schools; admin and staff app).

**Gate** (14 Nov): the engine (162 tests, 100 %), every payroll spec with the exit, transfer, leave, attendance, access
and fee-ledger specs, permissions, the database's 143, lint, types and formatting of the three apps — all green. It
found one gap from phase B and fixed it: the labour codes' wage rule (decision 3) was a rate nobody read. Now, with
`LABOUR_CODE_WAGES` = 1 in force, a regular month's PF wage takes the allowances above half of the structure pay as
wages too (`calc.ts`, trace `labourCode`; never on a top-up; NPS stays on basic + DA), and a settlement's gratuity
stands on the last month's labour-code wages (`detail.gratuity.wage`, `labourCode`); leave and notice stay on basic +
DA. The exit statement now says how much of its net payroll pays and how much is left for accounts.

**Not in phase E**: relief for earlier years' arrears (Form 10E) — the arrears are paid and taxed in the month paid;
promotions (a structure change by hand); fee dues read from the fee ledger (typed as other recovery, or through the
no-dues clearance); the settlement's pending salary estimate (the month's run pays it).

## As built — phase F, reports and audit (14 Nov 2026)

Decided 14 Nov 2026 (plan §5; legacy spec `PAYROLL_REPORTS_SPEC.md`, 44 legacy reports): one clean catalogue, one line
per employee, every download equal to the screen with PROVISIONAL on files; the gratuity liability as of a date with the
actuary's file; the bonus by the school's own rule (schools are outside the Code on Wages' bonus, s.41(1)(e)); a full
audit trail with a read-only Payroll auditor and the yearly auditor pack; the payroll home for checkers and scoped
makers, cost to school without gratuity. Fixed against the legacy: downloads ignored the screen's filters and had no
PROVISIONAL; a person with a top-up was counted twice; past months showed today's heads, designation and type; the PT
register, third-party payout and headcount were broken; the auditor pack could not be built; settings and role changes,
reveals and reads were unaudited; the bonus counted per record and ignored confidential staff; the gratuity liability
dropped failures silently and had no total.

**Data**: 0377 (093ffbe5) — `payroll_records.staff_type / pay_cell / category` as paid (a BEFORE INSERT trigger; old
records back-filled); `payroll_report_presets` (own, or shared: `owner_id` NULL, made by a checker);
`payroll_bonus_rules` (per year: PERCENT, FIXED, STATUTORY; rate or sum, prorate, minimum months and days, the wage limit
and cap) and `payroll_bonus_postings`; right `payroll.audit.view` (checker, school and group admin) and role
`payroll_auditor` (audit, run view, set-up view; `hiddenFor` lets it see every employee).

**API** (`payroll-reports.ts`, `payroll-report-grid.ts`, `payroll-reports.service.ts`, `payroll-annual.service.ts`,
`payroll-audit.service.ts`, `payroll-home.service.ts`), under `/payroll`: `reports` (the catalogue by role),
`reports/options?month`, `reports/presets` (+ POST, `/:id/delete`), `reports/:key` (the grid) and `reports/:key/file`
(`format` xlsx | pdf | csv — the same grid), `gratuity/actuary?asOf`, `bonus/:fy` (GET, PUT), `bonus/:fy/post`
(`dryRun`), `audit` (filters, pages), `audit/export`, `audit/pack?fy`, `audit/:id`, `home?month`. One record scope
(`RECS`: approved, locked or paid runs, not FAILED, the period, run, department, staff type, employee, confidential
staff) and one grid (columns, rows, sub-totals, total, PROVISIONAL, after-tables, note) drawn to the screen, Excel
(numbers as numbers, frozen header, filter), PDF (letterhead, Prepared / Checked) and CSV. The catalogue (21): salary
register (17 views; chosen columns), group summary, head-wise, year to date, attendance and salary, arrears paid, cost
to school (checker), month-on-month variance (per head), headcount reconciliation, TDS, PF, ESI, PT, LWF (phase C's
tables), NPS, ESI coverage, gratuity liability, bonus register, bank-wise payments (checker), loans outstanding,
third-party payout (checker; actual deductions). Every run and download is audited (`payroll.report.view` /
`.download`), as are viewing and exporting the trail. Datasets `payroll_register` and `payroll_heads` in the report
builder and schedules (checkers, payroll admin, auditor).

**Screens**: admin — **Payroll home** (`/payroll`), **Payroll reports** (`/payroll/reports?key=…`: all reports folded,
the period and filters, the grid, PDF / Excel / CSV, the register's views, Choose columns and saved sets, the bonus
rule and posting, the actuary's file), **Payroll audit trail** (`/payroll/audit`, `/payroll/audit/[id]`, Excel, the
auditor pack).

**Tests**: `payroll-reports.e2e-spec.ts` (5: the register — one line per employee, held apart, confidential hidden,
views, columns, filters, CSV equal to the screen, PROVISIONAL in files; summaries, year to date, variance, headcount,
the other reports, the builder dataset; the gratuity liability and the actuary's file, the bonus rule, register and a
single posting; presets; the audit trail for checkers and the auditor, viewing recorded, the auditor pack's manifest
checksums, the home in persons); a browser pass with axe at 1440 and 375 px.

**Gate** (14 Nov, 933f7722): the engine (162, 100 %), every payroll spec with the exit, transfer, leave, attendance,
access, fee-ledger and report-builder specs, permissions, the database's 143, lint, types and formatting — all green.

**Not in phase F**: an actuarial valuation itself (the actuary's); Bonus Form C and the ESI return file (the ESIC
upload is phase C's); scheduled e-mailing of payroll reports beyond the report builder's schedules; PRAN on the NPS
register (not kept on the employee record).

## As built — phase G, go-live (14 Nov 2026)

Decided 14 Nov 2026 (plan §5; legacy spec `PAYROLL_GOLIVE_SPEC.md`: the old module has no data-move tool, a parity
harness against the wrong system that auto-explains every tax difference and failure, no opening balances and no
sign-off): read the old payroll database into a holding area and bring the people and the current and last year's
locked runs as read-only history (older years as an archive file; the set-up compared, not copied; PAN and bank from the
employee record); parity by replay, every employee × head × month to the paisa, open until explained; two parallel
months (EduPro to Approved only), signed by a checker and countersigned by the principal, gating the first live lock and
bank file; the switch at a tax year's start when possible, the old months refused afterwards, a rollback until the first
live lock; the payroll admin prepares and a second person commits.

**Data**: 0378 (b9892b11) — `payroll_cutover` (SETUP → BROUGHT → PARALLEL → SIGNED → SWITCHED; history start, parallel
months, switch month, the read, what was prepared, committed, signed, switched, the first live lock, a rollback),
`payroll_legacy_rows` (the holding area) and `payroll_legacy_map` (what each old row became), `payroll_runs.imported`,
`payroll_parity_batches` (REPLAY, PARALLEL), `payroll_parity_results` (MATCH, OPEN, EXPLAINED per employee, month and
component), `payroll_parity_explanations` (by kind, employee, month, component; the difference explained; code, note,
evidence), `payroll_golive_signoffs` (scoreboard, engine version, SHA-256 checksum, signer and a different
countersigner); right `payroll.golive.countersign` (school and group admin — the principal holds the school admin role).

**Worker** (`legacy-payroll.ts`, job `payroll.legacy_read`): the old payroll tables read into the holding area through
`LEGACY_PAYROLL_DB_URL[_<CODE>]` (else the leave cut-over's connection), read only; `PanEnc`, `BankAccountEnc`,
`CalcTrace` never read; on request and nightly in the parallel months.

**API** (`payroll-golive.ts`, `payroll-golive.service.ts`, `/payroll/golive`): overview, `start`, `read`, `preview` (in
a savepoint, nothing kept), `prepare` (the payroll admin; counts, problems, a checksum of the rows read), `commit` (a
second person; refused if the rows changed), `archive`, `parallel-months`, `parity/replay`, `parity/parallel`,
`parity/:batch` (results, scoreboard, by month), `parity/:batch/explain`, `parity/:batch/sign`, `signoffs/:id/countersign`,
`switch`, `rollback`. The replay works each old regular month through `loadEmployee` + `calculate` with that month's
own loan instalments, one-off items and arrears taken from the old lines. Guards (`payroll-month.ts`): until the switch
EduPro creates only the parallel months' regular runs (the second may follow an approved first) and locks nothing and
makes no bank file; after it, months before the switch are refused; an imported run never changes.

**Screens**: Payroll set-up → **6. Moving from the old payroll** (`/payroll/setup/golive`: figures, steps, read, archive,
what would come, prepare and commit, replay, parallel months, sign-off, switch and switch back) and each comparison
(`/payroll/setup/golive/parity/[batchId]`: scoreboard, differences with filters, explain the ticked ones, sign).

**Tests**: `payroll-golive.e2e-spec.ts` (4: preview keeps nothing, prepare and a second person's commit, history
read-only, nothing run before the parallel months, the archive; the replay to the paisa, explanations kept on a re-run;
the parallel months to Approved only, the comparison, sign and countersign, the switch, the old months refused, the
rollback; the parallel months brought as history, the first live lock ending the rollback); the worker's reader test;
a browser pass with axe at 1440 and 375 px.

**Gate** (14 Nov): the engine (162, 100 %), every payroll spec (go-live included) with the exit, transfer, leave,
attendance, access, fee-ledger and report-builder specs, permissions, the database's 143, the worker's reader tests,
lint, types and formatting of the API, admin, staff app and workers — all green. Payroll phases A–G are built.

**Not in phase G**: decrypting the old PAN and bank copies (EduPro uses the employee record's); replaying the old
additional and full-and-final runs (only regular months are replayed; the parallel comparison takes every run);
a separate opening year-to-date figure (the history brought gives it).

## As built — Payroll SPOC (14 Nov 2026)

**Asked**: a role for a payroll SPOC who runs the whole payroll process, and a dev sign-in for it. **Decided**: one
person may take the month alone (the payroll admin's own-approval rule), each self-approval marked in the audit trail;
a narrow right to lock a month's staff attendance for payroll; the dev login on Alpha.

**Migration 0379**: permission `leave.month.lock` (lock a month that is over; unlocking stays `leave.office.manage`),
granted to every role holding `leave.office.manage` (school roles too); system role `payroll_spoc` "Payroll SPOC" with
`payroll.setup.view|manage|approve`, `payroll.run.view|manage|approve`, `payroll.profile.reveal`,
`payroll.settings.manage`, `payroll.audit.view`, `leave.report.view`, `leave.month.lock`. Not `leave.office.manage`, not
`payroll.golive.countersign`.

**API**: `POST /staff-attendance/lock` needs `leave.month.lock` (unlock still the office). `GET
/payroll/inputs/attendance` returns `register.canLock` and `register.openMissing` (missing punches still open in the
unlocked months). Self-approval: the run, settlement, LOP reversal and revision approvals and every dated approval
(`approveDated` → `selfApproved`) put `selfApproved: true` in the audit event when the approver made the item; the
audit list returns `self`. Still refused for the SPOC as for anyone: committing a go-live they prepared, countersigning
one they signed (and the countersign right is not theirs), deciding their own claims and verifying their own tax.

**Screens**: the payroll attendance tab's "lock the month first" warning gets **Lock ⟨month⟩** (a dialog with the open
missing punches) for holders of the right; the audit trail shows a **Self-approved** badge and a **Self-approvals**
filter. Help: Payroll → Who does what.

**Dev sign-in**: `dev-payroll` "Pankaj Payroll", employee PS01 (Accounts, Alpha), role `payroll_spoc`; in seed:demo,
the admin and staff app pickers; added to Alpha by a one-off insert of only those rows.

**Tests**: `payroll-spoc.e2e-spec.ts` (4: the role's rights; locking — a checker refused, the SPOC locks, only the
office unlocks; the month alone with the run self-approved, marked and listed, then locked; a checker refused their own
run, the SPOC approves it unmarked).

## As built — set-up lists: filters, pages, Excel and PDF (14 Nov 2026)

**Asked**: every page of Payroll set-up with a filter, Excel / PDF and pages. **Benchmark**: greytHR's grids export
to Excel only what the filters leave; Zoho Payroll's reports download as XLS/XLSX/PDF. **Decided** (all
recommended): every list of every set-up page; a download is every filtered row with the screen's columns, on the
letterhead with the filters and the Prepared / Checked boxes, recorded; PAN and bank masked and confidential staff
out of a maker's file, as on the screen; a Set-up book on the set-up home.

**API** (`payroll-setup-lists.service.ts`, `payroll-setup-lists.controller.ts`): one catalogue of 27 lists — `heads`,
`head-versions` (id), `head-tests` (id), `config` (kind: rates, pf, esi, pt, lwf, ot), `matrix` (a row per cell, a
column per level), `profiles`, `structures`, `templates`, `structure-drafts`, `setup-drafts` (rate, rule and
pay-head drafts), `profile-nominees` / `profile-changes` (employeeId), `structure-heads` (employeeId, asOf) /
`structure-timeline` (employeeId), `tax-slabs` / `tax-labels` (fy), `bank-accounts` (a checker or the payroll admin),
`golive-staged`, `golive-batches`, `parity` (batchId), `settings`. Each loads through the set-up's own service (its
rights, masking and `hiddenFor` hold), filters, and maps its rows to the report grid. `GET
/payroll/setup-lists/:key?…filters&page&size` (25/50/100) → `{ filters (with choices), applied, rows (the page), total,
all, page, size, extra }`; `GET /payroll/setup-lists/:key/file?format=xlsx|pdf&…` → every filtered row
(`gridPdf` / `gridSheet`), audit `payroll.setup.download`; `GET /payroll/setup-book?format=xlsx|pdf` → the settings,
heads, each rate tab in force today, matrix, templates, tax slabs and lines, bank accounts (checkers), a sheet each,
or one PDF (sections joined with pdf-lib, the logo on the first only). The comparison (`parity`) pages in the
database (`pageLoad`: status, month and head go to the results query) — a replay of two years holds many rows.

**Admin**: `lib/payroll-lists.ts` `setupList(key, path, sp, { params, prefix })` (a page with more lists gives each a
prefix: `v_status`, `t_page`; everything else in the address is kept); `components/payroll/SetupListBar.tsx` (the
filter form, records per page, Showing, Excel / PDF, the rows, the pages; `SetupListFiles` for a table saved whole);
the pay-file route's kinds `setuplist` and `setupbook`. Pages: set-up home (Set-up book), heads (one list with a Type
column instead of two tables), a head (versions, tests), rates (each tab; the status links became the Status
filter), matrix, profiles, a profile (nominees files, history), structures (staff, templates), a structure (amounts
files, timeline), tax, bank, drafts to approve (structure drafts; rate, rule and pay-head drafts in one list), go-live
(rows read, comparisons), a comparison (opens on Open as before), settings (Excel / PDF).

**Tests**: `payroll-setup-lists.e2e-spec.ts` (4: filters and pages, a search, a rate in force on a date, refusals;
files with the filters line, recorded, PAN masked, the confidential employee out of a maker's file, missing-PAN and
department filters; the bank list refused to a maker, the comparison paged in the database; the Set-up book's sheets,
a maker's without bank accounts, the PDF). Browser (dev-admin; 1440 and 375; 17 views): axe clean.

**Overtime rates by the staff master (14 Nov 2026)**: the Overtime tab's draft form picks the employee type from the
staff master's active Employee types (`GET /payroll/config/ot` returns `employeeTypes`, by name) instead of free text;
`POST /payroll/config/ot` refuses a type not in the master and saves the master's own spelling — the monthly overtime
finds a rate by the employee's staff type (`profile.staff_type`, the master's name), so a typed "teaching" never
matched. The list's employee-type filter is a drop-down too. Test: `payroll-setup-lists` (5).

## As built — fixing a wrong entry: Edit, Withdraw, Correct (14 Nov 2026)

**Asked**: in every section of Rates and statutory rules, how to delete or manage a wrong entry. **Benchmark**: greytHR,
Keka and Zoho Payroll allow changing or deleting an effective-dated revision until payroll is processed for its
period; after that a fix is a new revision from a later date with arrears. **Decided** (all recommended): Withdraw an
approved row no approved run has read; Correct from a date once one has; the same for all dated set-up.

**Migration 0380**: the eight dated tables (rates, PF, ESI, PT, LWF, OT, pay-head versions, structures) take status
`withdrawn`, `withdrawn_by|at`, `withdraw_reason` (10–300) and `closed_rows` (what an approval ended, each with its
earlier end). It also fixes **End**: an ended row had status `ended`, which every run leaves out, so ending a rate on
31-03 hid it from December too. End now only sets the end date (the row stays `active`, bounded by its dates, as the
rows an approval closes always were); the `ended` rows became `active`; the old module's ENDED structures come across
`active` too.

**API**: `payroll-dated.ts` — `approveDated` records `closed_rows`; `endDated` keeps `active`; `datedUsage` (the runs
a row was read by: a run's month meets the row's dates; a structure only by runs with a record of that employee;
APPROVED / LOCKED / PAID close it, PROCESSING / REVIEW are open) and `withUsage` (each ACTIVE row of a list gets
`usage: { closed, closedMonths, open, correctFrom }` — config lists, a head's versions, a structure's timeline);
`withdrawDated` (refused when closed, naming the month to correct from; the rows it ended reopen to their own end but
never past this row's end; rows approved before `closed_rows` are found by their end the day before). `POST
/payroll/dated/:kind/:id/withdraw {reason}` (`payroll-corrections.service.ts`, a checker or the payroll admin): the
open runs that read it go back to draft (`PayrollRunService.resetForSetup`: records purged as on a reject, event
`setup_withdrawn`); audit `payroll.<kind>.withdraw`. Set-up lists: status filter Withdrawn; Ended means past its end.

**Screens**: `components/payroll/RowFix.tsx` (Withdraw: the reason, the runs that go back to draft; Correct: why, the
month, the form or pointer). Rates: **Edit** a draft (the API's PUT, now on screen), Withdraw / Correct on approved
rows (Correct opens the draft form with the row's values from the first open month; the form builder now prefills
any row and keeps each dialog's ids apart), state badges (Ended by date, Withdrawn) and the reason in Why. A head's
versions: Withdraw / Correct (the New version dialog, dated from the month shown). A structure's timeline: Withdraw /
Correct (a link to the amounts form with From set, `?from=`). Help: Payroll → Dated rows → A wrong entry.

**Tests**: `payroll-withdraw.e2e-spec.ts` (4: withdrawn, kept, the row before back in force, a maker refused, a reason
needed, listed with its reason, audited; refused once an approved run read it with the month to correct from, a
processed run sent back to draft and the row before reopened; End keeps a row active; a salary amount withdrawn while
only another employee's run was approved). `payroll-setup` (End keeps the row active). Gate: the payroll suites
(withdraw, setup, set-up lists, go-live, run, people docs, revision, inputs, settlement, statutory, tax, reports,
SPOC), permissions, the database's 143. Browser (dev-admin; the Withdraw dialog on four tabs, a head's page): axe clean.

## As built — income-tax set-up: edit and add (14 Nov 2026)

**Asked**: on the Income tax page, how a user edits and adds. **Found**: only "Add a year" (a copy); nothing of a year
could be changed, and the copy lost the lines' group limits (80C, 80CCC and 80CCD(1) no longer shared ₹1.5 lakh in a
copied year). **Decided** (all recommended): the payroll admin edits with a reason, audited; a year in use changes
only with a tick (TDS deducted stays, the rest projected anew); lines edited, added, removed when unused; a year
nothing uses removed.

**API** (`payroll-tax-setup.service.ts`, `payroll-tax-setup.controller.ts`, all `payroll.settings.manage`): `PUT
/payroll/tax/:fy/regimes/:regime` (slabs from ₹0, meeting, only the last open, rates 0–1; rules — the rebate not over
its income limit; surcharges rising; replaced together, audit `payroll.tax.regime` with before and after); `POST
/payroll/tax/:fy/lines`, `PUT …/lines/:code` (a group limit must be a non-declared line with a cap), `POST
…/lines/:code/remove` (not `BUILT_IN_LINES`, not used by a declaration, not a group others count in); `POST
/payroll/tax/years/:fy/remove` (not the running year; no run, declaration, challan, certificate, earlier employer,
perquisite, regime choice, final tax, return or bonus rule in it — `taxYearBlockers`; returns are keyed by the
year's first calendar year). A year with an approved, locked or paid run (`taxYearInUse`) refuses a change without
`confirm`. `GET /payroll/tax` adds `inUse`, `blockers` and each line's `capGroup`, `used`, `builtIn`. "Add a year" now
copies `cap_group`.

**Screens** (`components/payroll/TaxEdit.tsx`): Change on each regime card (the slabs grid with two spare rows, the
rules, the surcharges, the reason, the in-use tick); ＋ Add a line, Edit and Remove on the lines (a Within column for
the group limit, the declarations using a line); Remove this year, or "in use: it stays". Actions
(`lib/payroll-actions.ts`): amounts with commas or ₹, rates as per cents. Help: Payroll set-up → Changing the
income-tax set-up.

**Tests**: `payroll-tax-setup.e2e-spec.ts` (4: a checker refused, slabs checked — from ₹0, meeting, one open — a
reason needed, saved and audited; a year an approved run used refused without the tick, saved with it; lines added,
a duplicate refused, a group limit checked, G80C's cap raised, a built-in line and one a declaration uses not
removed, an unused one removed; a new year keeps the group limits; a year nothing uses removed, one in use not). The
tax, tax papers, set-up and set-up lists suites; permissions. Browser (dev-admin; Change, Add a line, Edit): axe clean.
