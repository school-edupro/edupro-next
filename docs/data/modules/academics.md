# Academics — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

The school's academic year (`academic_years`), its classes (a master) and the year's sections, the subjects and
which subjects each class studies that year. On top of that: the weekly timetable (periods, slots) and the day's
substitutions; the daily work teachers post (homework, classwork, assignments) and class documents, with family
acknowledgements; the syllabus (chapters, topics) and how far each section has covered it; lesson plans and
lesson uploads with their approvals; each employee's daily activity log; the holiday list and the almanac; and at
year end the promotion decisions that move students into next year's sections, plus "wrong class" corrections.

## Tables

| Table                   | One row is                                                                                  | Key columns                                                                                                                                                   | For reports                 |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| academic_years          | one school year                                                                             | code (unique), start_date, end_date, status (year_status), locks jsonb                                                                                        | master (backbone)           |
| classes                 | a class of the school (all years)                                                           | code (unique while not deleted), name, display_order, band, status, deleted_at                                                                                | master (backbone)           |
| class_sections          | a section of a class in one year                                                            | academic_year_id, class_id, name, campus_id, capacity, status, deleted_at                                                                                     | master (backbone, per year) |
| subjects                | a subject of the school                                                                     | code, name, kind (subject_kind), display_order, parent_id, status, deleted_at                                                                                 | master                      |
| class_subjects          | a subject a class studies in a year                                                         | academic_year_id, class_id, subject_id (unique), is_elective, group_id, sort_order, periods_per_week, status                                                  | master                      |
| timetable_periods       | a period of the day (bell time)                                                             | campus_id, number, name, starts_at, ends_at, kind (period_kind)                                                                                               | master                      |
| timetable_slots         | one period of a section's week                                                              | academic_year_id, class_section_id, weekday (1 = Monday), period_id (unique), subject_id, employee_id, room                                                   | main (timetable)            |
| timetable_substitutions | a period taken by another teacher on a date                                                 | on_date, class_section_id, period_id (unique), slot_id, absent_employee_id, substitute_employee_id, subject_id, reason                                        | main                        |
| daily_work              | one homework / classwork / assignment posted to a section                                   | academic_year_id, class_section_id, subject_id, kind (daily_work_kind), assigned_on, due_on, publish_at, ack_required, posted_by_employee_id, deleted_at      | main                        |
| daily_work_files        | a file attached to a daily work                                                             | daily_work_id, file_id                                                                                                                                        | detail                      |
| academic_documents      | a class document (session plan, curriculum, date sheet) or a school one (magazine, almanac) | academic_year_id, kind, title, class_section_id (NULL = whole school), subject_id, file_ids jsonb, publish_at, ack_required, deleted_at                       | main                        |
| academic_acks           | one acknowledgement of an item by a family (for a child) or an employee                     | item_type, item_id, student_id or staff_user_id, acked_by, acked_at                                                                                           | detail                      |
| school_directory        | a contact the families see (office, accounts…)                                              | code, heading, name, designation, phone, email, timings, status                                                                                               | master                      |
| academic_settings       | the school's academics settings (one row)                                                   | school_id (pk), publish_time, teacher_mobile / teacher_email (full / masked / hidden), max_mb_daily_work, max_mb_documents, max_notice_files                  | internal (settings)         |
| syllabus_chapters       | a chapter of a class subject's syllabus for a year                                          | academic_year_id, class_id, subject_id, number (unique), name, term, planned_month                                                                            | master                      |
| syllabus_topics         | a topic of a chapter                                                                        | chapter_id, number (unique), name, planned_periods                                                                                                            | master                      |
| syllabus_progress       | a topic's state in one section                                                              | topic_id, class_section_id (unique), status (done / partial / not_done), done_on, employee_id                                                                 | main (coverage)             |
| lesson_plans            | a teacher's weekly plan for a section and subject                                           | academic_year_id, employee_id, class_section_id, subject_id, week_start (Monday), topics jsonb, status (lesson_plan_status), workflow_instance_id, deleted_at | main                        |
| lesson_uploads          | a lesson a teacher uploads for a date (the school's lesson planner)                         | academic_year_id, employee_id, on_date, target_type, topic, status, current_level, levels, file_ids jsonb, deleted_at                                         | main                        |
| lesson_upload_targets   | a class or section a lesson upload is for                                                   | lesson_id, class_id or class_section_id                                                                                                                       | detail                      |
| lesson_upload_approvals | one approval level of a lesson upload                                                       | lesson_id, level (unique), kind, approver_employee_id or role_code, state, acted_by, acted_at, remark                                                         | history                     |
| lesson_approver_rules   | who approves lessons of an employee / class / department / everyone                         | scope, employee_id, class_id, department (text)                                                                                                               | master                      |
| lesson_approver_levels  | one level of a rule                                                                         | rule_id, level (1–3), kind, approver_employee_id or role_code                                                                                                 | master                      |
| activity_logs           | one employee's activity log for one day                                                     | employee_id, on_date (unique), state, late, submitted_at, reviewed_by, reviewed_at, leave_kind, leave_type                                                    | main                        |
| activity_entries        | one time slot of a day's log                                                                | log_id, from_time, to_time, category_id, description, source                                                                                                  | detail                      |
| activity_categories     | a category of activity (Teaching, Duty…)                                                    | code (unique), name, sort_order, status (text)                                                                                                                | master                      |
| activity_settings       | cut-off time and days back for logs (one row)                                               | school_id (pk), cutoff_time, back_days                                                                                                                        | internal (settings)         |
| holidays                | a holiday, vacation or declared working day                                                 | academic_year_id, campus_id, name, kind (holiday_kind), starts_on, ends_on, applies_to (audience_kind), optional, staff_scope, staff_scope_values[]           | master                      |
| almanac_events          | an event of the school calendar                                                             | academic_year_id, title, kind (almanac_kind), starts_on, ends_on, starts_at, audience, deleted_at                                                             | master                      |
| promotion_decisions     | the year-end decision for one student                                                       | from_year_id, student_id (unique), to_year_id, decision (promotion_decision), to_class_section_id, from_enrolment_id, to_enrolment_id, applied_at             | main (promotion)            |
| class_corrections       | a request to move a student to the right section this year                                  | student_id, academic_year_id, from_section_id, to_section_id, effective_from, status, workflow_instance_id, preview / result jsonb                            | history                     |

Also used here but documented elsewhere: `teacher_assignments` (who teaches / is class teacher of what; HR guide),
`enrolments` and `students` (people guide), `notices` (comms guide; acknowledged through `academic_acks`),
`subject_groups`, `class_streams`, `class_subject_parts`, `student_subjects` (exams guide).

## How the tables join

Spine tables: **class_sections** (with `classes` and `academic_years`) for anything per section; **timetable_slots**
for the timetable; **daily_work** for homework; **syllabus_chapters → topics → progress** for coverage;
**activity_logs** for staff logs; **promotion_decisions** for year end.

Year, class, section, subject

- `class_sections.academic_year_id → academic_years.id`; `class_sections.class_id → classes.id`; `class_sections.campus_id → campuses.id`
- `class_subjects (academic_year_id, class_id, subject_id) → academic_years, classes, subjects`; `class_subjects.group_id → subject_groups.id`
- `subjects.parent_id → subjects.id` (Physics under Science: taught as the child, reported as the parent)
- Students in a section: `enrolments.class_section_id → class_sections.id` with `enrolments.academic_year_id = class_sections.academic_year_id` and `enrolments.status = 'active'`
- Teachers of a section: `teacher_assignments.class_section_id → class_sections.id` (`kind`, `subject_id`, `valid_to IS NULL` = live) → `employees.id`

Timetable

- `timetable_slots.class_section_id → class_sections.id`; `.period_id → timetable_periods.id`; `.subject_id → subjects.id`; `.employee_id → employees.id`
- `timetable_substitutions.slot_id → timetable_slots.id` (may be NULL); `.period_id → timetable_periods.id`; `.class_section_id → class_sections.id`
- `timetable_substitutions.absent_employee_id / substitute_employee_id → employees.id`
- A date's real timetable: slots where `weekday = EXTRACT(isodow FROM date)`, overridden by substitutions on (`on_date`, `class_section_id`, `period_id`)

Daily work and documents

- `daily_work.class_section_id → class_sections.id`; `.subject_id → subjects.id`; `.posted_by_employee_id → employees.id`
- `daily_work_files.daily_work_id → daily_work.id`; `daily_work_files.file_id → files.id`
- `academic_documents.class_section_id → class_sections.id` (NULL = whole school); `.posted_by_employee_id → employees.id`; `academic_documents.file_ids` = jsonb array of `files.id`
- `academic_acks (item_type, item_id)` → `daily_work.id` / `academic_documents.id` / `notices.id` (no FK); `academic_acks.student_id → students.id`; `.staff_user_id / .acked_by → users.id`

Syllabus and lessons

- `syllabus_chapters (academic_year_id, class_id, subject_id)`; `syllabus_topics.chapter_id → syllabus_chapters.id`
- `syllabus_progress.topic_id → syllabus_topics.id`; `.class_section_id → class_sections.id`; `.employee_id → employees.id`
- Sections of a chapter: `class_sections.class_id = syllabus_chapters.class_id` and same `academic_year_id`
- `lesson_plans.employee_id → employees.id`; `.class_section_id`, `.subject_id`; `.workflow_instance_id → workflow_instances.id` (entity_type `lesson_plan`)
- `lesson_upload_targets.lesson_id → lesson_uploads.id`; `.class_id → classes.id` or `.class_section_id → class_sections.id`
- `lesson_upload_approvals.lesson_id → lesson_uploads.id`; the waiting level: `lesson_upload_approvals.level = lesson_uploads.current_level`
- `lesson_upload_approvals.approver_employee_id → employees.id`, or `role_code = roles.code`
- `lesson_approver_levels.rule_id → lesson_approver_rules.id`; `lesson_approver_rules.department` = `employees.department` (legacy text)

Staff activity

- `activity_logs.employee_id → employees.id`; `activity_entries.log_id → activity_logs.id`; `activity_entries.category_id → activity_categories.id`
- A day with no log: `employees LEFT JOIN activity_logs ON employee_id AND on_date`

Calendar

- `holidays.academic_year_id → academic_years.id`; `holidays.campus_id → campuses.id` (NULL = every campus)
- `almanac_events.academic_year_id → academic_years.id`

Year end and corrections

- `promotion_decisions.from_year_id / to_year_id → academic_years.id`; `.student_id → students.id`
- `promotion_decisions.from_enrolment_id / to_enrolment_id → enrolments.id`; `.to_class_section_id → class_sections.id`
- `class_corrections.from_section_id / to_section_id → class_sections.id`; `.workflow_instance_id → workflow_instances.id` (entity_type `class_correction`); `.requested_by / decided_by → users.id`

## Life-cycles and statuses

**academic_years.status** (year_status): `planned` → `active` (exactly one per school) → `locked` → `closed`.
`locks` jsonb holds per-stage flags (`attendance`, `exams`, `fees`, `academics`…): a `true` flag locks that stage in
an open year; in a `locked` year only a stage set `false` (reopened) is writable; `closed` refuses all writes
(`app.assert_year_open`). "This year" = `status = 'active'` (or the session's `app.current_academic_year_id()`).

**classes / class_sections / subjects**: `status` (row_status) and `deleted_at`. Count `deleted_at IS NULL`; lists in
the app also keep `status = 'active'`. Deleting a subject sets both. **class_subjects.status** (text active /
inactive): an inactive mapping drops out of every list (choices, assignments, daily work, syllabus) but exams that
hold the subject keep it. **classes.band** (class_band): pre_primary, primary, middle, secondary, senior; NULL =
derived from `display_order` (1–5 primary, 6–8 middle, 9–10 secondary, 11–12 senior).

**subjects.kind** (subject_kind): scholastic, co_scholastic, language, vocational.

**timetable_periods.kind** (period_kind): teaching, break, assembly, activity — count load on `teaching` only.
Slots and periods have no status: a removed slot is deleted (no history). Substitutions are also deleted when undone.

**daily_work.kind** (daily_work_kind): homework, classwork, assignment. Visible to families once
`publish_at <= now()` (a later `publish_at` = scheduled). `deleted_at` = removed. **academic_documents.kind**:
session_plan, curriculum, date_sheet, magazine, almanac, other; same `publish_at` / `deleted_at` rules.

**syllabus_progress.status**: `done`, `partial`, `not_done`; no row = not marked yet. Coverage counts a partial topic
as half.

**lesson_plans.status** (lesson_plan_status): `draft` → `submitted` (a workflow `lesson_plan_approval` starts) →
`approved`, or `returned` when the approver rejects (the code writes `returned`, not `rejected`); a returned or draft
plan may be edited and submitted again. `rejected` exists in the enum but current code does not set it.

**lesson_uploads.status**: `pending` (waits at `current_level` of `levels`) → `acknowledged` (last level acknowledged)
or `rejected` (any level rejects). Each level's own state is in `lesson_upload_approvals.state` (pending /
acknowledged / rejected) with `acted_by`, `acted_at`, `remark`.

**activity_logs.state**: `draft` → `submitted` → `reviewed`, or `returned` (sent back; may be filled again).
`late` = submitted after `activity_settings.cutoff_time` of its day, or on a later day. `leave_kind` full / half = the
day was leave (count it as leave, not as "not filled"). No row for an active employee = "missing".
**activity_entries.source**: manual, timetable, substitution. **activity_categories.status**: active / inactive.

**holidays.kind** (holiday_kind): `holiday`, `vacation`, `working_day` (a normally-off day declared working, e.g. a
working Saturday). `applies_to` (audience_kind): everyone, students, employees, candidates. `optional` = a
restricted holiday for staff (not a day off by itself). `staff_scope` all / department / designation /
employee_type / employee with `staff_scope_values`. Holidays are hard-deleted (no `deleted_at`).
**almanac_events.kind** (almanac_kind): event, exam, meeting, activity, deadline; `audience`; soft-deleted.

**promotion_decisions.decision** (promotion_decision): `promote`, `retain` (both need `to_class_section_id`),
`transfer_out`, `graduate`. `applied_at` NULL = decided, not applied. Applying (`app.apply_promotion`) makes the
next-year enrolment (`to_enrolment_id`) for promote / retain and sets the old enrolment to `promoted`; for
transfer_out / graduate it sets the old enrolment to `left`. A decision may be changed until applied.

**class_corrections.status**: `pending` (one open per student; approval through `workflow_instances`) → `applied`,
`rejected` or `withdrawn`. `apply_error` = the move failed. Applying moves the **same** enrolment row to the new
section and redoes fee lines from `effective_from`.

## Amounts, dates and counting rules

- No money columns. `class_corrections.preview` / `result` jsonb hold fee-line figures of the move (fees guide).
- **Per year**: class_sections, class_subjects, timetable_slots, daily_work, syllabus, lesson plans and uploads,
  holidays, almanac all carry `academic_year_id` (or reach it through the section). Section ids change every year;
  class ids do not. Always filter the year.
- **Dates**: daily work by `assigned_on` (the school's date) or `publish_at` (timestamptz; convert with
  `AT TIME ZONE 'Asia/Kolkata'`); due by `due_on`. Lesson plans by `week_start` (always a Monday); lesson uploads by
  `on_date`; activity by `on_date`; substitutions by `on_date`; syllabus by `planned_month` (1–12, the month the
  chapter should be finished; months run from the year's start month) and `done_on`.
- **Timetable**: `weekday` 1 = Monday … 7 = Sunday (ISO). One slot per section × weekday × period; a teacher can hold
  only one slot per weekday × period in a year. Periods may be set per campus (`campus_id`; NULL = not tied to a campus); period
  `number` is unique per campus.
- **Syllabus coverage** (as the app): per section × subject, `topics` = topics of its chapters; `percent =
(done + partial / 2) / topics`; "behind" = topics of chapters planned for an earlier month that are not done.
- **Activity minutes**: sum of `to_time - from_time` over a log's entries.
- **One row per**: class_subjects (year, class, subject); timetable_slots (section, weekday, period);
  timetable_substitutions (date, section, period); syllabus_progress (topic, section); lesson_plans (employee,
  section, subject, week, while not deleted); activity_logs (employee, date); promotion_decisions (from year,
  student); academic_acks (item, student or staff user); lesson_upload_approvals (lesson, level).
- **Current vs history**: timetable_slots is today's timetable only; teacher_assignments keeps history with
  `valid_from` / `valid_to`; lesson_upload_approvals and workflow steps keep approval history; class_corrections keeps
  the move history the enrolment no longer shows.

## Answering report questions

**1. Sections of the year with strength, capacity and class teacher** (crosses into people and HR)

```sql
SELECT k.code AS class, cs.name AS section, cs.capacity,
       count(s.id) AS strength,
       count(s.id) FILTER (WHERE s.gender = 'male') AS boys,
       count(s.id) FILTER (WHERE s.gender = 'female') AS girls,
       (SELECT COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name))
          FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
         WHERE ta.class_section_id = cs.id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL LIMIT 1) AS class_teacher
  FROM class_sections cs
  JOIN academic_years y ON y.id = cs.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = cs.class_id AND k.deleted_at IS NULL
  LEFT JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = cs.academic_year_id AND en.status = 'active'
  LEFT JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
 WHERE cs.deleted_at IS NULL AND cs.status = 'active'
 GROUP BY k.display_order, k.code, cs.id, cs.name, cs.capacity
 ORDER BY k.display_order, cs.name
```

Count students, not enrolment rows, so deleted or merged records drop out.

**2. The timetable of one section**

```sql
SELECT ts.weekday, tp.number AS period, tp.name AS period_name, tp.starts_at, tp.ends_at, tp.kind,
       sub.code AS subject, COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)) AS teacher, ts.room
  FROM timetable_slots ts
  JOIN academic_years y ON y.id = ts.academic_year_id AND y.status = 'active'
  JOIN class_sections cs ON cs.id = ts.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN timetable_periods tp ON tp.id = ts.period_id
  LEFT JOIN subjects sub ON sub.id = ts.subject_id
  LEFT JOIN employees e ON e.id = ts.employee_id
 WHERE k.code = 'VI' AND cs.name = 'A'
 ORDER BY ts.weekday, tp.number
```

Weekday 1 is Monday. A slot may have no subject or teacher yet.

**3. Teacher workload: periods a week and substitutions this month**

```sql
WITH load AS (
  SELECT ts.employee_id, count(*) AS periods_per_week, count(DISTINCT ts.class_section_id) AS sections
    FROM timetable_slots ts
    JOIN academic_years y ON y.id = ts.academic_year_id AND y.status = 'active'
    JOIN timetable_periods tp ON tp.id = ts.period_id AND tp.kind = 'teaching'
   WHERE ts.employee_id IS NOT NULL
   GROUP BY ts.employee_id
), subs AS (
  SELECT x.substitute_employee_id AS employee_id, count(*) AS taken
    FROM timetable_substitutions x
   WHERE x.on_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date
   GROUP BY x.substitute_employee_id
)
SELECT e.employee_code, COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)) AS teacher, e.department,
       l.periods_per_week, l.sections, COALESCE(s.taken, 0) AS substitutions_this_month
  FROM load l
  JOIN employees e ON e.id = l.employee_id AND e.deleted_at IS NULL
  LEFT JOIN subs s ON s.employee_id = e.id
 ORDER BY l.periods_per_week DESC, teacher
```

Only teaching periods count. `employees.department` is legacy text (HR guide has the master).

**4. Substitutions in a month, with who was away**

```sql
SELECT x.on_date, k.code || '-' || cs.name AS section, tp.number AS period, sub.code AS subject,
       COALESCE(ab.display_name, concat_ws(' ', ab.first_name, ab.last_name)) AS absent_teacher,
       COALESCE(sb.display_name, concat_ws(' ', sb.first_name, sb.last_name)) AS substitute, x.reason
  FROM timetable_substitutions x
  JOIN class_sections cs ON cs.id = x.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN timetable_periods tp ON tp.id = x.period_id
  LEFT JOIN subjects sub ON sub.id = x.subject_id
  LEFT JOIN employees ab ON ab.id = x.absent_employee_id
  JOIN employees sb ON sb.id = x.substitute_employee_id
 WHERE x.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
 ORDER BY x.on_date, k.display_order, cs.name, tp.number
```

`absent_employee_id` can be empty (a free period filled). `reason` is free text: do not send it to an AI model.

**5. Daily work posted per section per week (last four weeks)**

```sql
SELECT k.code || '-' || cs.name AS section, date_trunc('week', w.assigned_on)::date AS week,
       count(*) FILTER (WHERE w.kind = 'homework') AS homework,
       count(*) FILTER (WHERE w.kind = 'classwork') AS classwork,
       count(*) FILTER (WHERE w.kind = 'assignment') AS assignments,
       count(DISTINCT w.subject_id) AS subjects_covered
  FROM daily_work w
  JOIN academic_years y ON y.id = w.academic_year_id AND y.status = 'active'
  JOIN class_sections cs ON cs.id = w.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE w.deleted_at IS NULL AND w.publish_at <= now()
   AND w.assigned_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 28
 GROUP BY k.display_order, k.code, cs.name, date_trunc('week', w.assigned_on)
 ORDER BY k.display_order, cs.name, week
```

Leaves out removed and still-scheduled items, as families see them. Sections with nothing posted do not appear.

**6. Homework that asks for an acknowledgement: how many families did** (crosses into people)

```sql
SELECT w.id, w.assigned_on, k.code || '-' || cs.name AS section, sub.code AS subject, w.title,
       (SELECT count(*) FROM enrolments en
         WHERE en.class_section_id = w.class_section_id AND en.academic_year_id = w.academic_year_id AND en.status = 'active') AS pupils,
       (SELECT count(DISTINCT a.student_id) FROM academic_acks a
          JOIN enrolments en ON en.student_id = a.student_id AND en.class_section_id = w.class_section_id
                            AND en.academic_year_id = w.academic_year_id AND en.status = 'active'
         WHERE a.item_type = 'daily_work' AND a.item_id = w.id) AS acknowledged
  FROM daily_work w
  JOIN class_sections cs ON cs.id = w.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN subjects sub ON sub.id = w.subject_id
 WHERE w.deleted_at IS NULL AND w.ack_required AND w.publish_at <= now()
   AND w.assigned_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 14
 ORDER BY w.assigned_on DESC, k.display_order, cs.name
```

`academic_acks` has no FK to the item: always filter `item_type`.

**7. Syllabus coverage by section and subject**

```sql
SELECT k.code || '-' || cs.name AS section, sub.code AS subject,
       count(t.id) AS topics,
       count(*) FILTER (WHERE pr.status = 'done') AS done,
       count(*) FILTER (WHERE pr.status = 'partial') AS partial,
       round(100.0 * (count(*) FILTER (WHERE pr.status = 'done') + 0.5 * count(*) FILTER (WHERE pr.status = 'partial'))
             / NULLIF(count(t.id), 0)) AS coverage_pct,
       count(t.id) FILTER (WHERE ch.planned_month IS NOT NULL AND pr.status IS DISTINCT FROM 'done'
         AND ((ch.planned_month - EXTRACT(MONTH FROM y.start_date)::int + 12) % 12)
           < ((EXTRACT(MONTH FROM LEAST(GREATEST(CURRENT_DATE, y.start_date), y.end_date))::int - EXTRACT(MONTH FROM y.start_date)::int + 12) % 12)) AS behind_plan
  FROM syllabus_chapters ch
  JOIN academic_years y ON y.id = ch.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = ch.class_id
  JOIN subjects sub ON sub.id = ch.subject_id
  JOIN class_sections cs ON cs.class_id = ch.class_id AND cs.academic_year_id = ch.academic_year_id AND cs.deleted_at IS NULL
  LEFT JOIN syllabus_topics t ON t.chapter_id = ch.id
  LEFT JOIN syllabus_progress pr ON pr.topic_id = t.id AND pr.class_section_id = cs.id
 GROUP BY k.display_order, k.code, cs.name, sub.display_order, sub.code
 ORDER BY k.display_order, cs.name, sub.display_order, sub.code
```

The app's own formula: partial counts half; "behind" uses months counted from the year's start month.

**8. Lesson uploads waiting for approval, and on whom**

```sql
SELECT l.on_date, COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)) AS teacher, l.topic,
       l.current_level, l.levels, a.kind AS waits_on_kind,
       COALESCE(ap.display_name, a.role_code) AS waits_on,
       (SELECT string_agg(COALESCE(tk.code, sk.code || '-' || tcs.name), ', ')
          FROM lesson_upload_targets lt
          LEFT JOIN classes tk ON tk.id = lt.class_id
          LEFT JOIN class_sections tcs ON tcs.id = lt.class_section_id
          LEFT JOIN classes sk ON sk.id = tcs.class_id
         WHERE lt.lesson_id = l.id) AS classes
  FROM lesson_uploads l
  JOIN academic_years y ON y.id = l.academic_year_id AND y.status = 'active'
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN lesson_upload_approvals a ON a.lesson_id = l.id AND a.level = l.current_level
  LEFT JOIN employees ap ON ap.id = a.approver_employee_id
 WHERE l.deleted_at IS NULL AND l.status = 'pending'
 ORDER BY l.on_date, teacher
```

A level may name a role (`role_code`) instead of a person. Weekly `lesson_plans` are a separate flow (workflow engine).

**9. Who has not filled, filled late or was sent back their activity log for a day** (crosses into HR)

```sql
SELECT e.employee_code, COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)) AS employee, e.department,
       COALESCE(l.state, 'missing') AS state, l.late, l.leave_kind,
       (SELECT COALESCE(sum(EXTRACT(EPOCH FROM (x.to_time - x.from_time)) / 60), 0)::int
          FROM activity_entries x WHERE x.log_id = l.id) AS minutes_logged
  FROM employees e
  LEFT JOIN activity_logs l ON l.employee_id = e.id AND l.on_date = DATE '2026-11-20'
 WHERE e.deleted_at IS NULL AND e.status = 'active'
   AND (l.id IS NULL OR l.state IN ('draft', 'returned') OR l.late)
 ORDER BY e.department NULLS LAST, employee
```

Same base as the app's day view: every active employee. A row with `leave_kind` is leave, not a miss.

**10. School days of a month: holidays and events for students**

```sql
WITH days AS (
  SELECT d::date AS on_date
    FROM generate_series(DATE '2026-11-01', DATE '2026-11-30', interval '1 day') AS d
)
SELECT d.on_date, EXTRACT(isodow FROM d.on_date)::int AS weekday,
       (SELECT string_agg(h.name || ' (' || h.kind::text || ')', '; ')
          FROM holidays h
          JOIN academic_years y ON y.id = h.academic_year_id AND y.status = 'active'
         WHERE d.on_date BETWEEN h.starts_on AND h.ends_on AND h.applies_to IN ('everyone', 'students')
           AND NOT h.optional AND h.campus_id IS NULL) AS holidays,
       (SELECT string_agg(a.title, '; ') FROM almanac_events a
         WHERE a.deleted_at IS NULL AND d.on_date BETWEEN a.starts_on AND a.ends_on) AS events
  FROM days d
 ORDER BY d.on_date
```

A row of kind `working_day` turns an off day into a school day; one holiday row spans several days.

**11. Promotion decisions of a year: by class and decision, applied or not**

```sql
SELECT fy.code AS from_year, ty.code AS to_year, k.code AS from_class, pd.decision,
       count(*) AS students,
       count(*) FILTER (WHERE pd.applied_at IS NOT NULL) AS applied,
       count(*) FILTER (WHERE pd.applied_at IS NULL) AS not_applied
  FROM promotion_decisions pd
  JOIN academic_years fy ON fy.id = pd.from_year_id
  JOIN academic_years ty ON ty.id = pd.to_year_id
  LEFT JOIN enrolments fe ON fe.id = pd.from_enrolment_id
  LEFT JOIN class_sections fcs ON fcs.id = fe.class_section_id
  LEFT JOIN classes k ON k.id = fcs.class_id
 GROUP BY fy.code, ty.code, k.display_order, k.code, pd.decision
 ORDER BY fy.code, k.display_order, pd.decision
```

Read the decision here: the old enrolment says `promoted` for both promote and retain.

**12. Attendance against homework per section, last 30 days** (crosses into attendance)

```sql
WITH att AS (
  SELECT m.class_section_id, sum(m.present) AS present, sum(m.strength) AS strength
    FROM mart.attendance_daily m
    JOIN academic_years y ON y.id = m.academic_year_id AND y.status = 'active'
   WHERE m.marked AND m.on_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 30
   GROUP BY m.class_section_id
), hw AS (
  SELECT w.class_section_id, count(*) AS homework
    FROM daily_work w
   WHERE w.deleted_at IS NULL AND w.kind = 'homework' AND w.publish_at <= now()
     AND w.assigned_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 30
   GROUP BY w.class_section_id
)
SELECT k.code || '-' || cs.name AS section,
       round(100.0 * a.present / NULLIF(a.strength, 0), 1) AS attendance_pct,
       COALESCE(h.homework, 0) AS homework_posted
  FROM class_sections cs
  JOIN academic_years y ON y.id = cs.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN att a ON a.class_section_id = cs.id
  LEFT JOIN hw h ON h.class_section_id = cs.id
 WHERE cs.deleted_at IS NULL AND cs.status = 'active'
 ORDER BY k.display_order, cs.name
```

Uses the attendance mart (15-minute refresh) and only days that were marked.

## Traps

- **Sections are per year.** The same class "VI-A" has a new `class_sections.id` every year. Join `academic_year_id`
  at each step; never match sections by name across years.
- **Soft deletes**: classes, class_sections, subjects, daily_work, academic_documents, almanac_events, lesson_plans,
  lesson_uploads have `deleted_at`. Holidays, timetable slots, substitutions and activity entries are hard-deleted,
  so old figures can change after the fact.
- **No timetable history.** `timetable_slots` is today's plan. "Who taught 8B on 3 August" cannot be answered exactly
  if the timetable changed since; substitutions by date are kept (until undone).
- **Parent and child subjects.** The timetable, teacher assignments and daily work may use a teaching subject
  (Physics) whose `parent_id` is the report-card subject (Science) used in exams. Roll up through `subjects.parent_id`
  before comparing with exam subjects.
- **Inactive class subjects** (`class_subjects.status = 'inactive'`) stay in the table; filter them out of "subjects
  a class studies" lists.
- **Scheduled daily work**: rows with `publish_at` in the future exist but families do not see them yet.
- **Polymorphic acknowledgements**: `academic_acks.item_id` points at three tables by `item_type`. A family
  acknowledges per child (`student_id`); an employee per own user (`staff_user_id`).
- **jsonb id lists**: `academic_documents.file_ids` and `lesson_uploads.file_ids` are jsonb arrays, not FKs (use
  `jsonb_array_elements_text`). `lesson_plans.topics` is jsonb `[{day, topic, activities, resources, homework}]`.
- **Enrolment status after promotion**: `promoted` also for retained students; `left` for transfer_out and graduate.
  Use `promotion_decisions.decision`. Undecided students have no row.
- **Class corrections rewrite history**: applying one moves the year's enrolment row itself, so a student's earlier
  section is only in `class_corrections` (`from_section_id`, `effective_from`). Attendance and marks stay.
- **Activity "missing"** has no row: start from `employees`. `late` is set only at submit. A `returned` log may be
  re-submitted; `edited_at` shows a change after submit.
- **Holidays**: `working_day` rows add days, they do not remove them. Check `applies_to`, `campus_id`, and (for
  staff) `optional` and `staff_scope`. A range row covers many days: expand with `generate_series`.
- **Lesson plan statuses**: rejected plans show as `returned`; count `returned` and `rejected` together.
- **Legacy text joins**: `lesson_approver_rules.department` and `employees.department` are free text (case and spaces).
- **Time zone**: `publish_at`, `submitted_at`, `acked_at` are timestamptz; turn them into the Asia/Kolkata date before
  grouping by day. `assigned_on`, `on_date`, `week_start` are already school dates.

## Personal and sensitive data

- **People's names and contacts**: `school_directory.name`, `phone`, `email`, `designation`, `timings`, `note`
  (staff contacts shown to families); names reached through `employees`, `students`, `users` from every
  `*_employee_id`, `*_by` and `student_id` column.
- **Free text about people**: `activity_logs.leave_reason`, `leave_type`, `review_note`, `pending_note`,
  `tomorrow_plan`; `activity_entries.description`; `timetable_substitutions.reason`, `note` (may say why a teacher was
  away); `lesson_plans.decision_note`; `lesson_upload_approvals.remark`; `promotion_decisions.remarks`;
  `class_corrections.reason`, `decision_note`, `apply_error`.
- **Money and fee details of a family**: `class_corrections.preview`, `result` (fee lines of one student).
- **Who did what**: `academic_acks` (which parent acknowledged, when), `syllabus_progress.employee_id`,
  activity logs per employee — fine in aggregate, personal per row.
- **Files**: `daily_work_files.file_id`, `academic_documents.file_ids`, `lesson_uploads.file_ids` may hold pictures of
  pupils or their work; never send file contents to an AI model.
- Teaching content (`daily_work.title`, `body`, `lesson_plans.objectives`, `syllabus_chapters.name`, `syllabus_topics.name`) is not personal, but
  `daily_work.body` may name pupils: treat as free text.
