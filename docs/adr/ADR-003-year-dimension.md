# ADR-003: Academic and financial years as dimensions, not row copies

- Status: Accepted, 2026-09-26

## Context

The legacy system stamps `FinancialYear` on every table and copies master rows (students, employees, fee structures, menus) into each new year with new primary keys. Identity across years depends on natural keys, and `srno` is unstable. Rollover is a 544-table copy script.

## Decision

1. Two dimension tables per school: `academic_years` (session, for example 2026-27, April to March) and `financial_years` (fee accounting and statutory periods). They usually coincide in India; the model keeps both so schools with a different session or statutory alignment are served without change.
2. Master entities (students, guardians, employees, classes, subjects, fee heads) exist once with a stable primary key. Per-year facts live in explicit tables: `student_enrollments`, `employee_postings`, `class_sections`, `fee_structures`, `teacher_assignments`, `exams`.
3. Transactional tables carry `academic_year_id` (and fee tables also `financial_year_id`) as a foreign key. Historical data is queried by year id, never by string.
4. Year status lifecycle: `planned` -> `active` -> `locked` (stage locks: attendance, exams, fees) -> `closed`. Writes to a locked stage are rejected by `app.assert_year_open(year_id, stage)` inside procedures; corrections are reversal entries.
5. The API carries the working year in the `X-Academic-Year-Id` header (validated to belong to the school), defaulting to the school's active year. The front end shows a global year selector.
6. Rollover is `app.rollover_academic_year(school_id, from_year_id, to_year_id, options)`: creates the new year, copies structures (fee structures, exam types, timetable slots, workflow definitions) by reference to the new year, creates enrolments from promotion decisions, carries forward fee balances, and produces a dry-run report before committing.

## Consequences

- Stable identity across years; no yearly duplication; smaller masters; cross-year reports become joins on year id.
- ETL must collapse the legacy per-year master copies into one master row plus per-year facts, keyed by `sadmission` and `EmpId`.
- Every list query in a year-scoped module must include the year filter; the reference module shows the pattern.
