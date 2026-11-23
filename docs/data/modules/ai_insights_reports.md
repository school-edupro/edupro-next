# AI, insights and reports — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

How the school _reads_ its data. **The assistant** (MobiAI): chat threads, questions and answers, and one `ai_audit`
row per prompt, tool call, answer or refusal with model, tokens and cost; answers come from an approved query
catalogue (no model writes SQL today). The workers write **weekly AI reports** and nightly **anomaly alerts** from the
**marts** (`mart.*`, per-school summaries rebuilt every 15 minutes). **Exports** log every file downloaded; the
**report builder** saves reports as a JSON spec, shares and schedules them. Landing-page and MIS dashboards, bulk
uploads and the assistant / AI-model settings complete it; `etl`, `archive` and `app` hold legacy-load bookkeeping,
archived attendance and the migration list.

## Tables

| Table                     | One row is                                                                   | Key columns                                                                                                                                                                                                       | For reports                                                    |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ai_conversations`        | one chat thread of one person (id is a uuid)                                 | `user_id`, `surface` (admin/teacher/parent), `language`, `title`, `turns`, `tokens`, `cost_paise`, `academic_year_id`, `created_at`, `updated_at`                                                                 | main (who uses the assistant)                                  |
| `ai_messages`             | one question (`role = 'user'`) or answer (`'assistant'`) in a thread         | `conversation_id`, `role`, `content`, `refused`, `citations` jsonb, `usage` jsonb, `display` jsonb, `created_at`                                                                                                  | detail (deleted after 180 days)                                |
| `ai_audit`                | one assistant event: prompt, tool, answer or refusal                         | `user_id`, `conversation_id`, `request_id`, `kind`, `provider`, `model`, `text`, `redactions`, `input_tokens`, `output_tokens`, `cost_paise`, `citations`, `at`                                                   | **main (usage and cost spine)**                                |
| `ai_reports`              | one AI-written weekly report for one period                                  | `kind` (principal_brief/department_weekly), `department`, `period_from`, `period_to`, `title`, `narrative`, `facts`, `citations`, `provider`, `model`, `cost_paise`, `export_id`, `message_ids[]`, `requested_by` | main                                                           |
| `insight_alerts`          | one anomaly found on one day for one subject                                 | `kind`, `severity` (info/warning/danger), `subject_type`, `subject_id`, `title`, `message`, `data`, `detected_on`, `notified_at`, `acked_by`, `acked_at`                                                          | main                                                           |
| `exports`                 | one requested file                                                           | `dataset`, `format` (xlsx/csv/pdf/xml), `params` jsonb, `title`, `status`, `file_id`, `row_count`, `error`, `requested_by`, `requested_at`, `started_at`, `finished_at`, `expires_at`, `download_count`           | **main (export log)**                                          |
| `report_definitions`      | one saved report-builder report                                              | `dataset` (student_profile/employee_profile/admissions), `name`, `description`, `spec` jsonb, `owner_id`, `status`, `last_run_at`                                                                                 | **main (saved reports)**                                       |
| `report_shares`           | one share of a saved report with one user or one role                        | `report_id`, `user_id` xor `role_id`, `can_edit`                                                                                                                                                                  | detail                                                         |
| `report_schedules`        | one report sent on a schedule                                                | `name`, `dataset`, `format`, `params`, `cron` (IST), `recipient_roles[]`, `recipient_addresses[]`, `channel`, `owner_id`, `status`, `next_run_at`, `last_run_at`, `last_export_id`                                | main                                                           |
| `report_layouts`          | one named column layout of a fixed report (e.g. the library book list)       | `report`, `name`, `columns[]`, `sheets[]`, `options`                                                                                                                                                              | master                                                         |
| `mis_dashboards`          | one MIS dashboard and the role codes that see it                             | `code` (principal, academics, attendance, fees, communication, transport, library, results, group), `name`, `roles[]`, `sort_order`, `status`                                                                     | master                                                         |
| `dashboard_role_defaults` | the landing page a role sees by default                                      | `role_code` (PK with school), `widgets`, `quick_actions`, `settings`, `locked`                                                                                                                                    | internal (settings)                                            |
| `user_dashboards`         | one person's own landing-page arrangement                                    | `user_id` (PK with school), `widgets`, `hidden`, `quick_actions`                                                                                                                                                  | internal                                                       |
| `imports`                 | one bulk upload of students or employees                                     | `kind` (students/employees), `file_name`, `status`, `total_rows`, `ok_rows`, `rejected_rows`, `report`, `payload`, `requested_by`, `committed_at`                                                                 | history (imports)                                              |
| `master_imports`          | one bulk upload of a set-up list                                             | `master` (registry id, e.g. `fee_heads`), `status`, `total_rows`, `ok_rows`, `rejected_rows`, `inserted_rows`, `updated_rows`, `report`, `payload`, `committed_at`                                                | history (imports)                                              |
| `assistant_settings`      | the school's assistant set-up (one row per school; no row = defaults)        | `audiences`, `daily_limit`, `topics_off`, `starters`, `name`, `subtitles`, `claude`, `claude_monthly_limit`                                                                                                       | internal (settings)                                            |
| `ai_model_settings`       | the one server-wide AI model (LLM) setting; no `school_id`, `id` is always 1 | `url`, `token` (encrypted), `token_last4`, `is_on`, `operator`, `tested_at`, `test_ok`                                                                                                                            | internal (definer-only: the app role sees no rows; never read) |

17 tables.

### Reporting and support schemas (`mart`, `etl`, `archive`, `app`)

| Table                       | One row is                                                     | Key columns                                                                                                                                                                                                           | For reports                                             |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `mart.attendance_daily`     | one class-section on one working day (PK section + date)       | `academic_year_id`, `on_date`, `class_section_id`, `class_id`, `section` ("VI-A"), `strength`, `present`, `absent`, `late`, `marked`                                                                                  | main (attendance trends)                                |
| `mart.fee_dues`             | one pupil × year × due date: bill total, paid, balance, ageing | `academic_year_id`, `student_id`, `admission_no`, `student_name`, `class_id`, `class_section_id`, `section`, `due_on`, `net`, `paid`, `balance`, `days_overdue`, `bucket`                                             | main (dues, defaulters)                                 |
| `mart.fee_collection_daily` | one year × receipt date × payment mode                         | `academic_year_id`, `received_on`, `mode`, `receipts`, `amount`                                                                                                                                                       | main (collection trend)                                 |
| `mart.fee_forecast`         | one year × class × due month × ledger                          | `academic_year_id`, `class_id`, `class_code`, `due_month`, `ledger`, `students`, `expected`, `collected`, `balance`                                                                                                   | main (expected vs collected)                            |
| `mart.exam_results`         | one exam × class, and one exam × class × section               | `academic_year_id`, `exam_id`, `exam_code`, `exam_name`, `class_id`, `class_code`, `class_section_id` (NULL on the class row), `section`, `pupils`, `complete`, `pass`, `fail`, `mean_pct`, `pass_pct`, `computed_at` | main (results summary)                                  |
| `mart.admissions_funnel`    | one admission cycle × class × application status               | `cycle_id`, `cycle_code`, `cycle_status`, `class_id`, `class_code`, `status`, `applications`                                                                                                                          | main (admissions funnel)                                |
| `mart.comms_delivery_daily` | one IST day × channel × message status (last 120 days)         | `on_date`, `channel`, `status`, `messages`                                                                                                                                                                            | main (delivery)                                         |
| `mart.refresh_log`          | one rebuild of one mart for one school                         | `mart`, `refreshed_at`, `rows`, `duration_ms`                                                                                                                                                                         | internal (freshness; kept 7 days)                       |
| `etl.runs`                  | one legacy-load run of one domain                              | `school_id`, `domain`, `source_label`, `started_at`, `finished_at`, `status`, `counts`                                                                                                                                | internal (legacy cut-over)                              |
| `etl.legacy_map`            | one old-system key mapped to a new row                         | `school_id`, `legacy_table`, `legacy_key`, `legacy_year`, `target_table`, `target_id`, `run_id`                                                                                                                       | internal (legacy cut-over; find a record by its old id) |
| `etl.rejects`               | one legacy value the loader refused                            | `run_id`, `legacy_table`, `legacy_key`, `column_name`, `reason`, `raw_value`, `blocking`                                                                                                                              | internal (legacy cut-over)                              |
| `etl.reconciliations`       | one legacy-vs-new total compared                               | `run_id`, `measure`, `legacy_value`, `target_value`, `delta` (generated), `status`                                                                                                                                    | internal (legacy cut-over)                              |
| `archive.attendance_marks`  | one attendance mark moved out of a closed year                 | as `attendance_marks` + `archived_at`                                                                                                                                                                                 | history (old years' marks)                              |
| `app.schema_migrations`     | one applied migration                                          | `name`, `checksum`, `applied_at`                                                                                                                                                                                      | internal                                                |

## How the tables join

**Spines.** Assistant use and cost: `ai_audit` (one row per event) with `ai_conversations` for the audience.
Downloads: `exports`. Saved reports: `report_definitions`. Alerts: `insight_alerts`. Headline figures: `mart.*`.

### Assistant

- `ai_messages.conversation_id → ai_conversations.id` (uuid; deleting a conversation deletes its messages)
- `ai_audit.conversation_id → ai_conversations.id` (no foreign key; may be NULL; survives message purges)
- `ai_conversations.user_id`, `ai_audit.user_id → users.id`; `ai_conversations.academic_year_id → academic_years.id`
- Person behind a user: `users.id → employees.user_id` (staff), `guardians.user_id` (parents), `students.user_id`
- `ai_audit.request_id = audit_logs.request_id = jobs_outbox.request_id` (the same API request)
- Catalogue entries used by an answer: `jsonb_array_elements(ai_messages.citations) ->> 'query'` (elements
  `{query, title, params, rows}`); `ai_audit.citations` is a plain array of query ids on `answer` rows.
- `assistant_settings.school_id` is the primary key (one row per school); `assistant_settings.updated_by`,
  `ai_model_settings.updated_by → users.id`

### Reports and alerts

- `ai_reports.export_id → exports.id` (its PDF); `ai_reports.message_ids[] → comms_messages.id` (the WhatsApp
  summaries); `ai_reports.requested_by → users.id` (NULL when the Monday job wrote it)
- `insight_alerts.subject_id →` `class_sections.id` when `subject_type = 'class_section'` (kind `attendance.drop`),
  `rfid_devices.id` when `'rfid_device'` (kind `reader.silent`), NULL when `'school'` (kind `fees.collection_dip`);
  `insight_alerts.acked_by → users.id`

### Exports and the report builder

- `exports.file_id → files.id` (NULL until ready); `exports.requested_by → users.id` (NULL for system exports)
- Into `exports.id`: `ai_reports.export_id`, `report_schedules.last_export_id`, `data_subject_requests.export_id`,
  `report_cards.export_id`, `certificates_issued.export_id`, `certificate_revisions.export_id`,
  `transfer_certificates.export_id`
- `exports.params ->> 'definitionId' → report_definitions.id` when `dataset = 'report_builder'`;
  `exports.params ->> 'reportId' → ai_reports.id` when `dataset = 'ai_report'` (text; compare with `id::text`)
- `report_shares.report_id → report_definitions.id` (cascade); `report_shares.user_id → users.id`;
  `report_shares.role_id → roles.id`; `report_definitions.owner_id → users.id`
- `report_schedules.owner_id → users.id` (no foreign key; the schedule runs as this user);
  `report_schedules.recipient_roles[]`, `mis_dashboards.roles[]`, `dashboard_role_defaults.role_code → roles.code`
  (text; a code may match a template and a school role)
- `user_dashboards.user_id → users.id`; `report_layouts.created_by → users.id`
- `imports.requested_by`, `master_imports.requested_by → users.id`; their `request_id` = `audit_logs.request_id`

### Marts to the backbone

- `mart.attendance_daily.class_section_id → class_sections.id`, `.class_id → classes.id`, `.academic_year_id → academic_years.id`
- `mart.fee_dues.student_id → students.id`, `.class_section_id → class_sections.id`, `.class_id → classes.id`
- `mart.fee_forecast.class_id → classes.id`; `mart.fee_collection_daily.academic_year_id → academic_years.id`
- `mart.exam_results.exam_id → exams.id`, `.class_id → classes.id`, `.class_section_id → class_sections.id`
- `mart.admissions_funnel.cycle_id → admission_cycles.id`, `.class_id → classes.id`
- `mart.comms_delivery_daily` is school-level (no keys beyond day, channel and status)
- `etl.legacy_map.target_table` + `target_id` → that table's `id`; `etl.legacy_map.run_id`, `etl.rejects.run_id`,
  `etl.reconciliations.run_id → etl.runs.id`
- `archive.attendance_marks.session_id → attendance_sessions.id`, `.student_id → students.id`

### How a saved report-builder report is stored and run

- **Stored**: `report_definitions.spec` is JSON, not SQL (`packages/db/src/report-builder.ts`, `ReportSpec`):
  `{dataset, columns: [{key, label, width, group, highlight, hidden}], filters: [{key, op, values[], ask}],
sort: [{key, dir}], options: {paper, orientation, academicYearId, includeInactive, search}, layout:
'table'|'detailed', groupLabels}`. Column keys come from a fixed field catalogue per dataset (student 360 profile
  fields plus class-section, statuses, fee group, discount, transport route/stop; the employee and admission
  catalogues). Filter operators: eq, neq, in, not_in, contains, starts, empty, not_empty, between, gte, lte; a filter
  with `ask` is asked at download time. One active name per owner (case-insensitive); deleting sets
  `status = 'inactive'`.
- **Visible to**: the owner, anyone it is shared with (a `report_shares` row for the user or one of their active
  roles; `can_edit` lets them change it), and holders of `reports.builder.manage`.
- **Run**: the API loads **every row of the dataset** with one fixed query (students: `enrolments` of the chosen
  year → `students` → `class_sections`/`classes` → fee profile, discount, route; limited to the sections the user's
  `people.student.view` scope allows, at most 20 000 rows), resolves each catalogue field, then filters and sorts
  **in memory** and keeps the chosen columns. Masked fields (Aadhaar etc.) show in full only with
  `people.sensitive.view`. A preview returns the first rows; a download inserts an `exports` row with
  `dataset = 'report_builder'` and `params` = `{definitionId, name, spec, academicYearId, sectionIds,
showSensitive …}`, queues `export.generate`, and sets `report_definitions.last_run_at`. The worker builds the file
  under the requester's tenant context (row-level security applies) and fills `exports.file_id` / `row_count`.
- **Fixed datasets** (`packages/db/src/datasets.ts`): each export `dataset` id (fee_dues, attendance_daily,
  audit_logs, fee_day_book, exam_results … plus one per set-up list) is a parameterised SQL query with a permission
  and an optional section scope; renderers (`report_builder`, `strength_report`, `ai_report`, `report_card`,
  `certificate_doc`, `student_id_card` …) make PDFs. Several fixed datasets read the marts directly.

## Life-cycles and statuses

- **`export_status`** (`exports.status`): `queued` → `running` → `ready` (file made, `file_id`, `row_count`,
  `finished_at`) → `expired` (the hourly job after `expires_at`; the file is soft-deleted). A failed attempt goes
  back to `queued` until the retry limit, then `failed` with `error`. `expires_at` defaults to 7 days after the
  request; certificate PDFs are kept 100 years (0389). Files produced = `ready` + `expired`.
- **`import_status`** (`imports`, `master_imports`): `validated` (checked; `payload` holds the rows; nothing written
  yet) → `committed` (`committed_at`; rows written) | `failed`. A validation never committed stays `validated`
  forever. Only `committed` uploads changed data.
- **`row_status`** on `report_definitions` (inactive = deleted by the user), `report_schedules` (inactive = paused),
  `mis_dashboards`.
- **`report_schedules`**: the hourly worker job runs every `active` row with `next_run_at <= now()`: inserts an
  `exports` row as `owner_id`, queues it, sets `last_run_at`, `last_export_id` and the next `next_run_at` from
  `cron`, and queues a message on the schedule's `channel` (WhatsApp by default; e-mail goes to e-mail addresses,
  other channels to mobiles) to every user holding a `recipient_roles` role plus each `recipient_addresses` entry.
  The message says where to download the file; the file itself waits in Exports.
- **`insight_alerts`**: created by `app.detect_insight_alerts()` (daily worker job) — `attendance.drop` (a section's
  last-7-day present % at least 10 points under the previous four weeks; `danger` at 20), `fees.collection_dip` (last
  7 days under half the weekly average of the previous four weeks), `reader.silent` (an active RFID reader silent 24
  hours). Open while `acked_at IS NULL`; `notified_at` when the WhatsApp alert was queued to the roles in setting
  `insights.alert_roles`; acknowledging sets `acked_by`, `acked_at`. One row per kind, subject and day.
- **`ai_audit.kind`**: `prompt` (one per question asked), `tool` (a catalogue query the model ran), `answer`,
  `refusal` (no answer could be given; counted instead of `answer`); the DDL comment also lists `error`.
  **`ai_audit.provider`**: `local` (EduPro's own matcher, `model = 'local-matcher'`), `claude`, `llm` (the server-wide
  model of `ai_model_settings`); older tool-loop rows carry the provider's own name.
- **`ai_messages`**: `role` user / assistant; `refused` true on an answer that declined. `display.by` repeats who
  answered (local / claude / llm).
- **`ai_conversations.surface`**: `admin` (office and admin staff), `teacher` (scoped teachers), `parent` (families —
  students' own chats also use it).
- **`ai_reports`**: `kind` principal_brief (department NULL) or department_weekly (`department` academics,
  attendance, fees or communication). Written Mondays 06:00 IST for the previous Monday–Sunday, or on demand; writing
  the same kind, department and `period_to` again **replaces** the row (narrative, facts, cost, `created_at`). A
  narrative that cites unknown facts is not stored.
- **`assistant_settings`**: `audiences` `{student, parent, teacher, admin}` true/false (default all true);
  `topics_off` `{audience: [department …]}`; `starters` `{audience: [query id …]}`; `claude` `{audience: true}`
  (model help on, per audience); `daily_limit` questions per person per day; `claude_monthly_limit` NULL = the
  server default. No row = all defaults.
- **`ai_model_settings`**: `is_on`; `test_ok`/`tested_at` reset when the address, token or reply field changes;
  `operator_changed_at` moves when `operator` changes (families' earlier consents stop counting).
- **`dashboard_role_defaults.locked`** true: the role's users cannot rearrange; their `user_dashboards` row is ignored.
- **ETL**: `etl.runs.status` (`etl.run_status`: running, succeeded, failed, aborted); `etl.reconciliations.status`
  (`etl.reconcile_status`: match, explained, unexplained); `etl.rejects.blocking` true for identity, money or marks
  rejects (they block cut-over).

## Amounts, dates and counting rules

- **Money is in paise** (integer): `ai_audit.cost_paise` (only on `answer`/`refusal` rows of a paid model; NULL or 0
  for the local matcher), `ai_conversations.cost_paise` (running total, cached), `ai_reports.cost_paise` (the latest
  generation only). Rupees = paise / 100. Total AI spend = `sum(ai_audit.cost_paise)` + `sum(ai_reports.cost_paise)`
  (the costs screen adds both).
- **Tokens**: `ai_audit.input_tokens`, `output_tokens` per event; `ai_conversations.tokens` = running sum (cached).
- **Counting questions**: `ai_audit` rows with `kind = 'prompt'` (survive the message purge) — this is also how the
  Claude / AI-model monthly limit is counted (`provider IN ('claude','llm') AND kind = 'prompt'` since the first of
  the month in IST). `ai_conversations.turns` is a cached count of questions per thread.
- **Dates**: `ai_audit.at`, `ai_messages.created_at`, `exports.requested_at` (group exports by this),
  `imports.created_at` / `committed_at` are timestamptz — convert with `AT TIME ZONE 'Asia/Kolkata'`.
  `insight_alerts.detected_on` and `ai_reports.period_from/period_to` are dates.
- **Exports**: `row_count` = data rows in the file; `download_count` = times downloaded. Duration = `finished_at -
started_at`.
- **Imports**: `total_rows = ok_rows + rejected_rows`; `master_imports` adds `inserted_rows` and `updated_rows`
  (known after commit).
- **One row per what**: `assistant_settings` per school; `user_dashboards` per (school, user);
  `dashboard_role_defaults` per (school, role code); `mis_dashboards` per (school, code); `ai_reports` per (school,
  kind, department, `period_to`); `insight_alerts` per (school, kind, subject, `detected_on`); `report_definitions`
  one active per (owner, lower(name)); `report_shares` per (report, user) and per (report, role); `report_layouts` per
  (school, report, lower(name)); `ai_model_settings` exactly one row server-wide.

### How the marts are built and refreshed

- **Refresh.** The worker job `insights.refresh` runs **every 15 minutes**: for each active school
  (`app.mart_schools()`), under that school's tenant context and an advisory lock, `app.refresh_marts()` deletes
  the school's rows of six marts and inserts them again in one transaction, logging one `mart.refresh_log` row per
  mart (`attendance_daily`, `fee_dues`, `fee_collection_daily`, `admissions_funnel`, `comms_delivery_daily`,
  `fee_forecast`). `mart.exam_results` is rebuilt **hourly** by `app.refresh_exam_results_mart()` (job
  `insights.results_mart`) and writes no log row — use `computed_at`. The log is cut to 7 days nightly
  (`app.prune_mart_refresh_log`). Readers see either the old or the new set, never half. Permission
  `insights.mart.refresh` lets a user refresh on demand. Marts are tenant tables: the same row-level security applies.
- **`mart.attendance_daily`** (0022, last version 0026): for every class section (`deleted_at IS NULL`) and every
  working day of its year in the last 400 days (a day with any day-kind session in that year) plus today. Uses the
  section's `attendance_sessions` row of `kind = 'day'` (the locked one first). `present` = marks with code other
  than `A` — so **L, SR, H, OD, SB and LV (leave) count as present**; `absent` = code `A`; `late` = code `L` (also inside
  `present`). `strength` = enrolments of that section and year with `status = 'active'` and `joined_on <= day` and
  (`ended_on` NULL or `>= day`). `marked` = a session exists.
- **`mart.fee_dues`**: `fee_demands` with status pending, partial or paid (waived, cancelled and carried left out),
  summed per pupil, year and `due_on`: `net`, `paid`, `balance = net - paid`; `days_overdue` and `bucket` (current,
  1-30, 31-60, 61-90, 90+) from `CURRENT_DATE`. Class and section from the pupil's **active** enrolment of that year.
- **`mart.fee_collection_daily`**: `fee_payments` with status not reversed and not bounced, per `academic_year_id`,
  `received_on` and `mode`: `receipts` = count, `amount` = sum of `amount` (all ledgers together).
- **`mart.fee_forecast`**: the same `fee_demands` rows as fee_dues, per class, `date_trunc('month', due_on)` and
  `ledger`: `students` (distinct), `expected = sum(net)`, `collected = sum(paid)`, `balance`.
- **`mart.exam_results`**: from `exam_results` (the exams module's per-pupil results): per exam and class **two kinds
  of row** — one per section and one for the whole class (`class_section_id` NULL). `complete` = results not
  `incomplete`; `mean_pct` = average `pct` of complete results; `pass_pct = 100 × pass / complete`.
- **`mart.admissions_funnel`**: count of `applications` per cycle, class and **current** status.
- **`mart.comms_delivery_daily`**: `comms_messages` created in the last 120 days, per IST day of `created_at`,
  channel and **current** status.
- **When to use a mart**: dashboards, trends, "this month by class" — they are fast and match the app's own screens
  and alerts. Use base tables for per-pupil detail, dates older than the mart keeps (attendance 400 days, comms 120
  days), strict status rules the mart does not apply, or figures that must be exact to the minute.

Class rows of the results mart (no double counting):

```sql
SELECT r.exam_code, r.exam_name, r.class_code,
       r.pupils, r.complete, r.pass, r.fail, r.mean_pct, r.pass_pct, r.computed_at
  FROM mart.exam_results r
  JOIN classes k ON k.id = r.class_id
 WHERE r.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.status = 'active')
   AND r.class_section_id IS NULL
 ORDER BY r.exam_code, k.display_order;
