# ADR-004: Role-based access control, global and module-wise

- Status: Accepted, 2026-09-26

## Context

Legacy access control is per-employee menu rows that hide links but are not enforced on pages, plus teacher types from class mappings, plus assorted permission flag tables and hard-coded bypass user lists. Any logged-in employee can open any admin URL.

## Decision

1. **Permission** is the atomic unit: `module.resource.action` (for example `fees.receipt.create`). Permissions are declared in code with `@RequirePermission()` on API handlers, collected into a registry at startup and synchronised into the `permissions` table. A CI test fails if a handler has neither `@RequirePermission()` nor `@Public()`.
2. **Role** is a named set of permissions with a `kind`: `global` (Group Admin, School Admin, Auditor, Support, Parent, Student) or `module` (Fee Cashier, Fee Manager, Fee Approver, Exam Coordinator, Class Teacher, Subject Teacher, Transport Manager, Librarian, HR Manager, Payroll Officer, Admissions Officer, Communication Approver, Principal). System roles are templates with `school_id IS NULL` and `is_system = true`; schools may add their own roles.
3. **Assignment** (`user_roles`): user + role + school (+ optional campus) + validity dates + granted_by. A user may hold several roles in several schools.
4. **Scope** (`user_role_scopes`): data-level restriction attached to an assignment: `class_section`, `subject`, `department`, `route`, `campus`. Policies in modules apply scopes to list and write operations.
5. **Segregation of duties** (`sod_rules`): pairs of permissions that one user may not hold in the same school; enforced at assignment time and re-checked at action time.
6. **Delegation** (`delegations`): a role holder delegates an approval role for a date range; audited; the original approver is recorded on every action taken under delegation.
7. **Resolution**: effective permissions for (user, school) = union of permissions of active assignments, minus SoD conflicts (rejected at grant time), cached in Redis for 5 minutes and invalidated on any assignment change.
8. **Enforcement order in the API**: authenticate (JWT) -> resolve tenant (membership) -> resolve year -> permission guard -> scope policy inside the service -> RLS in the database.
9. **Step-up**: permissions flagged `requires_mfa` (reversals, refunds, mark unlock, payroll approval, bulk PII export, impersonation) require an `amr` claim with MFA within the last 15 minutes.
10. **Menu projection**: the front end requests `/me` and builds navigation from permissions. No menu tables.

## Consequences

- One model for every module, enforced at the API and the database; the UI can never be the only control.
- Migration maps legacy menu clusters to module roles, teacher types to scoped Class Teacher and Subject Teacher assignments, flag tables to permissions, and removes bypass lists.
- Cost: a permission catalogue to maintain (generated, so low), and role design work with each school during onboarding.
