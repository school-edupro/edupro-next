# Sprint 19 record: engagement and reports, the last approvals, M3 (Phase 4, weeks 39-40)

|             |                                                                                                                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal        | Scheduled report jobs and MIS role mapping; engagement modules (appointments, visitors, gate passes, consent forms with a fee, certificates, clinic); the remaining approval flows on the workflow engine (CCTV requests, employee queries); fee shadow-run closure; parent consents, certificates and health; group view. |
| Environment | Local only (user-space PostgreSQL 16 and Redis). Demo data extended.                                                                                                                                                                                                                                                       |
| Commit      | see `git log` (this record is committed with the code)                                                                                                                                                                                                                                                                     |

## 1. Scope and outcome

| Id     | Task (sprint plan row S19 and AI track S17-19)                        | Outcome                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S19-01 | Scheduled report jobs                                                 | Done. `report_schedules` (dataset or document, format, five-field cron in IST, recipients by role or address, channel); the hourly `reports.scheduled` job queues the export as the schedule's owner and notifies recipients with the link; `packages/db/src/cron.ts` with unit tests; admin **Reports → Scheduled reports** (create, run now, pause)                   |
| S19-02 | MIS role mapping; dashboards data APIs                                | Done. `mis_dashboards` as a master (System → MIS dashboards by role; defaults installed on first use); `GET /insights/mis` returns the dashboards mapped to the caller's roles with live KPIs, the screen and the datasets; admin **Reports → MIS centre**                                                                                                              |
| S19-03 | Appointments                                                          | Done. Families ask to meet the class teacher, coordinator or principal with up to three slots; the `appointment_request` flow assigns the class teacher (48 h, escalates to the coordinator); confirmation with slot and place; WhatsApp to the family; admin **Engagement → Appointments**, parent **Appointments**                                                    |
| S19-04 | Visitors                                                              | Done. `visitor_log`: sign in with purpose, whom to meet, id-proof kind and badge; sign out; day view. Only the kind of id proof is stored, never the number (DPDP minimisation)                                                                                                                                                                                         |
| S19-05 | Gate passes on the workflow                                           | Done. Early-leave and late-arrival passes raised by the family or the office with the escort; the `gate_pass` flow assigns the class teacher (2 h, escalates to the school admin); an approved pass gets `GP/YYYY/NNNNN` and the family a WhatsApp                                                                                                                      |
| S19-06 | Consent forms builder with payment                                    | Done. `consent_forms` with a JSON field list (text, choice, yes/no, date, signature), audience, open and close dates and an optional fee; families sign per child; a fee creates a `misc` payment intent that the existing pay flow completes (`POST /payments/intents/mine/:id/checkout`); the `misc` success handler marks the response paid                          |
| S19-07 | Certificates designer and bulk generation                             | Done. Document templates of kind `certificate` (landscape A4 by default) in the template designer; issue to a section or chosen pupils with title and text; serials `CERT/YYYY/NNNNN`; one PDF for the batch (`certificate_batch`), each family downloads its own (`certificate`); admin **Engagement → Certificates**, parent **Certificates**                         |
| S19-08 | Clinic                                                                | Done. `clinic_visits` with complaint, treatment, temperature, referral and sent-home; WhatsApp to the family on entry; parent **Health** shows visits and the health records                                                                                                                                                                                            |
| S19-09 | Remaining approval flows on the engine                                | Done. `cctv_request` (school admin, 72 h) and `employee_query` (coordinator, 72 h, escalates to the school admin) join admissions, messages, lesson plans, fee profile changes, transport requests, appointments and gate passes. SMS approvals and category changes were already on the engine (Sprints 10 and 14). Direct decisions stay for schools without the flow |
| S19-10 | Fee shadow run closes                                                 | Done. `POST /shadow/close` (permission `fees.shadow.close`, second factor): closes after three consecutive zero-variance runs, or earlier with a reason; `shadow_closures` and the audit log keep the summary; **Fees → Variance workbench** shows the closure card. See `m3-gate-report.md`                                                                            |
| S19-11 | Admin: reports and MIS centre; parent: consents, certificates, health | Done. Eleven admin screens, four parent screens plus home tiles, Hindi strings, navigation by permission                                                                                                                                                                                                                                                                |
| S19-12 | UAT for exams, transport, library                                     | Script written: `docs/quality/uat-exams-transport-library.md`; execution waits for the pilot's users                                                                                                                                                                                                                                                                    |
| S19-13 | QA: E2E for workflow flows                                            | Done. `sprint19.e2e-spec.ts` (11 cases) drives each new flow through the inbox and the step actions                                                                                                                                                                                                                                                                     |
| S19-14 | AI track: group dashboards for the Group Admin                        | Done. `GET /insights/group` (permission `insights.group.view`) reads each school of the group under its own tenant: pupils, attendance today, fees this month and outstanding, latest exam pass %, open approvals, overdue loans; admin **Insights → Group view**                                                                                                       |
| S19-15 | Demo data                                                             | Done. MIS defaults and the four flows for both schools; an open Science City consent form with a fee, a visitor and a clinic visit for Alpha                                                                                                                                                                                                                            |

## 2. Data model and permissions

Migration `0031_sprint19_engagement_reports_approvals.sql`: `report_schedules`, `mis_dashboards`,
`appointments`, `visitor_log`, `gate_passes`, `consent_forms`, `consent_form_responses`,
`certificates_issued`, `clinic_visits`, `cctv_requests`, `employee_queries`, `shadow_closures`; template
kinds `certificate` and `gate_pass`. Permissions: `reports.schedule.manage`, `insights.mis.view`,
`insights.group.view`, `engagement.appointment.view / decide`, `engagement.visitor.manage`,
`engagement.gate_pass.view / issue`, `engagement.consent_form.manage`, `engagement.certificate.issue`,
`engagement.clinic.manage`, `engagement.cctv.request / decide`, `engagement.employee_query.create / answer`,
`fees.shadow.close` (second factor). Admins hold all; the coordinator the academic ones; class and subject
teachers appointments, gate-pass view and employee queries; the group admin the group view.

## 3. Design notes

- Scheduled reports run as their owner: the worker builds a system envelope for the owner's user and
  school, so RLS and the dataset permission apply exactly as for an interactive export.
- The cron parser is deliberately small (five fields, lists, ranges, steps, IST) and range-checks every
  field; an invalid expression is a 400 at creation.
- The consent fee reuses the payment intent contract (purpose `misc`, entity `consent_form_response`)
  and the parent app's gateway page, extracted into `apps/parent/lib/checkout.ts` for both routes.
- Each engagement entity keeps a `workflow_instance_id`; the workflow `onComplete` hook applies the
  outcome (confirmed slot, pass number, decision note, answer) and sends the family message.

## 4. Verification

`sprint19.e2e-spec.ts` (11), `packages/db/test/cron.test.ts` (5), the full API suite, workers and
unit suites, lint, typecheck, format, a11y on the new admin screens, a browser walk-through of the
admin and parent screens, the demo seed re-run.

## 5. Carried forward

UAT execution with the pilot (exams, transport, library); the legacy report-card comparison; the
shadow term's real reconciliation (see the M3 report conditions); Sprint 20 per plan (compat API
parity and contract tests, DPDP tooling, training material, Hindi pass, regression and load, DR
drill, go-live runbook, VAPT scoping, feature freeze).
