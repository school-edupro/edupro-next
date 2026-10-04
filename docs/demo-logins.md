# Demo data and role logins

`pnpm --filter @edupro/db seed:demo` fills the local database with two schools and one developer login per
role. It runs after `pnpm db:migrate` and `pnpm --filter @edupro/db seed:dev`, is safe to rerun (people
data is created only once), and refuses to run when `NODE_ENV=production`.

## What the seed creates

| Data                      | Alpha Public School (Pune)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Beta Public School (Nagpur) |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Academic years            | 2025-26 closed, 2026-27 active, 2027-28 planned                                                                                                                                                                                                                                                                                                                                                                                                                                                | same                        |
| Classes and sections      | I to X, sections A and B (20 sections, capacity 40)                                                                                                                                                                                                                                                                                                                                                                                                                                            | I to V, section A           |
| Students                  | 161 with guardians (every sixth student shares a guardian, so siblings exist), enrolments with roll numbers                                                                                                                                                                                                                                                                                                                                                                                    | 30                          |
| Employees                 | 20 with designations, departments, postings and reporting lines to the Principal, Vice Principal and Coordinator                                                                                                                                                                                                                                                                                                                                                                               | 8                           |
| Notification templates    | fee reminder (SMS with DLT ids), absent alert (WhatsApp), welcome (email), notice (push)                                                                                                                                                                                                                                                                                                                                                                                                       | none                        |
| Delivery log              | 24 messages in every status (delivered, sent, failed, queued)                                                                                                                                                                                                                                                                                                                                                                                                                                  | none                        |
| Settings                  | holidays list, late-fee mode, security lead email                                                                                                                                                                                                                                                                                                                                                                                                                                              | holidays, late-fee mode     |
| Security history          | one ended impersonation session, one closed break-glass window with its report, sample audit rows                                                                                                                                                                                                                                                                                                                                                                                              | none                        |
| Delegation                | the Academic Coordinator covers for the class teacher of VI-A for a week                                                                                                                                                                                                                                                                                                                                                                                                                       | none                        |
| Subjects (Sprint 6)       | 10 subjects; classes I to V study 7 (EVS, Art, Music…), VI to X study 8 (Science, Social Science, Computer Science elective in IX and X)                                                                                                                                                                                                                                                                                                                                                       | 7 subjects, primary set     |
| Teacher assignments       | a class teacher for every section (Anita Deshmukh for VI-A), the coordinator on VI to X, the Vice Principal as indicator on IX and X, five subject teachers on VI-A and VI-B (Suresh Nair takes Mathematics in both)                                                                                                                                                                                                                                                                           | a class teacher per section |
| Timetable                 | 9 periods (assembly, 7 teaching, break); a full Monday to Saturday timetable for all 20 sections with rooms; Saturday is a half day                                                                                                                                                                                                                                                                                                                                                            | same for 5 sections         |
| Status history            | a "created" entry for every student; one student of X-B left (reason and actor recorded)                                                                                                                                                                                                                                                                                                                                                                                                       | created entries             |
| Imports                   | one committed roll (class VI admissions) and one validated employee file with a rejected mobile number                                                                                                                                                                                                                                                                                                                                                                                         | none                        |
| Daily work (Sprint 7)     | 20 homework, classwork and assignment posts for VI-A, VI-B and IV-A by their teachers, with due dates                                                                                                                                                                                                                                                                                                                                                                                          | none                        |
| Notices                   | reopening notice (pinned), fee instalment (students), PTM for VI–VIII (class targets), VI-A project (section target), staff circular, one draft                                                                                                                                                                                                                                                                                                                                                | winter uniform notice       |
| Calendar                  | 11 holidays (Dussehra, Diwali, winter break…) and 9 almanac events (exams, PTM, sports day, annual day)                                                                                                                                                                                                                                                                                                                                                                                        | same                        |
| Gallery                   | "Independence Day 2026" with 3 images                                                                                                                                                                                                                                                                                                                                                                                                                                                          | none                        |
| Templates                 | transfer certificate, bonafide certificate and letter templates                                                                                                                                                                                                                                                                                                                                                                                                                                | same                        |
| Lifecycle                 | TC/2026-27/0001 for the student who left; a withdrawal in progress for a IX-B student (2 of 4 departments cleared); 2027-28 sections and promotion decisions for IX-A and X-A                                                                                                                                                                                                                                                                                                                  | none                        |
| Fees (Sprint 8)           | 8 fee heads, 12 periods (quarterly instalments due on the 10th), structures for every class, 3 transport slabs, 3 discounts; VI-A and VI-B have fee profiles and generated demands                                                                                                                                                                                                                                                                                                             | same masters, no demands    |
| Admissions                | cycle ADM-2027-28 (open) for classes I, VI (passcode `ALPHA-VI`) and IX with scoring masters; 11 applications in every status, one flagged possible duplicate                                                                                                                                                                                                                                                                                                                                  | one draft cycle             |
| Approvals (Sprint 9)      | the `admission_approval` workflow (Coordinator → School Admin); the applications under review sit in the coordinator's inbox, one of them already at the School Admin level                                                                                                                                                                                                                                                                                                                    | workflow only               |
| Payments                  | the selected application holds an accepted offer with a paid admission fee (mock gateway, ₹8,000); one failed online instalment attempt and one cash receipt of ₹4,500 for Aarav, allocated to his oldest dues                                                                                                                                                                                                                                                                                 | none                        |
| Attendance                | day registers for VI-A, VI-B and IV-A on the last 6 school days with absents, late marks and absent alerts; the older days are locked; VI-A's last day came through the RFID gate with in/out times                                                                                                                                                                                                                                                                                            | none                        |
| RFID                      | reader `GATE1` (key `dev_demo_gate_key_alpha`), tags `ALPHA-VIA-001…` on the VI-A students, one unknown tag in the log; settings `attendance.rfid_late_after` 08:15 and `admissions.admission_fee` 8000                                                                                                                                                                                                                                                                                        | none                        |
| Communication (Sprint 10) | templates for circulars (WhatsApp, SMS with DLT ids, email), bus alerts and query replies; the `message_approval` workflow; a sent PTM circular to Class VI with delivery states, one request awaiting the principal (PTA group), one rejected; group `pta`; the dev parent's consents (email withdrawn, transport recorded at the counter)                                                                                                                                                    | templates and workflow      |
| Transport                 | routes R1 Kothrud, R2 Baner, R3 Hadapsar with vehicles and drivers; VI-A and IV-A students on R1 with stops and pickup times, VI-B on R2                                                                                                                                                                                                                                                                                                                                                       | none                        |
| Engagement                | four family requests from the dev parent: an open academics query with an internal note, an answered fees query, an approved leave for Diya (rated 5), a transport complaint in progress; six feedback entries; one pending profile change request                                                                                                                                                                                                                                             | none                        |
| Devices                   | bus reader `BUS1` on R1 (key `dev_demo_bus_key_alpha`) with the last school day's boarding and alighting taps; biometric device `BIO1` (key `dev_demo_bio_key_alpha`) with five days of staff punches (biometric ids `BIO-E001…`)                                                                                                                                                                                                                                                              | none                        |
| Hardening (Sprint 11)     | the `lesson_plan_approval` workflow (Coordinator → Vice Principal → Principal); an approved poetry plan for VI-A English and a maths plan awaiting the coordinator; a substitution on the next school day (Anita covers Suresh's VI-A maths); Sai Sharma's attendance rule (late after 08:00, alerts muted); R1 flags boarding after 07:40, R2 sends no alighting alerts; privacy notice v1 acknowledged by the student, not yet by the parent; the first VI-B student pays in two instalments | workflow and notice only    |

## Sign in as a role

Open http://localhost:3000/login (admin), http://localhost:3001/login (parent app) or
http://localhost:3002/login (teacher app) and pick a subject in **Sign in as** (development bypass).

| Subject           | Person              | Role                                           | What to check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev-admin`       | Dev Admin           | School Admin in Alpha and Beta                 | Every screen; **Communication → Compose** and the approval inbox; **System → Privacy notice**; **Settings** now lists the admission fee, RFID late time, weekly off and alert throttle; switch school in the header; no audit export (segregation of duties)                                                                                                                                                                                                                                        |
| `dev-group`       | Gita Group Admin    | Group Admin in both                            | Same plus impersonation: Members page shows **Act as** with a reason field; banner and **End impersonation**                                                                                                                                                                                                                                                                                                                                                                                        |
| `dev-principal`   | Meena Iyer          | School Admin of Alpha, employee E001           | Employees page shows her as the reporting line of most staff; Security page lists her closed break-glass window                                                                                                                                                                                                                                                                                                                                                                                     |
| `dev-coordinator` | Rajesh Kulkarni     | Academic Coordinator                           | Students and enrolments editable; Subjects, Teacher assignments, Timetable and Bulk import are editable; **Approvals → My inbox** holds the admission requests; composes circulars; **Lesson plans** and **Substitutions**, **Student rules**; approves lesson plans at level 1; **Parent engagement → Queries** (all sections), feedback, change requests; Attendance day summary, register and lock; no access administration, no settings                                                        |
| `dev-teacher`     | Anita Deshmukh      | Class Teacher of VI-A (scoped)                 | Students list shows only VI-A (8 students); Teacher assignments and Timetable show VI-A only; teacher app **My classes** shows her week and **Attendance** marks VI-A and **Queries** answers VI-A families; **Lesson plans** (write and submit); **My classes** lists substitutions; a past delegation from the coordinator shows in history (kept in the past since Sprint 15: an active one would give her `exams.marks.unlock`, and segregation of duties would then refuse her own mark entry) |
| `dev-subject`     | Suresh Nair         | Subject Teacher VI-A and VI-B (scoped)         | Sections, students, assignments and timetables limited to VI-A and VI-B; teacher app shows Mathematics in both sections; cannot edit                                                                                                                                                                                                                                                                                                                                                                |
| `dev-auditor`     | Priya Auditor       | Auditor                                        | Read everything, Audit log with **Export** (needs MFA, satisfied by the dev bypass), no forms                                                                                                                                                                                                                                                                                                                                                                                                       |
| `dev-support`     | Sam Support         | Support Engineer in both schools               | Jobs, security page, platform views; no people data                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dev-clerk`       | Kavita Front Office | Front Office (school role created by the seed) | Admit students, link guardians, enrol, search, exports, send notifications; nothing under Access, Academics setup or System                                                                                                                                                                                                                                                                                                                                                                         |
| `dev-frontdesk`   | Farah Front Desk    | Front Desk (appointments)                      | **Appointments**: Front desk queue, Book, Calendar, Dashboard, Gate, My appointments; nothing else                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dev-gate`        | Gopal Gate          | Gate / Security                                | **Appointments → Gate** (check in on the day, print the visitor card) and the visitor log; no queue, no decisions                                                                                                                                                                                                                                                                                                                                                                                   |
| `dev-transport`   | Tarun Transport     | Transport In-charge                            | **Transport**: dashboard, requests, **Apply for a student**, **To approve** (first level of a family's request), student history, routes, vehicles, drivers, transport setup; no settings                                                                                                                                                                                                                                                                                                           |
| `dev-accounts`    | Ravi Accounts       | Accountant (employee E015)                     | Fees → masters, class fee structure, demands, **Payments** (online intents, counter receipts); answers fee queries under Parent engagement; student page fee profile and generate; no admissions, no people edits                                                                                                                                                                                                                                                                                   |
| `dev-parent`      | Suresh Sharma       | Guardian of Aarav (VI-A) and Diya (IV-A)       | Parent app: Homework (both children), Notices, Calendar, **Attendance**, **Timetable**, **Queries** (raise, reply, rate), **School bus** (taps), **Profile** (consents, change requests); first visit shows the **privacy notice** onboarding; Hindi toggle on the home page; admin app shows an empty navigation                                                                                                                                                                                   |
| `dev-student`     | Aarav Sharma        | Student                                        | Parent app as the student: own homework, notices and calendar; nothing in the admin app                                                                                                                                                                                                                                                                                                                                                                                                             |
| `dev-nobody`      | Nobody Member       | No roles                                       | Deny by default: empty navigation, every direct URL answers "permission denied"                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Sprint 12 walk-through (Phase 3 start: fee ledger, fleet, principal dashboard)

- **dev-accounts** (Accountant): open **Fees → Demands**, choose Class VI and click **Ledger** next to a
  student (or **Open ledger** on the student page). The ledger groups the demand by due date: the April and
  July instalments are overdue as of today, so the day-wise late fee (Alpha: ₹10 per day, System → Settings)
  shows per instalment; the "as of" date at the top recomputes it. VI-A roll 2 carries a **waived July late fee**
  (override with the principal's reason); revoke it or set a fixed amount for another instalment. Record a
  counter payment: the receipt gets the next number `TF/FY2026-27/…`, the row shows the advance if any, and
  **Receipt PDF** queues the document to the export centre from the default fee receipt template
  (System → Templates). **Regenerate with diff** re-runs the rules and lists added, removed and changed rows;
  paid rows are kept. Under **Fees → Fee masters** the new **Receipt numbering** card shows prefix, digits and
  next number per ledger and financial year (editable until the first receipt), and **Late fee slabs and
  visibility** sets slab dates and amounts per instalment (Beta uses slab mode: ₹100 after the due date, ₹250
  after 15 days, ₹500 after 45 days).
- **dev-admin**: switch the header year to **2025-26 · closed** and open the same ledger: last year's
  instalments are fully paid with numbered `TF/FY2025-26/…` receipts (seeded history for current VI-A, VI-B
  and VII-A students), and every write button is hidden because the year is closed. Back on 2026-27, open
  **Transport → Vehicles** and **Drivers** (the three buses with insurance, fitness and permit expiries; R2's
  fitness certificate expires soon) and a route page: the ordered **Stops** with coordinates, times and the
  slab each stop falls in, **Vehicle and crew** linking, and stop-aware student assignment.
- **dev-admin** or **dev-coordinator**: **Insights → Principal dashboard**. Attendance today by class with
  unmarked sections, the 14-day trend, fees due and collected till date, ageing buckets, collection by mode,
  the largest overdue balances (each links to the ledger), admissions funnel, message delivery, pending
  approvals and reader health, plus the alert list. Every number comes from the reporting marts (`mart.*`),
  refreshed every 15 minutes by the workers; **Refresh marts now** rebuilds them and the freshness table shows
  when each mart last ran. dev-teacher gets no Insights entry (permission `insights.dashboard.view`).
- **dev-parent** and **dev-teacher**: the home page now has a **Session** selector; choose 2025-26 to read
  last year's attendance, homework and timetable read-only (the API refuses writes on a closed year).
- Consent: the parent onboarding and **Communication → Consents** list a new purpose, **AI assistant in the
  parent app** (`ai.assistant`), off by default; the assistant itself arrives in Sprint 14.

### School setup masters walk-through (2026-09-29)

1. As `dev-admin`: **System → School**: country, state and city are drop-downs from the masters; the time zone list is the runtime's IANA zones; PIN and phone are validated. **Bank account details** lists the school's accounts (bank, account name and number, IFSC, branch, address, purpose, default) from the master with a link to manage them.
2. **Masters → System setup**: _Countries_, _States_ (with GST codes) and _Cities_ have the grid, add/edit, status, Excel export and bulk upload like every master; a wrong PIN or GST code is refused with the reason. **Masters → Fees setup → School bank accounts**: add an account (the IFSC must look like `HDFC0000123`, the account number 9 to 18 digits); _Banks_ now carry the branch address.

### Sprints 22-23 walk-through (pilot cut-over, hypercare, month-end)

1. As `dev-admin`: **System → Cut-over** shows _Rehearsal 2 (timed)_ signed off and _Pilot cut-over weekend_ running; open the running one: tick the remaining hypercare steps with a note (each tick records who, when and the duration since the previous step), **Take live snapshot**, edit a legacy count to differ and **Sign off** → refused with the measure; restore it and sign off → the run is done with the sign-off recorded. **New run** installs the 27 steps of the go-live runbook.
2. As `dev-teacher` (http://localhost:3002): **Report an issue** → "Attendance page slow", S2; the issue gets `HC/005` and a due time 24 hours out. As `dev-admin`: **System → Hypercare** shows the board with the severity counts and overdue badges; move it to _in progress_, assign `platform`, add a workaround, raise it to S1 (the due time tightens to 4 hours), then _fixed_ and _closed_. The workers send the admins a WhatsApp digest at 08:30 IST while `platform.hypercare_until` is unset or in the future.
3. As `dev-admin`: **System → Settings** → `platform.modules_enabled` → remove `library,transport`: the side menu drops both groups (the API and the compat layer keep serving them); put them back.
4. As `dev-accounts`: **Fees → Month-end close** → pick last month: the checks list receipts by ledger and mode and the blocking items; close with a fresh sign-in (second factor) → the period lock appears and the pack is queued in **Reports → Exports**. **Fees → Cashier**: a receipt dated inside the closed month is refused; **Reopen** with a reason releases the lock (audited).
5. The **book icon** in the admin header opens the help centre (training pages); the parent and teacher apps have **Help** tiles with the bilingual FAQ.
6. `node scripts/synthetic-check.mjs --base http://localhost:4000 --school 1 --token dev:dev-admin` prints the on-call check lines and exits non-zero on a failure.

### Sprint 20 walk-through (release-1 completeness)

1. As `dev-parent` (http://localhost:3001): **Profile → Your data → Open** → ask for _a copy of the data the school holds_ about Aarav; the request lists with its due date. Switch the app to हिन्दी from the home header: every screen, including attendance, homework, notices and the profile, is now in Hindi.
2. As `dev-admin`: **System → Privacy**: the request sits in the queue with the DPDP clock; **Start**, then **Complete and generate the report**: an export is queued and, once the workers render it, the family downloads _Personal data report · Aarav Sharma_ from **Profile → Your data**. Record an _erasure_ request at the office for a pupil who is still enrolled and try **Erase the person** (with a fresh sign-in): refused with the reason; withdraw the pupil first and it anonymises the person and the guardians linked only to them, keeping the ledger and results.
3. Same screen: **Record a breach** (a lost laptop with a cached defaulters export); update it as _contained_ then _notified_ with the Board and people boxes ticked; the hours to the Board notice are shown. The **Retention purge** card lists what last night's run removed per policy (settings `privacy.retention.*`).
4. As `dev-admin`: the **question mark** in the header opens the tour of the current screen (first visit opens it by itself); try it on the dashboard, **Fees → Cashier**, **Exams → Exams** and **System → Privacy**.
5. As `dev-teacher` (http://localhost:3002): the home page has the हिन्दी toggle; **Marks**, **Exam register**, **Lesson plans**, **Assistant** and **Queries** follow the language.
6. Compatibility: with the API running, the current apps' paths answer live data, e.g. `curl -H 'Authorization: Bearer dev:dev-parent' -H 'x-school-id: 1' 'http://localhost:4000/api/v1/compat/v1/student/GetFee?sadmission=A2481'` (also `GetTransport`, `GetLibraryTrasaction`, `GetReportCard`, `GetDatesheet`, `GetAlbum`, `GetGatePass`, `student_leave_list`; as `dev:dev-teacher`: `teacher/get_class_subject`, `teacher/GetUserDetail`, `teacher/GetParentQuery`). `curl 'http://localhost:4000/api/v1/compat/v1/app_version?platform=android&versioncode=0.9.0&school_id=1'` answers the update prompt without a sign-in; the matrix of all 170 legacy files is `docs/data/05-compat-parity-matrix.md`.

### Sprint 19 walk-through (engagement, reports, the last approvals, M3)

1. As `dev-parent` (http://localhost:3001): **Appointments** → pick Aarav, Class teacher and a school day, choose a free time and request, then **Request gate pass** (early leave, dentist). **Consent forms** → sign the Science City trip for Aarav (allow, pick-up by bus): the response is recorded and **Pay the fee now** opens the development gateway for ₹350; choose **Pay (success)** and the form shows _paid_. **Health** shows the morning clinic visit; **Certificates** is empty until step 4.
2. As `dev-teacher`: **Gate passes** (teacher app) or **Gate passes · to approve** (ERP) lists the gate pass for VI-A; approve it, then `dev-coordinator` and `dev-principal` approve in turn (nobody is Vice Principal, so that level is skipped). As `dev-frontdesk` (or `dev-admin`): **Gate passes · front desk → To hand over** → open the pass, take the photo (and the parent's code when someone else collects) and hand over; as `dev-gate`: **Gate passes · gate** → Let out. As `dev-admin`: **Appointments → Front desk** shows the request under Waiting; confirm it (the teacher sees it under Appointments with me). The parent app shows the confirmed slot with its gate pass, and the gate pass number `GP/2026/00001`; the family gets the pass by email (QR and PDF card).
3. As `dev-admin`: **Engagement → Visitors** shows Meera Iyer signed in; sign her out. **Front office and gate → Dashboard** shows appointments, gate passes and visitors together. **Clinic**: record a visit for any pupil with a temperature; the family message appears in **Communication → Outbox**. **CCTV requests**: raise one for Gate 2 and decide it from the inbox. **Employee queries** lists what staff raised; `dev-coordinator` answers from the inbox.
4. As `dev-admin`: **System → Templates**, create a template of kind _certificate_ (landscape) using `{{certificate.title}}`, `{{student.name}}`, `{{certificate.serialNo}}`; **Engagement → Certificates** → issue "Certificate of Merit" to VI-A: serials `CERT/2026/…`, one batch PDF in the Export centre; the parent app **Certificates** now lets Aarav's family download its own PDF.
5. As `dev-admin`: **Reports → Scheduled reports** → schedule the fee day book for Mondays 07:00 (`0 7 * * 1`) to the accountant role, then **Run now**; the export appears in the Export centre. **Reports → MIS centre** shows the dashboards mapped to your roles with live numbers; **System → MIS dashboards by role** is the master behind it (export, Excel upload).
6. As `dev-group`: **Insights → Group view** shows Alpha and Beta side by side (pupils, attendance today, fees this month and outstanding, latest exam, open approvals, overdue library loans).
7. As `dev-admin` with a fresh sign-in: **Fees → Variance workbench** → the closure card: **Close the shadow run** needs three zero runs or a reason; give a reason and confirm; the card shows who closed it and the summary. A stale sign-in (`;auth_time=…`) is sent to the step-up page.

### Sprint 18 walk-through (all bands and boards, library completion)

- **dev-admin**: **Exams → Report cards → Designer**: the four default layouts now differ per band —
  preview _primary_ (holistic progress card with descriptors), _middle_ (CCE), _secondary_ (periodic
  test / portfolio / enrichment / annual scaled to 100) and _senior_ (theory 70 / practical 30).
  **Exams → Board results**: import a CBSE file (try a CSV with `ROLL NO,NAME,SUB CODE,SUB NAME,THEORY,
PRACTICAL,TOTAL,GRADE,RESULT` or the compact `SUB1,MRK1,GRD1…`); the report lists unmatched roll
  numbers; the analysis table gives candidates, mean, highest, lowest, passed, 90+ per subject; Excel /
  PDF export. **Library → Stock and sales**: open a stock check, paste `1001, 1003, 1004`, record,
  close (optionally marking missing copies lost); sell a withdrawn copy with a receipt reference.
  **Library setup → Digital library** (masters grid) adds links for students; **Insights → Results
  analytics** shows pass % and means per exam, class and section with the weakest subjects.
- **dev-parent**: **Library** shows the digital-library links open to students under the loans.

### Sprint 17 walk-through (workflow GA, report cards, GPS, library)

- **dev-admin**: **Approvals → Definitions** now has **＋ New definition** (levels with approver, SLA
  hours and an escalation role) and **Edit** on each; open any approval from **Instances** or the
  inbox link to see its steps with due times, the **History** (started, decisions, reminders,
  escalations, reassignments, notes) and the **Cancel** / **Reassign** forms. **Exams → Report cards**:
  the **T1 · Term 1 (2026-27)** release (PT1-2026, _withhold while dues pending_ on) — pick VI-A,
  **Render the section (one PDF)** (the workers render it; PDF link appears per pupil), **Preview** any
  pupil, or open the **Designer** to edit a band's layout JSON / CSS with a live preview. **Transport →
  Live fleet** shows the first bus's last GPS fix (seeded; the vendor pushes to
  `/api/v1/transport/gps/positions` with a `transport.gps` service key). **Library → Catalogue**
  (five titles, two copies each, accession 1001–1010), **Circulation** (issue accession `1002` to
  student id 12307, renew, return with a late date to see the fine), **Fines** (collect or waive),
  **Library setup** (titles and copies as masters with Excel upload).
- **dev-parent**: **Results** lists Term 1 for Aarav with the PT1 summary and a **Report card PDF**
  button (refused with a clear message while fee dues stand); **School bus** shows the **Live bus**
  card with the last position and a map link; **Library** lists the children's loans and fines.

### Master-data framework walk-through (all masters, one grid)

- **dev-admin**: every module menu now has a "… setup" entry — **Fees → Fees setup**, **Academics →
  Academics setup**, **Transport → Transport setup**, **Exams → Exams setup**, **Communication →
  Communication setup**, **System → Campuses**. Each opens tabs of that module's masters (Fee heads,
  Month–instalment mapping, Transport slabs, Discounts, Banks; Classes, Sections, Subjects, Timetable
  periods, Holidays; Routes, Stops, Vehicles, Drivers; Exam types, Grade scales, Grade bands, Indicator
  sets, Indicators, Remark bank; Message templates, Groups, Query categories; Campuses) with the same
  toolbar: **Records per page**, **＋ Add** (generic form from the field rules), **Clone from year**
  (year-bound masters: try Month–instalment mapping 2026-27 → 2027-28), **Bulk update** (tick rows,
  pick a column, apply), **Filter**, **Excel** / **PDF** (queued to the export centre, link shown on the
  page), **Upload Excel** (download the template, upload it back: the report lists rejects by row and
  column; a clean file shows an **Import N rows** button). Every row has an edit icon and an
  activate / deactivate icon. Masters are always the working school's (RLS) and, where year-bound, the
  header's year.

### Sprint 16 walk-through (shadow run, results, AI reports)

- **dev-accounts**: **Fees → Variance workbench** opens with the seeded legacy feed (`fees_legacy.csv`, 3
  rows, 2 posted). **Reconcile now** for 25–27 September 2026 (the dates of the seeded rows) writes the run:
  one receipt matched to the rupee, one **Amount differs** (legacy shows ₹100 more) and one **Missing in new
  ledger** (`L-TF/OLD/0417`, unknown admission), plus **Missing in legacy feed** for receipts posted only
  here. **Explain** one with a sentence, **Resolve** another, **Reopen** it.
  Upload a CSV with the legacy headers (or a JSON array) to feed more rows; the cron feeds
  `POST /api/v1/shadow/feeds/ingest` with the header `x-service-key` (development key preimage
  `dev-service-key-legacy-cron`, seeded as `legacy-cron`).
- **dev-admin**: **System → Service keys** lists `legacy-cron`; **Issue a key** shows the new key once (MFA
  step-up when the session is stale); **Revoke** ends it. **Exams → PT1-2026 → Register** shows VI-A with
  totals, %, grade, rank and result (roll 5 absent in the first subject fails it); **Analysis** shows pass
  rate, means, grade distribution, sections and toppers; **Compute results** recomputes after new marks.
  **Promotion**: proposals under the pass rule (33 %, no subject below pass) with the reason; tick pupils,
  pick the next year and section and **Record decisions** — they land in **People → Promotions** for that
  year. **Insights → AI reports**: **Generate** the principal's brief for a week; the narrative cites facts
  by id (development template offline; Claude with `ANTHROPIC_API_KEY`); the PDF appears once the workers
  render it. **Insights → Assistant costs**: spend by day, app, user and model, refusal rate, budgets.
- **dev-parent**: **Fees** receipts show **Cleared** with the date when the bank statement matched them.

### Sprint 15 walk-through (exam entry, fee reports centre, assistant everywhere)

- **dev-subject** (Suresh Nair, Mathematics in VI-A and VI-B, teacher app `:3002`): **Marks** opens PT1-2026 ·
  VI-A · Mathematics with the seeded sheet (roll 5 absent); change a mark and save — the sheet goes through
  `app.enter_marks` (maximum 40, lock, enrolment). **Assistant**: "Who was absent today?", "meri class ki hazri
  batao" or "marks entered" answer only for VI-A and VI-B.
- **dev-teacher** (Anita Deshmukh, class teacher VI-A): **Marks** shows every subject of VI-A; **Exam register**
  holds the remarks (with the remark bank as suggestions), exam attendance days and height / weight / blood group
  of each pupil; a subject teacher sees no health columns.
- **dev-coordinator**: **Exams → PT1-2026 → lock** a subject and the teacher's sheet turns read-only; only the
  coordinator or an administrator (`exams.marks.unlock`) can reopen it.
- **dev-accounts**: **Fees → Reports centre**: the **Day book** for any range with totals by mode and ledger and
  receipt ranges (reversed receipts never appear, bounced ones show with their status); the **Head-wise tally**
  for a month (days × heads, late fee and misc columns); **Defaulters** as of a date with class and minimum
  balance filters, tick and **Send reminder** (`fee_due` template, once a day per pupil, last reminder shown);
  **Forecast** per class and due month; **Tally export** previews the vouchers and queues the XML (download from
  Reports → Export centre). **Fees → Bank statements**: upload a CSV (date, narration, reference, debit, credit)
  — credits match cheque, DD, NEFT and UPI receipts, returned cheques are flagged for a bounce adjustment.
- **dev-parent** (parent app `:3001`): **Assistant** asks for the _AI assistant_ consent first (Profile → Your
  consents); then "kitni fees baki hai" (Aarav is paid to October, so nothing is due within 30 days), "Was my child
  absent this week?" or "इस हफ्ते का गृहकार्य" answer only for the two children, in the language of the question
  (Hinglish is detected).
- **dev-admin**: **Insights → Alerts** lists the nightly anomalies (attendance drop per section, collection dip,
  silent RFID reader) with acknowledge; the workers job `insights.alerts` also sends them by WhatsApp to the
  roles in the setting `insights.alert_roles`.

### Sprint 14 walk-through (adjustments, hostel, misc, exams, assistant)

- **dev-accounts** (Accountant): VI-A roll 4 is now a **hosteller**: the ledger shows hostel instalments
  (₹9,000 a quarter) beside the school ones, with the hostel April instalment paid by NEFT (`HF/FY2026-27/…`);
  the cashier's **Ledger** select posts hostel receipts that settle hostel rows only. On any ledger the desk
  can **request a waiver** of a demand row, a **reversal** or a **cheque bounce** of a receipt (the bounce
  charge, ₹500 by default, comes from System → Settings); requests wait under **Fees → Adjustments**, where
  VI-A roll 5 already has a ₹1,000 waiver waiting. On the student page the desk can **request a category /
  discount / hostel change** (approved in the inbox because the default `fee_profile_change` workflow is
  installed there, or directly under Adjustments otherwise). **Fees → Misc receipts** lists the ID card and
  the book-stall vendor receipts (`MF/FY2026-27/…`) and posts new ones for students, employees, vendors or
  others; the **Reconciliation** card runs the online-vs-settlement check now (the workers run it nightly).
- **dev-admin**: approve the waiver under **Fees → Adjustments** — approval needs a recent MFA sign-in
  (development identities count as fresh; a stale session is sent to step-up). **Exams → Types and grade
  scales** shows PT1 and Half Yearly with the CBSE eight-point scale; **Exams → Exams of the session** opens
  **PT1-2026** for Classes VI and VII with three subjects (max 40, pass 13); Class VII's first subject is
  locked. **Insights → Assistant**: ask "Class VI fee defaulters above 5,000", "attendance today by class",
  "collection by mode in the last 30 days" or "कक्षा VI के बकायादार"; every answer names the catalogue query
  it used with the row count, and **Assistant audit** shows prompts, refusals, tool calls and cost. The
  development mock answers offline; set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY` for the real model.
- **dev-coordinator**: the assistant answers academics and attendance questions and refuses fee questions it
  is not allowed to run ("vendor receipts" → refused, nearest queries listed).
- **dev-parent**: **Fees** now offers **PDF** beside each receipt; the link appears once the workers have
  rendered it (own exports only).

### Sprint 13 walk-through (collect and pay)

- **dev-accounts** (Accountant): **Fees → Cashier**. Pick VI-A and a student: the card shows balance, the late
  fee still to collect and the payable amount; the receipt form is prefilled with it. Post a cash receipt: the
  banner shows the number `TF/FY2026-27/…`, the late fee collected and any advance, with **Print receipt**
  queuing the PDF (the receipt now lists a **Late fee** line per instalment). Post less than an instalment
  and the late fee waits; post the rest and it is collected. VI-A roll 3 already carries a seeded late July
  receipt (cash, 20 July) and a **refund request** of ₹500 (bank) waiting under **Fees → Refunds**. **Fees →
  Gateway settlements**: upload `docs/data/sample-settlement-razorpay.csv` (or paste CSV) to see matched,
  unmatched and mismatched lines. The ledger page gained **Open cashier**, the late fee collected and
  outstanding cards, receipt status (posted, partly refunded, settled) and a refund request form.
- **dev-admin**: approve the refund under **Fees → Refunds** (enter a payout reference); the ledger of VI-A
  roll 3 shows the receipt partly refunded and the demand reopened by ₹500. **Transport → Bus requests**: the
  dev parent's request to move Diya to R2 waits for a decision (no workflow installed by default; install the
  defaults under Approvals → Workflows and new requests go to the inbox instead). **Transport → Vehicles →
  Log**: a week of odometer, fuel and trips per bus, with one puncture incident on the second bus.
  **Insights → Department dashboards**: all seven open for the admin; the accountant sees Fees only, the
  coordinator Academics and Attendance. Each has a **Report centre** that queues CSV or Excel exports of the
  department's datasets to the export centre. **System → Settings → payments.gateway** picks the gateway
  (`mock` here; `razorpay`, `ccavenue`, `payu` need credentials in the environment).
- **dev-parent**: the **Fees** tile now opens dues and receipts per child with **Pay online**; with the mock
  gateway a development page offers "Pay (success)" and "Fail the payment", and the fees page shows the
  result and the new receipt. **School bus** shows the current bus per child, a request form (seat, stop or
  route change, leave) and the status of earlier requests.

### Switching the academic year (added after the Phase 2 review)

Every request carries the working year (`X-Academic-Year-Id`); when the header is absent the API uses the
school's active year. The admin header now shows a **Year** select next to the school name for every signed-in
member (the list comes from `/me`, so it needs no extra permission): pick `2025-26 · closed` and press
**Switch** to browse last year's students, enrolments, attendance, fees and reports read-only; the header
says "viewing closed year" and the dashboard tile shows the year code. Planned years cannot be selected
(the API refuses them until they are activated from System → Years). Switching school resets the year to
that school's active year. The teacher and parent apps always show the active year; a history selector for
them is on the Sprint 12 list.

### Sprint 11 walk-through

1. As `dev-parent`: sign in to the parent app. The **privacy notice** appears first (version 1, English or Hindi); set the consents and continue. It does not appear again until `dev-admin` publishes a new version under **System → Privacy notice**. Switch to हिन्दी on the home page.
2. As `dev-teacher` in the teacher app: **Lesson plans → New plan** for VI-A English next week, fill Monday to Friday, **Submit for approval**. **My classes** lists the substitution where Anita covers Suresh's maths period.
3. As `dev-coordinator`: **Approvals → My inbox** shows the seeded maths plan and the new one at level 1; approve. As `dev-admin` (Vice Principal designation is on E002; `dev-admin` also holds the School Admin role) approve level 2, then level 3 as `dev-principal`. The teacher sees _approved_; reject one to see it return for changes.
4. As `dev-coordinator`: **Academics → Substitutions**, pick tomorrow, section VI-B and a period: the free teachers appear lightest-load first; assign one; assigning the same teacher to another section in that period is refused.
5. As `dev-coordinator`: **Attendance → Student rules**: Sai Sharma is muted with an 08:00 late time. Post a gate tap for `ALPHA-VIA-005` at 08:30 on a weekday: the outcome is `marked_late` where the school default (09:00) would have said present. **Transport → Routes → R1** shows the alert rules (late boarding after 07:40).
6. Alert throttling: post the same bus tap for `ALPHA-VIA-001` seven times a few seconds apart; after six alerts in the hour the outcome carries `throttled: 1` and no further WhatsApp rows are queued. Change the limit under **System → Settings → comms.alert_throttle_per_hour**.
7. As `dev-accounts`: open the first VI-B student → fee profile shows **Instalments for this student = 2**; the demand rows carry two due dates. Set another student to 4 and **Regenerate demand**.
8. Compatibility: the legacy teacher app's calls work against the new API with the same rules:

   ```bash
   curl -s -X POST http://localhost:4000/api/v1/compat/v1/teacher/UploadDailywork -H 'content-type: application/json' -H 'Authorization: Bearer dev:dev-teacher' -H 'X-School-Id: 1' -d '{"SubmitType":"homework","cboClass":"VI-A","cboSubject":"ENG","txtDate":"'"$(date +%d/%m/%Y)"'","homework":"Read chapter 4","EmpId":"E006"}'
   ```

9. Offline: build and install the parent PWA (`pnpm --filter @edupro/parent build && pnpm --filter @edupro/parent start`), open it, switch the network off and reload: the last pages or the offline page appear.
10. The UAT script for the pilot is `docs/quality/uat-phase-2.md`; the pentest report is `docs/security/phase-2-pentest.md`; the M2 gate report is `docs/sprints/m2-gate-report.md`.

### Sprint 10 walk-through

1. As `dev-coordinator`: **Communication → Compose**. Title "Diwali holidays", template _Circular (WhatsApp)_, audience _Sections_ → VI-A, VI-B, write the message and **Preview recipients**: the count shows who is skipped and why (no mobile, consent withdrawn, duplicates). **Send for approval**.
2. As `dev-principal` (or `dev-admin`): **Approvals → My inbox** shows "Diwali holidays · whatsapp · N recipients" and the seeded "Sports day volunteers" request. Approve one, reject the other with a note. **Communication → Message requests** shows _sent_ with delivery counts (queued until the worker runs; the demo circular already shows delivered/sent/failed) and the rejected one with the note. Open a request to see every recipient's state.
3. Delivery receipts: post one for a seeded message id (`WA-DEMO-0`) with the dev token; the request's counts move.

   ```bash
   curl -s -X POST http://localhost:4000/api/v1/comms/delivery/webhook -H 'content-type: application/json' -H 'x-webhook-token: dev-comms-webhook-token' -d '{"provider":"whatsapp-http","messageId":"WA-DEMO-0","status":"delivered"}'
   ```

4. As `dev-parent`: parent app **Profile**: children with class teacher, bus route and stop; **Your consents** with Allow/Withdraw per purpose (email is withdrawn in the demo); **Request a change** to your mobile number. **Queries**: the four seeded requests; open the answered fees query and rate it; **New request** → Leave request with dates. **Timetable** shows the child's week. **School bus** shows the last school day's boarding and alighting.
5. As `dev-teacher` in the teacher app: **Queries** lists VI-A families' requests; reply to the maths homework query (the family gets a WhatsApp update) or close a leave request with a decision.
6. As `dev-accounts`: **Parent engagement → Queries** filtered by _Fees and payments_: the receipt query, answered.
7. As `dev-admin`: **Parent engagement → Profile change requests**: approve the mobile number change; the guardian record updates with an audit row. **Feedback** shows averages per area. **Communication → Consent**: pick Suresh Sharma to see his purposes and history; record a signed form. **Communication → Groups**: add a member to `pta`.
8. Transport and devices: **Transport → Routes** → R1 → add a student from a section with a stop and pickup time. **Attendance → Bus attendance** for the last school day; **RFID dashboard** shows reader health (GATE1, BUS1, BIO1), gate and bus counts and tagged students not yet in; **Staff punches** shows first in, last out and hours for each employee. Post a bus tap or a punch:

   ```bash
   curl -s -X POST http://localhost:4000/api/v1/attendance/rfid/events -H 'content-type: application/json' -H 'x-device-key: dev_demo_bus_key_alpha' -d "{\"school\":\"ALPHA\",\"device\":\"BUS1\",\"events\":[{\"tag\":\"ALPHA-VIA-001\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"direction\":\"in\",\"lat\":18.5074,\"lng\":73.8077}]}"
   curl -s -X POST http://localhost:4000/api/v1/attendance/punch/events -H 'content-type: application/json' -H 'x-device-key: dev_demo_bio_key_alpha' -d "{\"school\":\"ALPHA\",\"device\":\"BIO1\",\"events\":[{\"id\":\"BIO-E006\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}"
   ```

   The bus tap answers `boarded` (and the guardian gets a WhatsApp alert unless transport consent is withdrawn); the punch answers `recorded`.

### Sprint 9 walk-through

1. As `dev-admin`: **Admissions → Cycles → ADM-2027-28**. In **Decisions**, shortlist Class I by minimum score, run the **Draw of lots** with a seed (repeat it: the same seed picks the same children), then **Send shortlisted for approval**. **Approvals → Requests** lists the new requests at level 1.
2. As `dev-coordinator`: **Approvals → My inbox** shows the requests; approve one with a note and reject another. The approved one moves to level 2.
3. As `dev-admin` (or `dev-principal`): **My inbox** now holds the level-2 step; approve it. The application becomes _selected_ with an offer and a fee intent (₹8,000 from the setting `admissions.admission_fee`).
4. Public app http://localhost:3003/alpha/status: sign in with the selected applicant's mobile `9811000004` (Sunil Patil; any applicant's mobile is shown on their application page; the development OTP code appears on screen). The card shows **Admission offer · Fee pending** and **Pay admission fee**; the development gateway settles it and the badge turns to **Fee paid**.
5. As `dev-admin`: open the application → **Admit** (roll number optional; the section with the most free seats in 2027-28 is chosen). The admission number `A0001…` appears, the student exists with the guardian linked and a 2027-28 enrolment; the application shows _admitted_ with a link to the student. Admitting without payment answers "fee pending" unless the check is waived.
6. As `dev-accounts`: **Fees → Payments** lists the online intents (succeeded and failed). Pick VI-A, choose Aarav and **Record payment** ₹1,000 cash: the student page's demands show the amount allocated to the oldest due.
7. As `dev-teacher` in the teacher app (http://localhost:3002): **Attendance** → VI-A → the last school day → mark two students absent → save. The absent guardians get a WhatsApp alert (**Communication → Delivery log** in the admin app); saving again does not alert twice. A Sunday or a holiday is refused.
8. As `dev-coordinator`: **Attendance → Day summary** shows every section for the date, marked or not; open a register, correct a mark, then **Lock register**: the teacher app refuses further edits.
9. As `dev-parent`: parent app **Attendance** shows Aarav and Diya for the month with present/absent badges and Aarav's gate in/out times on the RFID day.
10. RFID: as `dev-admin`, **Attendance → RFID readers** shows `GATE1` and the tap log. Post a tap for a VI-A tag with the demo key:

    ```bash
    curl -s -X POST http://localhost:4000/api/v1/attendance/rfid/events -H 'content-type: application/json' -H 'x-device-key: dev_demo_gate_key_alpha' -d "{\"school\":\"ALPHA\",\"device\":\"GATE1\",\"events\":[{\"tag\":\"ALPHA-VIA-001\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"direction\":\"in\"}]}"
    ```

    The outcome is `marked_present` or `marked_late` (after 08:15 IST), `duplicate` on a repeat within a minute, `holiday` on a Sunday, `manual_kept` when the teacher already marked the student.

### Sprint 8 walk-through

1. Public app http://localhost:3003: choose Alpha Public School → **Apply** for Class I → enter any name and mobile `9999900002` → the code is shown on screen as the development code → fill the form (a date of birth between 1 Apr 2020 and 31 Mar 2021) → submit → the application number appears; **My applications** shows its status. Try Class VI without the passcode to see the refusal. The demo applicant `9999900001` already has an application.
2. As `dev-admin`: **Admissions → Applications**, open the new application, award **Interaction** and recompute the score, move it to shortlisted; **Dashboard** shows seats against applications and the possible duplicate.
3. As `dev-accounts`: **Fees → Demands**, choose Class VI and see the per-student totals; open a student and change the transport slab, then **Regenerate demand**; **Class fee structure** shows the amounts per head.
4. As `dev-coordinator`: reviews applications but cannot touch fee masters; `dev-clerk` sees neither.

### Sprint 7 walk-through

1. As `dev-teacher` in the teacher app: **Daily work** → post homework for VI-A with a PDF; it appears at once in the admin **Academics → Daily work** list and in the parent app.
2. As `dev-parent` (http://localhost:3001): **Homework** shows Aarav (VI-A) and Diya (IV-A) with a child switch; **Notices** shows the reopening notice, the fee instalment, the PTM and the VI-A project note but not the staff circular; **Calendar** lists holidays and events.
3. As `dev-admin`: **Academics → Notices**, create a circular for staff and publish it; only the teacher app shows it. **Holidays and almanac**: add a holiday inside the Diwali break and see it refused.
4. As `dev-admin`: **System → Document templates**, open the bonafide certificate, edit the wording and watch the preview; on a student page choose the template and **Generate PDF**; download it from the Export centre.
5. As `dev-clerk`: **People → Withdrawals**, open the IX-B request, clear transport and academics, then **Complete withdrawal**; the student becomes inactive with the reason in Status history. On another active student, **Issue transfer certificate**: TC/2026-27/0002 appears under **People → Transfer certificates** with its PDF.
6. As `dev-coordinator`: **People → Promotion**, class IX to 2027-28: adjust decisions, **Save**, then **Apply pending decisions**; the students gain a 2027-28 enrolment.

### Sprint 6 walk-through

1. As `dev-admin`: **Academics → Teacher assignments**, assign any teacher as Subject teacher of VII-A; open **Access → Assignments** and see the role and the VII-A scope that appeared for them (if the employee has a login). End the assignment: the role is revoked.
2. As `dev-admin`: **Academics → Timetable**, pick VI-B and set a slot on a day and period where Suresh Nair already teaches VI-A: the save is refused with "already taking another section".
3. As `dev-teacher` in the teacher app (http://localhost:3002): **My classes** shows VI-A and the week; in the admin app the Timetable page only offers VI-A.
4. As `dev-clerk`: **People → Bulk import**, download the students template, add a few rows (use `VI-A` in the `section` column) and validate; the report lists problems per row; commit only when clean. Then open a student and read **Status history**.

Add `;auth_time=<unix seconds>` to a subject (for example `dev-admin;auth_time=1700000000`) in an API
`Authorization: Bearer dev:...` header to simulate a stale multi-factor sign-in; the API then answers
`mfa-required` on privileged actions and the admin app shows the step-up page.

## Resetting

```bash
scripts/local-stack.sh start
pnpm db:migrate
pnpm --filter @edupro/db seed:dev
pnpm --filter @edupro/db seed:demo
```

To start from an empty database, drop and recreate it (see `docs/sprint-0-checklist.md`), then run the
three commands above.

### Transport request (transport v2)

1. As `dev-parent` (parent app): **School bus → Apply for transport / Change or stop** → child, service (pick and drop, pick only, drop only), route, stoppage (slab and monthly charge show), months → Send request.
2. As `dev-transport`: **Transport → To approve** → approve (first level). As `dev-accounts`: **Transport → To approve** → approve: the transport period is written, the fees of those months change (Fees → Demands → Ledger) and the parent app shows the new mapping and the history.
3. As `dev-transport`: **Transport → Apply for a student** → search, fill the same form: it waits with the fee department only. **Transport → Student history** shows every period; **Transport dashboard** the analytics. As `dev-admin`: **Transport → Transport settings** for the charge rule and the approval levels.
