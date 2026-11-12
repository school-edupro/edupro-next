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
