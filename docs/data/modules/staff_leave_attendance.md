# Staff leave and attendance — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

Staff leave and staff attendance, from set-up to the payroll month. The school sets leave types, policies
(entitlement, credit months, carry forward, sandwich), weekly offs, shifts and timings, and who approves. Staff
apply for leave (or the office applies on their behalf, or the system deducts it); the days are counted into day
rows, the balance is held at once in the month of applying, and the request goes through its approval levels.
Punches from devices, the central device database, Excel or by hand are worked into one attendance day per
employee (present, half day, absent, weekly off, holiday, leave, salary hold); late marks and missing punches
turn into leave every few marks; staff ask for corrections (regularisations). Each month the balances close and
credit, and the office locks the month for payroll. Cut-over tables keep what came from the old leave module.

## Tables

| Table                        | One row is                                                             | Key columns                                                                                                                                                                                      | For reports                    |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `staff_leave_types`          | a leave type (CL, EL, SL, LOP …)                                       | `code` (unique), `paid`, `loss_of_pay`, `keeps_balance`, `counts_present`, `deduct_order`, `credit`, `pay_percent`, `status`                                                                     | master                         |
| `staff_leave_policies`       | the entitlement rule of one type for a scope of staff                  | `leave_type_id`, `scope`, `scope_values`, `priority`, `annual_days`, `credit`, `credit_months`, `carry_forward`, `carry_cap`, `sandwich_*`, `by_attendance`, `status`                            | master                         |
| `staff_leave_approval_rules` | who approves leave (or regularisation) for a scope and type            | `kind`, `scope`, `scope_values`, `leave_type_id`, `bands` (jsonb), `priority`, `status`                                                                                                          | master                         |
| `staff_weekoff_rules`        | a weekly-off rule for a scope                                          | `scope`, `kind` (weekly / dates), `weekdays`, `week_numbers`, `dates`, `status`                                                                                                                  | master                         |
| `staff_shifts`               | a shift                                                                | `code`, `kind` (day / night), `starts_at`, `ends_at`, `grace_minutes`, `present_hours`, `half_day_hours`, `bus_duty`, `late_action`, `status`                                                    | master                         |
| `staff_shift_postings`       | an employee on a shift for a date range                                | `employee_id`, `shift_id`, `from_date`, `to_date`, `status`                                                                                                                                      | master (dated)                 |
| `staff_timings`              | a department's hours (a dated version) or an employee's special timing | `kind`, `department`, `employee_id`, `from_date`, `to_date`, `starts_at`, `ends_at`, `status`                                                                                                    | master (dated)                 |
| `staff_leave_settings`       | the school's leave and attendance settings (one row)                   | `late_marks_per_leave`, `missing_punches_per_leave`, `lop_after_days`, `default_shift_id`, `backdate_days`, `exceptions_from`                                                                    | internal (settings)            |
| `staff_leave_requests`       | one leave application (or one part of a split leave)                   | `number` (LV/2026-27/00001), `employee_id`, `leave_type_id`, `from_date`, `to_date`, `days`, `status`, `source`, `linked_request_id`, `held_month`, `workflow_instance_id`, `cancel_status`      | main (spine for leave)         |
| `staff_leave_days`           | one counted day (or half day) of a request                             | `request_id`, `employee_id`, `day` (unique per request), `portion`, `session`, `kind`, `status`                                                                                                  | detail (count leave days here) |
| `staff_leave_balances`       | one employee × leave type × month ledger line                          | `employee_id`, `leave_type_id`, `month` (unique triple), `opening`, `credited`, `held`, `correction`, `closing`, `lapsed`, `closed`, `imported`, `trail`                                         | main (balances)                |
| `staff_leave_edits`          | an approved leave shortened by the office                              | `request_id`, `old_from/old_to/old_days`, `new_from/new_to/new_days`, `removed`, `reason`                                                                                                        | history                        |
| `staff_leave_counters`       | the last leave number of a financial year                              | PK (`school_id`, `fy`), `last`                                                                                                                                                                   | internal (sequence)            |
| `staff_month_locks`          | a month locked (or unlocked) for payroll                               | PK (`school_id`, `month`), `locked`, `locked_at`, `unlocked_at`, `unlock_reason`                                                                                                                 | internal / history             |
| `staff_punches`              | one punch from any source                                              | `employee_id` (empty while the code is unknown), `code`, `punched_at`, `source`, `device`, `ref`, `read`                                                                                         | detail                         |
| `staff_attendance_days`      | one employee's worked-out day                                          | `employee_id`, `day` (unique pair), `day_type`, `leave_type_id`, `leave_portion`, `shift_id`, `in_at`, `out_at`, `worked_hours`, `ot_hours`, `late_minutes`, `early_minutes`, `manual`, `source` | main (spine for attendance)    |
| `staff_attendance_history`   | one change of a day (before and after)                                 | `employee_id`, `day`, `before`, `after`, `reason`, `changed_by`, `changed_at`                                                                                                                    | history                        |
| `staff_late_marks`           | a late arrival counted for deduction                                   | `employee_id`, `day` (unique pair), `late_minutes`, `status`, `request_id`                                                                                                                       | detail                         |
| `staff_missing_punches`      | a working day with an IN and no OUT                                    | `employee_id`, `day` (unique pair), `missing`, `status`, `request_id`, `mailed_at`                                                                                                               | detail                         |
| `staff_regularisations`      | an attendance correction asked by the employee                         | `employee_id`, `day`, `in_time`, `out_time`, `day_type`, `status`, `workflow_instance_id`                                                                                                        | main                           |
| `staff_attendance_runs`      | a month's late or missing deduction run (done once)                    | PK (`school_id`, `kind`, `month`), `result`, `ran_at`                                                                                                                                            | internal (log)                 |
| `staff_report_exclusions`    | an employee left out of the reports ("Not required")                   | `employee_id`, `status` (active / retired), `reason`                                                                                                                                             | master                         |
| `staff_report_access`        | a report given to a named user                                         | PK (`school_id`, `report`, `user_id`)                                                                                                                                                            | internal (settings)            |
| `staff_timing_log`           | one change of a timing                                                 | `timing_id`, `kind`, `subject`, `action`, `from_date`, `to_date`, `changes`, `changed_at`                                                                                                        | history (log)                  |
| `staff_shift_log`            | one change of a shift posting                                          | `posting_id`, `employee_id`, `shift`, `action`, `from_date`, `to_date`, `changes`, `changed_at`                                                                                                  | history (log)                  |
| `staff_cutover`              | the school's move from the old leave module (one row)                  | `parallel_month`, `freeze_on`, `status`, `read_counts`, `steps`, `switched_at`                                                                                                                   | internal (legacy cut-over)     |
| `staff_legacy_rows`          | one row read from the old module                                       | PK (`school_id`, `tbl`, `legacy_id`), `payload`, `read_id`                                                                                                                                       | internal (legacy cut-over)     |
| `staff_legacy_map`           | what an old row became here                                            | PK (`school_id`, `tbl`, `legacy_id`), `new_id`                                                                                                                                                   | internal (legacy cut-over)     |

