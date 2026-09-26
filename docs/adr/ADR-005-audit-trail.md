# ADR-005: Audit trail

- Status: Accepted, 2026-09-26

## Context

Legacy auditing is opt-in per call, stores string ids as zero, and runs an extra schema query per call. VAPT and DPDP both require a reliable, tamper-evident record of who did what to whose data.

## Decision

1. One `audit_logs` table, partitioned by month on `occurred_at`, append-only: the application role has `INSERT` and `SELECT` only; a trigger rejects `UPDATE` and `DELETE`; partitions older than the retention period are detached and archived, never edited.
2. Two writers:
   - **Service-level**: a NestJS interceptor records every mutating request (action, entity type and id, before and after JSON captured by the service, diff, permission used, request id, actor, tenant, IP, user agent).
   - **Database triggers** on money and marks tables (`receipts`, `receipt_lines`, `fee_adjustments`, `mark_entries`, `payroll_records`) write row-level before and after images regardless of the code path, using `app.audit_row_change()`.
3. Actor types: `user`, `impersonated_user` (with `impersonated_by`), `system_job`, `device`, `migration`.
4. Privileged events are always audited even when they read: permission changes, role assignments, delegations, impersonation start and end, bulk exports of personal data, break-glass access, year lock and reopen.
5. Audit rows are tenant-scoped (`school_id`) and visible to holders of `platform.audit.view` for their school; Group Admin sees all allowed schools; Auditor role is read-only everywhere.
6. Personal data in `before` and `after` is stored as JSONB; fields classified as sensitive (Aadhaar, bank account, health) are masked in the audit payload and referenced by field name only.
7. Retention: 7 financial years for money and marks, 3 years for other entities, configurable per school within legal minimums.

## Consequences

- Complete and tamper-evident history with no developer discipline required for the critical tables.
- Storage grows; partitioning and archival keep the hot set small.
- Services must load the "before" image for updates (the reference module shows the pattern).
