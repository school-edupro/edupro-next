# Students and families — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

A child becomes a **student** (one per school, unique admission number) through Admit, import, an incoming
transfer or by hand, with one **enrolment** per academic year in a class-section; promotion closes last year's row.
**Guardians** are linked to students (siblings share one). The office keeps the profile (columns plus `profile` /
`secure` jsonb), documents, approved **corrections** and portal change requests, and **merges** duplicates. A
student leaves by a **withdrawal** with department clearances (or a TC, or a transfer within the group); a completed
withdrawal can be revoked. Every status change is kept in a history table.

## Tables

| Table                     | One row is                                                                | Key columns                                                                                                                                                                                                                                                                                   | For reports                                      |
| ------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `students`                | a student of the school (any year, past or present)                       | `admission_no` (unique per school), `first_name`/`last_name`/`display_name`, `dob`, `gender`, `category`, `house`, `admitted_on`, `left_on`, `status` row_status, `deleted_at`, `merged_into_id`, `profile`/`details`/`address`/`secure` jsonb, `user_id`, `rfid_tag`, `profile_completeness` | **main (spine)**                                 |
| `enrolments`              | a student's place in a year: class-section and roll number                | `student_id` + `academic_year_id` (unique), `class_section_id`, `roll_no`, `board_roll_no`, `status` enrolment_status, `joined_on`, `ended_on`                                                                                                                                                | **main (spine for class reports)**               |
| `guardians`               | a parent or guardian (shared by siblings)                                 | `first_name`/`last_name`/`display_name`, `mobile`, `email`, `occupation`, `user_id` (parent's sign-in), `address`/`profile`/`secure`/`details` jsonb, `photo_file_id`, `status`, `deleted_at`                                                                                                 | main                                             |
| `student_guardians`       | one link student ↔ guardian                                               | `student_id` + `guardian_id` (unique), `relation` guardian_relation, `is_primary`, `receives_notifications`                                                                                                                                                                                   | detail                                           |
| `person_documents`        | an uploaded document of a student, guardian or employee                   | `person_type` student/guardian/employee, `person_id` (no FK), `kind` document_kind, `file_id`, `number`, `issued_on`/`expires_on`, `verified_at`, `deleted_at`                                                                                                                                | detail                                           |
| `student_status_history`  | one change of a student's status (trigger-written)                        | `student_id`, `from_status` (NULL on creation), `to_status` (active/inactive, or `removed`), `reason`, `changed_at`, `changed_by`                                                                                                                                                             | history                                          |
| `student_withdrawals`     | a request for a student to leave the school                               | `student_id`, `academic_year_id`, `kind` withdrawal/admission_cancelled, `status` withdrawal_status, `requested_on`/`initiated_on`, `leaving_on`, `completed_at`, `tc_id`, `revoke_status`, `revoked_at`, `current_step`, `batch_id`                                                          | **main (leavers)**                               |
| `withdrawal_clearances`   | one department's clearance on a withdrawal                                | `withdrawal_id` + `department` (unique), `department_id`, `step`, `status` clearance_status, `dues`, `charge`, `charge_misc_fee_id`, `bypassed`, `auto`, `acted_at`                                                                                                                           | detail                                           |
| `withdrawal_departments`  | a department that clears leavers (Accounts, Library…)                     | `process` school/hostel + `code` (unique), `step`, `approvers` jsonb, `auto_check` none/fees/library/hostel_fees, `auto_clear`, `gates_tc`, `charge_kind`, `status`                                                                                                                           | master                                           |
| `school_transfers`        | a student sent to another school of the group                             | `from_school_id`, `to_school_id`, `from_student_id`, `to_student_id`, `to_class_section_id`, `withdrawal_id`, `status` requested/accepted/rejected/cancelled, `requested_at`, `decided_at`                                                                                                    | history (no `school_id`: seen by both schools)   |
| `student_corrections`     | a request to correct name parts, date of birth, gender or parents' names  | `student_id`, `changes` jsonb `{field: {from, to}}`, `reason`, `status` pending/applied/rejected/withdrawn, `workflow_instance_id`, `requested_at`, `decided_at`                                                                                                                              | history                                          |
| `student_merges`          | a request to merge a duplicate student into the kept one                  | `keep_id`, `duplicate_id`, `reason`, `preview`/`result` jsonb, `status` pending/applied/rejected/withdrawn, `decided_at`                                                                                                                                                                      | history                                          |
| `profile_change_requests` | a family's (or office's) request to change profile fields from the portal | `student_id`, `requested_by_user_id`, `entity` student/guardian/profile, `entity_id`, `changes` jsonb, `status` change_request_status, `audience` parent/student/office, `current_level` 1–2, `route`, `proofs`, `auto_applied`, `created_at`                                                 | main (requests)                                  |
| `profile_change_actions`  | one decision on a profile change request                                  | `request_id`, `level`, `decision` approved/rejected/partial/auto/cancelled/override, `fields` jsonb, `actor_id`, `created_at`                                                                                                                                                                 | history                                          |
| `profile_portal_policies` | the school's portal rules for profile fields (one row)                    | `school_id` (unique), `fields`, `proofs`, `edit_window`, `approval` jsonb                                                                                                                                                                                                                     | internal (settings)                              |
| `profile_lists`           | a value of a dropdown list (Religion, Category, House…)                   | `list_code` + `value` (unique per school), `sort_order`, `status`                                                                                                                                                                                                                             | master                                           |
| `student_extra_fields`    | an extra student field created by an admission form                       | `key` (unique per school), `label`, `type`, `list`, `status` active/archived                                                                                                                                                                                                                  | master (values in `students.profile -> 'extra'`) |
| `family_app_layouts`      | the family / staff app layout the school publishes                        | PK `school_id`+`audience` parent/student/staff, `draft`, `published` jsonb, `published_at`                                                                                                                                                                                                    | internal (settings)                              |