Related tables of other modules: `employees` (HR guide), `holidays` (academics: `optional`, `staff_scope`,
`staff_scope_values` for staff), `workflow_instances` / `workflow_steps` (approvals; entity types `staff_leave`,
`staff_leave_cancel`, `staff_regularisation`), `punch_logs` (device pushes, copied into `staff_punches` by a
trigger), `activity_logs` (leave days written into the staff daily log), `files`. There is **no mart** for staff
attendance or leave: `mart.attendance_daily` is students only.

## How the tables join

Spines: **`staff_leave_requests`** (leave applications) with **`staff_leave_days`** (days actually counted);
**`staff_attendance_days`** (one row per employee and day); **`staff_leave_balances`** (balances by month).
For a full calendar of days (including days with no row) use the function **`app.staff_report_days(employee_ids[],
from, to)`**, which the reports use.

Leave:

- `staff_leave_requests.employee_id` → `employees.id`; `.leave_type_id` → `staff_leave_types.id`
- `staff_leave_requests.linked_request_id` → `staff_leave_requests.id` (the loss-of-pay part points at its paid part)
- `staff_leave_requests.workflow_instance_id` → `workflow_instances.id` → `workflow_steps.instance_id` (level, status, `assignee_user_ids[]` → `users.id`)
- `staff_leave_requests.cancel_instance_id` → `workflow_instances.id` (a cancellation's own chain)
- `staff_leave_requests.approval_rule_id` → `staff_leave_approval_rules.id`; `.document_file_id` → `files.id`
- `staff_leave_requests.applied_by / .decided_by / .cancel_raised_by` → `users.id`
- `staff_leave_days.request_id` → `staff_leave_requests.id`; `staff_leave_days.employee_id` → `employees.id`
- `staff_leave_edits.request_id` → `staff_leave_requests.id`
- `staff_leave_balances.employee_id` → `employees.id`; `.leave_type_id` → `staff_leave_types.id`;
  `staff_leave_requests.held_month` = `staff_leave_balances.month` of the row the days are held in
- `staff_leave_policies.leave_type_id`, `staff_leave_approval_rules.leave_type_id` → `staff_leave_types.id`
- Scopes (`scope`, `scope_values`) are text: department / designation names or codes, employee-type values or
  names, employee codes. Test them with `app.staff_in_scope(scope, scope_values, employee_id)`.

Attendance:

- `staff_attendance_days.employee_id` → `employees.id`; `.leave_type_id` → `staff_leave_types.id`; `.shift_id` → `staff_shifts.id`; `.updated_by` → `users.id`
- `staff_attendance_history (employee_id, day)` = `staff_attendance_days (employee_id, day)` (no FK; history survives a day being deleted and remade)
- `staff_punches.employee_id` → `employees.id` (matched by `employees.biometric_id`, else `employee_code`); `staff_punches.ref` = `punch_logs.id` as text for device pushes; punches of a day: `(punched_at AT TIME ZONE 'Asia/Kolkata')::date`
- `staff_late_marks.request_id` / `staff_missing_punches.request_id` → `staff_leave_requests.id` (the deduction they became)
- `staff_late_marks (employee_id, day)`, `staff_missing_punches (employee_id, day)`, `staff_regularisations (employee_id, day)` ↔ `staff_attendance_days (employee_id, day)`
- `staff_regularisations.workflow_instance_id` → `workflow_instances.id`; `.document_file_id` → `files.id`
- `staff_shift_postings.employee_id` → `employees.id`; `.shift_id` → `staff_shifts.id`
- `staff_timings.employee_id` → `employees.id` (special); `staff_timings.department` ↔ `employees.department` (text)
- `staff_shifts.late_leave_type_id / early_leave_type_id`, `staff_timings.late_leave_type_id / early_leave_type_id` → `staff_leave_types.id`
- `staff_leave_settings.default_shift_id` → `staff_shifts.id`
- `staff_shift_log.posting_id` = `staff_shift_postings.id` (not `postings.id`); `staff_timing_log.timing_id` = `staff_timings.id` (no FKs)
- `staff_report_exclusions.employee_id` → `employees.id`; `staff_report_access.user_id` → `users.id`

Out to the backbone: `employees.department` / `designation` (text) for grouping; `postings.reports_to_employee_id`
(this year's posting) for "my team"; `teacher_assignments` for the classes a teacher on leave leaves uncovered.

Cut-over: `staff_legacy_map.new_id` = the id of the new row in the table that matches `tbl` (old table names such
as `al_leave_request` → `staff_leave_requests`, `al_leave_balance` → `staff_leave_balances`, `al_attendance_daily`
→ `staff_attendance_days`, `al_late_mark`, `al_forgot_punch`, `al_regularization`, `al_month_lock`).

## Life-cycles and statuses

**`staff_leave_requests.status`**: pending → approved or rejected; withdrawn (by the employee while pending);
cancelled (by the office, by an approved cancellation request, or the system taking back its own deduction).

- Count leave taken from approved only. Count applications from all but withdrawn (and decide whether to count
  rejected). Pending = waiting at a level (`workflow_steps` at `workflow_instances.current_level`).
- `cancel_status` pending / approved / rejected: a cancellation asked for an approved leave; the leave stays
  approved until the cancellation is approved, then becomes cancelled.
- `source`: self, on_behalf (the office), auto_late, auto_missing (late marks / missing punches turned into
  leave), auto_absent (unexplained absence → loss of pay), auto_rule (a shift's late / early rule), import (from
  the old module). The `auto_*` rows are approved at once.
- `edits` counts shortenings; each is a row in `staff_leave_edits`. History of decisions: the workflow tables and
  `audit_logs`.

**`staff_leave_days.status`** follows its request (pending, approved, rejected, withdrawn, cancelled), except that a
shortened leave keeps its request approved and sets the cut days to cancelled. `kind`: work (a working day),
weekoff, holiday, optional (an off day charged by the sandwich rule or the bridge). `portion` 1 or 0.5 (with
`session` first / second).

**`staff_leave_balances`**: a row opens (at the previous month's effective closing) when first needed or at the
nightly month-end; `closed = false` while the month is open (`closing` is NULL), `closed = true` after the
month-end job (`closing`, `lapsed` set). `imported = true` = an opening balance from the cut-over or an Excel
import (later months are not re-synced over it). `trail` is the text history of each movement.

**`staff_attendance_days.day_type`**: P present, HD half day, A absent, WO weekly off, H holiday, LV leave (with
`leave_type_id` and `leave_portion` 0.5 or 1), HOLD salary hold.

- `source`: punches (worked out), manual / bulk (the office), regularisation (an approved correction), weekoff,
  holiday, absent (the nightly marking), leave (an approved leave), import (cut-over). `manual = true`: set by a
  person; the punches no longer change it.
- A day with no row is "not marked" (never absent). Locked months are never rewritten. Every change goes to
  `staff_attendance_history` (the first write too, `before` NULL).

**`staff_late_marks.status`**: pending (counts towards the month's deduction) → used (turned into leave,
`request_id`), waived (cleared by the office or a correction), lapsed (left over at the month's end, fewer than
`late_marks_per_leave`). **`staff_missing_punches.status`**: pending → used, retired (the day now has both punches
or was corrected), lapsed. `missing` = in / out.

**`staff_regularisations.status`**: pending → approved (the day is set, source regularisation) or rejected;
withdrawn, cancelled. One live (pending or approved) correction per employee and day. Count corrections asked as
all but withdrawn and cancelled.

**`staff_month_locks`**: `locked = true` = payroll lock (no leave or attendance writes into that month); an
unlock keeps the row with `locked = false`, `unlocked_at`, `unlock_reason`.

**Masters**: `staff_leave_types`, `staff_leave_policies`, `staff_leave_approval_rules`, `staff_weekoff_rules`,
`staff_shifts` use `status` active / inactive; `staff_shift_postings`, `staff_timings`,
`staff_report_exclusions` use active / retired. One active policy per type and scope; one active approval rule per
kind, scope and type. A later-starting shift posting wins an overlap.

**`staff_cutover.status`**: setup → parallel (both systems run in `parallel_month`) → switched (old module no
longer read).

**Approval chains** (`staff_leave_approval_rules.bands`): three day bands (0–7, 7–30, 30–365 days; at a boundary
the lower band wins), each up to three levels (named staff, reporting manager, HOD, designation, role, the
employee's L1–L3). The workflow definition is `staff_leave_<rule>_<band>`.

## Amounts, dates and counting rules

- **No money here.** Days only: numeric with halves. `pay_percent` (e.g. half-pay leave 50) and the encashment
  fields on policies are information for payroll.
- **Days of a request**: `staff_leave_requests.days` = sum of its day rows' `portion`, including weekly offs and
  holidays charged by the sandwich. Working days lost = `staff_leave_days` with `kind = 'work'`. A shortened
  leave's `days` is the new count.
- **Split leave**: when the balance is short, the paid part and the loss-of-pay part are two requests; the LOP
  part has `linked_request_id` = the paid part. Count applications with `linked_request_id IS NULL`; count days
  from both.
- **How a balance is computed** (per employee, type and month): `opening` (the month before's effective
  closing, or an import) + `credited` (set in the policy's credit months: the credit for the 3 / 6 / 12 months
  before, pro rata from joining, weighted by attendance when `by_attendance`) + `correction` (office adjustments,
  and days given back after their month closed) − `held` (days of leave **raised** this month, pending or
  approved). Closing = that figure, never below 0; only in the session-end month (the month before the policy's
  `session_start_month`, default April → March) the rest above `carry_cap` (or all of it without carry forward)
  goes to `lapsed`. Available now = `opening + credited + correction − held` of this month's row; read it with
  `app.staff_leave_balance_peek(employee_id, leave_type_id, month)` so a month not yet opened is still answered.
- **Held while pending**: the balance is taken at apply time in the month the leave is raised
  (`held_month`), not in the months the leave falls in. Reject, withdraw, cancel or shorten gives it back to the
  held month while that month is open, else to this month as a `correction`.
- **Only types with `keeps_balance`** have balance rows (CL, EL, SL, HPL, CO by default). OD, WFH, ML, PL and LOP
  have none; limits come from `max_days` / `max_per_month`.
- **Leave year** = financial year (1 April – 31 March): numbers `LV/<FY>/nnnnn`, the register and dashboard figures,
  and the default policy session. Staff leave does not use `academic_year_id`.
- **Dates to group by**: leave taken → `staff_leave_days.day`; leave applied → `staff_leave_requests.created_at`
  (IST date); balances → `staff_leave_balances.month` (first of month); attendance → `staff_attendance_days.day`;
  punches → IST date of `punched_at`. A night shift's day is the day the shift starts (the window runs 13:00 to
  13:00).
- **Times**: `in_at`, `out_at`, `punched_at` are timestamptz (show in Asia/Kolkata); shift and timing times
  (`starts_at`, `ends_at`) and regularisation `in_time` / `out_time` are local clock times without a zone.
- **What counts as present** (the reports' rule, `app.staff_report_days`): P 1, HD 0.5, leave of a type with
  `counts_present` (OD, WFH) 1, half a day of other leave 0.5 (the worked half), everything else 0. Paid leave and
  LOP by portion.
- **Payable days** (the register and payroll feed): days in the month − A − HD/2 − HOLD − loss-of-pay days on the
  register. Not-marked past days are payable until marked.
- **Working days and attendance %** (the reports' note): working days = the days up to yesterday from joining,
  less weekly offs and holidays (not-marked days stay in); attendance % = (present + paid leave) ÷ working days.
- **One row per**: day row per request and day; attendance day per employee and day; balance per employee, type
  and month; late mark and missing punch per employee and day; lock per month; punch per (source, device, code,
  time).
- **Dated versions**: `staff_timings` (department versions by `from_date`/`to_date`, non-overlapping) and
  `staff_shift_postings` (by date range). The shift actually used on a worked-out day is
  `staff_attendance_days.shift_id` (and `trace`).

## Answering report questions

**1. What leave balance does each employee have right now?**

```sql
WITH m AS (SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date AS month)
SELECT e.employee_code, e.display_name, t.code AS leave_type,
       b.opening, b.credited, b.correction, b.held,
       GREATEST(0, b.opening + b.credited + b.correction - b.held) AS available_now
  FROM employees e
  CROSS JOIN m
  JOIN staff_leave_types t ON t.status = 'active' AND t.keeps_balance
  CROSS JOIN LATERAL app.staff_leave_balance_peek(e.id, t.id, m.month) AS b
 WHERE e.deleted_at IS NULL AND e.status = 'active'
 ORDER BY e.display_name, t.sort_order
```

The peek function reads without writing; a month not yet opened shows its would-be opening.

**2. How many days of each leave type were taken this financial year, by department?**

```sql
SELECT COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS department,
       t.code AS leave_type, t.loss_of_pay,
       sum(d.portion) AS days,
       count(DISTINCT d.employee_id) AS staff
  FROM staff_leave_days d
  JOIN staff_leave_requests r ON r.id = d.request_id
  JOIN staff_leave_types t    ON t.id = r.leave_type_id
  JOIN employees e            ON e.id = d.employee_id
 WHERE d.status = 'approved'
   AND d.day BETWEEN date '2026-04-01' AND date '2027-03-31'
   AND e.deleted_at IS NULL
 GROUP BY 1, t.code, t.loss_of_pay, t.sort_order
 ORDER BY 1, t.sort_order
```

Day rows, not requests: a leave across 31 March is split correctly and half days count 0.5.

**3. Who is on leave today?**

```sql
SELECT e.employee_code, e.display_name, e.department, t.code AS leave_type, d.portion, d.session, r.number
  FROM staff_leave_days d
  JOIN staff_leave_requests r ON r.id = d.request_id
  JOIN staff_leave_types t    ON t.id = r.leave_type_id
  JOIN employees e            ON e.id = d.employee_id
 WHERE d.status = 'approved' AND d.kind = 'work'
   AND d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND NOT t.counts_present
 ORDER BY e.department, e.display_name
```

On duty and work from home (`counts_present`) are left out: those staff are working.

**4. Which leave waits for approval, at which level, and on whom?**

```sql
SELECT r.number, e.employee_code, e.display_name, t.code AS leave_type, r.from_date, r.to_date, r.days,
       wi.current_level, s.name AS level_name,
       (SELECT string_agg(u.display_name, ', ') FROM users u WHERE u.id = ANY(s.assignee_user_ids)) AS waiting_on,
       (now()::date - r.created_at::date) AS days_waiting
  FROM staff_leave_requests r
  JOIN employees e          ON e.id = r.employee_id
  JOIN staff_leave_types t  ON t.id = r.leave_type_id
  JOIN workflow_instances wi ON wi.id = r.workflow_instance_id AND wi.status = 'pending'
  LEFT JOIN workflow_steps s ON s.instance_id = wi.id AND s.level = wi.current_level AND s.status = 'pending'
 WHERE r.status = 'pending' AND r.linked_request_id IS NULL
 ORDER BY r.created_at
```

Pending cancellations use `cancel_status = 'pending'` and `cancel_instance_id` the same way.

**5. Monthly attendance summary per employee (for the principal or payroll)**

```sql
SELECT e.employee_code, e.display_name, e.department,
       sum(x.present)                                    AS present_days,
       count(*) FILTER (WHERE x.day_type = 'A')          AS absent,
       count(*) FILTER (WHERE x.day_type = 'HD')         AS half_days,
       count(*) FILTER (WHERE x.day_type IN ('WO', 'H')) AS off_days,
       sum(x.leave)                                      AS paid_leave,
       sum(x.lop)                                        AS loss_of_pay,
       count(*) FILTER (WHERE x.late > 0)                AS late_days,
       count(*) FILTER (WHERE x.day_type IS NULL AND x.joined AND x.day < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS not_marked
  FROM app.staff_report_days(
         ARRAY(SELECT id FROM employees
                WHERE deleted_at IS NULL AND status = 'active'
                  AND NOT EXISTS (SELECT 1 FROM staff_report_exclusions x
                                   WHERE x.employee_id = employees.id AND x.status = 'active')),
         date '2026-10-01', date '2026-10-31') AS x
  JOIN employees e ON e.id = x.employee_id
 GROUP BY e.id, e.employee_code, e.display_name, e.department
 ORDER BY e.display_name
```

The function fills days with no row from the calendar (WO / H) or leaves them NULL (not marked). The "Not required" staff are left out as the reports do.

**6. How many late marks did each employee get this month, and what became of them?**

```sql
SELECT e.employee_code, e.display_name,
       count(*)                                     AS late_marks,
       count(*) FILTER (WHERE m.status = 'pending') AS still_counting,
       count(*) FILTER (WHERE m.status = 'used')    AS turned_into_leave,
       count(*) FILTER (WHERE m.status = 'waived')  AS waived,
       count(*) FILTER (WHERE m.status = 'lapsed')  AS lapsed,
       round(avg(m.late_minutes))                   AS avg_minutes_late
  FROM staff_late_marks m
  JOIN employees e ON e.id = m.employee_id
 WHERE m.day >= date '2026-10-01' AND m.day < date '2026-11-01'
 GROUP BY e.id, e.employee_code, e.display_name
 ORDER BY late_marks DESC
```

Waived marks were cleared; for "late arrivals" exclude them. Bus-duty shifts make no late marks.

**7. Which missing punches are still open?**

```sql
SELECT e.employee_code, e.display_name, mp.day, mp.missing, mp.mailed_at IS NOT NULL AS mailed,
       g.status AS correction_status
  FROM staff_missing_punches mp
  JOIN employees e ON e.id = mp.employee_id
  LEFT JOIN staff_regularisations g ON g.employee_id = mp.employee_id AND g.day = mp.day
        AND g.status IN ('pending', 'approved')
 WHERE mp.status = 'pending'
 ORDER BY mp.day DESC, e.display_name
```

A pending one still counts towards the month's deduction.

**8. How many attendance corrections were asked this month, and decided how?**

```sql
SELECT COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS department,
       count(*)                                        AS asked,
       count(*) FILTER (WHERE g.status = 'approved')   AS approved,
       count(*) FILTER (WHERE g.status = 'rejected')   AS rejected,
       count(*) FILTER (WHERE g.status = 'pending')    AS waiting
  FROM staff_regularisations g
  JOIN employees e ON e.id = g.employee_id
 WHERE g.day >= date '2026-10-01' AND g.day < date '2026-11-01'
   AND g.status NOT IN ('withdrawn', 'cancelled')
 GROUP BY 1
 ORDER BY 1
```

Grouped by the day corrected, not the day asked.

**9. How many loss-of-pay days does each employee have this month? (for payroll)**

```sql
SELECT e.employee_code, e.display_name,
       sum(d.portion)                                                         AS lop_days,
       sum(d.portion) FILTER (WHERE r.source IN ('auto_late', 'auto_missing', 'auto_absent', 'auto_rule')) AS by_system,
       EXISTS (SELECT 1 FROM staff_month_locks l WHERE l.month = date '2026-10-01' AND l.locked) AS month_locked
  FROM staff_leave_days d
  JOIN staff_leave_requests r ON r.id = d.request_id
  JOIN staff_leave_types t    ON t.id = r.leave_type_id AND t.loss_of_pay
  JOIN employees e            ON e.id = d.employee_id
 WHERE d.status = 'approved'
   AND d.day >= date '2026-10-01' AND d.day < date '2026-11-01'
 GROUP BY e.id, e.employee_code, e.display_name
 ORDER BY lop_days DESC
```

From day rows, so deductions for late marks are included even though they do not change the attendance day. Payroll should read a locked month.

**10. Which teachers are on leave today, and which sections do they class-teach? (crosses into academics)**

```sql
SELECT e.display_name, t.code AS leave_type, d.portion, d.session,
       string_agg(DISTINCT k.code || '-' || cs.name, ', ') AS class_teacher_of
  FROM staff_leave_days d
  JOIN staff_leave_requests r ON r.id = d.request_id
  JOIN staff_leave_types t    ON t.id = r.leave_type_id AND NOT t.counts_present
  JOIN employees e            ON e.id = d.employee_id
  JOIN teacher_assignments ta ON ta.employee_id = e.id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL
        AND ta.academic_year_id = app.current_academic_year_id()
  JOIN class_sections cs      ON cs.id = ta.class_section_id
  JOIN classes k              ON k.id = cs.class_id
 WHERE d.status = 'approved' AND d.kind = 'work'
   AND d.day = (now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY e.id, e.display_name, t.code, d.portion, d.session
 ORDER BY e.display_name
```

Leave is by financial year; teacher assignments by academic year: join each on its own year.

**11. When did each employee first punch in today?**

```sql
SELECT e.employee_code, e.display_name,
       to_char(min(p.punched_at) AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS first_in,
       to_char(max(p.punched_at) AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS last_punch,
       count(*) AS punches
  FROM staff_punches p
  JOIN employees e ON e.id = p.employee_id
 WHERE (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY e.id, e.employee_code, e.display_name
 ORDER BY first_in
```

Raw punches include double taps; for the day's IN / OUT use `staff_attendance_days.in_at / out_at`.

**12. Overtime and hours worked per employee in a month**

```sql
SELECT e.employee_code, e.display_name, sh.code AS shift,
       sum(a.ot_hours) AS overtime_hours,
       round(avg(a.worked_hours) FILTER (WHERE a.day_type IN ('P', 'HD')), 2) AS avg_worked_hours,
       count(*) FILTER (WHERE a.manual) AS days_set_by_hand
  FROM staff_attendance_days a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN staff_shifts sh ON sh.id = a.shift_id
 WHERE a.day >= date '2026-10-01' AND a.day < date '2026-11-01'
 GROUP BY e.id, e.employee_code, e.display_name, sh.code
 ORDER BY overtime_hours DESC
```

Overtime is worked out only on present (P) days of a timing with `overtime` on, capped at `overtime_limit` when set.

## Traps

- **Requests vs day rows.** `staff_leave_requests.days` includes sandwiched off days and spans months and
  financial years. For "days taken in a period" sum `staff_leave_days.portion` with `status = 'approved'` and the
  period on `day`. A shortened leave's cut days are cancelled day rows under an approved request.
- **Split leave double counting.** A short balance gives two requests (paid part and LOP part,
  `linked_request_id`). Counting applications without `linked_request_id IS NULL` doubles them.
- **System deductions do not show on the attendance day.** Leave from late marks, missing punches and the shift's
  rule (`source` auto_late, auto_missing, auto_rule) is charged in `staff_leave_days` but the day stays P / HD in
  `staff_attendance_days`. Leave and LOP totals must come from `staff_leave_days`; the register's day codes alone
  undercount them.
- **`held` is not "taken in that month".** The balance ledger holds days in the month the leave was **raised**
  (`held_month`), whatever its dates. Monthly leave-taken figures come from day rows; balances come from the
  ledger.
- **Open months have no `closing`.** `closing` and `lapsed` are filled only when the month closes. For today's
  balance compute `opening + credited + correction − held` (or use the peek function). A month with no row is not
  zero: it opens at the previous effective closing.
- **Lapse only at session end.** Do not expect monthly lapses; `lapsed` is non-zero only in the session-end
  month.
- **Not marked is not absent.** A past day with no `staff_attendance_days` row was never worked out. Do not count
  it as absent; `app.staff_report_days` returns `day_type` NULL for it.
- **Weekly offs and holidays may have no row.** The nightly marking writes WO / H from the month start, but older
  or future days may lack rows; use the function or `app.staff_is_weekoff` / `app.staff_is_holiday` for a calendar.
- **Leave-type flags matter.** `counts_present` (OD, WFH) is present, not absence; `loss_of_pay` is unpaid;
  `pay_percent` < 100 is part pay. Group by these flags, not by code, when codes differ between schools.
- **"Not required" staff.** The school's reports leave out employees in `staff_report_exclusions` (status active).
  Match that, or totals will differ from the app.
- **Punch duplicates.** The same swipe can arrive from the device push and the central pull (different
  `source`), and double taps are separate rows. Never count punches as attendance; use the day rows.
- **Unknown codes.** `staff_punches.employee_id` NULL rows belong to nobody yet; they are worked into days once
  matched.
- **Locked months.** After a lock, days and leave in that month do not change (applying, approving and
  correcting into it are refused). Days given back after their held month closed land in this month's
  `correction`, not in the old month. Unlocked months keep their lock row with `locked = false`.
- **Imported data.** Cut-over rows: requests with `source = 'import'` (numbers kept from the old module or
  `OLD-<id>`), days with `source = 'import'`, balances with `imported = true` up to the month before the
  parallel month. During the parallel month both systems hold leave. `staff_legacy_rows.payload` is the raw old
  row: never report from it.
- **Shift posting is not a posting.** `staff_shift_log.posting_id` points at `staff_shift_postings`, not
  `postings`.
- **Two years.** Leave runs on the financial year; the HR posting and teacher assignments on the academic year.
- **Time zones.** Group punches and `created_at` by the IST date; `staff_attendance_days.day` is already a
  school-day date.
- **Text department.** `staff_timings.department` and every scope value are text matched to the employee's
  department text (or the master's code); a renamed department silently drops out.

## Personal and sensitive data

Mask or never send to an AI model:

- Names come from `employees` (see the HR guide); join for display only.
- `staff_leave_requests.reason`, `note`, `decision_note`, `cancel_reason`, `document_file_id` (sick notes,
  medical certificates, family reasons); `staff_leave_edits.reason`.
- `staff_regularisations.reason`, `decision_note`, `document_file_id`; `staff_late_marks.reason`,
  `staff_missing_punches.reason`; `staff_attendance_days.remark`, `trace`; `staff_attendance_history.before`,
  `after`, `reason` (a full day row, including in / out times).
- Movement data: `staff_punches` (`code` = the biometric card id, `punched_at`, `device`),
  `staff_attendance_days.in_at`, `out_at`, `worked_hours`, `late_minutes`, `early_minutes`: who was where and
  when. Aggregate before sharing.
- Leave types such as maternity leave and sick leave reveal health and family facts: do not list them by name
  outside HR.
- `staff_report_exclusions.reason`; `staff_shift_log.subject` and `staff_timing_log.subject` (name and code as
  text).
- Cut-over: `staff_legacy_rows.payload` (raw rows of the old module, may hold names, reasons and attachments'
  paths); `staff_cutover.read_error`, `steps`.
- `staff_leave_settings.missing_punch_cc` (e-mail addresses) and `device_serials`.