```

Finding a record by its old-system id (DBA only — `etl` is not readable by the app role and has no row-level
security, so filter `school_id`):

```sql
SELECT m.legacy_table, m.legacy_key, m.legacy_year, m.target_table, m.target_id, r.domain, r.source_label, m.loaded_at
  FROM etl.legacy_map m
  LEFT JOIN etl.runs r ON r.id = m.run_id
 WHERE m.school_id = 1
   AND m.target_table = 'students'
   AND m.target_id = 123;
```

## Answering report questions

All sketches assume the app role with `app.school_id` set (see the platform core guide, row-level security).

**1. How much is the assistant used each day, by audience, and what does it cost?**

```sql
SELECT (a.at AT TIME ZONE 'Asia/Kolkata')::date AS on_day,
       COALESCE(cv.surface, 'admin') AS audience,
       count(*) FILTER (WHERE a.kind = 'prompt')  AS questions,
       count(*) FILTER (WHERE a.kind = 'refusal') AS refused,
       count(DISTINCT a.user_id) AS people,
       round(COALESCE(sum(a.cost_paise), 0) / 100.0, 2) AS cost_rupees
  FROM ai_audit a
  LEFT JOIN ai_conversations cv ON cv.id = a.conversation_id
 WHERE a.at >= now() - interval '30 days'
 GROUP BY 1, 2
 ORDER BY 1 DESC, 2;
