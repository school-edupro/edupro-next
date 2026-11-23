# Hostel — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

A school sets up hostels, blocks, room types (each with a hostel fee group), rooms, beds and wardens. A boarder
holds a bed from a date; a move or leaving ends that stay, and every stay is kept. Wardens take roll-calls by session;
the mess marks skipped meals, keeps diets and allergies, and parents rate meals. Wardens approve visitors and log
incidents; home leave and outings are gate passes. A boarder leaves through a hostel withdrawal (parent request,
room check-out, approval levels, bed freed, fee stopped; it can be revoked). The hostel fee is billed by the fees
module on the `hostel` ledger, each month by the bed held that month.

## Tables

| Table                          | One row is                                                    | Key columns                                                                                                                                                            | For reports                                               |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `hostels`                      | a hostel building of the school                               | `code` (unique per school), `name`, `gender` boys/girls/mixed, `status` active/closed, `menu_cycle_weeks`, `menu_cycle_start`                                          | master                                                    |
| `hostel_blocks`                | a block (wing) of a hostel                                    | `hostel_id`, `name` (unique per hostel), `floors`                                                                                                                      | master                                                    |
| `hostel_room_types`            | a kind of room (2-seater AC…)                                 | `name`, `seater`, `ac`, `fee_group` (the hostel fee group), `status`                                                                                                   | master                                                    |
| `hostel_rooms`                 | a room                                                        | `hostel_id`, `block_id` (optional), `floor` (0 = ground), `room_no` (unique per hostel), `room_type_id`, `status` active/maintenance/closed                            | master                                                    |
| `hostel_beds`                  | a bed in a room                                               | `room_id`, `label` (A, B…; unique per room), `status` active/blocked                                                                                                   | master                                                    |
| `hostel_wardens`               | a warden posted to a hostel                                   | `hostel_id`, `employee_id` (unique pair), `is_head`                                                                                                                    | master                                                    |
| `hostel_allotments`            | one stay of one boarder on one bed                            | `student_id`, `bed_id`, `from_date`, `to_date` (NULL = open), `kind` allot/transfer, `end_reason` transfer/vacate/withdrawn                                            | **main (spine)**                                          |
| `hostel_rollcall_sessions`     | a roll-call slot of a hostel (Morning 06:30…)                 | `hostel_id`, `name`, `at_time`, `active`                                                                                                                               | master                                                    |
| `hostel_rollcalls`             | one roll taken for a session on a day                         | `session_id`, `on_date` (unique pair), `taken_by`, `taken_at`                                                                                                          | main                                                      |
| `hostel_rollcall_marks`        | one boarder's mark in a roll                                  | `rollcall_id`, `student_id` (unique pair), `bed_id`, `status` present/absent/on_leave/sick, `alerted_at`                                                               | detail                                                    |
| `hostel_settings`              | the school's hostel rules (one row)                           | PK `school_id`; `late_grace_minutes`, `escalate_after_hours`, `outing_return_by`, `alert_parent_absent`                                                                | internal (settings)                                       |
| `mess_meals`                   | a meal of the school (Breakfast, Lunch…)                      | `name`, `at_time`, `sort_order`, `active`                                                                                                                              | master                                                    |
| `hostel_meals`                 | a meal as one hostel serves it                                | `hostel_id`, `name` (unique per hostel), `at_time`, `mess_meal_id` → the school meal, `active`                                                                         | master                                                    |
| `hostel_menu`                  | what a meal serves on a weekday of a cycle week               | `meal_id`, `cycle_week` 1–4, `weekday` 0–6 (0 = Sunday), `items`                                                                                                       | master                                                    |
| `hostel_menu_changes`          | a one-off menu for a meal on a date                           | `meal_id`, `on_date` (unique pair), `items`, `note`                                                                                                                    | detail                                                    |
| `hostel_meal_marks`            | a meal marked on a day                                        | `meal_id`, `on_date` (unique pair), `served` (cached count), `taken_by`                                                                                                | main                                                      |
| `hostel_meal_skips`            | a boarder who skipped a marked meal                           | `mark_id`, `student_id` (unique pair), `reason`                                                                                                                        | detail                                                    |
| `hostel_meal_feedback`         | a parent's rating of a meal a child had                       | `meal_id`, `on_date`, `student_id`, `by_user` (unique set), `rating` 1–5, `comment`                                                                                    | main                                                      |
| `hostel_diets`                 | the diet kept for a boarder                                   | PK `student_id`; `diet` (a `mess_diet_types.code`), `no_onion_garlic`, `allergies` text[] (allergy names), `notes`                                                     | detail                                                    |
| `mess_diet_types`              | a diet the school offers                                      | `code` (unique per school), `name`, `is_default` (one per school), `active`                                                                                            | master                                                    |
| `mess_allergies`               | an allergy name the school lists                              | `name`, `active`                                                                                                                                                       | master                                                    |
| `hostel_visitors`              | a person on a boarder's approved-visitor list                 | `student_id`, `name`, `relation`, `mobile`, `status` pending/approved/rejected/removed, `source` parent/office                                                         | main                                                      |
| `hostel_visitor_photos`        | the photo of a listed visitor                                 | PK `visitor_id`; `content_type`, `bytes`                                                                                                                               | internal (binary)                                         |
| `hostel_visit_hours`           | a visiting window of a hostel on a weekday                    | `hostel_id`, `weekday` 0–6, `from_time`, `to_time`                                                                                                                     | master                                                    |
| `hostel_incidents`             | an incident about a boarder                                   | `student_id`, `hostel_id`, `occurred_at`, `category`, `severity` minor/serious, `status` open/follow_up/closed, `tell_parent`, `parent_told_at`                        | main                                                      |
| `hostel_incident_notes`        | a dated follow-up note on an incident                         | `incident_id`, `body`, `status_to` (the status it moved to, or NULL), `by_user`, `at`                                                                                  | history                                                   |
| `hostel_exit_requests`         | a parent's request that the child leave the hostel            | `student_id`, `leaving_on`, `reason`, `status` pending/started/declined/withdrawn, `withdrawal_id`                                                                     | main                                                      |
| `hostel_withdrawals`           | a boarder leaving the hostel (staying in school)              | `student_id`, `academic_year_id`, `allotment_id`, `leaving_on`, `reason`, `status`, `fee_choice` carry/refund, `fee_until`, `damage_charge`, `mess_charge`, `revoke_*` | main                                                      |
| `hostel_withdrawal_checkout`   | one room item checked at a withdrawal                         | `withdrawal_id`, `item_name` (unique pair), `condition` ok/missing/damaged, `charge`                                                                                   | detail                                                    |
| `hostel_checkout_items`        | the school's room check-out list (bed, keys…)                 | `name`, `charge` (for one missing/damaged), `sort_order`, `active`                                                                                                     | master                                                    |
| `hostel_withdrawal_clearances` | a department step of a hostel withdrawal (first design, 0153) | `withdrawal_id`, `department` (unique pair), `step`, `status` clearance_status, `dues`, `charge`                                                                       | history (legacy: no longer written by the API since 0158) |
| `hostel_fee_gaps`              | months a boarder was away between two stays (not billed)      | `student_id`, `academic_year_id`, `from_month`, `to_month`, `withdrawal_id`                                                                                            | internal (fee rule)                                       |
| `fee_hostel_calendars`         | the hostel fee calendar of a year                             | `academic_year_id` (unique), `mode` school/own, `pay_plan`, `late_mode` slab/daywise/none, `late_per_day`, `late_max`                                                  | master (fee set-up)                                       |
| `fee_hostel_period_rules`      | the hostel dates and late fee of one fee month                | `period_id` (unique) → `fee_periods`, `due_on`, `start_on`, `challan_on`, late slabs, `fee_pay`, `show`                                                                | master (fee set-up)                                       |

