# 85 — Staff leave and attendance

Status: phase A (set-up) built 9 Nov 2026; phases B–E planned. Plan: `LEAVE_MODULE_PLAN.md` beside the
legacy code (outside this repository).

## Source and approach

The school's earlier leave module (PHP, kept read-only in `new folder/LeaveManagement`; about 88,000
lines, 27 tables, 19 scheduled jobs, 16 MIS reports) was read for its **process**, which is kept: leave
types, policies by scope with credits in the session's credit months, carry forward and lapse at the
session end, the sandwich rule inside an application and across two (the bridge), the paid + loss-of-pay
split when the balance is short, the balance held at apply in the month the request is raised, approval
by day bands, the same person acting once, the admin override, withdraw / cancel / cancellation request /
date trim / apply on behalf, the attendance day worked out from the punches with its trace, late marks
and missing punches turned into leave, loss of pay for unexplained absence, regularisation, the payroll
month lock and the reports. The screens follow the Mobilise Design System. Only program files were read
(not the staff attachments, logs or connection settings).

## Decisions (9 Nov 2026)

1. Leave **and** staff attendance, in phases: A set-up, B leave, C attendance, D the reports, E the
   cut-over from the legacy module.
2. Same process, the legacy faults fixed (the month-close job lapsing every month, the open job copying a
   zero closing, the HD threshold charging a full day, approval chains saved per employee, only named /
   reporting-manager approvers, a message to the wrong approver after a same-person carry-forward, no
   queue for cancellation requests, the on-behalf supersede not rolled back, the apply screen showing
   another month's balance, register headings shifted, locked-month writes, night shifts in the re-check,
   report sums). Fields the legacy screens offered but never used are enforced where the meaning is clear
   (policy fewest / most days an application, not next to other leave, pro rata on joining, optional
   holidays in the sandwich); encashment and the half-pay % are information for payroll.
3. Approvers: the legacy day bands (up to 7, more than 7 up to 30, more than 30) × up to 3 levels, by
   scope and leave type, on the EduPro approval levels (named staff, reporting manager, HOD, designation,
   role), worked out when the leave is applied.
4. Punches: the device push EduPro has, the legacy read-only pull from the central device database by the
   school's device serials (the connection set on the server), and an Excel upload.

## As built — phase A, the set-up (9 Nov 2026)

**Data** (migration 0343): permissions `leave.setup.view` / `leave.setup.manage` and the role
**Leave & attendance office** (`leave_office`; school and group admins hold both).

- `app.staff_in_scope(scope, values, employee)`: all, or departments / designations / employee types (by
  name or code, as on the employee) / employee codes. `app.scope_key` (an immutable key of the values for
  the one-active-rule indexes).
- `staff_leave_types` (code `^[A-Z][A-Z0-9_]{0,19}$`): paid, loss of pay, keeps a balance, counts as
  present, half day, approved at once, document needed, not next to other leave, for days ahead, fewest /
  most days an application, most a month, deduction order, credited (Q / H / Y / none — never monthly,
  the owner rule), carry forward and cap, for men / women, pay %, order. A trigger tells the rules across
  columns in plain words (loss of pay is not paid, keeps no balance, carries nothing; a type without a
  balance has no deduction order; a cap needs carry forward; most ≥ fewest; men or women).
