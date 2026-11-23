# Student attendance and leave — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

Each school day the class teacher marks the **day register** of a section: one **session** per section and day,
one **mark** per pupil (present, absent, late, leave…); subject teachers may take separate **subject** sessions.
Marks also come from RFID gates (in / out times) and Excel **uploads**. Marking outside the school's windows is
flagged late; a coordinator may **reopen** a day. Families apply for **leave**, decided level by level; an approved
leave pre-fills LV. Per-pupil **rules** set a late time or mute alerts. **Punch logs** are employees' biometric
punches, which feed staff attendance.

## Tables

| Table                      | One row is                                                        | Key columns                                                                                                                                                                                                                                                        | For reports                                                                            |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `attendance_sessions`      | one register taken: a section on a date (day) or a subject period | `academic_year_id`, `class_section_id`, `on_date`, `kind` day/subject, `subject_id`, `period_id`, `source` manual/rfid/upload, `marked_by`, `marked_at`, `marked_late`, `locked`                                                                                   | **main (spine)**                                                                       |
| `attendance_marks`         | one pupil's mark in a session                                     | `session_id` + `student_id` (unique), `code` attendance_code, `in_at`/`out_at` (RFID), `source`, `alert_sent_at`, `marked_by`, `remarks`                                                                                                                           | **main (facts)**                                                                       |
| `attendance_uploads`       | one Excel list of admission numbers, checked then committed       | `academic_year_id`, `on_date`, `code` (P or A), `state` verified/committed/cancelled, `rows` jsonb, counts `total_rows`/`ok_rows`/`problem_rows`/`marked`/`replaced`/`kept`/`rest_marked`, `sms_sent`/`email_sent`, `committed_at`                                 | history (imports)                                                                      |
| `attendance_reopens`       | a day reopened for a class or a bus route until a time            | `scope` class/bus, `class_section_id` or `route_id` + `trip` pick/drop, `on_date`, `open_until`, `reason`, `created_by`                                                                                                                                            | history                                                                                |
| `attendance_settings`      | the school's marking windows (one row)                            | PK `school_id`; `class_from`/`class_to`, `bus_pick_from`/`bus_pick_to`, `bus_drop_from`/`bus_drop_to`, `back_days`                                                                                                                                                 | internal (settings)                                                                    |
| `student_attendance_rules` | a pupil's own rule for a year                                     | `student_id` + `academic_year_id` (unique), `late_after`, `alerts_muted`, `valid_from`/`valid_to`, `reason`                                                                                                                                                        | detail                                                                                 |
| `student_leaves`           | one leave application for a pupil                                 | `academic_year_id`, `number` (LV-YYMM-nnnn), `student_id`, `leave_type` (a `leave_types.code`), `from_date`, `to_date`, `days`, `chain` short/long, `status` pending/approved/rejected/cancelled, `applied_by`, `applied_at`, `decided_at`, `ended_on`, `file_ids` | **main (leave)**                                                                       |
| `student_leave_approvals`  | one approval level of a leave                                     | `leave_id` + `seq` (unique), `label`, `approver_user_ids` bigint[], `status` waiting/pending/approved/rejected/skipped, `acted_by`, `acted_at`, `note`                                                                                                             | detail (history of approvals)                                                          |
| `leave_approval_levels`    | a level of the short or long approval chain                       | `chain` short/long + `seq` (unique per school), `label`, `kind` class_teacher/role/employee, `role_code`, `employee_id`, `active`                                                                                                                                  | master                                                                                 |
| `leave_types`              | a leave type families may pick                                    | `code` (unique per school), `name`, `certificate` never/long/always, `max_days`, `status`                                                                                                                                                                          | master                                                                                 |
| `leave_settings`           | the school's leave rules (one row)                                | PK `school_id`; `long_days` (more days = long chain), `back_days` (how far back a family may apply)                                                                                                                                                                | internal (settings)                                                                    |
| `punch_logs`               | one biometric punch of an **employee** as a device sent it        | `device_id` → rfid_devices, `employee_id`, `biometric_id`, `punched_at`, `direction`, `outcome` recorded/duplicate/unknown_id, `raw`, `received_at`; unique (`device_id`, `biometric_id`, `punched_at`)                                                            | internal (device log; staff attendance uses `staff_punches` / `staff_attendance_days`) |

