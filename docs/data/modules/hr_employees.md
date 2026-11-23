# HR and employees — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

The staff of a school from hiring to leaving. A vacancy is raised, approved and published; candidates apply on
the careers page, pass screening stages and, once selected, are moved into the employee master. The employee
record holds the profile (plain and encrypted parts), a posting per academic year (campus, reporting manager),
teaching assignments, education, experience, training, documents, transfers and remarks. Staff change their own
profile through approved change requests. Once a year the ACR (annual confidential report) rates each employee
through set-up levels. An exit (resignation, termination …) is approved, cleared by departments, settled by a
full-and-final statement and closed, which makes the employee inactive.

## Tables

| Table                        | One row is                                                               | Key columns                                                                                                                                                                                      | For reports         |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `employees`                  | one staff member of the school                                           | `employee_code` (unique per school), `display_name`, `employee_type` (enum), `department` / `designation` (text), `joined_on`, `left_on`, `status`, `deleted_at`, `user_id`, `profile`, `secure` | main (spine)        |
| `postings`                   | an employee's posting in one academic year                               | `employee_id`, `academic_year_id` (unique pair), `campus_id`, `department`, `designation`, `reports_to_employee_id`, `valid_from`, `valid_to`                                                    | main (per year)     |
| `teacher_assignments`        | who teaches / class-teaches what in a section in a year                  | `employee_id`, `academic_year_id`, `class_section_id`, `subject_id`, `kind`, `is_actual`, `valid_from`, `valid_to`                                                                               | main                |
| `departments`                | a department in Staff setup                                              | `code`, `name` (both unique), `staff_group`, `hod_employee_id`, `status`                                                                                                                         | master              |
| `designations`               | a designation in Staff setup                                             | `code`, `name`, `staff_group`, `status`                                                                                                                                                          | master              |
| `employee_types`             | an employee type (Teaching Regular, Visiting …)                          | `code`, `name`, `staff_group` (enum employee_type), `status`                                                                                                                                     | master              |
| `employee_subjects`          | a subject an employee can teach                                          | PK (`employee_id`, `subject_id`)                                                                                                                                                                 | detail              |
| `employee_education`         | one qualification of an employee                                         | `employee_id`, `qualification`, `institution`, `passing_year`, `score`                                                                                                                           | detail              |
| `employee_languages`         | one language an employee knows                                           | `employee_id`, `language` (unique pair), `can_read/write/speak`                                                                                                                                  | detail              |
| `employee_experience`        | one earlier job                                                          | `employee_id`, `organisation`, `designation`, `from_on`, `to_on`                                                                                                                                 | detail              |
| `employee_training`          | one training attended                                                    | `employee_id`, `trained_on`, `topic`, `organisation`, `entered_on`                                                                                                                               | detail              |
| `employee_transfers`         | a move (campus to campus, or to another school), as a row on the profile | `employee_id`, `on_date`, `from_place`, `to_place`, `order_no`                                                                                                                                   | history             |
| `employee_remarks`           | a dated remark on the employee                                           | `employee_id`, `on_date`, `remark`, `source` (office / system)                                                                                                                                   | history             |
| `employee_document_types`    | a kind of employment document the school asks for                        | `code`, `name`, `required_for`, `has_expiry`, `status`                                                                                                                                           | master              |
| `employee_documents`         | one uploaded document of an employee                                     | `employee_id`, `type_id`, `file_id`, `number`, `expires_on`, `verified_at`, `deleted_at`                                                                                                         | detail              |
| `employee_school_transfers`  | a request to move an employee to another school of the group             | `from_school_id`, `to_school_id`, `from_employee_id`, `to_employee_id`, `on_date`, `status` (no `school_id`)                                                                                     | history             |
| `employee_change_requests`   | one self-service profile change asked by a staff member                  | `employee_id`, `changes` (jsonb), `status`, `current_level`, `auto_applied`, `decided_at`                                                                                                        | main                |
| `employee_change_actions`    | one decision on a change request                                         | `request_id`, `level`, `decision`, `fields`, `actor_id`                                                                                                                                          | history             |
| `employee_portal_policies`   | the school's rules for what staff see and change on My profile           | `fields`, `proofs`, `edit_window`, `approval`, `lists` (all jsonb)                                                                                                                               | internal (settings) |
| `employee_queries`           | a query or grievance a staff member raised                               | `employee_id`, `category`, `subject`, `status` (workflow_status), `workflow_instance_id`                                                                                                         | main (small)        |
| `acr_settings`               | the school's ACR settings (one row)                                      | `scale_labels`, `representation_days`, `staff_late_after`, `guidelines`                                                                                                                          | internal (settings) |
| `acr_grade_bands`            | a score band and its grade                                               | `min_pct`, `label`, `adverse`                                                                                                                                                                    | master              |
| `acr_levels`                 | one assessing level of the chain, per staff group                        | `staff_group`, `seq`, `label`, `kind`, `action`, `form_id`                                                                                                                                       | master              |
| `acr_forms`                  | a self-appraisal form or a level questionnaire                           | `part` (self / level), `staff_group`, `employee_type_ids`, `active`                                                                                                                              | master              |
| `acr_form_sections`          | a section of a form                                                      | `form_id`, `title`, `weight`                                                                                                                                                                     | master              |
| `acr_questions`              | a question of a form                                                     | `form_id`, `section_id`, `kind`, `weight`, `required`, `active`                                                                                                                                  | master              |
| `acr_remarks`                | a standard remark line offered for a grade                               | `grade`, `text`, `active`                                                                                                                                                                        | master              |
| `acr_cycles`                 | the ACR round of one academic year                                       | `academic_year_id` (one per year), `self_from`, `self_to`, `review_by`, `status`                                                                                                                 | master / main       |
| `acr_reports`                | one employee's ACR in one cycle                                          | `cycle_id`, `employee_id` (unique pair), `staff_group`, `status`, `current_level`, `self_pct`, `score_pct`, `grade`, `adverse`, `decision`                                                       | main                |
| `acr_reviews`                | one level of one ACR                                                     | `report_id`, `seq` (unique pair), `status`, `reviewer_ids`, `score_pct`, `grade`, `agreement`, `filled_by`, `filled_at`                                                                          | detail              |
| `acr_events`                 | one step in an ACR's life                                                | `report_id`, `at`, `what`, `note`, `by_user`                                                                                                                                                     | history             |
| `recruitment_stages`         | a screening stage in the school's list                                   | `name`, `kind`, `max_marks`, `sort_order`, `active`                                                                                                                                              | master              |
| `recruitment_settings`       | the school's notice and undo settings (one row)                          | `notify_*`, `by_*`, `undo_hours`, `correction_days`                                                                                                                                              | internal (settings) |
| `recruitment_export_layouts` | a saved column layout for the candidates' Excel                          | `name`, `columns`, `sheets`                                                                                                                                                                      | internal            |
| `vacancies`                  | one post advertised                                                      | `code` (VAC-yyyy-nnn), `title`, `designation`, `department`, `subject`, `employee_type` (all text), `posts`, `stage_ids`, `status`, `opens_at`, `closes_at`                                      | main                |
| `vacancy_events`             | one step in a vacancy's life                                             | `vacancy_id`, `what`, `at`                                                                                                                                                                       | history             |
| `candidates`                 | one person who signed in on the careers page                             | `mobile`, `email` (each unique per school when given), `name`, `profile`, `secure`                                                                                                               | main                |
| `candidate_files`            | a document a candidate uploaded                                          | `candidate_id`, `kind`, `file_id`                                                                                                                                                                | detail              |
| `job_applications`           | one candidate's application to one vacancy                               | `number` (APP-yyyy-nnnn), `vacancy_id`, `candidate_id` (unique pair), `status`, `current_stage_id`, `source`, `employee_id`, `joined_at`                                                         | main                |
| `job_application_events`     | one step of an application                                               | `application_id`, `what`, `detail`, `revoked_at`                                                                                                                                                 | history             |
| `employee_exit_types`        | an exit type (Resignation, Termination …)                                | `code`, `name`, `staff_may_apply`, `notice_applies`, `status`                                                                                                                                    | master              |
| `employee_exit_settings`     | notice days per employee type and FNF approvers (one row)                | `notice_days` (jsonb), `fnf_approvers`                                                                                                                                                           | internal (settings) |
| `exit_clearance_departments` | a no-dues department (Library, Accounts …)                               | `code`, `name`, `auto`, `approvers`, `status`                                                                                                                                                    | master              |
| `employee_exits`             | one exit of one employee                                                 | `employee_id`, `exit_type` (code text), `status`, `requested_on`, `proposed_last_day`, `expected_last_day`, `accepted_last_day`, `left_on`                                                       | main                |
| `employee_exit_events`       | one step of an exit                                                      | `exit_id`, `what`, `at`                                                                                                                                                                          | history             |
| `exit_clearances`            | one department's no-dues line on one exit                                | `exit_id`, `department` (code, unique pair), `status`, `dues`                                                                                                                                    | detail              |
| `employee_fnf`               | the full-and-final statement of one exit                                 | `exit_id` (unique), `lines`, `earnings`, `deductions`, `net`, `status`, `paid_on`                                                                                                                | main                |