```

The same grouping the assistant's cost screen uses.

**2. This month: who answered (own matcher, Claude, AI model), tokens, cost, against the school's limit**

```sql
SELECT a.provider, a.model,
       count(*) FILTER (WHERE a.kind = 'prompt')  AS questions,
       count(*) FILTER (WHERE a.kind = 'refusal') AS refusals,
       COALESCE(sum(a.input_tokens), 0)  AS input_tokens,
       COALESCE(sum(a.output_tokens), 0) AS output_tokens,
       round(COALESCE(sum(a.cost_paise), 0) / 100.0, 2) AS cost_rupees,
       max(s.claude_monthly_limit) AS school_monthly_limit
  FROM ai_audit a
  LEFT JOIN assistant_settings s ON s.school_id = a.school_id
 WHERE a.at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
 GROUP BY a.provider, a.model
 ORDER BY questions DESC;
```

The limit counts `prompt` rows of `claude` + `llm` together; a NULL limit means the server default.

**3. Which catalogue questions are asked most?**

```sql
SELECT c ->> 'query' AS catalogue_query,
       count(*) AS times_used,
       count(DISTINCT m.conversation_id) AS conversations,
       count(*) FILTER (WHERE m.refused) AS in_refused_answers
  FROM ai_messages m
  CROSS JOIN LATERAL jsonb_array_elements(m.citations) AS c
 WHERE m.role = 'assistant'
   AND m.created_at >= now() - interval '30 days'
 GROUP BY 1
 ORDER BY 2 DESC
 LIMIT 20;
