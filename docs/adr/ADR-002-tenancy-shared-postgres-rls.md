# ADR-002: Multi-school tenancy through a shared PostgreSQL database with row-level security

- Status: Accepted, 2026-09-26 (confirmed by the business)
- Supersedes: the interim "database per school" recommendation made while MySQL was assumed

## Context

Today every school runs its own database and its own code fork, and the schemas have drifted. The new product must serve a group of schools from one codebase, isolate each school's data strictly, and still allow group-level reporting and cross-school operations such as student transfer.

## Decision

1. One PostgreSQL database per environment. Every tenant-owned table carries `school_id BIGINT NOT NULL REFERENCES schools(id)`.
2. Row-level security is **enabled and forced** on every tenant table. The standard policy compares `school_id` with `app.current_school_id()`, a function reading the transaction-local setting `app.school_id`.
3. The API sets the context at the start of every transaction: `SET LOCAL app.school_id = $1; SET LOCAL app.user_id = $2; SET LOCAL app.allowed_school_ids = $3;` after validating that the user is a member of the requested school.
4. The application connects as `edupro_app`, a role without `BYPASSRLS` and without table ownership. Migrations run as `edupro_migrator`, the owner. `FORCE ROW LEVEL SECURITY` makes policies apply even to the owner.
5. Global tables (`users`, `schools`, `permissions`, system role templates) are not tenant-scoped but are still filtered by membership where they expose tenant information: `schools` shows only `id = ANY(app.allowed_school_ids())`; `users` shows only users sharing a membership with the caller's allowed schools.
6. Large tables (`audit_logs`, `attendance_marks`, `mark_entries`, `receipt_lines`, `punch_logs`) are partitioned: `audit_logs` by month, transactional tables by `academic_year_id` (list) with school-aware indexes.
7. Group reporting reads from a reporting schema or read replica populated by jobs, not from cross-tenant queries in the transactional API.
8. Physical separation option: a client who contracts for it receives a dedicated PostgreSQL schema or database with the same migrations; the tenant resolver maps that `school_id` to a different pool. This is a deployment choice, not a code branch.

## Consequences

- Isolation is enforced by the database even if application code forgets a filter. The RLS test suite in `packages/db/test` runs in CI and fails the build on any cross-tenant read or write.
- One backup, one migration path, one connection pool; cross-school features are straightforward.
- Cost: every query pays a policy check (negligible with indexes on `school_id`); developers must always open the tenant context, which `db.withTenant()` enforces; natural keys that collide across schools (`admission_no`, `employee_code`, receipt numbers) become unique per school, not globally.
