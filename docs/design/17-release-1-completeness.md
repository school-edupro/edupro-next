# Design note 17: Release-1 completeness (Sprint 20)

|            |                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprint     | S20 (weeks 41-42): compatibility API parity with contract tests, DPDP tooling, training material and in-app tours, Hindi pass, accessibility and performance fixes, regression, load, DR drill, go-live runbook, VAPT scoping, freeze |
| Depends on | Sprints 4, 5 and 11 (compatibility API), 10 and 11 (consent, privacy notices), 19 (engagement modules the legacy endpoints map to)                                                                                                    |
| Outcome    | Feature freeze for Release 1: every endpoint the current apps call answers from the new platform; a school can serve data-principal requests; the pilot has training, a go-live plan and a VAPT scope                                 |

## 1. Compatibility API parity

### 1.1 Inventory method

The legacy webservice tree (`t-webservices-21-03-2026`, 170 PHP files) was classified by reading each
file's inputs (`$_POST` / `$_GET`), output keys and tables. Three groups:

| Group                     | Rule                                                                                                                                                      | Count |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Served by `compat/v1`     | Called by the current student, parent or teacher app builds and backed by a module of the new platform                                                    | 38    |
| Superseded by the new app | Screens the new parent or teacher app replaces outright (dossiers, activity logs, form 16, maths talk, purchase orders); the old app keeps the old server | 24    |
| Retired                   | Dated copies (`*_28-08-2019`, `*_old`), diagnostics (`php_info`, `api_tester`, `ExecuteQry`, `backup`), password and IMEI flows the platform forbids      | 108   |

The full matrix is `docs/data/05-compat-parity-matrix.md`; the contract file
`apps/api/test/fixtures/compat/contracts.json` lists, for every served endpoint, the legacy request
fields and the response keys. The contract test drives each endpoint through an app session and asserts
the keys, so a regression in any shape fails CI.

### 1.2 Endpoints added in Sprint 20

All under `/api/v1/compat/v1`, authenticated by the app session of the handshake; legacy envelopes kept
(`{channel:{items}}`, `{channels:...}`, `{status, info}` or `{status, msg}` as the PHP file used).

