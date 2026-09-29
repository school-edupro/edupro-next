# 16 · Sprint 19: engagement, reports and MIS, the last approvals, M3

Plan row S19 (weeks 39–40), AI track S17–19 (group dashboards, the M3 AI evaluation report), M3
gate. Migration `0031`.

## 1. Scheduled report jobs

`report_schedules` (dataset or renderer, params, format, cron pattern, recipients as role codes and
addresses, channel whatsapp / email, last run, status). The hourly workers job `reports.scheduled`
takes the schedules due since their last run, creates the export under the schedule's owner (the
export service as today) and, when the file is ready, sends the download link to the recipients
through the notification queue (the `report_ready` template). Admin **Reports → Schedules** (create,
pause, run now, history through the export centre).

## 2. MIS role mapping and dashboards data APIs

`mis_dashboards` maps a dashboard key (`principal`, `academics`, `attendance`, `fees`,
`communication`, `transport`, `library`, `results`, `group`) to the role codes that see it. `GET
/insights/mis` returns the dashboards the caller's roles map to; each dashboard reads its numbers
through the existing insights services (principal dashboard, department dashboards, results
analytics, the group view) so the numbers are the same everywhere. Admin **Reports → MIS centre**:
one tile per dashboard with the KPIs, an "open" link and the export buttons of its datasets; **System
→ Settings** keeps the role mapping (masters grid `mis_dashboards`).

## 3. Engagement

- **Appointments** `appointments`: a family asks to meet a teacher, the coordinator or the principal
  (purpose, preferred slots); the request runs on the workflow `appointment_request` (class teacher
  or the person asked, one level); the decision sets the confirmed slot; WhatsApp to the family.
  Parent **Appointments**; admin **Engagement → Appointments**.
- **Visitors and gate pass** `visitor_log` (visitor, purpose, whom to meet, in/out times, id proof
  kind, badge number) and `gate_passes` (student early leave / late arrival with the escort, on the
  workflow `gate_pass`: class teacher then front office; the printed pass is a document template kind
  `gate_pass`). Admin **Engagement → Visitors** and **Gate passes**.
- **Consent forms builder** `consent_forms` (title, JSON schema of fields, audience, optional fee
  amount, open/close dates, status) and `consent_form_responses` (student, answers, signed by,
  payment intent when a fee applies through the payments service, purpose `misc`). Parent
  **Consents**: the family fills and signs; a fee opens the existing pay flow. Admin builds the form
  (fields: text, choice, yes/no, date, signature) and reads the responses; export as a dataset.
- **Certificates designer and bulk generation**: document templates gain the kinds `certificate`
  and `gate_pass`; entity `student` data plus `certificate` variables (title, text, date, serial);
  the renderer `certificate_batch` prints a section's certificates in one PDF (page break per
  pupil) with a serial number per pupil in `certificates_issued`. Admin **Engagement →
  Certificates** (choose template, section, title text, generate); parent **Certificates** lists the
  child's issued certificates with their PDFs.
- **Clinic** `clinic_visits` (student, time in / out, complaint, treatment, referred, notified
  family); a visit sends the family a WhatsApp; parent **Health** shows the visits and the health
  records of Sprint 15. Admin **Engagement → Clinic**.

## 4. Remaining approvals on the workflow engine

`cctv_requests` (a family or staff request for footage: camera, window, reason; approval by the
school admin) and `employee_queries` (staff HR queries with a category; approval / answer by the
principal or HR position) run on the workflow with default definitions; SMS approval (message
requests) and category change (fee profile change) were already on it. With these, every approval
flow of Release 1 uses one engine (M4 condition) and the definitions UI governs all of them.

## 5. The shadow run closes (M3)

`POST /shadow/close` records the closure when the last three daily runs read zero (or the accountant
overrides with a reason): `fees.shadow.closed_at`, the closing run id and the reconciliation summary
in `shadow_closures`. `docs/sprints/m3-gate-report.md` collects the evidence: the runs, the day book
and head-wise tally comparison, online payments live, the AI evaluation report (eval set, red team,
cost).

## 6. Group dashboards (AI track)

`GET /insights/group` for Group Admins: one row per school of the group — pupils, attendance today,
fee collection this month and outstanding, results of the latest exam (pass %), open approvals,
overdue library loans — from each school's marts under that school's tenant context (the caller's
memberships span the group). Admin **Insights → Group**.

## 7. Verification

`sprint19.e2e-spec.ts`: schedules (due detection and export creation), MIS mapping, appointments,
gate pass on the workflow, consent form with a fee, certificate batch, clinic notification, CCTV and
employee queries on the workflow, shadow close, the group dashboard; UAT scripts for exams,
transport and library; E2E for the workflow flows.
