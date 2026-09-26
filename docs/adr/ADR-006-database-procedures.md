# ADR-006: Database procedures for money and marks

- Status: Accepted, 2026-09-26

## Context

The business asked for backend logic in Node.js with "database procedures". The legacy fee posting writes three tables without a transaction, generates receipt numbers with `MAX + 1`, and duplicates late-fee logic across files.

## Decision

1. All writes that must be atomic across several tables, or that must be identical from every entry point (counter, parent portal, gateway webhook, bank upload, ETL), are implemented as **PL/pgSQL procedures or functions in the `app` schema**:
   - `app.next_receipt_no(school_id, ledger_type, financial_year_id)` with a row lock on `receipt_sequences`
   - `app.post_receipt(payload jsonb)`, `app.reverse_receipt(...)`, `app.record_bounce(...)`
   - `app.generate_fee_demand(enrollment_id, academic_year_id)`, `app.late_fee(demand_id, as_of date)`
   - `app.compute_grade(mark, max_mark, scale_id)`, `app.finalise_exam(exam_id)`
   - `app.close_daily_attendance(school_id, date)`, `app.run_payroll(run_id)`
   - `app.rollover_academic_year(...)`, `app.assert_year_open(year_id, stage)`
2. Procedures run inside the caller's transaction, which already carries the tenant context, so RLS applies inside them. Procedures are `SECURITY INVOKER`; no `SECURITY DEFINER` without an ADR.
3. Node.js services own orchestration, validation, authorisation, external calls and events; they call procedures through the `pg` driver with typed parameters and never re-implement the rule in TypeScript.
4. Ordinary CRUD (masters, notices, homework) uses Prisma; no procedures for simple writes.
5. Every procedure has a fixture-based test in `packages/db/test` with cases drawn from legacy history (for fees: real receipts from the pilot school), run in CI against a real PostgreSQL service.
6. Procedures are versioned by migration; behaviour changes ship with a new migration and updated fixtures, never by editing an applied migration.

## Consequences

- Atomic, single-source business rules; the gateway webhook and the cashier screen cannot diverge.
- Requires PL/pgSQL skills and a test harness (provided in Sprint 2).
- Debugging spans two runtimes; procedures log through `RAISE LOG` with the request id passed in.