34 tables.

## How the tables join

**Spine: `hostel_allotments`.** Almost every "who is in the hostel" question starts here.

Place of a stay:

- `hostel_allotments.bed_id → hostel_beds.id`
- `hostel_beds.room_id → hostel_rooms.id`
- `hostel_rooms.hostel_id → hostels.id`
- `hostel_rooms.block_id → hostel_blocks.id` (LEFT JOIN: a room may have no block)
- `hostel_rooms.room_type_id → hostel_room_types.id`
- `hostel_blocks.hostel_id → hostels.id`

Out to the backbone:

- `hostel_allotments.student_id → students.id`
- `students.id → enrolments.student_id` (pick the year) `→ class_sections.id → classes.id`
- `hostel_wardens.employee_id → employees.id`; `employees.user_id → users.id`
- `hostel_*.taken_by / recorded_by / decided_by / by_user / created_by / acted_by → users.id` (no FK; user ids)

Roll-call:

- `hostel_rollcall_sessions.hostel_id → hostels.id`
- `hostel_rollcalls.session_id → hostel_rollcall_sessions.id`
- `hostel_rollcall_marks.rollcall_id → hostel_rollcalls.id`
- `hostel_rollcall_marks.student_id → students.id`; `hostel_rollcall_marks.bed_id → hostel_beds.id` (the bed held then)

