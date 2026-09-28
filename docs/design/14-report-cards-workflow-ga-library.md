# 14 · Sprint 17: report cards, workflow GA, GPS, library

Plan rows S17 (weeks 35–36) and AI track S17–19. Migration `0029`.

## 1. Workflow engine v1 GA

- **SLA.** A level's `slaHours` now sets `workflow_steps.due_at` when the level becomes current
  (level 1 at start, the next on approval). The inbox and the instance page show the due time and an
  overdue badge; the inbox sorts by due time.
- **Reminders and escalation.** Workers job `workflow.sla` (hourly): a pending step past its due time
  gets one WhatsApp reminder to its assignees; after `workflow.escalate_after_hours` (24) the step is
  also given to the level's `escalateTo` resolver, else the roles in `workflow.escalate_roles`
  (`school_admin`), with a notification. Both leave `workflow_events`.
- **Delegation.** An active delegation (Access → Delegations) from an assignee lets the delegate see
  the step in the inbox and act on it; the history records `delegated` with the giver.
- **Cancel, reassign, notes, history.** `POST /workflow/instances/:id/cancel` (requester or
  `workflow.instance.cancel`; the owning module receives a rejection), `POST /workflow/steps/:id/
reassign` (definition managers), `POST /workflow/instances/:id/comments`, `GET …/history`.
  `workflow_events` is the per-instance history; `start()` now also writes an audit row.
- **Definitions UI.** Admin **Approvals → Definitions** gained the editor (code, entity type, up to six
  levels with resolver, SLA hours and escalation role) and activation; **Approvals → Instance** shows
  steps, due times, history, notes, cancel and reassign.
- Fixed in passing: definition create/update re-entered `db.tenant` inside the transaction and
  returned an empty body.

## 2. Report-card template engine

- `report_card_templates` (per class band: `layout` JSON of ordered sections with options, optional
  `body_html` in the document engine's Mustache subset, CSS, page size). `classes.band` (else derived
  from the class order). Defaults per band installed from **Exams → Report cards → Designer**.
- Data assembly `packages/db/src/report-card-data.ts`: pupil, guardians, the term's exams with
  marks and grades per subject (absent = 0, exempt excluded), per-exam totals and ranks from
  `exam_results`, the term aggregate and grade from the class scale, indicators by area, remarks, exam
  attendance, the latest health record, and the fee balance from `mart.fee_dues`.
- Renderer `packages/db/src/report-card-html.ts`: sections header, student, scholastic,
  co-scholastic, attendance, health, remarks, result, grade scale, signatures; design-system print
  CSS; a custom body replaces the layout renderer. Batch documents put a page break between pupils;
  a withheld card prints the notice instead of marks.
- **Releases** `report_card_releases` (term code, exams, template per band, `hide_defaulters` and
  `defaulter_min`, draft → released → withdrawn). `report_cards` records each rendered pupil (export
  id, withheld).
- **Batch render** through the export service: renderers `report_card` (one pupil) and
  `report_card_batch` (a section in one PDF), rendered by the workers with photos from storage.
- **Family.** `GET /exams/mine/results` (released terms, per-exam summary), `POST /exams/mine/
report-cards/:releaseId/:studentId/pdf` (409 `report_card.withheld` while the fee rule applies),
  `GET /exams/mine/exports/:id`. Parent app **Results**.
- **Visual-diff harness.** `packages/db/test/report-card.test.ts` snapshots each band's default
  layout against the sample pupil; renderer or layout changes show as diffs.

## 3. Transport GPS (NeverSkip adapter) and the parent view

- `vehicle_positions` (vehicle, recorded_at, lat, lng, speed, heading, ignition, source). The vendor
  pushes to `POST /transport/gps/positions` with a service key of scope `transport.gps`; the adapter
  accepts NeverSkip's field names (`imei`, `lat`, `lon`, `speed`, `angle`, `ts`, `acc`) or a plain
  array, keyed by `transport_vehicles.gps_device_id`. `GET /transport/gps/fleet`, `…/vehicles/:id/
trail`, `GET /transport/gps/mine` (the child's route, stop and the bus's last fix). Retention by
  the nightly `transport.positions.expire` job (`transport.gps_retention_days`).
- Admin **Transport → Live fleet**; parent **School bus → Live bus** (last seen, speed, map link).

## 4. Library (Sprint 17 part)

- `library_titles`, `library_copies` (accession register), `library_loans` (issue, due, return,
  renewals, fine, waived, paid, receipt reference). Titles and copies are also masters (Excel upload,
  export) in the master-data framework, group **Library**.
- Circulation rules from settings: `library.loan_days` (14), `library.max_loans` (2),
  `library.fine_per_day` (2.00); a pending fine blocks a new issue; reference copies are not issued;
  two renewals at most. Fines are computed on return and collected (with a receipt reference) or
  waived.
- Admin **Library → Catalogue / Circulation / Fines / Library setup**; parent **Library** (children's
  loans and fines). Permissions `library.catalogue.view/manage`, `library.loan.circulate`,
  `library.family.view`.

## 5. AI track: results mart

`mart.exam_results` (exam × class × section: pupils, complete, pass, fail, mean %, pass %) refreshed by
`app.refresh_exam_results_mart()` through the hourly `insights.results_mart` job — the base for the
principal's results analytics and the report-card marts of Sprints 18–19.

## 6. Out of scope, recorded

ETL of exam / transport / library history (no legacy dump in this environment); a map SDK (the app
links to OpenStreetMap); library sale, digital library and stock verification (Sprint 18); the
remaining bands' HPC/CCE layouts and board result import (Sprint 18).