```

Only the last 180 days of messages exist; for longer spans use `ai_audit.citations` on `answer` rows.

**4. Which teachers use the assistant, and how much? (crosses into HR)**

```sql
SELECT e.employee_code,
       e.display_name AS teacher,
       e.department,
       count(DISTINCT cv.id) AS conversations,
       COALESCE(sum(cv.turns), 0) AS questions,
       max(cv.updated_at) AS last_used
  FROM ai_conversations cv
  JOIN employees e ON e.user_id = cv.user_id AND e.deleted_at IS NULL
 WHERE cv.surface = 'teacher'
   AND cv.created_at >= now() - interval '90 days'
 GROUP BY e.id, e.employee_code, e.display_name, e.department
 ORDER BY questions DESC;
```

`turns` is cached per thread. Office staff with section-free roles chat on the `admin` surface.

**5. Open alerts of the last 30 days, with the section for attendance drops (crosses into academics)**

```sql
SELECT a.detected_on, a.kind, a.severity, a.title, a.message,
       k.code || '-' || cs.name AS section,
       (a.data ->> 'thisWeekPct')::numeric AS this_week_pct,
       (a.data ->> 'previousPct')::numeric AS previous_pct,
       a.notified_at
  FROM insight_alerts a
  LEFT JOIN class_sections cs ON a.subject_type = 'class_section' AND cs.id = a.subject_id
  LEFT JOIN classes k         ON k.id = cs.class_id
 WHERE a.acked_at IS NULL
   AND a.detected_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 30
 ORDER BY a.detected_on DESC,
          CASE a.severity WHEN 'danger' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END;