Mess:

- `hostel_meals.hostel_id → hostels.id`; `hostel_meals.mess_meal_id → mess_meals.id`
- `hostel_menu.meal_id → hostel_meals.id`; `hostel_menu_changes.meal_id → hostel_meals.id`
- `hostel_meal_marks.meal_id → hostel_meals.id`; `hostel_meal_skips.mark_id → hostel_meal_marks.id`
- `hostel_meal_skips.student_id → students.id`
- `hostel_meal_feedback.meal_id → hostel_meals.id`; `hostel_meal_feedback.student_id → students.id`; `by_user → users.id` (the parent)
- `hostel_diets.student_id → students.id`; `hostel_diets.diet = mess_diet_types.code` (text match, no FK);
  `mess_allergies.name = ANY (hostel_diets.allergies)` (names, no FK)

Visitors and visits:

- `hostel_visitors.student_id → students.id`; `hostel_visitor_photos.visitor_id → hostel_visitors.id`
- `hostel_visit_hours.hostel_id → hostels.id`
- A visit is a row of the visitor register (other module): `visitor_log.hostel_id → hostels.id`,
  `visitor_log.student_id → students.id`, `visitor_log.hostel_visitor_id → hostel_visitors.id`
  (`hostel_listed`, `hostel_in_hours`, `warden_decision` allowed/refused).

Incidents and complaints:

- `hostel_incidents.student_id → students.id`; `hostel_incidents.hostel_id → hostels.id`
- `hostel_incident_notes.incident_id → hostel_incidents.id`
- `hostel_incidents.file_ids` / `hostel_incident_notes.file_ids` (bigint[]) → `files.id`
- Hostel complaints are helpdesk tickets (other module): `parent_queries.hostel_id → hostels.id`,
  `parent_queries.hostel_room_id → hostel_rooms.id`, with `desk = 'hostel'`.

Leave and outings (other module, gate passes):

- `gate_passes.student_id → students.id` with `kind IN ('hostel_home', 'hostel_outing')`; the hostel of the pass is
  `app.hostel_of(student_id, day)` (no column).

Withdrawal:

- `hostel_exit_requests.student_id → students.id`; `hostel_exit_requests.withdrawal_id → hostel_withdrawals.id`
- `hostel_withdrawals.allotment_id → hostel_allotments.id` (the stay it ends)
- `hostel_withdrawals.exit_request_id → hostel_exit_requests.id`
- `hostel_withdrawals.academic_year_id → academic_years.id`; `student_id → students.id`
- `hostel_withdrawals.workflow_instance_id / revoke_workflow_instance_id → workflow_instances.id`
  (`entity_type = 'hostel_withdrawal'`) `→ workflow_steps.instance_id`
- `hostel_withdrawals.damage_misc_fee_id / mess_misc_fee_id → misc_fees.id` (charges raised as misc fees)
- `hostel_withdrawals.revoke_bed_id → hostel_beds.id`
- `hostel_withdrawal_checkout.withdrawal_id → hostel_withdrawals.id`; `item_id → hostel_checkout_items.id`
- `hostel_withdrawal_clearances.withdrawal_id → hostel_withdrawals.id`; `department_id → withdrawal_departments.id`;
  `charge_misc_fee_id → misc_fees.id`
- `fee_refunds.hostel_withdrawal_id → hostel_withdrawals.id` (refund of hostel months paid after the leaving month)
- `hostel_fee_gaps.withdrawal_id → hostel_withdrawals.id`; `student_id → students.id`; `academic_year_id → academic_years.id`
- A boarder's **school** withdrawal: `student_withdrawals.revoke_hostel_bed_id → hostel_beds.id`; it ends the stay
  with `end_reason = 'withdrawn'`.

Hostel fee (fees module):

- `fee_demands` with `ledger = 'hostel'` are the hostel bills (`student_id`, `academic_year_id`, `period_id → fee_periods.id`).
- `student_fee_profiles(student_id, academic_year_id)`: `hosteller`, `hostel_from`, `hostel_to` (first and last
  month), `hostel_fee_group`, `hostel_pay_plan`, `opening_hostel`, `opening_late_hostel`.
- `hostel_room_types.fee_group` = `fee_structures.fee_group` of the hostel heads (text match).
- `fee_hostel_calendars.academic_year_id → academic_years.id`; `fee_hostel_period_rules.period_id → fee_periods.id`.

## Life-cycles and statuses

**Allotment (a stay).** No status column: the dates are the status.

