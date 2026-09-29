# ADR-014 · Partitioning review and archive strategy (Sprint 18)

**Status:** accepted, 2026-09-29. Review at the M4 gate (Sprint 21).

## Context

The sprint plan asks, at S18, for a partitioning review of `mark_entries`, `attendance_marks` and the
receipt lines (`fee_payment_allocations`, `fee_late_fee_postings`) and an archive strategy. Only
`audit_logs` is partitioned today (monthly, ADR-005).

Growth at the pilot (about 3,000 pupils, 3 schools of that size in the group):

| Table                     | Rows per school per year (estimate)           | Ten years, three schools |
| ------------------------- | --------------------------------------------- | ------------------------ |
| `mark_entries`            | 3,000 pupils × 8 subjects × 6 exams ≈ 150,000 | ≈ 4.5 M                  |
| `attendance_marks`        | 3,000 × 220 working days ≈ 660,000            | ≈ 20 M                   |
| `fee_payment_allocations` | 12,000 receipts × 5 heads ≈ 60,000            | ≈ 1.8 M                  |
| `fee_late_fee_postings`   | ≈ 15,000                                      | ≈ 0.5 M                  |

Every query on these tables is bounded by school (RLS) and by academic year, section, exam or
payment; the unique keys the procedures rely on (`(exam_subject_id, student_id)`,
`(session_id, student_id)`) are not year-prefixed, and declarative range partitioning would require
the partition key inside every unique index — a change to the procedures and to the day book's
correctness argument for no measured gain at these volumes.

## Decision

1. **No table partitioning in Release 1.** The volumes stay well below the tens of millions of rows
   where range partitioning pays for itself on PostgreSQL 16 with covering indexes.
2. **Index the receipt line by payment.** `fee_payment_allocations (payment_id)` was missing (the
   ledger read it through the demand); added in migration 0030.
3. **Archive closed years' attendance marks.** `app.archive_closed_years()` moves the marks of
   academic years closed longer than the two most recent closed years into `archive.attendance_marks`
   (same columns plus `archived_at`), per school, under the school's tenant context. The workers job
   `archive.closed_years` runs it nightly at 02:00 IST (it moves nothing until a third closed year
   exists). Attendance marts already carry the aggregates families and the office read; the archive
   stays queryable by the migrator for audits.
4. **Re-check at M4.** Capture `pg_stat_user_tables` sizes and the plans of the day book, the
   attendance marts and the register sheet after the first full term; revisit if any plan stops
   using the covering index or a table passes 5 M rows.

## Consequences

- No change to procedures, RLS policies or the compat API.
- The archive schema is a second place to look for old attendance; documented in the DR runbook.
- Mark entries and receipt lines are never archived: report cards and ledgers of past years read
  them live.