Related: `rfid_events` and `rfid_devices` (the gate readers, transport guide), `bus_roll_sessions` /
`bus_roll_marks` (bus attendance, transport guide), `holidays` (academics), `parent_queries` with `kind = 'leave'`
(the older leave request, engagement guide), `mart.attendance_daily` (below), `archive.attendance_marks` (old marks).

## How the tables join

Spine: **`attendance_sessions`** (one per section and day for `kind = 'day'`) with **`attendance_marks`**.

Register to class and pupil

- `attendance_marks.session_id → attendance_sessions.id`
- `attendance_marks.student_id → students.id`
- `attendance_sessions.class_section_id → class_sections.id → classes` (via `class_sections.class_id`)
- `attendance_sessions.academic_year_id → academic_years.id`
- the pupils who should be on the register: `enrolments` with `class_section_id = attendance_sessions.class_section_id`,
  same `academic_year_id`, `status = 'active'`
- subject sessions: `attendance_sessions.subject_id → subjects.id`; `.period_id → timetable_periods.id`
- marked by: `attendance_sessions.marked_by`, `attendance_marks.marked_by → users.id`

Rules, reopens, uploads

- `student_attendance_rules.(student_id, academic_year_id)` = `enrolments.(student_id, academic_year_id)`
- `attendance_reopens.class_section_id → class_sections.id`; `.route_id → transport_routes.id`
- `attendance_uploads` links to sessions only by date and `source = 'upload'` (sessions note "Excel upload #<id>");
  `attendance_uploads.rows` lists the rows with `admissionNo`, `studentId`, `classSectionId`, `issue`

Leave

- `student_leaves.student_id → students.id`; `.academic_year_id → academic_years.id`
- `student_leave_approvals.leave_id → student_leaves.id`; `approver_user_ids` and `acted_by` are `users.id`
- `student_leaves.leave_type = leave_types.code` (text, no FK)
- `leave_approval_levels.employee_id → employees.id`; `role_code` is a `roles.code`
- leave → register: a leave covers a mark when `attendance_marks.student_id = student_leaves.student_id` and
  `attendance_sessions.on_date BETWEEN from_date AND LEAST(to_date, COALESCE(ended_on - 1, to_date))`

Punches (staff)

- `punch_logs.device_id → rfid_devices.id` (`rfid_devices.kind = 'biometric'`); `punch_logs.employee_id → employees.id`
- a trigger copies `recorded` punches into `staff_punches`; staff days are in `staff_attendance_days` (staff guide)

## Life-cycles and statuses

**`attendance_marks.code`** (attendance_code) — what each code means and how the app counts it:

| Code | Meaning                                                 | App counts it as                                                     |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `P`  | present                                                 | present                                                              |
| `A`  | absent                                                  | absent (absent alerts go to parents; `alert_sent_at`)                |
| `L`  | late (came after the late time; RFID uses `late_after`) | present, also counted as late                                        |
| `SR` | short leave (left early, e.g. on a gate pass)           | present                                                              |
| `H`  | **half day** (not a holiday)                            | present, as a whole day                                              |
| `OD` | on duty (school activity outside class)                 | present                                                              |
| `SB` | stay back                                               | present                                                              |
| `LV` | on approved leave                                       | neither present nor absent: "leave"; but it stays in the days marked |

Holidays are not a code: on a holiday or weekly off (`holidays` with `applies_to` everyone/students and `kind` not
`working_day`; the setting `attendance.weekly_off`) the app refuses to create a session, so a working day is a day
with a day session. Gate passes pre-fill `L` (late arrival) or `SR` (early leave); approved leave pre-fills `LV`.

**`attendance_sessions.kind`** (attendance_kind): `day` = the day register (what attendance % means; one per
section and date, `subject_id` and `period_id` NULL); `subject` = one subject period (subject teacher; `subject_id`
required). Never add subject sessions to day counts. `source` (attendance_source): manual, rfid (created by a gate
reader), upload (Excel). `locked` = no more changes (RFID and uploads skip it). `marked_late` = saved outside the
marking window (by an admin, on a reopened day, or a few days back within `back_days`).