```

`data` keys differ per kind (`last7`/`weeklyAverage` for fees, `code`/`lastSeenAt` for readers).

**6. What was exported in the last 30 days, and did it work?**

```sql
SELECT x.dataset, x.format, x.status,
       count(*) AS exports,
       sum(x.row_count) AS rows_out,
       sum(x.download_count) AS downloads,
       count(*) FILTER (WHERE x.requested_by IS NULL) AS made_by_system,
       round(avg(extract(epoch FROM x.finished_at - x.started_at))::numeric, 1) AS avg_seconds
  FROM exports x
 WHERE x.requested_at >= now() - interval '30 days'
 GROUP BY 1, 2, 3
 ORDER BY exports DESC;
```

System exports (AI report PDFs) have no requester; scheduled ones carry the schedule owner.

**7. Saved report-builder reports: owner, size, shares and downloads**

```sql
SELECT d.id, d.name, d.dataset,
       o.display_name AS owner,
       d.last_run_at,
       jsonb_array_length(d.spec -> 'columns') AS columns,
       jsonb_array_length(d.spec -> 'filters') AS filters,
       (SELECT count(*) FROM report_shares s WHERE s.report_id = d.id) AS shares,
       (SELECT count(*) FROM exports x
         WHERE x.dataset = 'report_builder' AND x.params ->> 'definitionId' = d.id::text) AS downloads
  FROM report_definitions d
  JOIN users o ON o.id = d.owner_id
 WHERE d.status = 'active'
 ORDER BY d.last_run_at DESC NULLS LAST;