- Open stay: `to_date IS NULL`. At most one open stay per boarder and per bed (partial unique indexes).
- On a day D the boarder holds the bed when `from_date <= D AND (to_date IS NULL OR to_date >= D)`. This is the
  rule the API uses everywhere (`app.hostel_of`, the occupancy board). A `to_date` in the future means "staying,
  leaves on that day"; a `from_date` in the future means "booked, not in yet".
- `kind`: `allot` (first stay) or `transfer` (a stay that began by moving from another bed).
- Ending: `end_reason` `transfer` (moved; the old row ends the day before the new one starts), `vacate` (left the
  hostel: by hand or by a completed hostel withdrawal), `withdrawn` (left the school: school withdrawal or an
  admission cancellation). `ended_at` / `ended_by` record when it was keyed.
- A move on the very day the stay began does not end the row: `bed_id` is changed in place.
- A revoke "as if never left" re-opens the same row (`to_date`, `end_reason` set back to NULL). A revoke "from a
  date" adds a new row and a `hostel_fee_gaps` row for the months away.
- The history is the rows themselves (plus `audit_logs`).

**Hostel** `status`: active, closed. **Room** `status`: active, maintenance, closed (closed rooms are left off the
board). **Bed** `status`: active, blocked (not offered for allotment). **Room type** `status`: active, inactive.
Usable capacity = active beds in active rooms of active hostels.

**Roll-call mark** `status`: present, absent, on_leave, sick.

- A pupil out on hostel leave (gate pass state `out`) is saved as `on_leave` by the system; a warden cannot mark
  someone `on_leave` who is not away (it is saved as absent).