**`attendance_uploads.state`**: verified (checked, nothing written) → committed (marks written) or cancelled.

**`student_leaves.status`**: pending → approved or rejected (by levels); cancelled by the family (before it starts,
or a pending one). A family giving up the rest of an approved leave sets `ended_on` (the first day back) and keeps
`approved`. `chain` = short (one level) or long (more than `leave_settings.long_days` days: class teacher,
coordinator, principal by default).

**`student_leave_approvals.status`**: waiting (a later level, not its turn yet) → pending (its turn now) → approved
or rejected; skipped (nobody holds the level, no longer needed after a decision, or cancelled by the family).
The leave is approved when the last level approves; one rejection rejects it.

**`punch_logs.outcome`**: recorded (matched to an employee), duplicate (within 60 seconds of another), unknown_id
(no employee has that biometric id).

## Amounts, dates and counting rules

- **One row per what.** One day session per section and date (unique on section, date, kind, subject, period);
  one mark per pupil per session. A pupil can have two day marks on a date only if moved between sections that day.
- **Percent the app's way.** Days = day-session marks of the pupil; present = codes other than `A` and `LV`;
  percent = present ÷ days (so leave lowers it); absent = `A`; leave = `LV`; late = `L`. If you want leave left out
  of the base, say so and use present ÷ (days − leave). `H` counts as a full present day in the app.
- **Unmarked is not absent.** A pupil without a mark in a day session was not marked (the register shows "-").
  Strength − present ≠ absent.
- **Dates.** `on_date` is the school's date (a plain date, India). `in_at`, `out_at`, `marked_at`, `applied_at`,
  `punched_at` are timestamptz: convert with `AT TIME ZONE 'Asia/Kolkata'`.
- **Year.** Sessions and leaves carry `academic_year_id`; group by it, not by calendar year.
- **Leave days.** `student_leaves.days` = calendar days `to_date − from_date + 1` (weekends and holidays included),
  as asked; the days actually taken end the day before `ended_on`. Count school days of leave from the `LV` marks.
- **`mart.attendance_daily`** — one row per section and working date of the last 400 days (plus today), refreshed
  every 15 minutes: `strength` = `active` enrolments covering the date, `present` = marks with code other than `A`
  (**so `LV` counts as present here**), `absent` = `A`, `late` = `L`, `marked` = a day session exists. Use it for
  dashboards and trends of the current year; use the base tables for registers, leave and exact percentages.

## Answering report questions