```

`last_run_at` moves on download, not on preview.

**8. Scheduled reports: when they run next, how the last one went, and late ones**

```sql
SELECT sc.name, sc.dataset, sc.format, sc.cron, sc.channel,
       sc.next_run_at, sc.last_run_at,
       x.status AS last_export_status, x.row_count, x.error,
       COALESCE(sc.next_run_at < now() - interval '2 hours', false) AS late,
       o.display_name AS runs_as
  FROM report_schedules sc
  JOIN users o        ON o.id = sc.owner_id
  LEFT JOIN exports x ON x.id = sc.last_export_id
 WHERE sc.status = 'active'
 ORDER BY sc.next_run_at NULLS LAST;
```

The job runs hourly, so up to an hour's delay is normal.

**9. Bulk uploads of the last 90 days: what was loaded and what was rejected**

```sql
SELECT 'people' AS source, i.kind::text AS what, i.status::text AS status,
       i.created_at, i.committed_at, i.total_rows, i.ok_rows, i.rejected_rows,
       u.display_name AS by_user
  FROM imports i
  LEFT JOIN users u ON u.id = i.requested_by
 WHERE i.created_at >= now() - interval '90 days'
UNION ALL
SELECT 'master', m.master, m.status::text,
       m.created_at, m.committed_at, m.total_rows, m.ok_rows, m.rejected_rows,
       u.display_name
  FROM master_imports m
  LEFT JOIN users u ON u.id = m.requested_by
 WHERE m.created_at >= now() - interval '90 days'
 ORDER BY 4 DESC;
