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

## As built — phase B, leave (9 Nov 2026)

**Data** (0344–0347): rights `leave.own.apply` (every staff role) and `leave.office.manage` (school and
group admin, the leave office). `staff_leave_requests` (number `LV/<FY>/00001` from `staff_leave_counters`,
dates, days, half day and session, reason, document, status pending / approved / rejected / withdrawn /
cancelled, source self / on behalf / the system's deductions / import, the loss-of-pay part linked to its
paid part, the month the balance is held in, the system's note, the workflow instance and rule, the
decision, the cancellation request and its instance, edits); `staff_leave_days` (a day or a half, the kind:
working day or a weekly off / holiday charged by the sandwich); `staff_leave_balances` (one row an employee,
type and month: opening, credited, held, correction, closing, lapsed, closed, imported, the trail);
`staff_leave_edits`; `staff_month_locks` (the payroll lock; locked and unlocked with attendance in phase C).
Database functions shared with the nightly job: `staff_leave_rule` (session and carry forward: the policy,
else the type; the lower cap), `staff_leave_close_figures` (lapse or cap **only in the session-end month** —
the earlier month-close job lapsed every month), `staff_leave_effective_closing`, `staff_leave_balance_row`
(opened at the effective closing of the month before), `staff_leave_balance_peek` (the same, read only),
`staff_leave_resync` (later open months reopened after a change), `staff_leave_close_month`,
`staff_leave_credit` (the credit months' credit for the 3 / 6 / 12 months before, pro rata from joining,
set not added), `staff_leave_month_end` (close, open, credit; every night at 00:30 IST in the workers,
catching up a missed night), `staff_leave_digest` (each approver's morning e-mail). Message templates
(e-mail and app) seeded with the set-up: waiting, approved, rejected, cancelled, dates changed,
cancellation waiting, digest.

**The engine** (`leave-engine.ts`, `LeaveService.applyIn`): the earlier checks in order — loss of pay not
applied for by staff (the earlier module took a posted LOP id), half day (one date, a session), the type
is for the employee's gender, the document (not for the office or the system), days ahead allowed, the
backdate limit, the days (weekly offs and declared holidays free; an optional holiday a working day unless
the policy treats it as a holiday; off days between the first and last working day counted per the policy's
sandwich; a range of off days only refused, the office excepted), the **bridge** to the nearest live leave
within 60 days when every day between is off and both policies charge it (asked first), the payroll lock,
the fewest / most days (the stricter of the type and the policy; the fewest not asked of the office or the
system), overlap (the other half of a day allowed), not next to other leave (the nearest working day either
side), the balance in the month of applying (short: the paid part — in half days where the type allows —
plus loss of pay, asked first; all loss of pay goes to the approvers of the type asked for), the most a
month, an approver (`chainFor`). Then the request(s), the days, the hold, and the workflow: the rule's
band as a definition `staff_leave_<rule>_<band>`, levels with `autoSkip` and `noSelfApproval` (the
employee's own level passes on, the last to the school admin; a level nobody holds is skipped; nobody at all:
refused and nothing kept), payload employee and department (for the HOD and the reporting manager).
Approval completes through `onComplete('staff_leave')`: approved (with its loss-of-pay part; the activity
log's leave days filled) or rejected (the hold given back). A cancelled workflow is not a rejection (the
engine's cancel calls the handler — the leave closes itself, so the balance is given back once). Given back
into the month it was held in while open, else into this month as a correction (closed months stay closed).
Withdraw (own, waiting), cancel (office, waiting or approved; an approved leave's days leave the activity
log), the cancellation request (approved leave; a fresh chain `staff_leave_cancel_…`; the leave stands until
the last level), decide for the approvers (office, with a reason; the same effects), shorten (office, one
end, at least a day left, not a split leave), on behalf (office; replaces leave on those days in the same
transaction — the earlier module cancelled them even when the new entry failed).

**API** (`/leave`): `mine`, `apply` (a `confirm` answer for the bridge and the split), `on-behalf`,
`approvals` (waiting / decided), `requests/:id` (facts, `dayRows`, the approval and cancellation steps, the
changes, `can`), `…/decide`, `…/withdraw`, `…/cancel`, `…/cancel-request`, `…/cancel-decide`,
`…/override`, `…/trim`; `register` (eight figures for the financial year, filters, pages; `format=xlsx|pdf`
on the letterhead), `balances` (read without opening rows), `balances/adjust`, `balances/format`,
`balances/import` (the figure becomes the balance; a second run changes nothing), `balances/run-month`.

**Admin**: Employee management → **My leave** (`/leave`: balance figures, the apply form with the two
questions, my leave in pages, Waiting for me), **Leave register** (`/leave/register`: figures, filters,
Excel / PDF, Enter leave for an employee), **Balances** (`/leave/balances` from the register: the ledger
with the trail, correct, opening balances from Excel, run now), a leave's page (`/leave/requests/:id`:
decide, decide a cancellation, withdraw, ask to cancel, the office's cancel / decide / shorten), Waiting for
me (`/leave/approvals`); staff leave in My approvals. The holidays master gained Optional (staff) and For
which staff. **Staff app**: My leave (`/my-leave`), a leave (`/my-leave/:id`), Leave to approve
(`/leave-approvals`, shown when something waits). Workers: `leave.month_end` (00:30 IST), `leave.digest`
(08:30 IST).

Tests: `leave-requests.e2e-spec.ts` (the split asked then made and approved with its loss-of-pay part, the
activity log; the sandwich by policy and the bridge asked then counted; overlap and the other half of a
day, a type not for men, a missing document, nobody to approve (nothing kept), loss of pay not applied for,
a locked month; the HOD's own leave passing to the school admin; withdraw and reject giving the balance
back once; the cancellation request through its chain; the office's trim, decision for the approvers and
entry replacing a leave; the register's figures, filters and Excel; balances, opening balances from Excel
twice, a past month closed and this month reopened at its closing, the credit pro rata from joining).

## Phase C — staff attendance (next)

Punch intake (the device push, the read-only pull from the central device database by the school's device
serials, Excel), the day from the punches (shift and timing, first in / last out, the double tap, worked
hours, P / HD / A, one punch, the late and early rule, the trace and history), the attendance register
(month grid, legend, day correction, bulk upload), regularisation (its chain), late marks and missing
punches (with the monthly deduction through the deduction order), absent with no application → loss of pay,
re-check and recompute, the payroll month lock and unlock, department and special timings, credits weighted
by attendance.
