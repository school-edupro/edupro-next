# Certificates — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

One register for every certificate issued to a student or staff member (TC, bonafide, character, fee paid, awards,
experience, the school's own types). A parent, student or staff member may **request** one; it passes the type's approval
levels and, if charged, a misc fee. The office runs the type's checks (the principal may override), the paper gets the next
number of its type and year (a TC also a book Sl. No.), every printed field is **frozen**, and a QR opens a public
**verification**. Papers can be duplicated, cancelled, re-issued or corrected, issued in bulk or from Excel; awards are
allotted and printed; the old system's register came across as history.

## Tables

| Table                          | One row is                                                                           | Key columns                                                                                                                                                                                                                                                                                                                                                    | For reports                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `certificates`                 | one certificate paper: an original (`copy_no = 0`) or a duplicate (`copy_no` 1, 2 …) | `type_id`, `number`, `copy_no`, `original_id`, `serial`, `year_code`, `student_id` / `employee_id` (exactly one), `status`, `issued_on`, `issued_by`, `purpose`, `data` (frozen jsonb), `checks`, `override_reason`, `book_no`, `sl_no`, `request_id`, `batch_id`, `reissue_of`, `revision`, `transfer_certificate_id`, `legacy`, `legacy_ref`, `cancelled_at` | main (the register; the spine)                                  |
| `certificate_types`            | a certificate type of the school (TC, BONAFIDE …, or its own)                        | `code`, `name`, `audience` (STUDENT / STAFF), `prefix`, `template_id`, `rules`, `multiple`, `uses_book`, `request`, `fields`, `variants`, `issuers` (jsonb), `active`, `built_in`, `sort_order`                                                                                                                                                                | master                                                          |
| `certificate_requests`         | one request for a certificate (from the parent, student or staff app, or the office) | `type_id`, `student_id` / `employee_id`, `requested_by`, `channel`, `purpose`, `copies`, `status`, `fee_amount`, `misc_fee_id`, `fee_waived_reason`, `certificate_ids`, `decided_at`, `issued_at`, `workflow_instance_id`, `created_at`                                                                                                                        | main                                                            |
| `certificate_revisions`        | one revision of a certificate corrected under the same number                        | `certificate_id`, `revision`, `data`, `template_version_id`, `issued_on`, `reason`, `changes`, `export_id`                                                                                                                                                                                                                                                     | history                                                         |
| `certificate_verifications`    | one public check of a certificate (QR or number search)                              | `certificate_id` (NULL when not found), `method`, `result`, `number_tried`, `ip_hash`, `checked_at`                                                                                                                                                                                                                                                            | history (log)                                                   |
| `certificate_batches`          | certificates issued together (a section, chosen students, leavers, award allotments) | `type_id`, `title`, `scope`, `certificate_ids`, `skipped`, `override_reason`, `export_id`, `run_id`, `created_at`                                                                                                                                                                                                                                              | detail                                                          |
| `certificate_imports`          | an Excel sheet uploaded to issue certificates (a draft with its rows)                | `type_id`, `title`, `scope`, `file_name`, `uploads`, `columns`, `rows` (jsonb), `run_ids`                                                                                                                                                                                                                                                                      | internal (imports)                                              |
| `certificate_awards`           | an award the school gives (master)                                                   | `name`, `type_code` (the certificate type it prints on), `active`, `sort_order`                                                                                                                                                                                                                                                                                | master                                                          |
| `certificate_award_allotments` | an award given to one student                                                        | `award_id`, `student_id`, `event`, `position`, `awarded_on`, `remarks`, `certificate_id`                                                                                                                                                                                                                                                                       | main                                                            |
| `certificate_settings`         | one row per school: who signs and what prints                                        | `signatory_employee_id`, `signatory_title`, `print_signature`, `print_preparer`, `corrections_keep_number`                                                                                                                                                                                                                                                     | internal (settings)                                             |
| `certificate_series`           | the last serial of a type in a year                                                  | `type_code`, `year_code`, `last_serial`                                                                                                                                                                                                                                                                                                                        | internal (sequence)                                             |
| `certificate_book_series`      | the TC book's last Sl. No. (one row per school)                                      | `last_sl`                                                                                                                                                                                                                                                                                                                                                      | internal (sequence)                                             |
| `document_templates`           | a printable layout (shared with fee receipts, letters, gate passes …)                | `code`, `name`, `kind` (template_kind), `version`, `ready_code`, `status`, `deleted_at`                                                                                                                                                                                                                                                                        | master                                                          |
| `document_template_versions`   | one saved version of a template (written by trigger)                                 | `template_id`, `version`, `body_html`, `page_width`, `page_height`                                                                                                                                                                                                                                                                                             | history                                                         |
| `transfer_certificates`        | the older TC table: one row per TC, still written for every TC                       | `student_id`, `academic_year_id`, `tc_no`, `serial`, `issued_on`, `reason`, `last_class`, `status` (tc_status), `snapshot`                                                                                                                                                                                                                                     | legacy cut-over (use `certificates`; join only for withdrawals) |
| `tc_sequences`                 | the older TC number counter                                                          | `last_serial`                                                                                                                                                                                                                                                                                                                                                  | internal (retired by 0382)                                      |
| `certificates_issued`          | the engagement module's achievement certificates (older table, still written)        | `student_id`, `template_id`, `serial_no`, `title`, `text`, `issued_on`                                                                                                                                                                                                                                                                                         | legacy cut-over (mirrored in `certificates`)                    |
| `certificate_cutover`          | one row per school: the read and bring of the old system's register                  | `read_at`, `read_error`, `read_counts`, `book_last_sl`, `type_map`, `brought_at`, `brought`                                                                                                                                                                                                                                                                    | internal (cut-over)                                             |
| `certificate_legacy_rows`      | one row of the old system's certificate register as read                             | `srno`, `payload` (jsonb), `read_id`                                                                                                                                                                                                                                                                                                                           | internal (cut-over)                                             |

19 tables. There is **no mart** for this module.

## How the tables join

**Spine:** `certificates` (one row per paper). Filter `copy_no = 0` for "certificates issued", add `status = 'issued'`
for "still valid".

Inside the module

- `certificates.type_id → certificate_types.id`; `certificate_types.template_id → document_templates.id`
- `certificates.template_version_id → document_template_versions.id`; `document_template_versions.template_id → document_templates.id`
- `certificates.original_id → certificates.id` (a duplicate → its original); `certificates.reissue_of → certificates.id` (the new paper → the cancelled one it replaced)
- `certificates.request_id → certificate_requests.id` (also `certificate_requests.certificate_ids` bigint[]); `certificate_requests.type_id → certificate_types.id`
- `certificates.batch_id → certificate_batches.id` (also `certificate_batches.certificate_ids` bigint[], in print order); `certificate_batches.type_id → certificate_types.id`; the batches of one run share `certificate_batches.run_id`; `certificate_imports.run_ids` holds those run ids
- `certificate_revisions.certificate_id → certificates.id`; `certificate_revisions.template_version_id → document_template_versions.id`
- `certificate_verifications.certificate_id → certificates.id`
- `certificate_award_allotments.award_id → certificate_awards.id`; `certificate_award_allotments.certificate_id → certificates.id`; `certificate_awards.type_code = certificate_types.code` (text, no FK)
- `certificate_series.type_code = certificate_types.code` and `certificate_series.year_code = certificates.year_code` (text)
- `certificates.transfer_certificate_id → transfer_certificates.id` (originals only, unique); `transfer_certificates.template_id → document_templates.id`
- `certificates.legacy_ref`: `'legacy:' || certificate_legacy_rows.srno` for the old system's rows; `'achievement:' || certificates_issued.id` for the engagement module's achievement certificates

Out to the backbone

- Students: `certificates.student_id`, `certificate_requests.student_id`, `certificate_award_allotments.student_id`, `transfer_certificates.student_id`, `certificates_issued.student_id → students.id`
- Class at issue: `certificates.year_code = academic_years.code` → `enrolments (student_id, academic_year_id)` → `class_sections` → `classes`. `transfer_certificates.academic_year_id → academic_years.id` directly.
- Staff: `certificates.employee_id`, `certificate_requests.employee_id`, `certificate_settings.signatory_employee_id → employees.id`
- Withdrawals: `student_withdrawals.tc_id → transfer_certificates.id` → `certificates.transfer_certificate_id`
- Fees: `certificate_requests.misc_fee_id` (no FK) `= misc_fees.id`; the student's line `misc_fee_students (misc_fee_id, student_id)` with `status` open / paid / cancelled
- Approvals: `certificate_requests.workflow_instance_id` (no FK) `= workflow_instances.id` (`entity_type = 'certificate_request'`) → `workflow_steps`
- Users: `issued_by`, `cancelled_by`, `override_by`, `requested_by`, `decided_by`, `created_by → users.id`
- PDFs: `certificates.export_id`, `certificate_revisions.export_id`, `certificate_batches.export_id`, `transfer_certificates.export_id`, `certificates_issued.export_id → exports.id`

## Life-cycles and statuses

**`certificates.status`**: `issued` or `cancelled` (with `cancelled_at`, `cancelled_by`, `cancel_reason`). Cancelling an
original cancels its duplicates too, and (for a TC) its `transfer_certificates` row. A number is never given again, even
after a cancel. A **duplicate** is a new row with the same `number`, `copy_no` = next, `original_id` set, its own
`issued_on` (the day it was made) and its own verify link; no `transfer_certificate_id`. A **re-issue** makes a new
certificate with a new number and `reissue_of` = the old one, and cancels the old one in the same step (one re-issue
each). A **correction that keeps the number** (when `certificate_settings.corrections_keep_number`) raises
`certificates.revision` (1, 2 …), sets `revised_at`, replaces `data`, `purpose`, `template_version_id` and `issued_on` on
the same row, and writes `certificate_revisions` rows (revision 1 = the paper as first issued, saved at the first
correction). `legacy = true`: brought from the old system (read-only; one the old system deleted came as `cancelled`).
`override_reason` set: issued although a check failed (the principal, with MFA).

**`certificates.checks`** (and `certificate_requests.checks`): a jsonb array `[{key, label, ok, detail}]`; keys `state`,
`class`, `fees`, `library`, `hostel`, `transport`, `one`. A failed check stops the issue unless overridden; `one` is never
overridden.

**`certificate_types`**: `multiple` = `ONE` (one live original ever), `YEAR` (one a year), `ANY`. `rules` jsonb:
`{"state": "active" | "leaving" | "any", "fees", "library", "hostel", "transport": bool, "classes": [...]}`. `request`
jsonb: `{"open": {"parent", "student", "staff"}, "purposes", "maxCopies", "fee", "levels": [...]}`. `uses_book` = the TC's
book / Sl. No. series. `active = false`: no longer issued (old certificates keep it). Built-in codes: TC, BONAFIDE,
CHARACTER, DOB, DOB_JUST, STUDY, CASTE, DOMICILE, NOC, TRAVEL_NOC, VISA, SCHOLAR, BOARD_REG, FEE_PAID, BOARD_FORM,
ACHIEVEMENT, MERIT, PARTICIPATION, AWARD (students); EXPERIENCE, SERVICE, STAFF_VISA (staff).

**`certificate_requests.status`**: `submitted` (with the type's approval levels) → `approved` → `issued` (`issued_at`,
`certificate_ids`); or `rejected` (with `decision_note`) / `withdrawn` (by the requester). Between `approved` and
`issued` the app shows a stage: **waiting for the fee** when `misc_fee_id` is set, `fee_waived_reason` is NULL and the
student's `misc_fee_students` line is not `paid`; otherwise **ready to issue**. Open requests = `submitted` + `approved`.
`channel`: parent, student, staff, office.

**`certificate_verifications`**: `method` `qr` (the printed link) or `search` (number + date of issue, originals only);
`result` `valid`, `cancelled`, `not_found`. Every check is logged, including bogus ones.

**`transfer_certificates.status`** (enum `tc_status`): issued / cancelled — kept in step with the TC's register row.
**`document_templates.kind`** (enum `template_kind`): transfer_certificate, bonafide, letter, fee_receipt, certificate,
gate_pass; `status` row_status; `deleted_at` soft delete. Every saved change of a template writes a new
`document_template_versions` row (trigger); certificates keep the version they printed with.

**History.** The audit trigger writes `audit_logs` (`entity_type` = table name) for `certificates`, `certificate_types`,
`certificate_requests`, `certificate_revisions`, `certificate_batches`, `certificate_awards`,
`certificate_award_allotments`, `certificate_settings`, `certificate_book_series`, `certificate_cutover`. Request
approvals are in `workflow_steps` / `workflow_events`.

## Amounts, dates and counting rules

- **Numbers.** `number` = `PREFIX/YEAR/00001` (prefix of the type, `year_code`, five-digit serial per type and year from
  `certificate_series`). TCs issued before the register kept their four-digit numbers (`TC/2026-27/0004`); old-system
  certificates keep their old numbers. Unique key: `(school_id, number, copy_no)`, so one number = one original + its
  duplicates. `serial` is NULL for the engagement module's achievement certificates.
- **TC book.** `sl_no` runs on for ever (never resets); `book_no = (sl_no − 1) / 100 + 1` (100 to a book); only for
  types with `uses_book` (the TC). Duplicates repeat the original's `book_no` / `sl_no`.
- **Year.** `year_code` is the code of the **academic year the office was working in** when it issued (the session's
  year), not worked out from `issued_on`. Old-system rows take it from their financial year. Join to `academic_years`
  on `academic_years.code = certificates.year_code`.
- **Dates.** `issued_on` (date) is the day of issue — but a correction under the same number moves it to the
  correction's day; the first day is then in `certificate_revisions` (revision 1). A duplicate's `issued_on` is the day
  the duplicate was made. Requests and checks have only timestamps: use `(created_at AT TIME ZONE 'Asia/Kolkata')::date`,
  `issued_at`, `checked_at` the same way.
- **Counting.** Certificates issued = originals (`copy_no = 0`); duplicates are counted apart (`copy_no > 0`); valid =
  `status = 'issued'`. The app's reports count by `issued_on` within the dates and show issued / duplicates / cancelled /
  overrides per type and month. Request turnaround = `issued_at − created_at` of issued requests.
- **Money.** Only `certificate_requests.fee_amount` (rupees, the type's fee when asked). What was paid lives in the fees
  module (`misc_fee_students.paid`, `status`).
- **Frozen data.** `certificates.data` holds everything printed, as it was on the day: `student` (or the staff
  member's details), `fields` (typed details such as the TC's reason, conduct, promotion), `tc` (for TCs: `reason`,
  `lastClass`, `conduct` …), `cert` (number, book / Sl. No., revision), `school`, `attendance`, `fees`, `signs`, `qr`.
  Use it for "what the paper says"; use `students` for who the person is now.

## Answering report questions

1. **How many certificates of each type did we issue this academic year, and how many are cancelled or duplicates?**

```sql
SELECT t.code, t.name,
       count(*) FILTER (WHERE x.copy_no = 0) AS issued,
       count(*) FILTER (WHERE x.copy_no = 0 AND x.status = 'issued') AS still_valid,
       count(*) FILTER (WHERE x.copy_no = 0 AND x.status = 'cancelled') AS cancelled,
       count(*) FILTER (WHERE x.copy_no > 0) AS duplicates,
       count(*) FILTER (WHERE x.override_reason IS NOT NULL) AS overrides
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id
 WHERE x.year_code = '2026-27' AND NOT x.legacy
 GROUP BY t.code, t.name, t.sort_order
 ORDER BY t.sort_order
```

Originals only for "issued"; `legacy` rows left out (they are the old system's history).

2. **The TC book register, in book and Sl. No. order.**

```sql
SELECT x.book_no, x.sl_no, x.number, x.issued_on, s.admission_no, s.display_name AS student,
       x.data->'tc'->>'lastClass' AS last_class, x.data->'tc'->>'reason' AS reason,
       x.status, x.cancel_reason, x.legacy,
       (SELECT count(*) FROM certificates d WHERE d.original_id = x.id) AS duplicates
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id
  LEFT JOIN students s ON s.id = x.student_id
 WHERE t.code = 'TC' AND x.copy_no = 0
 ORDER BY x.book_no NULLS LAST, x.sl_no NULLS LAST, x.issued_on, x.id
```

The class and reason come from the frozen paper (`data->'tc'`), as the app's register shows them.

3. **How many students of each class took a TC this year?** (crosses into enrolments / classes)

```sql
SELECT c.code AS class, c.name AS class_name, count(DISTINCT x.student_id) AS students_with_tc
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id AND t.code = 'TC'
  JOIN academic_years y ON y.code = x.year_code
  JOIN enrolments e ON e.student_id = x.student_id AND e.academic_year_id = y.id AND e.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes c ON c.id = cs.class_id
 WHERE x.copy_no = 0 AND x.status = 'issued' AND x.year_code = '2026-27'
 GROUP BY c.code, c.name, c.display_order
 ORDER BY c.display_order
```

The class is the enrolment of the certificate's year; a TC moves that enrolment to `transferred`, so do not filter `active`.

4. **Which requests are open, how long have they waited, and are any waiting for the fee?** (crosses into fees)

```sql
SELECT r.id, t.name AS type, r.channel, r.status, r.copies,
       COALESCE(s.admission_no, e.employee_code) AS person_no,
       (r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS asked_on,
       (now() AT TIME ZONE 'Asia/Kolkata')::date - (r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS days_open,
       r.fee_amount,
       CASE WHEN r.status = 'submitted' THEN 'with approvers'
            WHEN r.misc_fee_id IS NOT NULL AND r.fee_waived_reason IS NULL AND COALESCE(mfs.status, 'open') <> 'paid' THEN 'waiting for the fee'
            ELSE 'ready to issue' END AS stage
  FROM certificate_requests r
  JOIN certificate_types t ON t.id = r.type_id
  LEFT JOIN students s ON s.id = r.student_id
  LEFT JOIN employees e ON e.id = r.employee_id
  LEFT JOIN misc_fee_students mfs ON mfs.misc_fee_id = r.misc_fee_id AND mfs.student_id = r.student_id
 WHERE r.status IN ('submitted', 'approved')
 ORDER BY r.created_at
```

The stage follows the app: with the approvers, waiting for the misc fee, or ready for the office.

5. **How quickly do we answer requests, by type?**

```sql
SELECT t.name AS type, count(*) AS asked,
       count(*) FILTER (WHERE r.status = 'issued') AS issued,
       count(*) FILTER (WHERE r.status = 'rejected') AS rejected,
       count(*) FILTER (WHERE r.status = 'withdrawn') AS withdrawn,
       round(avg(EXTRACT(EPOCH FROM (r.issued_at - r.created_at)) / 86400) FILTER (WHERE r.status = 'issued')::numeric, 1) AS avg_days_to_issue
  FROM certificate_requests r
  JOIN certificate_types t ON t.id = r.type_id
 WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY t.name, t.sort_order
 ORDER BY t.sort_order
```

Days from asking to issue, for issued requests.

6. **How often are our certificates checked on the public page, and what did people find?**

```sql
SELECT to_char((v.checked_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') AS month, v.method, v.result,
       count(*) AS checks, count(DISTINCT v.ip_hash) AS distinct_devices, count(DISTINCT v.certificate_id) AS certificates
  FROM certificate_verifications v
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3
```

`ip_hash` counts repeat devices without storing any address.

7. **Which certificates were issued past a failed check, why, and by whose override?**

```sql
SELECT x.number, t.name AS type, x.issued_on, COALESCE(s.admission_no, e.employee_code) AS person_no,
       x.override_reason, ob.display_name AS overridden_by,
       (SELECT string_agg(ch->>'label', ', ') FROM jsonb_array_elements(x.checks) ch WHERE (ch->>'ok')::boolean IS FALSE) AS failed_checks
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id
  LEFT JOIN students s ON s.id = x.student_id
  LEFT JOIN employees e ON e.id = x.employee_id
  LEFT JOIN users ob ON ob.id = x.override_by
 WHERE x.override_reason IS NOT NULL
 ORDER BY x.issued_on DESC
```

`checks` is a jsonb list; failed ones have `ok = false`.

8. **Which awards went to which classes this year, and were their certificates printed?** (crosses into enrolments / classes)

```sql
SELECT a.name AS award, c.name AS class, count(*) AS allotments,
       count(*) FILTER (WHERE al.certificate_id IS NOT NULL) AS certificates_issued
  FROM certificate_award_allotments al
  JOIN certificate_awards a ON a.id = al.award_id
  JOIN academic_years y ON al.awarded_on BETWEEN y.start_date AND y.end_date
  LEFT JOIN enrolments e ON e.student_id = al.student_id AND e.academic_year_id = y.id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes c ON c.id = cs.class_id
 WHERE y.code = '2026-27'
 GROUP BY a.name, c.name, c.display_order
 ORDER BY a.name, c.display_order
```

The year is found from `awarded_on`; a student without an enrolment that year shows with no class.

9. **Which students got a bonafide certificate in the last 30 days?**

```sql
SELECT s.admission_no, s.display_name, x.number, x.issued_on, x.purpose
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id AND t.code = 'BONAFIDE'
  JOIN students s ON s.id = x.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
 WHERE x.status = 'issued' AND x.copy_no = 0
   AND x.issued_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 30
 ORDER BY x.issued_on DESC
```

Valid originals only; merged-away and deleted student rows left out.

10. **Do the withdrawals that are cleared or completed have their TC?** (crosses into the student withdrawal flow)

```sql
SELECT w.id AS withdrawal_id, w.status AS withdrawal_status, w.leaving_on, tc.tc_no, tc.status AS tc_status,
       x.number AS register_number, x.status AS register_status
  FROM student_withdrawals w
  LEFT JOIN transfer_certificates tc ON tc.id = w.tc_id
  LEFT JOIN certificates x ON x.transfer_certificate_id = tc.id AND x.copy_no = 0
 WHERE w.status IN ('cleared', 'completed')
 ORDER BY w.leaving_on
```

The withdrawal points at the older TC row; the register row is found through it.

11. **Staff certificates issued, and to staff who have left?** (crosses into HR's `employees`)

```sql
SELECT t.name AS type, e.employee_code, e.display_name, e.status AS employee_status, e.left_on,
       x.number, x.issued_on, x.status
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id AND t.audience = 'STAFF'
  JOIN employees e ON e.id = x.employee_id
 WHERE x.copy_no = 0
 ORDER BY x.issued_on DESC
```

`audience = 'STAFF'` types (experience, service, staff visa NOC).

12. **Which certificates were corrected or re-issued, and when were they first issued?**

```sql
SELECT x.number, t.name AS type, x.revision, x.revised_at,
       (SELECT r.issued_on FROM certificate_revisions r WHERE r.certificate_id = x.id AND r.revision = 1) AS first_issued_on,
       x.issued_on AS current_issued_on,
       (SELECT n.number FROM certificates n WHERE n.reissue_of = x.id) AS reissued_as
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id
 WHERE x.revision > 1 OR EXISTS (SELECT 1 FROM certificates n WHERE n.reissue_of = x.id)
 ORDER BY x.number
```

`issued_on` moves with a correction; revision 1 keeps the first day.

## Traps

- **Three TC tables, one truth.** Count and list TCs from `certificates` (type `TC`). `transfer_certificates` is still
  written for every TC (the withdrawal flow and the TC list need it) and every TC before the register was copied into
  `certificates` by migration 0381 — so adding the two tables double counts. Join `transfer_certificates` only to reach
  `student_withdrawals.tc_id` or its `academic_year_id`. `tc_sequences` is dead (numbers come from `certificate_series`).
- **Achievement certificates twice.** The engagement module still writes `certificates_issued` **and** a `certificates`
  row (`legacy_ref = 'achievement:<id>'`). Use `certificates`; `certificates_issued` has no status, so it never shows a
  cancel.
- **Duplicates share the number.** `number` alone is not unique; filter `copy_no = 0` or count `DISTINCT number`.
  Duplicates get their own `issued_on` and verify link.
- **Cancelled and re-issued.** A re-issued certificate is cancelled and its replacement has a new number: "valid
  certificates" must filter `status = 'issued'`; "certificates ever issued" counts both (the app does).
- **Corrections move the date.** With `corrections_keep_number`, `issued_on`, `data` and `template_version_id` on the
  same row change; the history is in `certificate_revisions`.
- **year_code is the working year, not the date's year.** Group by `year_code` for "this academic year's
  certificates"; by `issued_on` for a date range. They can disagree around April.
- **Legacy rows.** `legacy = true` rows are the old system's register (old numbers, read-only; deleted ones came as
  cancelled). Include them for history, exclude them for "issued in EduPro". `certificate_legacy_rows` is the raw
  holding area, not certificates.
- **Arrays vs foreign keys.** `certificate_requests.certificate_ids` and `certificate_batches.certificate_ids` repeat what
  `certificates.request_id` / `certificates.batch_id` say; join on the FK columns.
- **Frozen vs current details.** The name, class and address on the paper are in `data`; the student may have changed
  since (or been merged: a merge moves the certificates to the kept student, the paper keeps the old details).
- **Requests per person.** A request is for exactly one of `student_id` / `employee_id`; staff requests have no fee line.
  `fee_amount` is what was asked, not what was paid.
- **Time zones.** `certificate_requests.created_at`, `issued_at`, `certificate_verifications.checked_at` are UTC
  timestamps; convert with `AT TIME ZONE 'Asia/Kolkata'` before taking the date (the app's own reports cast `::date`,
  which uses the server zone).
- **Templates are shared.** `document_templates` also holds fee receipts, letters and gate passes; filter `kind` or go
  through `certificate_types.template_id`. Templates are soft-deleted (`deleted_at`).

## Personal and sensitive data

- `certificates.data`, `certificate_revisions.data` and `changes` (old → new values), `transfer_certificates.snapshot`:
  the printed copy of the person — name, date of birth, gender, parents' and guardian's names, address, mobile, e-mail,
  religion, category and caste, nationality, mother tongue, place of birth, PEN / APAAR / registration numbers, Aadhaar
  (masked to the last four digits), family income, disability (CWSN), attendance, fees paid. Never send whole.
- `certificate_legacy_rows.payload` (the old register's raw rows) and `certificate_imports.rows` / `columns` (sheet cells
  with personal details): personal; internal only.
- `certificate_batches.skipped` (names and reasons), `certificates_issued.text`, `certificate_award_allotments.remarks`,
  and free text: `purpose`, `note`, `decision_note`, `cancel_reason`, `override_reason`, `fee_waived_reason`,
  `reason` — may describe a person.
- `certificate_verifications.ip_hash` and `user_agent`: a pseudonymous trace of the visitor (no address is stored).
- `certificates.verify_token`: the secret of the public link — never expose it.
- Links to people: `student_id`, `employee_id`, `signatory_employee_id`, `requested_by` — join to `students` /
  `employees` only for the name and number.