Related tables in other guides: `admission_cancellations` and `admission_no_changes` (admissions guide),
`promotion_decisions` (academics), `transfer_certificates` (certificates), `user_school_memberships` (platform).

## How the tables join

Spine: **`enrolments`** for anything "by class" or "in a year"; **`students`** for the person.

The class of a student in a year

- `enrolments.student_id → students.id`
- `enrolments.academic_year_id → academic_years.id`
- `enrolments.class_section_id → class_sections.id`; `class_sections.class_id → classes.id`
  (`class_sections.academic_year_id` equals `enrolments.academic_year_id`; `classes.display_order` sorts classes)
- the working year: `academic_years.status = 'active'` (the app also sets `app.current_academic_year_id()`)

Family

- `student_guardians.student_id → students.id`; `student_guardians.guardian_id → guardians.id`
- siblings: two `student_guardians` rows with the same `guardian_id` (the view `student_siblings`, not in the
  digest, gives `student_id`, `sibling_id`, `guardian_id`)
- sign-ins: `students.user_id`, `guardians.user_id → users.id`; also `user_school_memberships.person_ref_id` with
  `person_type` student / guardian

Documents and photos

- `person_documents.person_id → students.id` when `person_type = 'student'` (→ `guardians.id` for 'guardian',
  → `employees.id` for 'employee'); `person_documents.file_id → files.id`
- `students.photo_file_id`, `guardians.photo_file_id → files.id`

Leaving and history

- `student_withdrawals.student_id → students.id`; `.academic_year_id → academic_years.id`;
  `.tc_id → transfer_certificates.id`
- `withdrawal_clearances.withdrawal_id → student_withdrawals.id`; `.department_id → withdrawal_departments.id`;
  `.charge_misc_fee_id → misc_fees.id`
- `school_transfers.from_student_id → students.id` (sending school); `.withdrawal_id → student_withdrawals.id`;
  `to_student_id` / `to_class_section_id` are ids in the receiving school (no FK)
- `student_status_history.student_id → students.id`
- `student_corrections.student_id`, `profile_change_requests.student_id → students.id`;
  `profile_change_actions.request_id → profile_change_requests.id`
- `student_merges.keep_id`, `.duplicate_id → students.id`; `students.merged_into_id → students.id`
- approvals: `student_corrections.workflow_instance_id`, `student_merges.workflow_instance_id`,
  `student_withdrawals.revoke_workflow_instance_id → workflow_instances.id`
- who: `created_by`, `updated_by`, `requested_by`, `decided_by`, `changed_by` → `users.id`

Out to other modules: almost every module keys on `student_id → students.id` (fees, attendance, exams, hostel,
transport, library). Admissions: `applications.student_id → students.id`.

## Life-cycles and statuses

**`students.status`** (row_status): `active` = on the rolls; `inactive` = left (withdrawal completed, TC issued,
admission cancelled), merged, or erased. `deleted_at` set = removed from lists (deleted by the office when it had no
active enrolment, or merged into another record). `left_on` = the leaving date. Current students:
`deleted_at IS NULL AND status = 'active'` with an `active` enrolment of the year.