**1. Today: which sections are marked, and how many present, absent, on leave and late?**

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS on_date),
     y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class_name, cs.name AS section,
       (SELECT count(*) FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS strength,
       s.id IS NOT NULL                                                           AS marked,
       count(m.id) FILTER (WHERE m.code IN ('P', 'L', 'H', 'OD', 'SB', 'SR'))     AS present,
       count(m.id) FILTER (WHERE m.code = 'A')                                    AS absent,
       count(m.id) FILTER (WHERE m.code = 'LV')                                   AS on_leave,
       count(m.id) FILTER (WHERE m.code = 'L')                                    AS late,
       bool_or(s.marked_late)                                                     AS marked_after_window
  FROM class_sections cs
  JOIN y ON y.id = cs.academic_year_id
  JOIN classes k ON k.id = cs.class_id
  CROSS JOIN d
  LEFT JOIN attendance_sessions s ON s.class_section_id = cs.id AND s.on_date = d.on_date AND s.kind = 'day'
  LEFT JOIN attendance_marks m ON m.session_id = s.id
 WHERE cs.deleted_at IS NULL
 GROUP BY k.display_order, k.name, cs.id, cs.name, s.id
 ORDER BY k.display_order, cs.name
```

Same counting as the app's dashboard; sections with `marked` false have not taken the register.

**2. Present % per section for a month, from the mart (fast).**

```sql
SELECT ad.section, count(*) FILTER (WHERE ad.marked) AS days_marked,
       sum(ad.present) AS present_marks, sum(ad.absent) AS absent_marks,
       round(100.0 * sum(ad.present) / NULLIF(sum(ad.present) + sum(ad.absent), 0), 1) AS present_pct
  FROM mart.attendance_daily ad
  JOIN academic_years y ON y.id = ad.academic_year_id
 WHERE y.status = 'active' AND ad.on_date >= DATE '2026-11-01' AND ad.on_date < DATE '2026-12-01'
 GROUP BY ad.class_id, ad.section
 ORDER BY ad.section
```

The mart counts `LV` as present; the base tables do not.

**3. Each pupil's attendance this year (days, present, absent, leave, %).**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1),
days AS (
  SELECT m.student_id,
         count(*)                                         AS days_marked,
         count(*) FILTER (WHERE m.code NOT IN ('A', 'LV')) AS present,
         count(*) FILTER (WHERE m.code = 'A')             AS absent,
         count(*) FILTER (WHERE m.code = 'LV')            AS on_leave,
         count(*) FILTER (WHERE m.code = 'H')             AS half_days
    FROM attendance_marks m
    JOIN attendance_sessions a ON a.id = m.session_id AND a.kind = 'day'
    JOIN y ON y.id = a.academic_year_id
   GROUP BY m.student_id
)
SELECT k.name AS class_name, cs.name AS section, e.roll_no, st.admission_no, st.display_name,
       d.days_marked, d.present, d.absent, d.on_leave, d.half_days,
       round(100.0 * d.present / NULLIF(d.days_marked, 0), 1)               AS percent_app_way,
       round(100.0 * d.present / NULLIF(d.days_marked - d.on_leave, 0), 1)  AS percent_leave_excluded
  FROM enrolments e
  JOIN y ON y.id = e.academic_year_id
  JOIN students st ON st.id = e.student_id AND st.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN days d ON d.student_id = e.student_id
 WHERE e.status = 'active'
 ORDER BY k.display_order, cs.name, e.roll_no NULLS LAST
```

Two percents: the app's (leave in the base) and one with leave left out.

**4. Pupils below 75 % this year.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1),
days AS (
  SELECT m.student_id, count(*) AS days_marked, count(*) FILTER (WHERE m.code NOT IN ('A', 'LV')) AS present
    FROM attendance_marks m
    JOIN attendance_sessions a ON a.id = m.session_id AND a.kind = 'day'
    JOIN y ON y.id = a.academic_year_id
   GROUP BY m.student_id
)
SELECT k.name AS class_name, cs.name AS section, st.admission_no, st.display_name,
       d.days_marked, d.present, round(100.0 * d.present / d.days_marked, 1) AS percent
  FROM days d
  JOIN enrolments e ON e.student_id = d.student_id AND e.status = 'active'
  JOIN y ON y.id = e.academic_year_id
  JOIN students st ON st.id = d.student_id AND st.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE d.days_marked >= 20 AND 100.0 * d.present / d.days_marked < 75
 ORDER BY percent, k.display_order
```

The 20-day floor avoids flagging pupils who joined last week.

**5. Absent on each of the last three working days.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1),
working AS (
  SELECT DISTINCT a.on_date FROM attendance_sessions a JOIN y ON y.id = a.academic_year_id
   WHERE a.kind = 'day' AND a.on_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
   ORDER BY a.on_date DESC LIMIT 3
)
SELECT st.admission_no, st.display_name, k.name AS class_name, cs.name AS section
  FROM attendance_marks m
  JOIN attendance_sessions a ON a.id = m.session_id AND a.kind = 'day'
  JOIN working w ON w.on_date = a.on_date
  JOIN students st ON st.id = m.student_id AND st.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = a.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE m.code = 'A'
 GROUP BY st.admission_no, st.display_name, k.display_order, k.name, cs.name
HAVING count(DISTINCT a.on_date) = 3
 ORDER BY k.display_order, cs.name
```

Working days are days with a day session, so holidays are skipped.

**6. Subject attendance by subject.**