- `staff_leave_policies`: name (unique), leave type, rule book (a note), scope, priority, days a year,
  credited, how often (empty: the type's), session start month, credit months (worked out from the start
  — April + H = 4,10 — or typed and counted against the frequency), days a credit, pro rata, carry forward
  (empty: the type's) and cap, fewest / most days, sandwich (weekly offs, holidays, optional holidays),
  encashment. One active policy per type and scope.
- `staff_weekoff_rules`: scope, weekly (ISO weekdays, weeks of the month) or dates; `app.staff_is_weekoff`.
- `holidays` gained `optional` and the staff scope; `app.staff_is_holiday(employee, day, optional)`.
- `staff_shifts` (day / night, times, grace, present / half-day / shift hours, overtime, bus duty, one
  punch, the late and early rule: minutes and HD / A / half a day of a leave type);
  `staff_shift_postings` (employee, shift, from, to; a later start wins); `staff_timings` (department and
  special timings — screens come with phase C). One trigger checks shifts and timings.
- `staff_leave_approval_rules`: kind leave / regularisation, name, scope, leave type (empty: any),
  priority, `bands` (JSON: the three bands' engine levels; one band for regularisation). One active rule
  per kind, scope and type.
- `staff_leave_settings` (one row a school): late marks / missing punches for a day of leave, loss of pay
  after days, punch gap, re-check and absent look-back, the count-from date, default shift, late reduces
  hours, office may edit times / apply on behalf, backdate limit, missing-punch copy, device serials,
  message channels.
- `app.staff_leave_seed(school)`: into an empty set-up only — the ten types (CL, EL, SL, HPL, CO, OD,
  WFH, ML, PL, LOP; CL 1 and EL 2 in the deduction order, LOP 999 and approved at once, HPL pay 50%), the
  General and Bus-duty shifts, Sunday off and the settings (default shift General). Called when the
  set-up is opened.

**Masters** (group `leave`, "Leave & attendance setup"): Leave types, Leave policies, Weekly offs, Shifts,
Shift postings — grids, add / edit, Excel template and upload, Excel / PDF; the triggers' messages show on
a refused row. Times are 24-hour text checked by pattern; lists (scope values, credit months, weekdays,
weeks, dates) are comma-separated.

**API** (`modules/leave`): `GET leave/setup/overview` (counts; the leave types with their policies and
staff in no policy; warnings as the legacy screen gave them, plus staff without an approver and no
regularisation chain), `GET/POST/PUT leave/setup/approvals[/:id]`, `PUT …/:id/bands/:band` (levels checked
by the shared `buildLevels`, reporting manager allowed, at most 3), `POST …/:id/status`,
`GET leave/setup/approvals/preview` (the rule, the band and the people at each level today for an
employee, a type and days; the employee removed from their own levels; a type approved at once needs
nobody), `GET/PUT leave/setup/settings`. `leave-chain.ts` (`chainFor`, `bandOf`) is what phase B uses at
apply time: the active rules whose scope takes the employee in, for the type or any, by priority (the
type's before any), the first whose band has a level.

**Admin**: Employee management → **Leave & attendance set-up** (`/leave/setup`): six figures, To look at,
four sections (leave rules, calendar, shifts and timings, settings), leave types at a glance. **Who
approves** (`/leave/setup/approvals`): the leave rules with their three bands' levels, the regularisation
rules, a new rule (scope picker), Test the chain. A rule's page: who it is for, switch off / on, and the
shared levels editor once per band. **Settings** (`/leave/setup/settings`). The master grids lead back to
the set-up.

Tests: `leave-setup.e2e-spec.ts` (the defaults and the overview's warnings; policy credit months, a
quarterly policy with two months refused, a paid loss-of-pay type refused, a day shift past midnight
refused, a night shift kept; rules, bands, the chain for an employee by length and department, the lower
band at a boundary, a band without levels leaving it to the next rule, the HOD skipped on their own leave,
a type approved at once; an unknown department, a second active rule, a fourth level, a missing band
refused; settings; the rights). Help: `content/help/leave.md`.

## Phase B — leave (next)

Balance ledger by month (opening, credited, held, correction, closing, lapsed, closed); apply with the
legacy checks in order (half day, document, gender, working days and the sandwich, the bridge, payroll
lock, fewest / most days, overlap, balance and the paid + loss-of-pay split, most a month, not next to
other leave, backdate limit, an approver exists); the approval through the workflow engine with the
chain from `chainFor`; withdraw, cancel, the cancellation request and its queue, date trim, on behalf (one
transaction); messages and the daily digest; My leave in the staff app and the admin app; the leave
register (nine figures, filters, the override); the balance master (adjust, add, Excel opening
balances); the credit, open and close jobs; the activity log's leave days filled from approved leave; the
holidays' staff scope and optional flag on the calendar screen.
