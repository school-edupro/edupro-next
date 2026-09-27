# AI layer: role-aware assistant and analytical dashboards

Status: design accepted for planning on 2026-09-27; delivery scheduled in the sprint plan (AI track, Sprints 12
to 19, then 27 to 29). This note fixes the architecture and the rules so that every AI feature is built the
same way: on top of the ERP's permissions, tenancy and audit, never beside them.

## 1. What the layer provides

| Capability                        | For whom                                 | Examples                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principal dashboard               | Principal, Vice Principal, Group Admin   | Today: attendance %, absentees by class, fee collected vs due, admissions funnel, pending approvals, alerts (attendance drop, collection dip, reader offline)                                                                                                                                                                                                                                |
| Department dashboards and reports | Each department head and its staff       | Academics (homework coverage, lesson plan approval lag, timetable substitutions), Attendance (trends, chronic absentees, RFID health), Fees (dues ageing, collection by mode, defaulters), Admissions (funnel, seat fill, source), Transport (route load, late boarding), Communication (delivery rates, consent coverage, query response time), HR (punches, leave), Exams (from Sprint 15) |
| AI assistant (chat)               | Every role, scoped                       | Principal: "which classes fell below 85% attendance this month?"; Accountant: "defaulters of Class VI above 10,000"; Teacher: "who was absent in VI-A this week?"; Parent: "what is due this quarter and when is the PTM?" (own children only)                                                                                                                                               |
| AI reports                        | Principal, department heads, Group Admin | Weekly narrative per department with the numbers that changed and why; monthly board pack for the group                                                                                                                                                                                                                                                                                      |
| Anomaly alerts                    | Department heads                         | Attendance drop in a section, fee collection below forecast, a reader silent, a class with no homework for a week                                                                                                                                                                                                                                                                            |

## 2. Architecture

```
apps/admin, apps/teacher, apps/parent            chat panel and dashboard pages (role-aware navigation)
        │
apps/api  ── modules/insights ────────────────── query catalogue, dashboards API, chat orchestration, audit
        │            │
        │            ├── packages/insights-marts   reporting schema (`mart.*`): materialised views per department,
        │            │                             refreshed by apps/workers jobs; every view carries school_id and
        │            │                             is read through RLS like any table
        │            ├── packages/ai               provider abstraction (Claude API by default, pluggable), prompt
        │            │                             templates, tool definitions, redaction, cost meter, eval harness
        │            └── tools = existing ERP endpoints called with the caller's own token and permissions
        │
PostgreSQL (marts under RLS)  ·  Redis (rate limits, caches)  ·  object storage (report PDFs via the export service)
```

Principles:

1. **Permissions first.** The assistant never has its own access. Every answer is produced by tools that call the ERP with the signed-in user's token, so RBAC, class-section scopes and family scoping apply exactly as in the screens. A parent asking about another child gets the same 404 the app gives.
2. **Approved query catalogue, not free SQL.** Questions map to catalogued, parameterised queries over the marts (`insights.query` permission). The model chooses a catalogue entry and its parameters; it never writes SQL. Unknown questions get "I can't answer that from school data" plus the nearest catalogue entries.
3. **Numbers come from the database, words from the model.** Dashboards and report tables are computed by SQL; the model narrates and explains, and every figure in a narration is linked to the query that produced it (citation), so a principal can click through.
4. **Tenancy and DPDP.** Prompts carry the minimum data (aggregates and ids, names only when the caller may see them); children's personal data is not used for model training; the provider is configured per deployment (Claude API, or an on-premise model for schools that require data residency); prompts, tool calls and answers are audited like any action, with PII masked in logs. Consent purpose `ai.assistant` is added for families; staff use is covered by employment.
5. **Bilingual.** English, Hindi and Hinglish in and out, using the same catalogue.
6. **Cost and abuse controls.** Per-user daily budget, per-school monthly budget with alerts, cached answers for repeated dashboard questions, rate limits, prompt-injection defences (tool results treated as data, no instructions from documents), and a red-team suite that runs in CI.

## 3. Role and department matrix (first release)

| Role                              | Dashboard                                 | Assistant scope                                                                                                           |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Principal / Vice Principal        | Principal dashboard, every department     | Whole school, all catalogue entries                                                                                       |
| Group Admin                       | Group dashboard across schools            | Cross-school aggregates, per-school drill-down                                                                            |
| Academic Coordinator              | Academics, Attendance                     | Academics and attendance entries for the sections in scope                                                                |
| Class / Subject Teacher           | My sections                               | Own sections only: attendance, homework, lesson plans, substitutions, family queries                                      |
| Accountant                        | Fees                                      | Fees and payments entries; no academic data                                                                               |
| Admissions officer / Front Office | Admissions                                | Admissions funnel and applications                                                                                        |
| Transport in-charge               | Transport                                 | Routes, boarding, late boarding, reader health                                                                            |
| HR                                | HR (punches, leave, payroll from Phase 6) | Staff attendance and leave                                                                                                |
| Parent / Student                  | none (app tiles)                          | Own children: attendance, homework, fees due, notices, bus, queries; FAQ from the school's published notices and policies |

## 4. Data marts (department views)

`mart.attendance_daily`, `mart.attendance_student_month`, `mart.fee_dues_ageing`, `mart.fee_collection_daily`,
`mart.admissions_funnel`, `mart.homework_coverage`, `mart.lesson_plan_status`, `mart.substitutions`,
`mart.transport_boarding`, `mart.reader_health`, `mart.comms_delivery`, `mart.query_response_time`,
`mart.punch_summary`. Each is a materialised view with `school_id`, refreshed by a worker job (every 15 minutes
for operational views, nightly for history), under the same forced RLS as base tables. Report cards and exam
marts join in Sprint 17.

## 5. Delivery in the sprint plan

| Sprint  | AI track deliverable                                                                                                                                                                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S12     | Marts v1 (attendance, fees, admissions, communication); principal dashboard v1 with real numbers; `packages/ai` provider abstraction with redaction, budget meter and audit; consent purpose `ai.assistant`; year selector in every app so dashboards and the assistant answer for any academic year |
| S13     | Department dashboards (academics, attendance, fees, admissions, transport, communication, HR); dashboards data API; report centre pages per department                                                                                                                                               |
| S14     | Query catalogue v1 (30 entries) and assistant v0 for staff roles in the admin app: intent → catalogue → tool call → narrated answer with citations; English and Hindi                                                                                                                                |
| S15     | Assistant for teachers (teacher app) and parents (parent app, own children, consent-gated); Hinglish; anomaly alerts v1 (attendance, fees, readers) into the notification service                                                                                                                    |
| S16     | AI reports v1: weekly department narratives and the principal's Monday brief as scheduled export jobs (PDF, WhatsApp summary); red-team suite; cost dashboard                                                                                                                                        |
| S17–S19 | Exam and report-card marts, results analytics for the principal; group dashboards for Group Admin; M3 includes the AI evaluation report                                                                                                                                                              |
| S27–S29 | Insights GA (the plan's existing "insights" items): full catalogue, group reporting store, on-premise model option                                                                                                                                                                                   |

## 6. Acceptance

- Every assistant answer is reproducible from the cited catalogue query; the evaluation set (200 questions across roles and languages) scores ≥ 95% correct-or-declined, 0 permission leaks.
- Dashboards match the module screens to the rupee and the student.
- Prompts and answers are in the audit log with PII masked; budgets enforced; red-team suite green in CI.