- Present % (the API's register): present ÷ (present + absent + sick); `on_leave` is left out.
- A newly absent boarder is alerted once: `alerted_at` is set when the parent / head warden were told.
- One roll per session per day (`UNIQUE (session_id, on_date)`); saving again replaces the marks.

**Meal marks.** A mark row means the meal was taken on that day. `served` = boarders holding a bed that day and not
away on leave at the meal's time, minus the skips. It is computed when saved and cached.

**Diet.** No row in `hostel_diets` = the school's default diet (`mess_diet_types.is_default`, else `veg`), no
allergies.

**Visitor** `status`: pending (a parent added, waiting for a warden), approved (the office adds approved), rejected,
removed (taken off the list; kept). At most one pending/approved row per boarder and mobile. Count the list with
`status = 'approved'`. Parents and guardians on the student record count as approved without a row.

**Visit** (`visitor_log`): `state` waiting/inside/left/cancelled; `warden_decision` allowed/refused only when the
visitor was not on the list or came outside the hours.

**Incident** `status`: open → follow_up → closed (`closed_at` is set exactly when closed; a check enforces it).
Minor incidents recorded before 0162 were closed with the remark "Recorded before the follow-up register". Each
`hostel_incident_notes` row may move the status (`status_to`); the notes are the history. `category`: discipline,
health, safety, property, other. `severity`: minor, serious.

**Exit request** `status`: pending (one at a time per pupil) → started (the office started a withdrawal from it;
`withdrawal_id` set) or declined (`decline_note`) or withdrawn (the parent took it back).

**Hostel withdrawal** `status`:

- `requested`: started, waiting for its approval levels (or for the office to complete when levels are off).
- `cleared`: approved / cleared, still to complete (rare since approval levels complete it on the last approval).
- `completed`: the bed was given up on `leaving_on`, the hostel fee stops after `fee_until` (first day of the
  last month charged; one month more when `notice_short`), paid later months carried forward or refunded
  (`fee_choice`), damages and mess dues raised as misc fees.
- `rejected`: not approved; the pupil keeps the bed.
- `cancelled`: called off (`cancelled_at`, `cancel_reason`).
- `revoked`: a completed withdrawal undone (the pupil is back).
- At most one `requested`/`cleared` withdrawal per pupil.
- Revoke sub-status `revoke_status`: pending → approved (then `status` becomes `revoked`) or rejected (the
  withdrawal stands). `revoke_mode`: continue (same stay, months away charged) or from_date (new stay from
  `revoke_from`, months away not charged).
- Approval history: `workflow_instances` / `workflow_steps` of the instance ids.
- For "pupils who left the hostel" count `status = 'completed'` only (a revoked one came back).

**Withdrawal clearance** (`hostel_withdrawal_clearances.status`, enum clearance_status): pending, cleared, hold.
Only withdrawals made under the first design (before 0158) have these rows.

**Checkout line** `condition`: ok, missing, damaged; the sum of `charge` became `damage_charge`.

**Hostel fee calendar** `mode`: school (hostel instalments follow the class calendar) or own (own `pay_plan`, dates
and late fee in `fee_hostel_period_rules`). `late_mode`: slab, daywise, none. No row = school mode.

## Amounts, dates and counting rules

- **Money in this module:** `hostel_withdrawals.damage_charge`, `mess_charge` (entered at the start; become misc
  fees on completion), `hostel_withdrawal_checkout.charge`, `hostel_checkout_items.charge`,
  `hostel_withdrawal_clearances.dues` / `charge` (legacy), and the fee calendar's late fee amounts. All are rupees,
  zero or more.
- **The hostel fee is not here.** It is `fee_demands` with `ledger = 'hostel'` (net after discount, `paid` so far).
  Count demand rows with `status IN ('pending', 'partial', 'paid')`, as `mart.fee_dues` does. A month is billed
  when the pupil's fee profile says hosteller and the month is inside `hostel_from`–`hostel_to` and not inside a
  `hostel_fee_gaps` row; the price comes from the room type's `fee_group` of the bed held that month.
  `mart.fee_forecast` has a `ledger` column (expected / collected by class and month): use it for hostel fee
  totals; `mart.fee_dues` mixes all ledgers.
- **Damage / mess charges actually raised:** `misc_fee_students` lines of the misc fees in
  `damage_misc_fee_id` / `mess_misc_fee_id` (paid, status). The withdrawal columns are what was entered.
- **Dates to group by:** stays by `from_date` / `to_date`; roll-calls by `hostel_rollcalls.on_date`; meals by
  `hostel_meal_marks.on_date`; feedback by `on_date` (the meal's day, not `created_at`); incidents by
  `(occurred_at AT TIME ZONE 'Asia/Kolkata')::date`; withdrawals by `leaving_on` (when they left) or
  `requested_on` (when asked); visits by `(visitor_log.created_at AT TIME ZONE 'Asia/Kolkata')::date`.
- **Year:** stays, roll-calls, meals and incidents are dated, not tied to an academic year. Withdrawals, fee gaps
  and fee calendars carry `academic_year_id`. For "this year" filter dates by `academic_years.start_date` /
  `end_date`. Hostel fees follow the academic year of the fee demand.
- **One row per:** stay (not per pupil — a pupil with two moves has three rows); roll per session and day; mark per
  roll and pupil; meal mark per meal and day; skip per mark and pupil; diet per pupil (current only, no history);
  feedback per meal, day, pupil and parent user (two parents can rate the same meal).
- **Boarders on a day** = distinct `student_id` with a stay covering the day. **Boarders in a month** = stays
  with `from_date <= last day` and `to_date IS NULL OR to_date >= first day`.
- **Menu of a date:** `hostel_menu_changes` for that meal and date if present, else `hostel_menu` for the
  weekday (`extract(dow …)`, 0 = Sunday) and cycle week `((date − hostels.menu_cycle_start) / 7) % menu_cycle_weeks + 1`.

## Answering report questions

**1. How many beds are full and free in each hostel today?**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d)
SELECT h.code, h.name,
       count(b.id) FILTER (WHERE b.status = 'active' AND r.status = 'active') AS usable_beds,
       count(a.id) AS occupied,
       count(b.id) FILTER (WHERE b.status = 'active' AND r.status = 'active' AND a.id IS NULL) AS free_beds
  FROM hostels h
  JOIN hostel_rooms r ON r.hostel_id = h.id
  JOIN hostel_beds b ON b.room_id = r.id
  CROSS JOIN today
  LEFT JOIN hostel_allotments a ON a.bed_id = b.id
        AND a.from_date <= today.d AND (a.to_date IS NULL OR a.to_date >= today.d)
 WHERE h.status = 'active'
 GROUP BY h.id, h.code, h.name
 ORDER BY h.name
```

Note: "today" is India time; at most one stay covers a bed on a day.

**2. How many boarders does each class have (crosses into academics)?**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
     yr AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.display_order, k.name AS class, h.name AS hostel, count(DISTINCT a.student_id) AS boarders
  FROM hostel_allotments a
  CROSS JOIN today
  JOIN hostel_beds b ON b.id = a.bed_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostels h ON h.id = r.hostel_id
  JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
  JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = (SELECT id FROM yr) AND e.status = 'active'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE a.from_date <= today.d AND (a.to_date IS NULL OR a.to_date >= today.d)
 GROUP BY k.display_order, k.name, h.name
 ORDER BY k.display_order, h.name
```

Note: in the app, use the selected year instead of the `yr` guess.

**3. Roll-call totals per day and session for a month.**

```sql
SELECT rc.on_date, h.name AS hostel, ss.name AS session,
       count(m.id) FILTER (WHERE m.status = 'present')  AS present,
       count(m.id) FILTER (WHERE m.status = 'absent')   AS absent,
       count(m.id) FILTER (WHERE m.status = 'on_leave') AS on_leave,
       count(m.id) FILTER (WHERE m.status = 'sick')     AS sick
  FROM hostel_rollcalls rc
  JOIN hostel_rollcall_sessions ss ON ss.id = rc.session_id
  JOIN hostels h ON h.id = ss.hostel_id
  LEFT JOIN hostel_rollcall_marks m ON m.rollcall_id = rc.id
 WHERE rc.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
 GROUP BY rc.on_date, h.name, ss.name, ss.at_time
 ORDER BY rc.on_date, h.name, ss.at_time
```

Note: a session with no roll that day has no `hostel_rollcalls` row (not "all present").

**4. Which boarders were absent at three or more roll-calls this month, and their present %?**

```sql
SELECT s.admission_no, s.display_name,
       count(*) FILTER (WHERE m.status = 'present') AS present,
       count(*) FILTER (WHERE m.status = 'absent')  AS absent,
       count(*) FILTER (WHERE m.status = 'sick')    AS sick,
       count(*) FILTER (WHERE m.status = 'on_leave') AS on_leave,
       round(100.0 * count(*) FILTER (WHERE m.status = 'present')
             / NULLIF(count(*) FILTER (WHERE m.status <> 'on_leave'), 0), 1) AS present_pct
  FROM hostel_rollcall_marks m
  JOIN hostel_rollcalls rc ON rc.id = m.rollcall_id
  JOIN students s ON s.id = m.student_id
 WHERE rc.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
 GROUP BY s.id, s.admission_no, s.display_name
HAVING count(*) FILTER (WHERE m.status = 'absent') >= 3
 ORDER BY absent DESC
```

Note: leave is left out of the percentage, as on the hostel register.

**5. Meals served and skipped in the last week.**

```sql
SELECT k.on_date, h.name AS hostel, mm.name AS meal, k.served,
       (SELECT count(*) FROM hostel_meal_skips sk WHERE sk.mark_id = k.id) AS skipped
  FROM hostel_meal_marks k
  JOIN hostel_meals hm ON hm.id = k.meal_id
  JOIN hostels h ON h.id = hm.hostel_id
  LEFT JOIN mess_meals mm ON mm.id = hm.mess_meal_id
 WHERE k.on_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7
 ORDER BY k.on_date, h.name, hm.at_time
```

Note: `served` already excludes skips and boarders away on leave; do not subtract the skips again.

**6. The kitchen's diet list today: boarders per diet in each hostel.**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
     def AS (SELECT COALESCE((SELECT code FROM mess_diet_types WHERE is_default LIMIT 1), 'veg') AS code)
SELECT h.name AS hostel, COALESCE(d.diet, def.code) AS diet, t.name AS diet_name,
       count(*) AS boarders,
       count(*) FILTER (WHERE d.no_onion_garlic) AS no_onion_garlic,
       count(*) FILTER (WHERE cardinality(d.allergies) > 0) AS with_allergy
  FROM hostel_allotments a
  CROSS JOIN today CROSS JOIN def
  JOIN hostel_beds b ON b.id = a.bed_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostels h ON h.id = r.hostel_id
  LEFT JOIN hostel_diets d ON d.student_id = a.student_id
  LEFT JOIN mess_diet_types t ON t.code = COALESCE(d.diet, def.code)
 WHERE a.from_date <= today.d AND (a.to_date IS NULL OR a.to_date >= today.d)
 GROUP BY h.name, COALESCE(d.diet, def.code), t.name
 ORDER BY h.name, boarders DESC
```

Note: a boarder with no diet row eats the default diet. The kitchen screen also shows the medical note in
`students.profile->>'medical_condition'` (health data: keep it out of AI prompts).

**7. Incidents this session by hostel, category and severity; how many are still open.**

```sql
SELECT h.name AS hostel, i.category, i.severity,
       count(*) FILTER (WHERE i.status <> 'closed') AS still_open,
       count(*) FILTER (WHERE i.status = 'closed')  AS closed,
       count(*) FILTER (WHERE i.tell_parent AND i.parent_told_at IS NULL) AS parent_not_told_yet
  FROM hostel_incidents i
  JOIN hostels h ON h.id = i.hostel_id
 WHERE (i.occurred_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY h.name, i.category, i.severity
 ORDER BY h.name, i.category, i.severity
```

**8. Hostel withdrawals by year, reason and status, with the charges entered.**

```sql
SELECT y.name AS year, w.reason, w.status,
       count(*) AS withdrawals,
       sum(w.damage_charge) AS damage_charges,
       sum(w.mess_charge) AS mess_charges,
       count(*) FILTER (WHERE w.notice_short) AS short_notice,
       count(*) FILTER (WHERE w.fee_choice = 'refund' AND w.status = 'completed') AS refunded
  FROM hostel_withdrawals w
  JOIN academic_years y ON y.id = w.academic_year_id
 GROUP BY y.name, y.start_date, w.reason, w.status
 ORDER BY y.start_date DESC, w.reason, w.status
```

Note: "left the hostel" = `completed`; `revoked` came back; `rejected` and `cancelled` never left.

**9. Hostel fee still due per boarder this year (crosses into fees).**

```sql
WITH yr AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT s.admission_no, s.display_name, k.name AS class,
       sum(d.net) AS hostel_billed, sum(d.paid) AS hostel_paid, sum(d.net - d.paid) AS hostel_due,
       sum(d.net - d.paid) FILTER (WHERE d.due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue
  FROM fee_demands d
  JOIN students s ON s.id = d.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
  LEFT JOIN enrolments e ON e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id AND e.status = 'active'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE d.academic_year_id = (SELECT id FROM yr) AND d.ledger = 'hostel'
   AND d.status IN ('pending', 'partial', 'paid')
 GROUP BY s.id, s.admission_no, s.display_name, k.name, k.display_order
HAVING sum(d.net - d.paid) > 0
 ORDER BY k.display_order, s.display_name
```

Note: the hostel late fine is worked out by `app.late_fee(…, 'hostel')`; only last year's carried fine is a demand
line (head code `PREVLATEH`). See the fees guide.

**10. School-day absence of boarders against day scholars this month (crosses into attendance).**

```sql
WITH boarders AS (
  SELECT DISTINCT a.student_id FROM hostel_allotments a
   WHERE a.from_date <= DATE '2026-11-30' AND (a.to_date IS NULL OR a.to_date >= DATE '2026-11-01'))
SELECT k.name AS class, (b.student_id IS NOT NULL) AS boarder,
       count(*) AS marks,
       count(*) FILTER (WHERE m.code = 'A') AS absent,
       round(100.0 * count(*) FILTER (WHERE m.code = 'A') / NULLIF(count(*), 0), 1) AS absent_pct
  FROM attendance_sessions se
  JOIN attendance_marks m ON m.session_id = se.id
  JOIN class_sections cs ON cs.id = se.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN boarders b ON b.student_id = m.student_id
 WHERE se.kind = 'day' AND se.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
 GROUP BY k.name, k.display_order, (b.student_id IS NOT NULL)
 ORDER BY k.display_order, boarder
```

Note: `mart.attendance_daily` is per section and cannot split boarders, so this reads the base tables.

**11. Who is out on hostel leave or an outing right now, and who is overdue (crosses into gate passes)?**

```sql
SELECT g.pass_no, g.kind, s.admission_no, s.display_name,
       h.name AS hostel, g.out_at, g.return_by,
       (g.return_by < now()) AS overdue, g.overdue_at, g.escalated_at
  FROM gate_passes g
  JOIN students s ON s.id = g.student_id
  LEFT JOIN hostels h ON h.id = app.hostel_of(g.student_id, (now() AT TIME ZONE 'Asia/Kolkata')::date)
 WHERE g.kind IN ('hostel_home', 'hostel_outing') AND g.state = 'out'
 ORDER BY g.return_by NULLS LAST
```

Note: the school counts a pupil late only after `hostel_settings.late_grace_minutes`; `overdue_at` is set by the
worker when the alert went out.

**12. Hostel visits in the last 30 days: off-list, outside hours, refused.**

```sql
SELECT h.name AS hostel, (v.created_at AT TIME ZONE 'Asia/Kolkata')::date AS on_day,
       count(*) AS visits,
       count(*) FILTER (WHERE v.hostel_listed IS FALSE) AS not_on_list,
       count(*) FILTER (WHERE v.hostel_in_hours IS FALSE) AS outside_hours,
       count(*) FILTER (WHERE v.warden_decision = 'refused') AS refused
  FROM visitor_log v
  JOIN hostels h ON h.id = v.hostel_id
 WHERE v.hostel_id IS NOT NULL AND v.state <> 'cancelled'
   AND v.created_at >= now() - interval '30 days'
 GROUP BY h.name, (v.created_at AT TIME ZONE 'Asia/Kolkata')::date
 ORDER BY on_day DESC, h.name
```

## Traps

- **Current occupant is a date test, not `to_date IS NULL`.** A stay with a future `to_date` is still current; a
  stay with a future `from_date` is not yet. Use `from_date <= D AND (to_date IS NULL OR to_date >= D)`.
- **"Today" is India time.** The database clock is not; use `(now() AT TIME ZONE 'Asia/Kolkata')::date`. Several
  API queries use `CURRENT_DATE`, which can be a day off around midnight.
- **One pupil, many stays.** Counting `hostel_allotments` rows counts stays, not boarders; use
  `count(DISTINCT student_id)`.
- **Same-day moves leave no trace.** A transfer on the day the stay began rewrites `bed_id`; the old bed is only in
  `audit_logs`.
- **Revoke rewrites history.** A revoke "as if never left" re-opens the ended stay; a report of "left in October"
  run later will no longer see that pupil.
- **`end_reason = 'vacate'` covers both a hand vacate and a completed hostel withdrawal;** `withdrawn` means the
  pupil left the school, not the hostel withdrawal. Join `hostel_withdrawals.allotment_id` to tell them apart.
- **`hosteller` on the fee profile is not the same as holding a bed.** The fee profile follows the stays, but a pupil
  can be marked hosteller and still wait for a bed (the "waiting for a bed" list). Use allotments for occupancy,
  fee profile + `fee_demands` for billing.
- **Hostel fee ≠ school fee.** Always filter `fee_demands.ledger = 'hostel'`; `mart.fee_dues` and most fee totals
  mix ledgers.
- **Cached counts:** `hostel_meal_marks.served` is fixed when the meal is saved (later leave or a late allotment does
  not change it). `hostel_withdrawals.damage_charge` is what was entered; what is owed is the misc fee line.
- **No roll is not "all present".** A missing `hostel_rollcalls` row means the roll was not taken.
- **Diet defaults.** Missing `hostel_diets` row = default diet; a diet code may name an inactive diet type.
  Allergy names in `hostel_diets.allergies` are text, matched to `mess_allergies.name` by name.
- **Two meal lists.** `hostel_meals` is per hostel (marks, menu, feedback hang on it); `mess_meals` is the school
  list it points to. Group by `mess_meal_id` to compare hostels.
- **`hostel_withdrawal_clearances` is legacy** (first design). Since 0158 withdrawals use approval levels
  (`workflow_instances`); do not read "pending clearances" from it.
- **Wardens see their own hostels in the API only** (`hostel_wardens`); the database rule is per school. A report for
  a warden must filter by the warden's hostels itself.
- **Merged and deleted students:** merges move hostel rows to the kept record, but still join `students` with
  `deleted_at IS NULL AND merged_into_id IS NULL` for lists.
- **Visitor list vs visits.** `hostel_visitors` is the approved list; actual visits are `visitor_log` rows with
  `hostel_id` set.
- **Hostel leave is not in this module's tables;** it is `gate_passes` (`kind` hostel_home / hostel_outing,
  `state` pending/approved/rejected/cancelled/handed_over/out/returned).

## Personal and sensitive data

Mask these, or never send them to an AI model:

- **Visitors:** `hostel_visitors.name`, `relation`, `mobile`, `note`; `hostel_visitor_photos.bytes` (face photo;
  never export). Visit rows in `visitor_log` carry visitor names, mobiles and ID proof digits.
- **Health and behaviour:** `hostel_diets.allergies`, `notes`, `no_onion_garlic` (health / religion hints);
  `hostel_incidents.what`, `action`, `closing_remark`, `category` = health; `hostel_incident_notes.body`;
  `hostel_rollcall_marks.status = 'sick'` and `note`; `hostel_meal_skips.reason`.
- **Free text about pupils and families:** `hostel_meal_feedback.comment`; `hostel_exit_requests.note`,
  `decline_note`; `hostel_withdrawals.remarks`, `cancel_reason`, `charge_remarks`, `decided_note`, `fee_note`,
  `revoke_reason`, `revoke_note`; `hostel_withdrawal_checkout.note`; `hostel_allotments.remarks`, `end_remarks`;
  `hostel_withdrawal_clearances.remarks`, `check_result`.
- **Documents and files:** `hostel_withdrawals.documents`, `hostel_withdrawal_clearances.documents` (jsonb file
  lists), `hostel_incidents.file_ids`, `hostel_incident_notes.file_ids`.
- **Where a child sleeps:** room and bed of a named pupil (safety data); hostel `address` and `phone`.
- Names of pupils come from `students.display_name`; parents' contacts from `guardians` — mask as in the people guide.
