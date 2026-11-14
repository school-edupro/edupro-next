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
FAILED with the reason. Supplementary and bonus runs only after the month's regular run is locked; a bonus is
always a top-up. Approve: a checker who did not create it (the payroll admin excepted), no FAILED records, not
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
one-off items; fee recovery; recurring, payees, claims, overtime) and `payroll-run.e2e-spec.ts` (8: the checks
block a run; a negative net recovered; reject and afresh; approve by another checker, hold and release, lock;
reopen with the receipt reversed and the loan restored; a supplementary top-up; the LOP reversal and
reconciliation; payslips — the pattern checked, the locked file, the office copy, the zip, e-mail only on Send, My
payslips mine only); the engine's 136 unit tests; a browser pass with axe at 1440 and 375 px.

**Not in phase B**: the bank file, PF / ESI / PT / LWF returns and the PAID stage (phase C); declarations, proofs
and the tax forms (phase D); the full and final run (phase E).