```

A `validated` row was checked but never committed: nothing was written.

**10. Attendance by class this month, from the mart (crosses into attendance and academics)**

```sql
SELECT k.code AS class,
       a.section,
       count(*) FILTER (WHERE a.marked) AS days_marked,
       count(*) FILTER (WHERE NOT a.marked) AS days_not_marked,
       sum(a.present) FILTER (WHERE a.marked) AS present_marks,
       sum(a.absent)  FILTER (WHERE a.marked) AS absent_marks,
       round(100.0 * sum(a.present) FILTER (WHERE a.marked)
             / NULLIF(sum(a.present + a.absent) FILTER (WHERE a.marked), 0), 1) AS present_pct
  FROM mart.attendance_daily a
  JOIN classes k ON k.id = a.class_id
 WHERE a.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.status = 'active')
   AND a.on_date >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY k.display_order, k.code, a.section
 ORDER BY k.display_order, a.section;
```

Percent of pupils marked; the alerts use `present / strength` instead. Leave (LV) counts as present in this mart.

**11. Fee balance by class and age of the due, from the mart (crosses into fees)**

```sql
SELECT COALESCE(k.code, '(no active enrolment)') AS class,
       f.bucket,
       count(DISTINCT f.student_id) AS students,
       sum(f.balance) AS balance
  FROM mart.fee_dues f
  LEFT JOIN classes k ON k.id = f.class_id
 WHERE f.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.status = 'active')
   AND f.balance > 0
 GROUP BY k.display_order, k.code, f.bucket
 ORDER BY k.display_order NULLS LAST,
          CASE f.bucket WHEN 'current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2 WHEN '61-90' THEN 3 ELSE 4 END;
```

`balance > 0` is needed: fully paid due dates are in the mart too. Pupils who left have no class here.

**12. How fresh are the marts?**

```sql
SELECT r.mart,
       max(r.refreshed_at) AS last_refresh,
       (array_agg(r.rows ORDER BY r.refreshed_at DESC))[1] AS rows_then,
       (array_agg(r.duration_ms ORDER BY r.refreshed_at DESC))[1] AS ms_then,
       round(extract(epoch FROM now() - max(r.refreshed_at)) / 60) AS minutes_ago
  FROM mart.refresh_log r
 GROUP BY r.mart
UNION ALL
SELECT 'exam_results', max(x.computed_at), count(*)::int, NULL, round(extract(epoch FROM now() - max(x.computed_at)) / 60)
  FROM mart.exam_results x
 ORDER BY 1;
