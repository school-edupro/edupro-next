# The database map — for reports and complex data

EduPro Next's PostgreSQL database read table by table (23 Nov 2026, migrations to 0417), so that reports — written
by a developer today, by an AI model from a question later — use the right tables, joins and counting rules.
Structure only: nothing here was read from a school's records.

## What is here

| File                        | What it is                                                                                                                                                    | Kept up to date by                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `schema.json`               | Every table and view (685): its module, columns and types, primary and unique keys, what it references and what references it, plus every enum and its values | `node scripts/schema/schema-map.mjs` after each migration |
| `schema/<module>.md`        | The same, one readable page per module (columns, types, links)                                                                                                | the same script                                           |
| `modules/<module>.md`       | **The guides**: what each table means, how they join, statuses and life-cycles, amounts and counting rules, 12 checked report queries, traps, personal data   | by hand, when a module changes                            |
| `02-data-inventory-dpdp.md` | The personal-data register (DPDP classification, retention)                                                                                                   | by hand                                                   |
| `01`, `03`–`05`             | The migration from the old PHP system (types, ETL, parity)                                                                                                    | —                                                         |

Run from the repo root with the `.env` loaded (`set -a && source .env && set +a`):

    node scripts/schema/schema-map.mjs            rewrites schema.json and schema/*.md
    node scripts/schema/schema-map.mjs --check    fails when a new table has no module (add a rule to MODULES)

Every SQL example in the guides (215) was checked against the database with `EXPLAIN` (names and joins valid).

## The modules

| Module                       | Tables | Guide                                                             | What it holds                                                                                                             |
| ---------------------------- | -----: | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Platform core                |     44 | [platform_core](modules/platform_core.md)                         | Schools, users and sign-ins, roles and rights, settings, files, the approval engine (`workflow_*`), audit log, DPDP tools |
| People — students            |     19 | [people_students](modules/people_students.md)                     | Students, guardians, yearly enrolments, profile corrections, merges, withdrawals, transfers                               |
| Admissions                   |     53 | [admissions](modules/admissions.md)                               | Enquiries, applicants, applications, stages, marks, draws, offers, admission fees                                         |
| Academics                    |     31 | [academics](modules/academics.md)                                 | Years, classes and sections, subjects, timetable, homework, lesson plans, syllabus, holidays, promotions                  |
| Attendance and student leave |     12 | [attendance_leave_students](modules/attendance_leave_students.md) | Daily and subject attendance, reopens, uploads, student leave                                                             |
| Exams and results            |     54 | [exams_results](modules/exams_results.md)                         | Exams, papers, marks, indicators, remarks, results, report cards, board results                                           |
| Fees and payments            |     53 | [fees_payments](modules/fees_payments.md)                         | Fee set-up, demands (bills), receipts, allocations, refunds, misc fees, online payments, bank matching                    |
| Transport                    |     25 | [transport](modules/transport.md)                                 | Routes, stops, vehicles, drivers, who rides, requests, bus attendance, GPS, RFID                                          |
| Hostel                       |     34 | [hostel](modules/hostel.md)                                       | Rooms and beds, stays, roll-calls, mess, visitors, incidents, exits                                                       |
| Library                      |     35 | [library](modules/library.md)                                     | Titles and copies, loans, fines and charges, reservations, stock checks, periodicals, sales                               |
| HR — employees               |     47 | [hr_employees](modules/hr_employees.md)                           | Staff records, postings, teacher assignments, documents, ACR, recruitment, exits                                          |
| Staff leave and attendance   |     28 | [staff_leave_attendance](modules/staff_leave_attendance.md)       | Leave types and policies, balances, requests, punches, attendance days, shifts                                            |
| Payroll                      |     69 | [payroll](modules/payroll.md)                                     | Pay heads, structures, monthly inputs, runs and payslips, statutory, tax, bank batches                                    |
| Purchase, stores and assets  |     60 | [purchase_stores_assets](modules/purchase_stores_assets.md)       | Indents to orders, receipts, the stock ledger, issues and transfers, assets, depreciation, disposal                       |
| Certificates                 |     19 | [certificates](modules/certificates.md)                           | Certificate types and series, requests, the issued register, verification, awards                                         |
| Communication and engagement |     77 | [comms_engagement](modules/comms_engagement.md)                   | Messages, notices, consent, helpdesk queries, appointments, visitors, gate passes, clinic and health                      |
| AI, insights and reports     |     17 | [ai_insights_reports](modules/ai_insights_reports.md)             | The assistant's conversations and audit, AI reports, alerts, the report builder, exports, dashboards                      |
| Marts                        |      8 | (in the guides above)                                             | Ready-made summaries in `mart.*` — see below                                                                              |

## The backbone every report joins to

```
schools ─┬─ academic_years ─── class_sections (one set per year) ─── classes
         │                         │
         ├─ students ── enrolments (one per student per year: class_section_id, roll_no, status)
         │      └── student_guardians ── guardians (user_id = the parent's sign-in)
         ├─ employees ─┬─ postings (one per year)      ┌─ departments / designations (masters; employees
         │             └─ teacher_assignments (section, subject, kind)   holds them as text — match by name)
         ├─ users ── user_school_memberships (person_type + person_ref_id → student / guardian / employee)
         └─ workflow_instances (entity_type, entity_id) ── workflow_steps   (approvals of many modules)
```

- **A student's class in a year**: `students → enrolments (that academic_year_id) → class_sections → classes`.
  Section ids are new every year. Never take the class from anywhere else.
- **Who is "a student now"**: `students.deleted_at IS NULL` (merged duplicates are deleted and point to the kept row
  through `merged_into_id`) and an `enrolments` row of the current year whose `status` is `active`. Past years are
  mostly `promoted` (also for retained pupils — read `promotion_decisions`); `cancelled` never counts.
- **A teacher's sections**: `teacher_assignments` with `valid_to IS NULL`.

## Writing report SQL safely

1. **Run as the app's database role with the school set**, never as the migrator: the migrator sees every school.
   The API's `db.tenant(...)` does this (`app.school_id` set; row-level security forced on 669 tables). With no school
   set, tenant tables return no rows and no error.
2. **A few tables widen to all of a user's schools** (`audit_logs`, `login_events`, `user_school_memberships`,
   `schools`, `users`): filter `school_id = app.current_school_id()` on them.
3. **Definer-only tables return nothing to the app role** (`mobile_sessions`, `auth_otp_challenges`,
   `auth_trusted_devices`, `mobile_web_handoffs`, `api_idempotency`, `ai_model_settings`); `etl.*` and
   `archive.attendance_marks` are not granted to it either. Read `audit_logs` through the parent table with an
   `occurred_at` range (it is partitioned by month).
4. **Read only, bounded**: a read-only transaction, a statement time limit and a row limit for anything generated.
5. **Rights still apply**: the database keeps schools apart, but a teacher's sections, a parent's children and a
   library desk are limited in the API — a generated report must add the same filters (the assistant's catalogue in
   `apps/api/src/modules/insights/catalogue.ts` shows how).

## Counting rules that cross modules

- **Dates**: the school's day is India time — `(ts AT TIME ZONE 'Asia/Kolkata')::date` for `timestamptz` columns.
  Academic year (April–March, `academic_year_id`) for students, exams, fees bills; financial year (`'2026-27'` text,
  `payroll_compliance.fy` an integer) for payroll, purchase, staff leave. Fee collections are by `received_on`, not by
  the bills' year.
- **Soft deletes**: 52 tables have `deleted_at` — exclude non-null rows. Several modules delete outright (holidays,
  timetable slots), so their history is gone.
- **Caches versus the source**: `exam_results` / `term_results` (rebuilt on verify or Compute), `stock_balances`
  (the ledger is `stock_moves`), `mart.*` (up to 15 minutes old; exam results hourly), `student_route_assignments`
  (a snapshot of `student_transport`), `library_loans.fine_*` (old fines; new ones are `library_charges`). The
  guides say which to trust.
- **Money**: `numeric` rupees. Fee balance = `net − paid` over lines not `cancelled` or `carried`; real receipts are
  not `reversed` or `bounced`; head-wise cash comes from allocations. Payroll: count once from record lines; final
  months are runs at `LOCKED` / `PAID`.
- **Attendance**: from day sessions only (`kind = 'day'`). Present = every code but `A` and `LV` in the register's
  own reports; the attendance mart counts `LV` as present and certificates count only `P` and `L` — pick one rule
  per report and say which.
- **Approvals**: the waiting step is `workflow_steps.level = workflow_instances.current_level AND status =
'pending'`. Gate passes, transport requests, appointments, admission registrations and purchase department
  approvals keep their own levels.

## The marts (`mart.*`)

| Mart                   | One row is                                                       | Watch out                                                                                      |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `attendance_daily`     | section × day: strength, present, absent, late                   | counts `LV` as present; strength = enrolments active today, so past years collapse             |
| `fee_collection_daily` | day × mode: receipts, amount                                     | gross; no misc receipts                                                                        |
| `fee_dues`             | pupil × bill due date: net, paid, balance, days overdue, bucket  | keeps paid lines (filter `balance > 0`); school and hostel mixed; no class for pupils who left |
| `fee_forecast`         | class × due month × ledger: expected, collected                  | as above                                                                                       |
| `exam_results`         | exam × section, plus a whole-class row (`class_section_id` NULL) | never add the class row to the section rows; hourly                                            |
| `admissions_funnel`    | cycle × class × status: applications                             | includes drafts and both admission flows                                                       |
| `comms_delivery_daily` | day × channel × status: messages                                 | last 120 days; each message's current status                                                   |
| `refresh_log`          | one refresh                                                      | internal                                                                                       |

## Personal and sensitive data

Each guide ends with the module's sensitive columns. Across all of them: names, mobiles, e-mails, addresses, dates
of birth, photos and signatures; the `secure` jsonb columns (encrypted Aadhaar, PAN, bank accounts); health and
clinic records, disability and allergies; category, religion and caste; salaries, tax and bank details; ACR and
recruitment assessments; free-text notes about people; frozen copies (`certificates.data`, legacy payloads); gateway
and provider secrets (`payment_gateways.secret`, `comms_providers`). A report shown to an authorised person may
include what their rights allow; **an AI model gets the schema and the question, never these columns' values** —
rows it must read are masked as the assistant does today (`maskContacts`, `redact`).

## Data issues found while reading

Worth fixing before reports rely on them (none changes stored data by itself):

- `privacy_acknowledgements` is unique on `(user_id, notice_version)` without `school_id`: a parent in two schools can
  show as not acknowledged in the second.
- Present days are counted three ways (register, attendance mart, certificates) — see Attendance above.
- Online receipts and gateway refunds are dated with the database server's `CURRENT_DATE`, not India's date.
- `mart.attendance_daily` and the fee marts take the class from today's active enrolment only, so past years and
  pupils who left lose their class.
- Two settlement sources for a leaving employee (`employee_fnf` and `payroll_settlements`), and fines in two places
  in the library — reports must pick one.
- `health_records` repeats every published check-up (count from `health_checkups`); a migrated hypercare ticket has
  two "created" events.