**`enrolments.status`** (enrolment_status):

| Value         | Set when                                                                                                | Count in this year's strength?                    |
| ------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `active`      | enrolled (Admit, import, promotion into the year, revoke of a withdrawal)                               | yes                                               |
| `promoted`    | the year closed and the student was promoted **or retained** into the next year (`ended_on` = year end) | no now; yes for "who was in this class that year" |
| `withdrawn`   | a withdrawal was completed (`ended_on` = leaving date)                                                  | no now; yes before `ended_on`                     |
| `transferred` | a TC was issued straight from Certificates (no withdrawal)                                              | as withdrawn                                      |
| `left`        | a promotion decision of transfer-out or graduate                                                        | as withdrawn                                      |
| `cancelled`   | the admission was cancelled ("admitted by mistake")                                                     | never: leave it out of every count                |

**`student_withdrawals.status`** (withdrawal_status): `requested` (departments clearing; `current_step`), `cleared`
(all clearances done, can be completed), `completed` (left: enrolment `withdrawn`, student `inactive`, `left_on`,
logins stopped), `cancelled` (the request was dropped), `revoked` (a completed withdrawal undone: enrolment back to
`active`, student `active`, fees charged again). Revoking goes through `revoke_status` pending → approved
(status becomes `revoked`) or rejected. `kind = 'admission_cancelled'` rows are the bookkeeping side of a cancelled
admission, not real leavers. At most one open (`requested`/`cleared`) withdrawal per student.

**`withdrawal_clearances.status`** (clearance_status): pending, cleared, hold. `bypassed` = cleared without the check;
`auto` = cleared by the automatic check (fees, library, hostel fees).

**Request tables** (`student_corrections`, `student_merges`, `admission_cancellations`): pending → applied (written)
or rejected / withdrawn; one pending request per student; `apply_error` = approved but not written.
`profile_change_requests.status` (change_request_status): pending, approved, rejected, partially_approved,
cancelled; `profile_change_actions` keeps each level's decision. `school_transfers.status`: requested → accepted
(student created in the other school) or rejected / cancelled.

**`student_status_history`** is written by a trigger on every insert and status change of `students` (any path:
API, import, ETL): `to_status` is `active`, `inactive` or `removed` (soft delete); `reason` comes from the action
(for example "withdrawal: …", "Merged into …", "withdrawal revoked").

## Amounts, dates and counting rules

- **One row per what.** `enrolments`: one per student per academic year (re-enrolling the same year updates the
  row). Active roll numbers are unique per section. `student_guardians`: one per student and guardian.
  `students`: one per child per school; a transferred child gets a **new** student row (and admission number) in
  the receiving school.
- **Strength.** Count `enrolments` with `status = 'active'` of the year, joined to `students` with
  `deleted_at IS NULL`. Strength on a past date: statuses other than `cancelled` with
  `joined_on <= date AND (ended_on IS NULL OR ended_on >= date)`.
- **New admissions.** `students.admitted_on` within the year's dates (the app's people dashboard does this);
  `enrolments.joined_on` is also set at Admit. Leavers: `student_withdrawals` `completed` by `leaving_on`, or
  `students.left_on`.
- **Dates.** `dob`, `admitted_on`, `left_on`, `joined_on`, `ended_on`, `leaving_on` are plain dates. `*_at` columns are
  timestamptz: group by `(x AT TIME ZONE 'Asia/Kolkata')::date`.
- **Money.** `withdrawal_clearances.dues` (what the check found due) and `charge` (a damage / mess charge raised as a
  misc fee) are rupees; the fee settlement itself lives in the fees module (`fee_demands`, `fee_refunds`).
- **Profile jsonb.** `students.profile` holds the catalogue fields (keys such as `religion`, `mother_tongue`,
  `ews`, `cwsn`, `pen_no`, `apaar_id`, `previous_school_name`, `registration_no`, `transport_required`,
  `boarding`, `medical_condition`) and `extra` (fields from admission forms); `students.address` holds `line1`–`line3`,
  `city`, `state`, `pin`, `country`; `students.secure` holds ciphertext of `aadhaar_no` and `bank_account_no`.
  Guardians: `guardians.profile` (e.g. `education`, `annual_income`, `organisation`, `designation`, `whatsapp_no`,
  `date_of_birth`) and `guardians.secure` (`aadhaar_no`, `pan_no` ciphertext). Values are text ("Yes"/"No" for
  flags). `students.details` is older free data (an erased record keeps `erased_at` there).