Related tables of other modules used here: `application_stage_results` (one row per application and stage: marks,
result; listed in the admissions digest), `person_documents` (the older generic document store, `person_type =
'employee'`), `payroll_settlements` (the payroll module's settlement of a leaver, one per exit), `workflow_instances`
/ `workflow_steps` (approvals of vacancies, exits, queries), `files`.

## How the tables join

Spine: **`employees`**. Most HR reports start there (filter `deleted_at IS NULL`, usually `status = 'active'`).
Recruitment reports start from **`vacancies`** or **`job_applications`**; exit reports from **`employee_exits`**;
ACR reports from **`acr_reports`** joined to `acr_cycles`.

Employee record and masters (text matches, not foreign keys):

- `employees.department` → `departments.name` (match `lower(d.name) = lower(btrim(e.department))`; the API also accepts the code in scopes)
- `employees.designation` → `designations.name` (same text match)
- `employees.profile ->> 'staff_type'` → `employee_types.name` (case-insensitive); `employees.employee_type` is the enum group the type gives
- `departments.hod_employee_id` → `employees.id`
- `employees.user_id` → `users.id`; also `user_school_memberships.person_ref_id` = `employees.id` with `person_type = 'employee'`
- `employees.photo_file_id`, `employees.signature_file_id` → `files.id`

Postings and teaching (per academic year):

- `postings.employee_id` → `employees.id`; `postings.academic_year_id` → `academic_years.id` (the working year: `app.current_academic_year_id()`)
- `postings.reports_to_employee_id` → `employees.id` (the reporting manager); `postings.campus_id` → `campuses.id`
- `teacher_assignments.employee_id` → `employees.id`; `.class_section_id` → `class_sections.id` → `classes.id` (`class_sections.class_id`); `.subject_id` → `subjects.id`; `.academic_year_id` → `academic_years.id`
- `employee_subjects.subject_id` → `subjects.id` (what a person can teach, not what they teach this year)

Rows of the profile:

- `employee_education / _languages / _experience / _training / _transfers / _remarks.employee_id` → `employees.id` (all cascade on delete)
- `employee_documents.employee_id` → `employees.id`; `.type_id` → `employee_document_types.id`; `.file_id` → `files.id`

Self-service and transfers:

- `employee_change_requests.employee_id` → `employees.id`; `.requested_by_user_id` → `users.id`
- `employee_change_actions.request_id` → `employee_change_requests.id`; `.actor_id` = `users.id`
- `employee_school_transfers.from_employee_id` → `employees.id` (source school); `.to_employee_id` = the new `employees.id` in the target school; `.from_school_id` / `.to_school_id` → `schools.id`
- `employee_queries.workflow_instance_id` → `workflow_instances.id`

ACR:

- `acr_cycles.academic_year_id` → `academic_years.id`
- `acr_reports.cycle_id` → `acr_cycles.id`; `.employee_id` → `employees.id`; `.self_form_id` → `acr_forms.id` (no FK)
- `acr_reviews.report_id` → `acr_reports.id`; `acr_reviews.seq` = `acr_reports.current_level` for the level at work; `acr_reviews.reviewer_ids[]` = `employees.id` values; `acr_reviews.filled_by` = `users.id`; `acr_reviews.remark_ids[]` = `acr_remarks.id`; `acr_reviews.form_id` → `acr_forms.id` (no FK)
- `acr_events.report_id` → `acr_reports.id`
- `acr_levels.form_id` → `acr_forms.id`; `acr_levels.employee_id` → `employees.id`; `acr_form_sections.form_id` → `acr_forms.id`; `acr_questions.form_id` / `.section_id` → forms / sections
- `acr_reports.grade` / `acr_reviews.grade` → `acr_grade_bands.label` (text, no FK)
- The people at a level come from `employees.profile ->> 'acr_hod'` / `'acr_reviewer'` / `'approver_l1'..'approver_l3'` (employee ids as text), a role, a designation or `acr_levels.employee_id`

Recruitment:

- `job_applications.vacancy_id` → `vacancies.id`; `.candidate_id` → `candidates.id`; `.employee_id` → `employees.id` (after joining); `.current_stage_id` → `recruitment_stages.id` (no FK); `.pdf_file_id` → `files.id`
- `application_stage_results.application_id` → `job_applications.id`; `.stage_id` → `recruitment_stages.id`
- `vacancies.stage_ids[]` = `recruitment_stages.id` values (in order); `vacancies.workflow_instance_id` = `workflow_instances.id` (entity `vacancy`)
- `candidate_files.candidate_id` → `candidates.id`; `.file_id` → `files.id`
- `vacancy_events.vacancy_id`, `job_application_events.application_id` → their parents

Exits:

- `employee_exits.employee_id` → `employees.id`; `.exit_type` → `employee_exit_types.code` (text); `.workflow_instance_id` → `workflow_instances.id`; `.letter_file_id` → `files.id`; `.raised_by / .decided_by / .closed_by` → `users.id`
- `exit_clearances.exit_id` → `employee_exits.id`; `exit_clearances.department` → `exit_clearance_departments.code` (text, copied with its `name` and `approvers`)
- `employee_fnf.exit_id` → `employee_exits.id` (one statement per exit)
- `employee_exit_events.exit_id` → `employee_exits.id`
- Out to payroll: `payroll_settlements.exit_id` → `employee_exits.id`

## Life-cycles and statuses

**`employees.status`** (row_status active / inactive), with `left_on` and `deleted_at`.

- In service = `deleted_at IS NULL AND status = 'active'`. A leaving date makes the record inactive (an exit's
  close, a transfer accepted by the other school once its date has passed, or the office typing a leaving date).
- `deleted_at` set = removed by the office (status also becomes inactive). Always exclude it.
- On roll on a date D: `joined_on <= D AND (left_on IS NULL OR left_on >= D)`. `left_on` is the last working day.
- An erased person (data-protection erasure) keeps the row with `first_name = 'Erased'` and empty contact fields.

**`employees.employee_type`** (enum employee_type): teaching, non_teaching, contract, visiting. It is the staff
group of the type in `profile ->> 'staff_type'`. The ACR and the document rules decide "teaching or not" from the
department's `staff_group` first, else this enum (`app.employee_staff_side(department, employee_type)`).

**`postings`**: one row per employee and year. `valid_to` is set when the employee is removed; the app reads the
working year's row (`academic_year_id = app.current_academic_year_id()`) without checking `valid_to`.

**`teacher_assignments.kind`** (enum teacher_assignment_kind): class_teacher, subject_teacher, coordinator,
indicator, remarks. Live = `valid_to IS NULL` (what the app uses; ended rows stay as history; an exit's close
sets `valid_to` to the leaving day). One live actual class teacher per section and year (`is_actual = true`);
`is_actual = false` is a co-class teacher. A subject_teacher row always has a `subject_id`.

**`employee_documents`**: soft delete by `deleted_at`. Valid = not deleted and (`expires_on IS NULL OR expires_on

> = today`). Checked against the original = `verified_at IS NOT NULL`. Which types are required:
`employee_document_types.required_for` all / teaching / non_teaching / none (optional), compared with the
employee's side (`app.employee_documents_due(employee_id)` returns required / on file / valid per type).

**`employee_change_requests.status`** (enum change_request_status): pending, approved, rejected,
partially_approved, cancelled. A change the policy lets staff make at once is stored already approved with
`auto_applied = true`. Up to two levels (`current_level` 1–2). Each decision is a row in
`employee_change_actions` (`decision`: approved, rejected, partial, auto, cancelled, override). For "changes
asked by staff" count all but cancelled; for "waiting" use pending.

**`employee_school_transfers.status`**: requested → accepted / rejected / cancelled. One open request per
employee. On accept the target school gets a new employee row (`to_employee_id`), and the source row is closed
(left on the date, a row in `employee_transfers`, a system remark).

**`employee_queries.status`** (enum workflow_status): pending, approved, rejected, cancelled.

**ACR**

- `acr_cycles.status`: draft → open (when started: an ACR is made for every active employee) → closed.
- `acr_reports.status`: self (the employee fills the self-appraisal) → review (at level `current_level`) →
  disclosed (all levels done; the employee sees score and grade; may object until `object_by` if the grade is
  adverse) → represented (an objection waits; `representation`) → closed (acknowledged, decided upheld /
  revised, or the objection days passed). A send-back returns it one step (to self from level 1).
- `acr_reviews.status`: waiting (not its turn) → pending (its turn) → done; or skipped (same person as an earlier
  level, or nobody set while a later level has someone; `skipped_note` says why). `action` rate / review.
  `agreement` agree / partly / disagree (review levels).
- `acr_reports.decision`: upheld / revised (only after an objection).
- Count a grade as final when status is closed, or disclosed with `object_by < today`. History: `acr_events`.

**Recruitment**

- `vacancies.status`: draft → pending (sent for approval) → approved or rejected (= sent back, editable again)
  → published (on the careers page from `opens_at` to `closes_at`) → closed; cancelled at any point. A published
  vacancy past `closes_at` is closed by the app only when the list is next read.
- `job_applications.status`: submitted (New, at the first stage) → screening (passed a stage) → selected (passed
  the last stage) → joined (moved to the employee master, `employee_id` set); rejected (not taken forward, at any
  stage); on_hold (waiting at a stage); returned (sent back to the candidate to correct, `correction` jsonb);
  withdrawn (allowed, not written by the app today). In process = submitted, screening, on_hold, returned.
- `job_applications.source`: online / office (a walk-in).
- `application_stage_results.result`: pass, fail, hold, skipped (a stage jumped over by a move).
- `job_application_events.revoked_at` set = a decision that was undone. History of each lives in its events table.
- `recruitment_stages.kind`: shortlist, test, interview, final.

**Exits**

- `employee_exits.status`: pending (in approval) → approved (accepted; clearances made) → closed (employee
  inactive, `left_on`, `closed_at`, `handover`). Also sent_back (to edit and send again), rejected, withdrawn
  (by the employee or office until accepted). One exit in progress per employee (pending, sent_back, approved).
  `closing_as` records what an approver chose when ending the approval early (sent_back / rejected).
- `exit_clearances.status`: pending → cleared (with `dues` ≥ 0 and the system's `check_result`); the office may
  reopen (back to pending, dues 0).
- `employee_fnf.status`: draft → submitted (only when every clearance is cleared) → approved → paid (with
  `paid_on`, `paid_mode`, `paid_reference`); a return sends it back to draft.
- An approved exit also hands payroll a draft `payroll_settlements` row (trigger), when payroll is set up.
- Leavers in a period = `status IN ('approved', 'closed')`, dated by `COALESCE(left_on, accepted_last_day,
proposed_last_day)` (what the exit register uses).

**Masters**: `departments`, `designations`, `employee_types`, `employee_document_types`, `employee_exit_types`,
`exit_clearance_departments` use `status` (row_status); `acr_forms`, `acr_questions`, `acr_remarks`,
`recruitment_stages` use `active` (boolean). Inactive master rows stay referenced by old records.

## Amounts, dates and counting rules

- **Money** (rupees, numeric(12,2)): `employee_fnf.earnings`, `.deductions`, `.net` (= earnings − deductions;
  positive = payable to the employee, negative = to recover). They are cached sums of `employee_fnf.lines`
  (jsonb: `kind` earning / deduction, `code` salary, leave_encashment, gratuity, bonus, other_earning, notice,
  advances, tds, other_deduction, plus one line per clearance department with `fromClearance`).
  `exit_clearances.dues` (≥ 0) is a department's dues; they flow into the FNF as deduction lines. No salary is kept
  in this module (pay band only: `vacancies.pay_band`, `profile ->> 'pay_band'`).
- **Notice**: `employee_exits.notice_days` is frozen when the exit is raised (from `employee_exit_settings.notice_days`
  by employee type; 0 when the type has `notice_applies = false`). Days short = `expected_last_day −
COALESCE(accepted_last_day, proposed_last_day)` when not `notice_waived` and `notice_days > 0`.
- **Scores**: `acr_reports.self_pct` (self-appraisal), `acr_reviews.score_pct` (a rating level),
  `acr_reports.score_pct` = average of the done rating levels; `grade` = the last level's grade (or the band of the
  score). Percent 0–100. `adverse` comes from the band of the final grade.
- **Marks**: `application_stage_results.marks` ≤ `max_marks` (copied from the stage). Compare stages as
  `marks / max_marks`.
- **Dates to group by**: joining `employees.joined_on`; leaving `employees.left_on` (or the exit's last day);
  applications `job_applications.submitted_at` (timestamptz → IST date); vacancies `published_at` / `closes_at`;
  ACR by `acr_cycles.academic_year_id`; exits by last day; change requests `created_at`.
- **Years**: postings, teacher assignments and ACR cycles are per **academic year**. Joiners / leavers and the
  exit register are usually counted by **financial year** (1 April – 31 March), which for most schools is the same
  span. Codes: vacancies VAC-yyyy-nnn, applications APP-yyyy-nnnn.
- **One row per**: employee per code; posting per employee and year; ACR per employee and cycle; cycle per
  academic year; review per ACR and level; application per vacancy and candidate; stage result per application
  and stage; FNF per exit; clearance per exit and department; language per employee and language.
- **Current vs history**: department / designation on `employees` are today's; `postings.department/designation`
  are what the year's posting was made with (not kept in step with later profile edits). Use
  `employee_transfers` and `employee_remarks` for the story of moves. `employees.completeness` (0–100) is a cached
  profile-fill figure.
- **Times**: `*_at` columns are timestamptz; turn into the school's day with `(x AT TIME ZONE 'Asia/Kolkata')::date`.
  `vacancies.opens_at/closes_at` are set as India time minutes.

## Answering report questions

**1. How many staff do we have by department and staff group?**

```sql
SELECT COALESCE(d.name, NULLIF(btrim(e.department), ''), 'No department') AS department,
       COALESCE(d.staff_group, 'unknown')                                 AS department_side,
       e.employee_type::text                                              AS staff_group,
       count(*)                                                           AS staff,
       count(*) FILTER (WHERE e.gender = 'female')                        AS women,
       count(*) FILTER (WHERE e.user_id IS NULL)                          AS without_login
  FROM employees e
  LEFT JOIN departments d ON lower(d.name) = lower(btrim(e.department)) AND d.status = 'active'
 WHERE e.deleted_at IS NULL AND e.status = 'active'
 GROUP BY 1, 2, 3
 ORDER BY 1, 3
```

Department is free text on the employee; the master is matched by name, so a renamed master leaves old text unmatched.

**2. What does each teacher teach this year? (crosses into academics)**

```sql
SELECT e.employee_code, e.display_name, e.designation,
       count(*) FILTER (WHERE ta.kind = 'subject_teacher')                      AS subject_slots,
       count(DISTINCT ta.class_section_id)                                       AS sections,
       string_agg(DISTINCT k.code || '-' || cs.name, ', ')
         FILTER (WHERE ta.kind = 'class_teacher' AND ta.is_actual)               AS class_teacher_of,
       string_agg(DISTINCT s.name, ', ')                                          AS subjects
  FROM teacher_assignments ta
  JOIN employees e       ON e.id = ta.employee_id
  JOIN class_sections cs ON cs.id = ta.class_section_id
  JOIN classes k         ON k.id = cs.class_id
  LEFT JOIN subjects s   ON s.id = ta.subject_id
 WHERE ta.academic_year_id = app.current_academic_year_id()
   AND ta.valid_to IS NULL
   AND e.deleted_at IS NULL AND e.status = 'active'
 GROUP BY e.id, e.employee_code, e.display_name, e.designation
 ORDER BY e.display_name
```

`valid_to IS NULL` = live; `is_actual` separates the class teacher from a co-class teacher.

**3. How many joined and left this financial year?**

```sql
WITH fy AS (SELECT date '2026-04-01' AS f, date '2027-03-31' AS t)
SELECT e.employee_type::text AS staff_group,
       count(*) FILTER (WHERE e.joined_on BETWEEN fy.f AND fy.t)                         AS joined,
       count(*) FILTER (WHERE e.left_on   BETWEEN fy.f AND fy.t)                         AS left_school,
       count(*) FILTER (WHERE e.joined_on <= fy.f AND (e.left_on IS NULL OR e.left_on >= fy.f)) AS on_roll_at_start
  FROM employees e CROSS JOIN fy
 WHERE e.deleted_at IS NULL
 GROUP BY 1
 ORDER BY 1
```

Do not filter on `status` here: leavers are inactive. A transfer to a sister school also sets `left_on`.

**4. Who is missing a required document, or has one expired?**

```sql
SELECT e.employee_code, e.display_name, e.department, t.name AS document,
       CASE WHEN NOT EXISTS (SELECT 1 FROM employee_documents d
                              WHERE d.employee_id = e.id AND d.type_id = t.id AND d.deleted_at IS NULL)
            THEN 'missing' ELSE 'expired' END AS problem
  FROM employees e
  JOIN employee_document_types t ON t.status = 'active'
   AND (t.required_for = 'all' OR t.required_for = app.employee_staff_side(e.department, e.employee_type))
 WHERE e.deleted_at IS NULL AND e.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM employee_documents d
                    WHERE d.employee_id = e.id AND d.type_id = t.id AND d.deleted_at IS NULL
                      AND (d.expires_on IS NULL OR d.expires_on >= CURRENT_DATE))
 ORDER BY e.display_name, t.sort_order
```

The same rule the Documents tab uses (`app.employee_staff_side`); contract staff of a mixed department need only the "all" types.

**5. Who reports to whom this year?**

```sql
SELECT m.employee_code AS manager_code, m.display_name AS manager, m.designation,
       count(*) AS direct_reports,
       string_agg(e.display_name, ', ' ORDER BY e.display_name) AS team
  FROM postings p
  JOIN employees e ON e.id = p.employee_id
  JOIN employees m ON m.id = p.reports_to_employee_id
 WHERE p.academic_year_id = app.current_academic_year_id()
   AND e.deleted_at IS NULL AND e.status = 'active'
 GROUP BY m.id, m.employee_code, m.display_name, m.designation
 ORDER BY direct_reports DESC
```

The reporting manager lives on the year's posting, not on the employee row.

**6. Where does this year's ACR round stand?**

```sql
SELECT r.staff_group,
       CASE WHEN r.status = 'disclosed' AND r.object_by < CURRENT_DATE THEN 'closed' ELSE r.status END AS status,
       count(*) AS acrs,
       round(avg(r.score_pct), 1) AS avg_score_pct,
       count(*) FILTER (WHERE r.adverse) AS adverse
  FROM acr_reports r
  JOIN acr_cycles c ON c.id = r.cycle_id
  JOIN employees e ON e.id = r.employee_id
 WHERE c.academic_year_id = app.current_academic_year_id()
   AND e.deleted_at IS NULL
 GROUP BY 1, 2
 ORDER BY 1, 2
```

A disclosed ACR past its objection date is final even if the app has not swept it to closed yet. Sensitive: aggregate only.

**7. Which ACRs wait at a level, and on whom?**

```sql
SELECT e.employee_code, e.display_name, v.seq, v.label,
       (SELECT string_agg(p.display_name, ', ') FROM employees p WHERE p.id = ANY(v.reviewer_ids)) AS waiting_on,
       r.self_submitted_at
  FROM acr_reports r
  JOIN acr_cycles c  ON c.id = r.cycle_id AND c.status = 'open'
  JOIN acr_reviews v ON v.report_id = r.id AND v.seq = r.current_level AND v.status = 'pending'
  JOIN employees e   ON e.id = r.employee_id
 WHERE r.status = 'review'
 ORDER BY r.self_submitted_at
```

`reviewer_ids` are employee ids (not users). An empty array is "waiting on nobody".

**8. How is each vacancy doing (funnel)?**

```sql
SELECT v.code, v.title, v.status AS vacancy_status, v.posts,
       count(a.id)                                                       AS applications,
       count(a.id) FILTER (WHERE a.status IN ('submitted', 'screening', 'on_hold', 'returned')) AS in_process,
       count(a.id) FILTER (WHERE a.status = 'selected')                  AS selected,
       count(a.id) FILTER (WHERE a.status = 'joined')                    AS joined,
       count(a.id) FILTER (WHERE a.status = 'rejected')                  AS not_taken_forward,
       count(a.id) FILTER (WHERE a.source = 'office')                    AS walk_ins
  FROM vacancies v
  LEFT JOIN job_applications a ON a.vacancy_id = v.id
 WHERE v.status NOT IN ('draft', 'cancelled')
 GROUP BY v.id, v.code, v.title, v.status, v.posts
 ORDER BY v.code
```

Selected and joined are separate: a joined application is no longer "selected".

**9. How did candidates do at each stage of a vacancy?**

```sql
SELECT st.sort_order, st.name AS stage, st.kind,
       count(*) FILTER (WHERE x.result IS NOT NULL)  AS recorded,
       count(*) FILTER (WHERE x.result = 'pass')     AS passed,
       count(*) FILTER (WHERE x.result = 'fail')     AS failed,
       round(avg(100 * x.marks / NULLIF(x.max_marks, 0)), 1) AS avg_pct
  FROM application_stage_results x
  JOIN job_applications a  ON a.id = x.application_id
  JOIN recruitment_stages st ON st.id = x.stage_id
 WHERE a.vacancy_id = 1
   AND x.result IS DISTINCT FROM 'skipped'
 GROUP BY st.id, st.sort_order, st.name, st.kind
 ORDER BY st.sort_order
```

Replace `1` with the vacancy id. A row with no result is only scheduled.

**10. Who left or is leaving this year, and is their settlement done?**

```sql
SELECT e.employee_code, e.display_name, e.department, COALESCE(t.name, x.exit_type) AS exit_type,
       x.status, COALESCE(x.left_on, x.accepted_last_day, x.proposed_last_day) AS last_day,
       (SELECT count(*) FROM exit_clearances c WHERE c.exit_id = x.id AND c.status = 'pending') AS departments_pending,
       (SELECT sum(c.dues) FROM exit_clearances c WHERE c.exit_id = x.id)                      AS clearance_dues,
       f.status AS fnf_status, f.net AS fnf_net, f.paid_on
  FROM employee_exits x
  JOIN employees e ON e.id = x.employee_id
  LEFT JOIN employee_exit_types t ON t.code = x.exit_type
  LEFT JOIN employee_fnf f ON f.exit_id = x.id
 WHERE x.status IN ('approved', 'closed')
   AND COALESCE(x.left_on, x.accepted_last_day, x.proposed_last_day) BETWEEN date '2026-04-01' AND date '2027-03-31'
 ORDER BY last_day DESC
```

The exit register's own rule. Where payroll is live, also look at `payroll_settlements` for the same exit (do not add both).

**11. Which staff profile changes are still waiting?**

```sql
SELECT e.employee_code, e.display_name, r.created_at::date AS asked_on, r.current_level,
       (SELECT string_agg(k, ', ') FROM jsonb_object_keys(r.changes) AS k) AS what_changes,
       (now()::date - r.created_at::date) AS days_waiting
  FROM employee_change_requests r
  JOIN employees e ON e.id = r.employee_id
 WHERE r.status = 'pending'
 ORDER BY r.created_at
```

The keys of `changes` are field keys (`mobile`, `bank_ifsc` …) or row edits `list:<kind>:<op>:<row>`; values hold old and new (IDs encrypted).

**12. Each section's class teacher and the section's attendance this month (crosses into student attendance)**

```sql
SELECT k.code AS class, cs.name AS section, e.display_name AS class_teacher,
       sum(m.present) AS present_marks, sum(m.strength) AS possible,
       round(100.0 * sum(m.present) / NULLIF(sum(m.strength), 0), 1) AS attendance_pct
  FROM class_sections cs
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN teacher_assignments ta ON ta.class_section_id = cs.id AND ta.kind = 'class_teacher'
        AND ta.is_actual AND ta.valid_to IS NULL
  LEFT JOIN employees e ON e.id = ta.employee_id
  LEFT JOIN mart.attendance_daily m ON m.class_section_id = cs.id AND m.marked
        AND m.on_date >= date_trunc('month', CURRENT_DATE)::date
 WHERE cs.academic_year_id = app.current_academic_year_id()
 GROUP BY k.display_order, k.code, cs.name, e.display_name
 ORDER BY k.display_order, cs.name
```

Uses the student attendance mart (refreshed every 15 minutes) rather than raw marks. There is no staff mart.

## Traps

- **Text joins to masters.** `employees.department`, `employees.designation`, `postings.department/designation`,
  `vacancies.department/designation/subject/employee_type` are text, not ids. Match masters by lower-cased
  trimmed name; old values from before the masters may not match any row. Group by the text with
  `COALESCE(NULLIF(btrim(department), ''), 'No department')` as the leave dashboard does.
- **Two "employee types".** `employees.employee_type` is the 4-value enum group; the finer type (Class Four,
  Teaching Contract …) is `profile ->> 'staff_type'`, matching `employee_types.name`. Do not join the enum to
  `employee_types.code`.
- **Two department values per person.** The employee row is today's; the posting row is the year's and is not
  updated when the profile changes. Use the employee row for "now", the posting for campus and reporting manager.
- **Deleted, inactive, erased.** Always `deleted_at IS NULL`. Inactive staff are leavers, still needed for
  history. Erased people show as `first_name = 'Erased'`.
- **Sister-school transfers create a second employee.** The same person exists once in each school (different
  `employees.id` and code). `employee_school_transfers` has no `school_id`; both schools see it, so filter by
  `from_school_id` or `to_school_id = app.current_school_id()` for outgoing / incoming.
- **Two document stores.** `employee_documents` (typed, the Documents tab, soft-deleted) and the older
  `person_documents` with `person_type = 'employee'` (the photo upload and early documents). Count required
  documents from `employee_documents` only.
- **Ended assignments stay.** `teacher_assignments` keeps ended rows (`valid_to` set). Without
  `valid_to IS NULL` a teacher is counted in every section they ever held that year.
- **ACR statuses lag.** A disclosed ACR past `object_by` is final but stays "disclosed" until a list is read;
  a published vacancy past `closes_at` stays "published" until the vacancy list is read. Apply the date rule in
  SQL.
- **ACR grade is text.** It matches `acr_grade_bands.label` at the time; renaming a band leaves old grades as they
  were. `acr_reports.score_pct` is the average of rating levels, not the last level's score.
- **ACR people are employee ids, ACR actors are user ids.** `acr_reviews.reviewer_ids` and `profile ->> 'acr_hod'`
  hold employee ids; `filled_by`, `decided_by`, `by_user` hold user ids.
- **Recruitment snapshot.** `job_applications.snapshot` is what was sent; `candidates.profile` is the live form
  (changed later). Report submitted data from the snapshot. One candidate may apply to many vacancies: count
  people with `count(DISTINCT candidate_id)`.
- **Joined ≠ selected.** `joined` replaces `selected`; "selected so far" = selected + joined.
- **Exit FNF and payroll settlement.** `employee_fnf` is the manual statement; `payroll_settlements` is made by a
  trigger once an exit is approved where payroll is set up. Pick one source per report.
- **Cached totals.** `employee_fnf.earnings/deductions/net` are sums of `lines` written by the app; trust them,
  but do not re-add the clearance dues (they are already deduction lines). `employees.completeness` is cached.
- **jsonb fields.** `employees.profile` keys follow the field catalogue (`packages/db/src/employee-fields.ts`):
  e.g. `staff_type`, `blood_group`, `marital_status`, `nature_of_appointment`, `pay_band`, `confirmed_on`,
  `acr_hod`, `approver_l1`. Dates in jsonb are text (`YYYY-MM-DD`); cast with care. Addresses are
  `address -> 'present' / 'permanent'`.
- **Time zone.** Convert timestamptz to the IST date before grouping by day (`submitted_at`, `created_at`).

## Personal and sensitive data

Mask or never send to an AI model:

- `employees`: `first_name`, `last_name`, `display_name`, `dob`, `gender`, `mobile`, `email`, `address` (home
  addresses), `photo_file_id`, `signature_file_id`, `biometric_id`, `details`, `profile` (father's and spouse's
  names, children, emergency contacts, religion, category, blood group, marital status, PF / UAN / ESI / passport
  / voter numbers, bank name and IFSC) and above all `secure` (encrypted Aadhaar, PAN, bank account — never
  decrypt for a report), `search_text` (holds name and mobile).
- `employee_education.score`, `employee_experience.reason`, `employee_remarks.remark` (free text about a person),
  `employee_documents.number`, `.remarks` and the files behind `file_id`, `employee_school_transfers.snapshot`
  (whole profile with encrypted IDs), `employee_change_requests.changes` and `.proofs`.
- `employee_queries.detail`, `.answer` (grievances).
- **ACR — confidential by design**: `acr_reports.self_answers`, `auto_facts`, `office_facts` (leave, late
  arrivals, half-pay leave), `self_pct`, `score_pct`, `grade`, `adverse`, `representation`, `decision_note`;
  `acr_reviews.answers`, `remarks`, `grade`, `grade_reason`, `remark_ids`; `acr_events.note`. Report only to
  people with the ACR right; never to an AI model with names attached.
- Recruitment: `candidates.mobile`, `email`, `name`, `profile`, `secure` (encrypted Aadhaar / PAN);
  `job_applications.snapshot`, `snapshot_secure`, `employee_match`, `correction`, `decision_note`;
  `candidate_files` (photos, ID proofs, parents' photos); `application_stage_results.remarks`, `panel`.
- Exits: `employee_exits.reason`, `letter_file_id`, `decision_note`, `sent_back_note`, `handover`;
  `exit_clearances.note`, `check_result`; `employee_fnf.lines`, `net`, `paid_reference` (money owed to a named
  person); `employee_exit_events.note`.
- Names kept as text for display: `*_by_name`, `filled_by_name`, `recorded_by_name`, `raised_by_name`.
