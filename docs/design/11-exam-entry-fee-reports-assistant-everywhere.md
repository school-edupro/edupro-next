# 11. Exam entry, fee reports centre, assistant everywhere (Sprint 15)

Sprint plan row S15 (weeks 31-32) and AI track S15. Builds on 10 (exams start, assistant v0), 09 (collect and
pay), 08 (marts). Migration `0026_sprint15_exam_entry_fee_reports.sql`.

## 1. Exam entry

Legacy: `exam_mark_entry`, `exam_indicator_entry`, `exam_remark`, `exam_attendance`, `exam_health_statistics`
(t-webservices `submit_*`). Legacy has no server-side permission check on marks and locks per class+exam; here
entry is scoped and the lock is per exam subject (`exam_subjects.entry_locked`, Sprint 14) or per exam
(`exams.marks_locked`).

| Table                          | Key                                         | Notes                                                                                                                                                    |
| ------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark_entries`                 | (exam_subject_id, student_id)               | `marks` NUMERIC(6,2) NULL, `absent`, `exempt`, `entered_by/at`, `updated_by/at`. Written only by `app.enter_marks(p_exam_subject_id, p_rows jsonb)`      |
| `indicator_sets`, `indicators` | set code per school; indicator code per set | co-scholastic / HPC descriptors with the allowed grades (`grades TEXT[]`, e.g. `{A,B,C}`)                                                                |
| `exam_indicator_sets`          | (exam_id, class_id, set_id)                 | which set a class uses in an exam                                                                                                                        |
| `indicator_entries`            | (exam_id, indicator_id, student_id)         | `grade` must be in the set's grades                                                                                                                      |
| `remark_bank`                  | (school, code)                              | predefined remarks per class band (legacy `exam_remark_mapping`)                                                                                         |
| `exam_remarks`                 | (exam_id, student_id)                       | free text ≤ 600 plus optional bank code; per student per exam (legacy semantics)                                                                         |
| `exam_attendance`              | (exam_id, student_id)                       | `days_present`, `days_total`                                                                                                                             |
| `health_records`               | (student_id, recorded_on, exam_id nullable) | height cm, weight kg, BMI generated, blood group, vision L/R, dental, notes. Sensitive: separate permissions, values never staged into the audit payload |

`app.enter_marks` checks: year open for `exams`; exam not `marks_locked`; subject not `entry_locked`; student
enrolled (active) in a section of the exam class this year; `0 <= marks <= max_marks`; absent/exempt rows carry
NULL marks. It upserts and returns inserted/updated counts. Every other entry kind is a plain upsert in the
service under the same lock and enrolment checks (indicator, remark, attendance and health are per exam or
per student, not per subject; the exam lock governs them).

Permissions (module `exams`): `exams.marks.enter`, `exams.marks.view`, `exams.marks.unlock`,
`exams.indicator.enter`, `exams.remark.enter`, `exams.attendance.enter`, `exams.health.enter`,
`exams.health.view`. SoD rule `exams.marks.enter` × `exams.marks.unlock` (design 02 §SoD). Grants: class and
subject teachers enter and view (health: class teacher only); coordinators view everything and unlock; admins
all; auditor views marks. Unlocking (`POST /exams/:id/subjects/lock` with `locked:false`) needs
`exams.marks.unlock` in addition to `exams.master.manage`.

Scoping: a teacher may enter for a section they hold in `teacher_assignments` this year — class teacher or
coordinator for any subject, subject teacher for the assigned subject — mirroring `AttendanceService.assertMayMark`.
Unscoped roles (coordinator, admin) pass the `ScopePolicy` check with `null`.

Routes (`/exams/:id/...`, all under the exam):
`GET entry/sections` (sections and subjects the caller may enter), `GET marks?classSectionId&subjectId`,
`PUT marks`, `GET indicators?classSectionId`, `PUT indicators`, `GET register?classSectionId` (remarks +
attendance + latest health per student), `PUT remarks`, `PUT attendance`, `PUT health`.
Masters: `GET/PUT /exams/indicator-sets`, `GET/PUT /exams/remark-bank`, `PUT /exams/:id/indicator-sets`.

Teacher app: **Marks** (subject grid) and **Exam register** (class teacher: attendance days, remark, height and
weight) tiles; locked state disables the grid.

## 2. Report framework and the fee reports centre

- One definition serves screen and file: `packages/db/src/datasets.ts` entries are the report registry
  (id, permission, params, columns, SQL). `GET /fees/reports/:id?…` runs the definition live for the screen
  (capped rows); `POST /reports/exports` renders the same definition to CSV, XLSX, PDF or XML.
- Marts stay tables refreshed by `insights.refresh` (ADR-010: materialised views cannot carry RLS; the plan's
  wording is superseded). Kysely is not introduced: every report is bound-parameter SQL under the tenant
  wrapper, and a second query layer would sit outside RLS discipline for no gain. Recorded as a deviation.
- Live (base tables) because they must match the counter the same minute: **day book** (all ledgers, misc and
  paid refunds as negative lines; reversed receipts excluded, bounced shown with status like legacy; totals by
  ledger, by mode, receipt-number ranges), **head-wise tally** (days of a month × fee heads from allocations,
  plus late fee and misc columns; refunds net out through reversed allocations).
- From marts: **defaulters** (`mart.fee_dues`, filters class, section, as-of, minimum balance) and **forecast**
  (`mart.fee_forecast`: expected, collected, balance per class per due month for the year; legacy
  `fees_forecast` rebuilt per student is replaced by a class × month table; per-student detail is the ledger).
- **Defaulter messaging**: `POST /fees/reports/defaulters/notify` sends the `fee_due` template (installed per
  school on whatsapp and sms; service category, so no consent gate, as legacy) to the primary guardian of each
  selected student, one per student per day, recorded in `fee_reminders`. Permission `fees.defaulter.notify`.
- **Tally export**: dataset `fee_tally_vouchers` (one line per receipt × head, cash/bank ledger from settings
  `fees.tally.cash_ledger` / `fees.tally.bank_ledger`, party = student). Format `xml` renders Tally XML
  (ENVELOPE › TALLYMESSAGE › VOUCHER, Receipt vouchers, Dr cash/bank, Cr head ledgers). `exports.format` gains
  `xml`.
- **Bank upload reconciliation**: `bank_statements` + `bank_statement_lines` (CSV with date, narration,
  reference, debit, credit, balance; header aliases like settlements). Credits match cheque/DD/bank/UPI
  receipts and misc receipts by instrument number or reference + amount, then by unique amount within ±3 days;
  a match stamps `fee_payments.cleared_on` / `bank_line_id`. Debit lines whose narration says return/bounce and
  match a cleared cheque are flagged `returned` for the desk to raise a bounce adjustment (never auto-posted).
  Permissions reuse `payments.settlement.view|manage`.
- Admin **Fees → Reports** (`/fees/reports?report=…`): day book, head-wise tally, defaulters (with notify),
  forecast, each with export buttons; **Fees → Bank statements** for uploads.

## 3. Assistant for teachers and parents, Hinglish, anomaly alerts v1

- Catalogue entries gain `scope?: 'section' | 'student'`. The service resolves the caller through
  `ViewerService`: staff get `sectionIds` (null = unrestricted), families get their children. A scoped caller
  only sees entries that declare a scope, and the SQL receives the ids as a mandatory filter
  (`CatalogueContext.sectionIds/studentIds`). Unscoped staff keep the full catalogue as before.
- New entries for families: `my_children`, `child_dues`, `child_attendance`, `child_homework`,
  `child_notices`, `child_timetable`; sections-scoped versions of attendance/homework/queries for teachers.
- `insights.assistant.use` granted to class_teacher, subject_teacher and parent. Parents must have consent
  `ai.assistant` **granted** (opt-in; DPDP) or the API answers `consent-required` (403) and the app links to
  the consent screen. `ai_conversations.surface` comes from the request (`admin|teacher|parent`), validated
  against the viewer kind.
- Hinglish: detection (Latin script with Hindi function words: kitna, kya, bakaya, hai, ka/ki/ke, kaun, kab,
  mera/mere, bachche, chhutti, hazri…) sets `language='hinglish'`; the mock responder answers in Hinglish;
  catalogue keywords carry Hinglish terms (bakaya, fees baki, gair hazir, hazri).
- Anomaly alerts v1: worker job `insights.alerts` (maintenance queue, daily) per school:
  `attendance.drop` (section this week ≥ 10 points under its previous 4-week mean, min 20 marked pupils),
  `fees.collection_dip` (last 7 days under half the mean weekly collection of the previous 4 weeks, and the
  week had at least one due date or the mean is above zero), `reader.silent` (RFID reader silent ≥ 24 h).
  Rows go to `insight_alerts` (one per kind × subject × day) and a `push`/`whatsapp` `insight_alert` message
  goes to users holding `insights.dashboard.view` in the roles named by setting `insights.alert_roles`
  (default `school_admin`). `GET /insights/alerts` and `POST /insights/alerts/:id/ack`; the principal
  dashboard lists open alerts. `insights.alert.view|ack` permissions.

## 4. Out of scope, recorded

ETL rehearsal 3 against the legacy database and the three-month report comparison need the legacy MySQL
dump, which is not in this environment; the ETL gains transform steps and tests for marks, indicators,
remarks, exam attendance and health so the rehearsal is a data run, not a code task. Registers and analysis
views are Sprint 16.
