# ETL framework

Goal: move each school's legacy MySQL data into the PostgreSQL target repeatably, with per-table reconciliation, so a cutover can be rehearsed three times and run once.

## 1. Principles

1. **Idempotent per school and per domain.** Every load is keyed by `etl.legacy_map`; rerunning updates rather than duplicates.
2. **Transform in code, load through the same rules as the API.** Money and marks go through the PL/pgSQL procedures where they exist (receipts through `app.post_receipt` from Sprint 13), never by raw insert.
3. **Every rejected value is recorded**, never silently defaulted. A school cutover is blocked while rejects touch identity, money or marks.
4. **Tenant context always set.** Loads run as `edupro_etl`, an application-style role with `SET LOCAL app.school_id`, so RLS applies during migration too. Only `etl.*` bookkeeping tables are written outside the tenant context.
5. **Reconcile with numbers the school recognises**: student counts per class, fee demand and collection totals per year, attendance counts per month, mark counts per exam.

## 2. Pipeline

```
legacy dump (.sql) --restore--> MySQL 8 (local or CI service)
      |
      v
 Extract (packages/etl MysqlSource, streaming SELECT per table, per FinancialYear)
      |
      v
 Transform (pure functions in packages/etl/src/transforms.ts; catalogue docs/data/01)
      |            \
      v             \--> etl.rejects (table, legacy key, column, reason, raw)
 Resolve identity (etl.legacy_map: student by admission no, employee by code, year by code)
      |
      v
 Load (batched upserts inside Db.withTenant; procedures for money and marks)
      |
      v
 Reconcile (counts and sums legacy vs target) --> etl.reconciliations + markdown report
```

## 3. Bookkeeping schema (`etl`, migration 0008)

| Table | Purpose |
|---|---|
| `etl.runs` | one row per run: school, domain, source dump hash, started, finished, status, counts |
| `etl.legacy_map` | `(school_id, legacy_table, legacy_key, legacy_year) -> (target_table, target_id)`; the identity resolution memory |
| `etl.rejects` | rejected values with reason and raw value |
| `etl.reconciliations` | measure name, legacy value, target value, delta, status per run |

## 4. Order of domains per school

1. Tenancy and years: `FYmaster` to `academic_years` and `financial_years`; school settings from `AppConf.php` values.
2. Identity: `admin`, `employee_master`, `student_master` to `users`, memberships (provisioning list for One Auth).
3. People: students, guardians, enrolments; employees, postings.
4. Academics masters: classes, sections, subjects, streams, teacher assignments.
5. Fees masters then history: heads, structures, periods, discounts; demands; receipts and lines through the posting procedure; adjustments; misc and hostel.
6. Exams: types, exams, subjects, grade scales; marks, indicators, remarks; report card data.
7. Attendance, transport, library, communication logs (current and previous year only).
8. HR and payroll (Sprint 24 onward).

Each domain is a separate script with its own reconciliation measures, so a failed domain can be rerun alone.

## 5. Rehearsal and cutover protocol

| Step | Rehearsal 1 | Rehearsal 2 | Rehearsal 3 | Cutover |
|---|---|---|---|---|
| Dump | any recent | recent | 48 h old | final, after legacy is set read-only |
| Run all domains | yes | yes | yes, timed | yes, timed |
| Reconcile | fix transforms | zero unexplained delta on identity | zero unexplained delta everywhere | signed off by the school |
| UAT on the result | no | module owners | school super-users | smoke tests |

## 6. `packages/etl` skeleton (Sprint 1)

- `src/transforms.ts`: pure, unit-tested transforms from the catalogue.
- `src/reject.ts`: the `Reject` type and helpers.
- `src/legacy-map.ts`: in-memory and PostgreSQL-backed identity map.
- `src/pipeline.ts`: interfaces (`Source`, `Step`, `Loader`, `Reconciler`) and a runner with per-run bookkeeping.
- `src/sources/mysql.ts`: streaming extractor on `mysql2` (needs a restored dump; not runnable in CI until a MySQL service is added in Sprint 4).
- `src/sources/csv.ts`: fixture source for tests.
- `test/transforms.test.ts`: transform cases from legacy observations.

Domain scripts arrive with their modules: identity and people in Sprint 4, fees in Sprints 12 to 15, exams in Sprints 17 to 18.