```sql
SELECT k.name AS class_name, cs.name AS section, sub.name AS subject,
       count(DISTINCT a.id)                                       AS periods_taken,
       count(m.id) FILTER (WHERE m.code NOT IN ('A', 'LV'))       AS present_marks,
       count(m.id) FILTER (WHERE m.code = 'A')                    AS absent_marks
  FROM attendance_sessions a
  JOIN subjects sub ON sub.id = a.subject_id
  JOIN class_sections cs ON cs.id = a.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN academic_years y ON y.id = a.academic_year_id
  LEFT JOIN attendance_marks m ON m.session_id = a.id
 WHERE a.kind = 'subject' AND y.status = 'active'
 GROUP BY k.display_order, k.name, cs.name, sub.name
 ORDER BY k.display_order, cs.name, sub.name
```

Only `kind = 'subject'` sessions; one session per period taken.

**7. Leave applications by type, chain and status.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT COALESCE(lt.name, l.leave_type) AS leave_type, l.chain, l.status,
       count(*) AS applications, sum(l.days) AS days_asked,
       count(*) FILTER (WHERE l.status = 'pending' AND EXISTS (
         SELECT 1 FROM student_leave_approvals x WHERE x.leave_id = l.id AND x.status = 'pending' AND x.seq > 1)) AS waiting_beyond_level_1
  FROM student_leaves l
  JOIN y ON y.id = l.academic_year_id
  LEFT JOIN leave_types lt ON lt.code = l.leave_type
 GROUP BY 1, l.chain, l.status
 ORDER BY 1, l.chain, l.status
```

`days_asked` are calendar days as applied for.

**8. Where are pending leaves waiting?**

```sql
SELECT x.label AS waiting_at, count(*) AS leaves,
       min(l.applied_at) AS oldest_applied, min(l.from_date) AS earliest_start
  FROM student_leaves l
  JOIN student_leave_approvals x ON x.leave_id = l.id AND x.status = 'pending'
 WHERE l.status = 'pending'
 GROUP BY x.label
 ORDER BY 2 DESC
```

Normally one approval row is `pending` while a leave is pending (none if nobody holds any level).

**9. Approved leave days per class in a month.**

```sql
WITH m AS (SELECT DATE '2026-11-01' AS first_day, DATE '2026-11-30' AS last_day)
SELECT k.name AS class_name, count(DISTINCT l.student_id) AS pupils_on_leave,
       sum(GREATEST(0, LEAST(l.to_date, COALESCE(l.ended_on - 1, l.to_date), m.last_day)
                     - GREATEST(l.from_date, m.first_day) + 1)) AS calendar_days_of_leave
  FROM student_leaves l
  CROSS JOIN m
  JOIN enrolments e ON e.student_id = l.student_id AND e.academic_year_id = l.academic_year_id AND e.status = 'active'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE l.status = 'approved' AND l.from_date <= m.last_day
   AND LEAST(l.to_date, COALESCE(l.ended_on - 1, l.to_date)) >= m.first_day
 GROUP BY k.display_order, k.name
 ORDER BY k.display_order
```

Cuts each leave to the month and to the day before `ended_on`; calendar days, not school days.

**10. Who marked late, from Excel, or locked, per section, in a month.**

```sql
SELECT k.name AS class_name, cs.name AS section, u.display_name AS marked_by,
       count(*)                                       AS sessions,
       count(*) FILTER (WHERE a.marked_late)          AS marked_after_window,
       count(*) FILTER (WHERE a.source = 'upload')    AS from_excel,
       count(*) FILTER (WHERE a.locked)               AS locked
  FROM attendance_sessions a
  JOIN class_sections cs ON cs.id = a.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN users u ON u.id = a.marked_by
 WHERE a.kind = 'day' AND a.on_date >= DATE '2026-11-01' AND a.on_date < DATE '2026-12-01'
 GROUP BY k.display_order, k.name, cs.name, u.display_name
 ORDER BY k.display_order, cs.name
```

`marked_late` is set when saved outside the school's window.

**11. Late arrivals at the gate on a day (RFID).**

```sql
SELECT a.on_date, k.name AS class_name, st.admission_no, st.display_name, m.code,
       (m.in_at AT TIME ZONE 'Asia/Kolkata')::time  AS came_in,
       (m.out_at AT TIME ZONE 'Asia/Kolkata')::time AS went_out,
       r.late_after AS own_late_time
  FROM attendance_marks m
  JOIN attendance_sessions a ON a.id = m.session_id AND a.kind = 'day'
  JOIN students st ON st.id = m.student_id
  JOIN class_sections cs ON cs.id = a.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN student_attendance_rules r ON r.student_id = m.student_id AND r.academic_year_id = a.academic_year_id
 WHERE m.source = 'rfid' AND m.code = 'L' AND a.on_date = DATE '2026-11-20'
 ORDER BY m.in_at
