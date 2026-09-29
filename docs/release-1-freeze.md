# Release 1 feature freeze

|       |                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| Date  | 2026-09-29 (end of Sprint 20)                                                                                                     |
| Tag   | `release-1-freeze` on `main`                                                                                                      |
| Until | M4 (VAPT passed, end of Sprint 21) and then the pilot go-live (`docs/runbooks/go-live.md`)                                        |
| Rule  | Only defect fixes, VAPT remediation, translations and documentation land on `main`; anything else waits on a `release-2/*` branch |

## 1. What is in Release 1

| Area              | Delivered in                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform          | Tenancy with forced RLS, year dimension, RBAC with scopes and SoD, audit, jobs and outbox, exports and templates, settings, service keys, break-glass, MFA step-up (S0-S5, S16)                                           |
| People            | Students, guardians, employees, documents, bulk import, TC, withdrawals, promotion, master-data framework (S2-S7, S16)                                                                                                    |
| Admissions        | Public app with OTP, cycles and forms, scoring, shortlist and draw, approvals, offers, fee, admission → enrolment (S8-S9)                                                                                                 |
| Academics         | Classes, subjects, assignments with auto-scopes, timetable and substitutions, daily work, notices, calendar, gallery, lesson plans (S6-S7, S11)                                                                           |
| Attendance        | Sessions and marks, rules, RFID/bus/biometric devices, alerts with throttling, dashboards (S9-S11)                                                                                                                        |
| Communication     | Templates, approved requests, consent enforcement, delivery receipts, outbox, DPDP notices and onboarding (S10-S11)                                                                                                       |
| Fees and payments | Masters, demand, cashier, receipts, adjustments, hostel and misc ledgers, online payments (PayU, Razorpay, CCAvenue), settlements, refunds, bank reconciliation, reports and Tally, shadow run and closure (S12-S16, S19) |
| Exams             | Types and scales, exams, entry with locks, indicators, remarks, register, results, report cards for all bands, board results, analytics (S14-S18)                                                                         |
| Workflow          | Engine v1 with SLAs, escalation, delegation, comments and history; nine default flows (S9, S17, S19)                                                                                                                      |
| Transport         | Routes, stops, slabs, vehicles and drivers, requests on the workflow, GPS positions and live bus (S12-S13, S17)                                                                                                           |
| Library           | Catalogue, circulation with rules and fines, sale, digital items, stock verification (S17-S18)                                                                                                                            |
| Engagement        | Queries and feedback, profile changes, appointments, visitors, gate passes, consent forms with payment, certificates, clinic, CCTV, employee queries (S10, S19)                                                           |
| Reports and MIS   | Datasets and documents, Excel/CSV/PDF/XML, scheduled reports, MIS centre by role, group view (S3, S15, S19)                                                                                                               |
| Insights and AI   | Department dashboards, assistant with catalogue and consent, alerts, narrative reports, results analytics (S12-S18)                                                                                                       |
| Compatibility     | Handshake and 38 legacy endpoints for the current apps with contract tests (S4, S5, S11, S20)                                                                                                                             |
| DPDP tooling      | Data-principal requests, erasure routine, retention purge, breach log and runbook (S20)                                                                                                                                   |
| Apps              | Admin (57 screens under axe), parent and teacher PWAs with Hindi, public admissions                                                                                                                                       |

## 2. Deferred to Release 2 (from `SCHOOL_ERP_SPRINT_PLAN.md`)

HR and payroll (S24-S26), procurement and inventory (S27), Insights GA and the reporting store
(S27-S29), staff leave (stubbed in the compat API until HR), hostel operations beyond the ledger,
alumni, and the items listed under "carried forward" in each sprint record.

## 3. Change control until M4

1. Every change references a defect, a VAPT finding or a translation/documentation item.
2. Migrations remain additive; a data fix ships as a migration with its own test.
3. The full regression (`pnpm -r test`, the API e2e suite, a11y, visual snapshots) must be green on
   the commit; the sprint record lists the totals.
4. Anything that changes an API shape used by the apps updates the compat contract file and the
   OpenAPI document in the same commit.

## 4. Known gaps at the freeze

- Real provider accounts (SMS, WhatsApp, email, payment gateway live mode) are not connected in this
  environment; adapters are covered by tests and the mock gateway.
- The DR drill script needs `pg_dump`/`pg_restore` 16 on the machine; the local Zonky bundle does not
  ship them, so the last measured drill remains the Sprint 5 one; staging runs the script nightly.
- ETL against the real legacy dump waits for the dump (rehearsal 2 dry run stands in).
- The teacher app's Phase 2 screens (attendance, daily work, timetable) are still English only; the
  Phase 3 and 4 screens and the whole parent app are bilingual.