## Answering report questions

**1. Class and section strength today, boys and girls.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.display_order, k.name AS class_name, cs.name AS section, cs.capacity,
       count(*)                                        AS strength,
       count(*) FILTER (WHERE s.gender = 'male')       AS boys,
       count(*) FILTER (WHERE s.gender = 'female')     AS girls
  FROM enrolments e
  JOIN y ON y.id = e.academic_year_id
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id AND cs.deleted_at IS NULL
  JOIN classes k ON k.id = cs.class_id
 WHERE e.status = 'active'
 GROUP BY k.display_order, k.name, cs.name, cs.capacity
 ORDER BY k.display_order, cs.name
```

The working year is the `active` one; replace it with a chosen year when needed.

**2. How many were on roll in each class on a past date?**

```sql
SELECT k.name AS class_name, count(*) AS on_roll
  FROM enrolments e
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN academic_years y ON y.id = e.academic_year_id
 WHERE y.code = '2025-26'
   AND e.status IN ('active', 'promoted', 'withdrawn', 'left', 'transferred')
   AND e.joined_on <= DATE '2025-09-30'
   AND (e.ended_on IS NULL OR e.ended_on >= DATE '2025-09-30')
 GROUP BY k.display_order, k.name
 ORDER BY k.display_order
```

Past years have most rows `promoted`, so filter by dates, not by `active`. `cancelled` is never counted.

**3. Category, EWS and children with special needs by class.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class_name,
       COALESCE(s.category, 'Not given')                AS category,
       count(*)                                         AS pupils,
       count(*) FILTER (WHERE s.profile ->> 'ews' = 'Yes')  AS ews,
       count(*) FILTER (WHERE s.profile ->> 'cwsn' = 'Yes') AS cwsn
  FROM enrolments e
  JOIN y ON y.id = e.academic_year_id
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE e.status = 'active'
 GROUP BY k.display_order, k.name, 2
 ORDER BY k.display_order, 2
```

`category` is a column; `ews` and `cwsn` are "Yes"/"No" text in `profile`.

**4. New admissions this year by class, and how many came through online admission.**

```sql
WITH y AS (SELECT id, start_date, end_date FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class_name, count(*) AS new_admissions,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM applications a WHERE a.student_id = s.id)) AS through_online_admission
  FROM students s
  JOIN y ON s.admitted_on BETWEEN y.start_date AND y.end_date
  JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = y.id
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE s.deleted_at IS NULL AND e.status <> 'cancelled'
 GROUP BY k.display_order, k.name
 ORDER BY k.display_order
```

Uses `admitted_on`; a child admitted in an earlier year but enrolled again is not "new".

**5. Leavers by month: withdrawals, cancelled admissions, TCs, transfers in the group.**

```sql
SELECT date_trunc('month', w.leaving_on)::date AS month,
       count(*) FILTER (WHERE w.kind = 'withdrawal')            AS withdrawals,
       count(*) FILTER (WHERE w.kind = 'admission_cancelled')   AS admissions_cancelled,
       count(*) FILTER (WHERE tc.status = 'issued')             AS tc_issued,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM school_transfers t
                                       WHERE t.withdrawal_id = w.id AND t.status = 'accepted')) AS to_group_school
  FROM student_withdrawals w
  JOIN academic_years y ON y.id = w.academic_year_id
  LEFT JOIN transfer_certificates tc ON tc.id = w.tc_id
 WHERE y.status = 'active' AND w.status = 'completed'
 GROUP BY 1
 ORDER BY 1
```

Only `completed` withdrawals are leavers; split `kind` so cancelled admissions are not called withdrawals.

**6. Withdrawals still waiting for clearance.**

```sql
SELECT s.admission_no, s.display_name, w.leaving_on, w.current_step,
       string_agg(c.department || ' (' || c.status || ')', ', ' ORDER BY c.step, c.department)
         FILTER (WHERE c.status <> 'cleared')                    AS waiting_for,
       sum(c.dues) FILTER (WHERE c.status <> 'cleared')          AS dues_shown
  FROM student_withdrawals w
  JOIN students s ON s.id = w.student_id
  LEFT JOIN withdrawal_clearances c ON c.withdrawal_id = w.id
 WHERE w.status IN ('requested', 'cleared')
 GROUP BY s.admission_no, s.display_name, w.leaving_on, w.current_step
 ORDER BY w.leaving_on
```