| Legacy file                                                    | New route                                                                   | Backed by                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GetFee.php`                                                   | `GET student/GetFee?sadmission=`                                            | fee ledger instalments (`FeeLedgerService.mine`)                    |
| `GetTransport.php`                                             | `GET student/GetTransport?sadmission=`                                      | route assignment, stop, vehicle, driver, GPS device                 |
| `GetLibraryTrasaction.php`                                     | `GET student/GetLibraryTrasaction?sadmission=`                              | `library_loans`                                                     |
| `GetHealthrecord.php`, `GetClinicExamination.php`              | `GET student/GetHealthrecord`, `GET student/GetClinicExamination`           | `health_records`, `clinic_visits`                                   |
| `GetStudentDateSheet.php`, `GetDatesheet.php`                  | `GET student/GetDatesheet`                                                  | `exam_subjects.exam_on` of exams shown on the portal                |
| `GetReportCard.php`                                            | `GET student/GetReportCard`                                                 | released report cards (`ReportCardsService.mine`)                   |
| `GetAcademicCalander.php`                                      | `GET student/GetAcademicCalander`                                           | holidays and calendar events                                        |
| `GetSchoolnews.php`, `get_app_banner_news.php`                 | `GET student/GetSchoolnews`, `GET student/get_app_banner_news`              | pinned notices of kind `news` / `circular`                          |
| `GetAlbum.php`, `GetAlbumImages.php`                           | `GET student/GetAlbum`, `GET student/GetAlbumImages?id=`                    | gallery albums and items with signed file links                     |
| `GetGatePass.php`, `SubmitGatePass.php`, `UpdateGetPassStatus` | `GET GetGatePass`, `POST SubmitGatePass`, `POST UpdateGetPassStatus`        | Sprint 19 gate passes (family raises; class teacher decides)        |
| `GetVistorEntry.php`, `SubmitVisitorEntry.php`                 | `GET teacher/GetVistorEntry`, `POST teacher/SubmitVisitorEntry`             | Sprint 19 visitor log                                               |
| `student_apply_Leave.php`, `student_leave_list.php`            | `POST student/student_apply_Leave`, `GET student/student_leave_list`        | parent queries of kind `leave`                                      |
| `SendQuery.php`, `GetQueryResponse.php`, `GetParentQuery.php`  | `POST SendQuery`, `GET GetQueryResponse`, `GET teacher/GetParentQuery`      | parent queries / employee queries                                   |
| `GetUserDetail.php`, `TeacherProfile.php`                      | `GET teacher/GetUserDetail`                                                 | employees + postings                                                |
| `get_class_subject.php`                                        | `GET teacher/get_class_subject`                                             | teacher assignments, exams open for entry, exam types, leave types  |
| `show_student_for_mark_entry.php`, `submit_mark_entry.php`     | `GET teacher/show_student_for_mark_entry`, `POST teacher/submit_mark_entry` | `ExamEntryService.marks / putMarks` (locks, scopes, SoD apply)      |
| `GetAssignment.php`                                            | `GET teacher/GetAssignment`                                                 | `daily_work` of kind assignment                                     |
| `GetUpdateVersion.php`, `app_version.php`                      | `GET app_version?platform=` (public)                                        | settings `compat.app_version_android / _ios / _force_below`         |
| `GetLeaveHistory.php`, `ApplyLeave.php`                        | `GET teacher/GetLeaveHistory`, `POST teacher/ApplyLeave`                    | answer `{status:false, info:'Use the staff portal'}` until HR (S24) |

Design rules kept from Sprint 11: compat calls run through the new services (scopes, locks, workflow),
never straight to tables; dates in `dd-mm-yyyy`; ids as strings; errors travel as HTTP 200 with
`status:false` and a message, as the apps expect; the handshake session carries the person type so a
guardian's `sadmission` must be one of their children (otherwise "No record").

## 2. DPDP tooling

### 2.1 Data-principal requests

`data_subject_requests`: `kind` (access, correction, erasure, grievance), `principal_kind` (student,
guardian, employee), `principal_id`, `requested_by_user`, `channel` (parent_app, office, email, letter),
`detail`, `status` (received, in_progress, completed, refused), `received_on`, `due_on` (received plus
`privacy.dsr_days`, default 30), `handled_by`, `outcome`, `export_id`, `completed_at`.

| Kind       | Completion                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| access     | Renderer `dsr_access` (worker) produces a PDF for the principal: identity and contact, enrolments or postings, guardians or children, attendance summary per year, fee demands and receipts, exam results, consents and their history, messages sent (metadata), files held, requests raised. The export is created for the office user and the family download goes through the request row (`GET /privacy/requests/mine/:id/export`) |
| correction | Points at the existing change-request flow (`profile_change_requests`); the request row records which change request closed it                                                                                                                                                                                                                                                                                                         |
| erasure    | `app.erase_principal(kind, id, reason)` (SECURITY DEFINER, audited) anonymises the person rows (names, contacts, address, documents, photos, guardians' contact), keeps the ledgers, attendance and results as pseudonymous records the school must retain, and refuses while the principal is active (current enrolment or posting) or has a fee balance                                                                              |
| grievance  | Recorded and time-boxed; answered in the outcome text                                                                                                                                                                                                                                                                                                                                                                                  |

Families raise access, correction and grievance requests from **Profile → Your data**; erasure is
raised at the office (identity verified in person). Staff work the queue on **System → Privacy**
(permission `platform.privacy.manage`); each transition is audited.

### 2.2 Retention purge

Settings (per school, within legal minimums enforced by the schema): `privacy.retention.comms_body_days`
(180: message bodies replaced by `[retained metadata]`), `privacy.retention.login_events_days` (365),
`privacy.retention.visitor_log_days` (365), `privacy.retention.ai_messages_days` (180),
`privacy.retention.export_files_days` (30, already the export expiry), `transport.gps_retention_days`
(existing). The nightly worker job `retention.purge` runs per school, writes one `retention_runs` row
per policy with the count, and never touches financial or academic records (the archive strategy of
ADR-014 covers those).

### 2.3 Breach log

`breach_log`: `title`, `detected_at`, `reported_by`, `description`, `data_classes` (text[]),
`principals_affected` (count), `status` (open, contained, notified, closed), `board_notified_at`,
`principals_notified_at`, `actions`, `owner`. The incident runbook (`docs/runbooks/incident-breach.md`)
walks the 72-hour path: contain, assess, notify the Data Protection Board and the affected principals
through the communication module with the `breach_notice` template, close with the post-mortem.

## 3. Training material and in-app tours

- `docs/training/<module>.md`: one page per module (admissions, academics, attendance, communication,
  engagement, fees, exams) in the same voice as the demo walk-throughs: who does what, the daily
  routine, the month-end routine, the five most common questions.
- In-app tours: `apps/admin/components/Tour.tsx` (client) reads the tour of the current route from
  `lib/tours.ts` (steps with a title and a body, optionally anchored to a `data-tour` element), shows a
  panel with next/back/skip, remembers completion in `localStorage` (`edupro.tour.<id>`), and opens on
  the first visit. The header gains a "Show me around" button that replays the tour of the page.
  Texts live in `messages/en.json` and `hi.json` under `tours`.

## 4. Hindi pass, accessibility and performance

- Parent app: the seven Phase 2 screens (attendance, calendar, homework, notices, profile, queries,
  timetable) move to `t(lang, …)`; the dictionary gains their strings.
- Teacher app: `lib/i18n.ts` with the same cookie and a toggle on the home page; the home, marks, exam
  register, lesson plans and assistant screens are translated (the Phase 3 and 4 screens of the plan).
- Admin: en and hi are key-complete (2,703 keys); seven product words stay identical by design.
- Accessibility: the axe suite runs on all 57 admin screens; findings fixed in this sprint are listed in
  the sprint record.
- Performance: `pnpm perf:local` baseline and `performance*.e2e-spec.ts` re-run after the sprint's
  index review; numbers in the sprint record.

## 5. Regression, load, DR drill, go-live, VAPT scope, freeze

- Full regression: every e2e suite, unit suites, a11y, visual snapshots.
- Load: `perf/k6/baseline.js` and `due-date-peak.js` for staging; locally autocannon and the fees load
  probe.
- DR drill: `scripts/restore-drill.sh` against the local stack; measured duration recorded in the
  runbook's "Last drill" row.
- `docs/runbooks/go-live.md`: the cut-over plan for the pilot (freeze, final ETL, verification, DNS and
  app pointing, hypercare, rollback).
- `docs/security/vapt-scope.md`: assets, URLs, roles and test accounts, exclusions, evidence expected,
  schedule for the CERT-In empanelled auditor (Sprint 21).
- Feature freeze: tag `release-1-freeze`; `docs/release-1-freeze.md` lists what is in, what is deferred
  and the change-control rule until M4.
