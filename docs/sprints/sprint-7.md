# Sprint 7 record: academics daily work (Phase 2, weeks 15-16)

|             |                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal        | Daily academics for teachers and families, the student lifecycle documents (transfer certificate, withdrawal, promotion) and a template engine for documents on the export service |
| Environment | Local only (user-space PostgreSQL 16 and Redis; no Azure subscription). Demo data extended so every developer login can check the new screens                                      |
| Commit      | see `git log` (this record is committed with the code)                                                                                                                             |

## 1. Scope and outcome

| Id    | Task                                                                       | Outcome                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S7-01 | Template engine for documents on the export service                        | Done. `document_templates` per school (HTML body, CSS, page size, version), a small escaping template engine (`{{path}}`, `{{#if}}`, `{{#each}}`), a `document` renderer in the export worker, default templates (transfer certificate, bonafide, letter), preview with sample or real data, PDF queued through the export centre                      |
| S7-02 | ID cards, transfer certificates, withdrawal clearance, promotion decisions | Done. ID cards existed (Sprint 4). TC: per-school sequence, snapshot, PDF, ends the enrolment, cancel. Withdrawal: request opens a clearance per department; `app.complete_withdrawal` refuses until all cleared, then ends the enrolment and deactivates the login. Promotion: decisions per student, applied by `app.apply_promotion` into next year |
| S7-03 | Homework, classwork, assignments with files                                | Done. One `daily_work` table with a kind; attachments through the file service (must be ready and in-tenant); teachers post within their `class_section` scope; families read their children's sections                                                                                                                                                |
| S7-04 | Notices and circulars with targeting                                       | Done. Audience (everyone, students, employees) plus targets (class, section, student, employee), publish window, pin, publish/unpublish, files; visibility resolved per viewer                                                                                                                                                                         |
| S7-05 | Holidays and almanac                                                       | Done. Holidays with kind and audience, overlap refused; almanac events with kind, time and audience; one calendar read for every app                                                                                                                                                                                                                   |
| S7-06 | Gallery                                                                    | Done. Albums with audience and images through the file service; signed download URLs on the album page                                                                                                                                                                                                                                                 |
| S7-07 | Teacher PWA: homework and classwork posting                                | Done. **Daily work** page posts for assigned sections with an attachment (upload → complete → post); notices and calendar tiles link to the shared pages                                                                                                                                                                                               |
| S7-08 | Admin academics screens; parent app reading                                | Done. Admin: Daily work, Notices, Holidays and almanac, Gallery (+ album), Transfer certificates, Withdrawals (+ clearance page), Promotion, System → Document templates (+ editor with live preview), TC/withdrawal/document cards on the student page. Parent: Homework (child switch), Notices, Calendar                                            |
| S7-09 | Demo data                                                                  | Done. Templates for both schools, 20 daily-work posts (VI-A, VI-B, IV-A), 7 notices, 11 holidays, 9 almanac events, an album with 3 images, TC/2026-27/0001 for the leaver, a withdrawal with two clearances done, 2027-28 sections and 20 promotion decisions for IX-A and X-A; parent and student roles gained the reading permissions               |
| S7-10 | Threat model: people and academics; QA: file upload security tests         | Done. `docs/design/04-threat-model-people-academics.md`; e2e covers content-type refusal, tenant isolation of files, pending uploads, template escaping                                                                                                                                                                                                |

## 2. Data model and permissions

- Migration `0017_sprint7_daily_academics.sql`: 15 tables, 11 enums, 3 routines (`app.next_tc_no`, `app.complete_withdrawal`, `app.apply_promotion`), all under forced row-level security.
- Permissions: `academics.daily_work.view|post`, `academics.notice.view|manage`, `academics.calendar.view|manage`, `academics.gallery.view|manage`, `people.tc.view|issue`, `people.withdrawal.view|manage|clear`, `people.promotion.view|manage`, `platform.template.view|manage`. Parent and Student templates read daily work, notices, calendar, gallery and timetable; the API restricts rows to their own children.
- Viewer resolution (`ViewerService`): staff (employee record or employee membership) read through ADR-004 scopes; families read through `guardians.user_id` and `students.user_id`.

## 3. Verification

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | see section 5                                                                                                                                                                                                                                                                                                                                                                           |
| API e2e `daily-academics.e2e-spec.ts` (new) | 10 tests: file content-type refusal and tenant isolation, homework with attachment and scope refusal, family reads, notices audience and targets, holiday overlap, templates install/preview/escaping/render, TC issue/duplicate/cancel, withdrawal two-step, promotions set/apply/idempotent, gallery audience                                                                         |
| Role walk-through against the running API   | dev-admin: 20 posts in IV-A/VI-A/VI-B, 6 notices, 11 holidays, 9 events, 1 album, 3 templates, 1 TC, 1 open withdrawal, 16 IX decisions; dev-parent: 2 children, 16 posts (IV-A, VI-A), 4 notices, no staff events, cannot post; dev-teacher: VI-A only, VI-B post refused (`scope-denied`); dev-student: own section; dev-clerk: withdrawals yes, promotions denied; dev-nobody denied |

Note for testers: `dev-teacher` holds the coordinator's delegation this week, so she also sees draft notices; end it under Access → Delegations for the pure teacher view.

## 4. Decisions

- One `daily_work` table with a `kind` column replaces the three legacy tables (homework_master, classwork_master, assignment); the API and screens present them separately.
- Templates are trusted admin content; values are always escaped by the engine. There is no expression language on purpose.
- The TC PDF is queued after the TC row commits (two transactions) so the worker can read the certificate; a **Generate PDF** action re-queues it.
- Withdrawal departments default to fees, library, transport, academics and can be set per school with `people.withdrawal_departments`.
- Promotion keeps the source enrolment as history (`promoted` or `left`) and creates the target enrolment through `app.enrol_student`.

## 5. Test totals after this sprint

| Suite                  | Result                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| API e2e (`test:e2e`)   | 11 suites, 89 tests passed (79 before this sprint + 10 new)                           |
| API unit               | 5 passed                                                                              |
| `@edupro/db`           | 29 passed                                                                             |
| `@edupro/workers`      | 10 passed                                                                             |
| `@edupro/etl`          | 67 passed, 2 skipped                                                                  |
| `@edupro/storage`      | 3 passed                                                                              |
| Lint, typecheck, build | 14 workspaces clean (one pre-existing warning in the admin app); 10 build tasks green |

The Jest exit wait after the full e2e run (recorded in Sprint 6) remains; the run is bounded with a
time limit until the handle is found.