Open = `requested` or `cleared`; `current_step` is the step now clearing.

**7. Current students no parent can be reached on by mobile.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class_name, cs.name AS section, s.admission_no, s.display_name,
       count(sg.id)                                                    AS guardians_linked,
       bool_or(sg.is_primary)                                          AS has_primary,
       bool_or(g.mobile IS NOT NULL AND sg.receives_notifications)     AS reachable_by_mobile,
       bool_or(g.user_id IS NOT NULL)                                  AS parent_can_sign_in
  FROM enrolments e
  JOIN y ON y.id = e.academic_year_id
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN student_guardians sg ON sg.student_id = s.id
  LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
 WHERE e.status = 'active'
 GROUP BY k.display_order, k.name, cs.name, s.admission_no, s.display_name
HAVING NOT COALESCE(bool_or(g.mobile IS NOT NULL AND sg.receives_notifications), false)
 ORDER BY k.display_order, cs.name, s.display_name
```

`receives_notifications` false means the school does not message that guardian.

**8. Families with two or more children studying now.**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1),
kids AS (
  SELECT sg.guardian_id, count(DISTINCT e.student_id) AS children
    FROM student_guardians sg
    JOIN enrolments e ON e.student_id = sg.student_id AND e.status = 'active'
    JOIN y ON y.id = e.academic_year_id
    JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
   WHERE sg.relation IN ('father', 'mother')
   GROUP BY sg.guardian_id
)
SELECT children, count(*) AS parents
  FROM kids
 WHERE children >= 2
 GROUP BY children
 ORDER BY children
```

Counted per parent record; a family with separate father and mother records is counted once per parent.

**9. Promotion flow: last year's class against this year's (crosses into the next year).**

```sql
WITH last_y AS (SELECT id FROM academic_years WHERE code = '2025-26'),
     this_y AS (SELECT id FROM academic_years WHERE code = '2026-27')
SELECT k1.name AS class_last_year, e1.status AS ended_as,
       k2.name AS class_this_year, count(*) AS pupils
  FROM enrolments e1
  JOIN last_y ON last_y.id = e1.academic_year_id
  JOIN class_sections cs1 ON cs1.id = e1.class_section_id
  JOIN classes k1 ON k1.id = cs1.class_id
  JOIN students s ON s.id = e1.student_id AND s.deleted_at IS NULL
  LEFT JOIN (enrolments e2 JOIN this_y ON this_y.id = e2.academic_year_id) ON e2.student_id = e1.student_id
  LEFT JOIN class_sections cs2 ON cs2.id = e2.class_section_id
  LEFT JOIN classes k2 ON k2.id = cs2.class_id
 WHERE e1.status <> 'cancelled'
 GROUP BY k1.display_order, k1.name, e1.status, k2.display_order, k2.name
 ORDER BY k1.display_order, k2.display_order NULLS LAST
```

A retained student is `promoted` too (the old row closes); compare the classes to tell them apart.

**10. Overdue fees by class (crosses into fees).**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class_name, count(DISTINCT e.student_id) AS pupils,
       count(DISTINCT d.student_id) FILTER (WHERE d.net > d.paid AND d.due_on < CURRENT_DATE) AS pupils_overdue,
       COALESCE(sum(d.net - d.paid) FILTER (WHERE d.due_on < CURRENT_DATE), 0)               AS overdue_amount
  FROM enrolments e
  JOIN y ON y.id = e.academic_year_id
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN fee_demands d ON d.student_id = e.student_id AND d.academic_year_id = e.academic_year_id
                         AND d.status IN ('pending', 'partial')
 WHERE e.status = 'active'
 GROUP BY k.display_order, k.name
 ORDER BY k.display_order
```

`fee_demands` lines `pending`/`partial`; the fees guide has the full rules (or use `mart.fee_dues`).

**11. Find a student by any admission number, old or new, and resolve merges.**

```sql
WITH q AS (SELECT lower('A0123') AS no)
SELECT s.id, s.admission_no AS current_no, s.display_name, s.status,
       COALESCE(s.merged_into_id, s.id) AS record_to_use, 'current number' AS matched_on
  FROM students s, q
 WHERE lower(s.admission_no) = q.no