```

More than about 30 minutes old means the workers are behind; `exam_results.computed_at` is the newest result, not
the rebuild time.

## Traps

- **LV is "present" in `mart.attendance_daily`.** `present` counts every code except `A` (late, short leave, half
  day, on duty, stay back and approved leave). Use base `attendance_marks` for a strict present count.
- **Mart strength rewrites history.** `strength` counts enrolments that are `active` _today_; after promotion a past
  year's enrolments are `promoted`, so its strength drops to 0, and a pupil who left disappears from every earlier
  day. Present % over `present + absent` is steadier than over `strength`.
- **Mart class is the current active enrolment.** In `mart.fee_dues` and `mart.fee_forecast` a pupil without an
  active enrolment in that year (left, promoted) has NULL class and section. Previous years show almost no classes.
- **Paid lines are in `mart.fee_dues`.** Filter `balance > 0` for dues; `bucket` and `days_overdue` use
  `CURRENT_DATE` of the database session, not IST, and are only as fresh as the last refresh.
- **`mart.exam_results` double counts** unless you pick one grain: `class_section_id IS NULL` (class rows) or
  `IS NOT NULL` (section rows).
- **Mart windows**: attendance 400 days (plus marks of old closed years moved to `archive.attendance_marks`), comms
  120 days. `mart.admissions_funnel` and `mart.comms_delivery_daily` count **current** status, not how many ever
  reached a stage.
- **Marts lag** up to 15 minutes (results up to an hour); a school that is not `active` is not refreshed at all.
- **Message purge.** `ai_messages` older than the school's `privacy.retention.ai_messages_days` (default 180) are
  deleted nightly; `ai_conversations.turns`, `tokens`, `cost_paise` and `title` keep the old totals, `ai_audit` keeps
  every event. Do not count questions from `ai_messages` over long periods.
- **Cached totals** (`ai_conversations.turns/tokens/cost_paise`) are added per answer and never recomputed; sums over
  `ai_audit` are the truth.
- **Rewritten reports.** `ai_reports` keeps one row per period; regenerating replaces narrative, cost and `created_at`
  (earlier costs are lost). Count reports by `period_to`, not by `created_at`.
- **`exports` is a log, not a list of files.** Most rows are `expired` (file gone after 7 days). Many datasets and
  renderers share the table (AI report PDFs, report cards, certificates, DSR copies); filter `dataset`.
- **`exports.params` is jsonb with text ids**: compare `params ->> 'definitionId'` with `id::text`.
- **The report builder is not SQL.** A saved spec cannot be run as a query: its fields resolve in code from jsonb
  profiles and other tables, and filters run in memory on display values (dates as typed, names lower-cased). Rebuild
  the logic from the module guides instead of parsing `spec`.
- **Imports**: `payload` holds the uploaded rows of an upload that may never have been committed; do not treat a
  `validated` upload as loaded data.
- **Alerts**: one row per kind, subject and day — a section can raise the same alert every day of a bad week; count
  distinct subjects for "how many sections".
- **Definer-only `ai_model_settings`** returns no rows to the app role; never try to read the token.
- **Role codes as text** (`mis_dashboards.roles`, `report_schedules.recipient_roles`, `dashboard_role_defaults.role_code`)
  can match a system template and the school's own role with the same code.
- **`etl.*` has no row-level security and no app grant**; `archive.attendance_marks` likewise. Reading them needs the
  owner role, so every query must filter `school_id` by hand.

## Personal and sensitive data

- **Chat content**: `ai_messages.content` (questions and answers; questions are redacted for contacts, answers name
  pupils, marks, fees), `ai_messages.citations` (`params` may hold a pupil's name or id), `ai_messages.display`
  (record cards with figures and names), `ai_conversations.title` (the first question, up to 80 characters),
  `ai_audit.text` (redacted prompts and answers). Never send to an AI model; report counts only.
- **AI reports**: `ai_reports.narrative` and `ai_reports.facts` are school-level figures, but may name staff or
  sections; `ai_reports.message_ids` point at WhatsApp messages with recipients' mobiles.
- **Alerts**: `insight_alerts.title`, `message`, `data` name sections and devices (no pupils).
- **Exports**: `exports.params` (search text, filters, section ids, `showSensitive`), `exports.title`, `exports.error`
  (may quote a value); the files behind `exports.file_id` are full personal reports.
- **Report builder and schedules**: `report_definitions.spec` (filter values may be names or mobiles),
  `report_definitions.description`, `report_schedules.recipient_addresses` (mobiles and e-mails),
  `report_schedules.params`, `report_layouts.created_by_name`.
- **Imports**: `imports.payload` and `master_imports.payload` (whole uploaded rows: names, dates of birth, mobiles,
  addresses, Aadhaar where uploaded), `imports.report` / `master_imports.report` (error lines quoting values),
  `imports.file_name`.
- **Marts**: `mart.fee_dues.student_name`, `mart.fee_dues.admission_no` (identify a pupil with their dues).
- **Legacy and archive**: `etl.rejects.raw_value`, `etl.legacy_map.legacy_key` (old admission numbers, user names),
  `archive.attendance_marks.remarks`.
- **Secrets — never select**: `ai_model_settings.token` (encrypted Bearer token), `ai_model_settings.url`.
