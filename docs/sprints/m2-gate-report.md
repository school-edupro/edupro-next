# M2 gate report: daily operations

|                |                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-09-27                                                                                                                                                                                                                                                |
| Scope          | Phase 2, Sprints 6 to 11 (`SCHOOL_ERP_SPRINT_PLAN.md`)                                                                                                                                                                                                    |
| Recommendation | Pass with conditions: every Phase 2 module is built, tested and verified locally with demo data for each role; the internal pentest is clean. The conditions concern the pilot's environment and inputs, which were not available to the engineering team |

## 1. What M2 was to deliver

"Pilot school runs admissions, academics, attendance and communication on the new platform; internal pentest clean."

## 2. Evidence

| Area                         | Evidence                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academics setup and daily    | Sprints 6 and 7: subjects, assignments with auto-scopes, timetable with conflicts, daily work, notices, calendar, gallery, templates, TC, withdrawal, promotion; `academics`, `daily-academics` e2e |
| Admissions                   | Sprints 8 and 9: public app (OTP, proof of work), cycles and forms, scoring, shortlist, draw, approvals, offers, fee, admission → enrolment; `admissions`, `admission-to-enrolment` e2e             |
| Fees start and payments      | Sprints 8 and 9: demand generation reproducing legacy cases, payments v0 with signed idempotent webhooks, offline receipts; Sprint 11 instalment variant; `fees`, `admission-to-enrolment` e2e      |
| Attendance and devices       | Sprints 9 to 11: sessions, marks, alerts, locks, RFID gates, bus readers, biometric punches, dashboards, per-student and per-route rules, throttling; `attendance`, `devices`, `hardening` e2e      |
| Communication and engagement | Sprint 10: approved message requests with consent, delivery receipts, groups, queries, feedback, change requests; Sprint 11 DPDP onboarding; `communication`, `engagement`, `hardening` e2e         |
| Workflow                     | Sprint 9 engine; used by admissions (2 levels), messages (1), lesson plans (3)                                                                                                                      |
| Compatibility                | Sprint 11 write parity for the current teacher app: homework, attendance, notices; `compat-writes` e2e                                                                                              |
| Front ends                   | Admin (Hindi parity checked by key), teacher and parent apps with offline shell and a Hindi toggle on the parent app; axe accessibility 20/20 on admin Phase 2 screens                              |
| Security                     | `docs/security/phase-2-pentest.md`: automated attack cases pass; no open high or medium findings                                                                                                    |
| Performance                  | `performance.e2e-spec.ts` on a 20-section school: hot reads under 1.2 s p95 on a laptop; indexes added in migration 0021                                                                            |
| Data migration               | Transforms for people, fees, attendance and engagement with unit tests; rehearsal 2 dry run on a synthetic extract (`docs/data/etl-rehearsal-2.md`)                                                 |
| Test totals                  | see `docs/sprints/sprint-11.md` section 5                                                                                                                                                           |

## 3. Conditions to close M2

| Condition                                                                                    | Owner                                                     | Why it is open                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| Run `docs/quality/uat-phase-2.md` with the pilot's super-users and record the results        | Pilot school with the delivery team                       | No pilot users have used the local build yet  |
| Point the current teacher app at the compat write endpoints and complete one day of live use | Mobile app team                                           | Needs a staging URL and an app build          |
| Deliver the production dumps and run rehearsal 2 for real                                    | Client DBA (S0-08)                                        | Dumps still not shared; the dry run stands in |
| Connect an SMS/WhatsApp provider and map its delivery receipts to the webhook shape          | Platform engineering with the vendor                      | No provider account                           |
| Apply the staging environment and run the deploy workflow (carried from M1)                  | Platform engineering with the client's Azure subscription | No subscription                               |

## 4. Carried into Sprint 12

Fee ledger foundation (receipt numbering, late fee, ledger view), transport module proper (stops, geo, vehicles), key rotation for device and webhook secrets, consent wording versions surfaced to parents, message retention schedule.