UNION ALL
SELECT s.id, s.admission_no, s.display_name, s.status, COALESCE(s.merged_into_id, s.id), 'old number (' || c.reason || ')'
  FROM admission_no_changes c
  JOIN students s ON s.id = c.student_id
  JOIN q ON lower(c.old_no) = q.no
```

A merged duplicate keeps its number but has `merged_into_id`; changed numbers are in `admission_no_changes`.

**12. Boarders in each class (crosses into hostel).**

```sql
WITH y AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class_name,
       count(*)                                                                    AS strength,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM hostel_allotments h
                                       WHERE h.student_id = e.student_id AND h.from_date <= CURRENT_DATE
                                         AND (h.to_date IS NULL OR h.to_date >= CURRENT_DATE))) AS boarders
  FROM enrolments e
  JOIN y ON y.id = e.academic_year_id
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE e.status = 'active'
 GROUP BY k.display_order, k.name
 ORDER BY k.display_order
```

A hostel stay is open when `to_date` is NULL or not yet passed.

## Traps

- **Soft deletes and merges.** Always `students.deleted_at IS NULL`. A merged duplicate has `deleted_at`,
  `status = 'inactive'` and `merged_into_id`; its enrolments, marks, fees, guardians and the rest moved to the kept
  record (where both had a row for the same year or day, the duplicate's row was deleted). Its status history stays.
- **Rows per year.** `enrolments` has one row per year: join on `academic_year_id` or you count a child once per
  year. Never infer the class from `students`; it has no class column.
- **`active` only means this year.** Last year's rows are `promoted`/`left`/`withdrawn`; filtering `status = 'active'`
  for a closed year returns nearly nothing.
- **Cancelled admissions** keep their enrolment (`cancelled`), marks and attendance; always exclude `cancelled`.
- **Revoked withdrawals.** A `revoked` withdrawal is not a leaver; the child is active again.
- **Guardians are shared.** Counting guardians per student double-counts families; counting students per guardian
  double-counts children with two parents. `is_primary` marks the main contact; there may be none.
- **Erased records.** A data-erasure request sets the name to "Erased" / "Pupil <id>", clears contact data and sets
  `status = 'inactive'` without `deleted_at`; they still appear in historical counts.
- **School transfers.** `school_transfers` has no `school_id` and is visible to both schools; the other school's
  student row is hidden by row-level security, so `to_student_id` cannot be joined from the sending school.
- **jsonb values are text.** Compare `profile ->> 'ews' = 'Yes'`; dates inside jsonb are text too. `secure` values are
  ciphertext: you can test presence, never read or group them.
- **`person_documents` has no FK** on `person_id`; always filter `person_type`, and `deleted_at IS NULL` (a replaced
  document is soft-deleted).
- **`display_name` and `search_text` are generated** columns; use them, do not rebuild names.
- **Time zones.** `changed_at`, `requested_at`, `decided_at` are timestamptz; convert before taking the date.

## Personal and sensitive data

Mask or keep away from an AI model:

- `students`: `first_name`, `last_name`, `display_name`, `search_text`, `dob`, `gender`, `category`, `blood_group`,
  `address`, `details`, `profile` (religion, caste and sub-caste, income band, disability and medical condition,
  mobiles, e-mails, bank name / IFSC / account holder, PEN, APAAR, previous school, siblings), `secure` (Aadhaar,
  bank account: encrypted, never decrypt for reports), `photo_file_id`, `rfid_tag`, `user_id`, `legacy_ref`.
- `guardians`: `first_name`, `last_name`, `display_name`, `search_text`, `mobile`, `email`, `occupation`, `address`,
  `details`, `profile` (income, education, employer and office address, date of birth, WhatsApp), `secure` (Aadhaar,
  PAN), `photo_file_id`.
- `person_documents`: `number` (Aadhaar, PAN, bank numbers), `title`, `file_id`.
- Free text and copies of personal data: `student_corrections.changes`/`reason`; `student_merges.preview`/`result`/
  `reason`; `profile_change_requests.changes`/`reason`/`proofs`/`decision_note`; `profile_change_actions.fields`/`note`;
  `student_withdrawals.reason`/`remarks`/`documents`/`cancel_reason`/`revoke_reason`/`revoke_hostel_note`;
  `withdrawal_clearances.remarks`/`documents`/`check_result`; `school_transfers.snapshot` (the whole profile with
  photos and encrypted IDs), `note`, `requested_by_name`, `decided_by_name`, `decision_note`;
  `student_status_history.reason`; `enrolments.remarks`.