```

`in_at` is the first gate entry; a pupil's own `late_after` overrides the school's late time.

**12. Attendance of boarders against day scholars (crosses into hostel).**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT CASE WHEN h.student_id IS NULL THEN 'day scholar' ELSE 'boarder' END AS kind,
       count(DISTINCT m.student_id)                              AS pupils,
       count(*)                                                  AS day_marks,
       count(*) FILTER (WHERE m.code NOT IN ('A', 'LV'))         AS present,
       round(100.0 * count(*) FILTER (WHERE m.code NOT IN ('A', 'LV')) / NULLIF(count(*), 0), 1) AS present_pct
  FROM attendance_marks m
  JOIN attendance_sessions a ON a.id = m.session_id AND a.kind = 'day'
  JOIN y ON y.id = a.academic_year_id
  LEFT JOIN LATERAL (SELECT ha.student_id FROM hostel_allotments ha
                      WHERE ha.student_id = m.student_id AND ha.from_date <= a.on_date
                        AND (ha.to_date IS NULL OR ha.to_date >= a.on_date) LIMIT 1) h ON true
 GROUP BY 1
```

A pupil counts as a boarder on a date when a hostel stay covers that date.

## Traps

- **Day vs subject sessions.** Mixing them multiplies a pupil's days by the periods taken. Filter `kind = 'day'`.
- **LV is counted differently.** The app: neither present nor absent but in the days marked. The mart: present.
  The data: an approved leave writes `LV` only when the register is saved after the approval; a register saved
  earlier keeps `A` or `P`. For "how many were on leave" use `student_leaves` (and the older `parent_queries`
  with `kind = 'leave'` and `decision = 'approved'`, `leave_from`/`leave_to`, which the register also honours).
- **H is half day**, not holiday, and counts as a full present day.
- **Other modules count differently.** The TC / certificate data counts working days as every day session of the
  section (marked or not for the pupil) and present as `P` or `L` only; the exam registers and report cards use the
  app's rule (present = not `A`, not `LV`). State the rule you use.
- **Unmarked pupils** and late joiners: compare with active enrolments of the date, not of today.
- **Moved pupils.** Marks stay in the old section's sessions; a section's register lists only its current pupils.
  Group per pupil by `attendance_marks.student_id`, per section by the session's section.
- **Merged and deleted students.** Marks moved to the kept record on merge; still filter `students.deleted_at IS NULL`.
  Cancelled admissions keep their marks: leave out pupils whose enrolment is `cancelled`.
- **Archived years.** Marks of closed years older than the two latest closed years are moved to
  `archive.attendance_marks` (the sessions stay); old-year reports must read both.
- **mart strength for past years.** The mart counts only enrolments still `active`, so closed years (rows
  `promoted`) show strength 0 and today's leavers drop out of past days. Rebuild strength from `enrolments` dates.
- **mart today.** The mart uses the database's `CURRENT_DATE` and is up to 15 minutes old.
- **punch_logs are staff**, not students; `unknown_id` and `duplicate` rows are not attendance.
- **Time zones.** Convert `in_at`/`out_at`/`punched_at` to India time before taking the date or time.

## Personal and sensitive data

- `attendance_marks`: a child's presence day by day with `in_at` / `out_at` gate times (movement pattern),
  `remarks`. Report in aggregate outside the school.
- `student_leaves`: `reason` (often medical or family matters), `file_ids` (medical certificates and other proofs),
  `decision_note`, `applied_by`; `student_leave_approvals.note`.
- `student_attendance_rules.reason` (why a child has a special rule, may be health or custody related).
- `attendance_uploads.rows` (admission numbers, names, sections of the file), `notify_note`, `file_name`.
- `attendance_reopens.reason`, `attendance_sessions.notes` (free text).
- `punch_logs`: `biometric_id`, `punched_at` and `raw` of named employees (staff movement data).
