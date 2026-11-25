# Platform core — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

**Tenancy**: school groups → schools (the tenant) → campuses, dated settings and small set-up lists. **Access**: one
`users` row per person across schools, linked to a student, guardian or employee of a school by
`user_school_memberships`; roles carry permissions and are granted for a period (`user_roles`, scopes, delegations,
time-boxed break-glass and impersonation); sign-ins land in `login_events`. **Shared engines**: the approval engine
(definition → request → one step per level → events) used by about 30 request types, the file index, the job outbox
and the append-only, month-partitioned `audit_logs`. **Compliance**: DPDP requests, breach log, retention runs; the
cut-over and hypercare tables are left from the move off the old PHP system.

## Tables

| Table                     | One row is                                                                                    | Key columns                                                                                                                                                                                                          | For reports                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `schools`                 | one school (the tenant); no `school_id`                                                       | `code` (unique), `name`, `short_name`, `board`, `affiliation_no`, `timezone`, `locale`, `group_id`, `address`/`contact`/`branding` jsonb, `status`, `deleted_at`                                                     | master (global)                                                  |
| `school_groups`           | one group of schools; no `school_id`                                                          | `code` (unique), `name`, `status`, `deleted_at`                                                                                                                                                                      | master (global)                                                  |
| `campuses`                | one campus of the school                                                                      | `code` (unique per school), `name`, `address` jsonb, `geo` jsonb, `status`, `deleted_at`                                                                                                                             | master                                                           |
| `school_settings`         | one value of one setting key for a date range                                                 | `key` (e.g. `auth.login_mode`), `value` jsonb, `valid_from`, `valid_to`                                                                                                                                              | internal (settings; versioned)                                   |
| `countries`               | one country in the school's list                                                              | `code` (ISO, unique per school), `name`, `dial_code`, `status`                                                                                                                                                       | master                                                           |
| `states`                  | one state of a country                                                                        | `country_id`, `code` (unique per school), `name`, `gst_code`, `status`                                                                                                                                               | master                                                           |
| `cities`                  | one city of a state                                                                           | `state_id`, `name` (unique per state), `pincode`, `status`                                                                                                                                                           | master                                                           |
| `banks`                   | one bank in the cheque / DD bank picker (no account numbers)                                  | `code` (unique per school), `name`, `branch`, `ifsc`, `address`, `account_label`, `status`                                                                                                                           | master                                                           |
| `users`                   | one person who can sign in, shared by all schools; no `school_id`                             | `display_name`, `email` (citext), `mobile`, `oneauth_sub` (unique), `status`, `last_login_at`, `invited_at`, `legacy_ref`, `deleted_at`                                                                              | master (global; the "by" of every table)                         |
| `user_school_memberships` | one link of a sign-in to a person in one school                                               | `user_id`, `person_type` (employee/guardian/student/external), `person_ref_id`, `status`, `deleted_at`; unique (school, user, person_type)                                                                           | **main (who can sign in)**                                       |
| `roles`                   | one role: a system template (`school_id` NULL) or the school's own                            | `code`, `name`, `kind` (global/module), `is_system`, `status`, `deleted_at`                                                                                                                                          | master                                                           |
| `permissions`             | one right in the global catalogue; no `school_id`                                             | `code` (`module.thing.verb`, PK), `module`, `requires_mfa`, `orphaned`, `declared_in_code`                                                                                                                           | master (global)                                                  |
| `role_permissions`        | one right given to a role; no `school_id`                                                     | `role_id`, `permission_code` (PK both)                                                                                                                                                                               | master                                                           |
| `sod_rules`               | one pair of rights nobody may hold together (`school_id` NULL = all schools)                  | `permission_a`, `permission_b`                                                                                                                                                                                       | master                                                           |
| `user_roles`              | one grant of a role to a user (kept after it is revoked)                                      | `user_id`, `role_id`, `campus_id`, `valid_from`, `valid_to`, `revoked_at`, `granted_by`, `reason`                                                                                                                    | **main (access spine)**                                          |
| `user_role_scopes`        | one limit on a role grant                                                                     | `user_role_id`, `scope_type` (class_section/subject/department/route/campus), `scope_id`                                                                                                                             | detail                                                           |
| `delegations`             | one hand-over of a role (or of purchase approvals) from one user to another for a period      | `from_user_id`, `to_user_id`, `role_id`, `scope` (all/purchase), `starts_at`, `ends_at`, `revoked_at`, `reason`                                                                                                      | history                                                          |
| `break_glass_events`      | one emergency role grant, at most 4 hours                                                     | `user_id`, `role_id`, `user_role_id`, `reason`, `started_at`, `expires_at`, `revoked_at`, `report_sent_at`                                                                                                           | history (security)                                               |
| `impersonation_sessions`  | one "act as / view as" session                                                                | `actor_user_id`, `target_user_id`, `mode` (full/view/act), `app` (admin/parent/teacher), `person_type`, `person_ref_id`, `reason`, `started_at`, `expires_at`, `ended_at`                                            | history (security)                                               |
| `portal_handoffs`         | one 60-second code carrying a view-as session into the parent or teacher app                  | `session_id`, `app`, `expires_at`, `used_at`                                                                                                                                                                         | internal                                                         |
| `login_events`            | one sign-in (also a denied legacy-app sign-in, and the start of an impersonation)             | `user_id`, `school_id` (nullable), `occurred_at`, `method`, `outcome`, `ip`, `user_agent`, `detail` jsonb (`app`)                                                                                                    | history (sign-ins)                                               |
| `auth_otp_challenges`     | one sign-in code sent                                                                         | `user_id`, `purpose`, `app`, `sent_to`, `shown_on_screen`, `attempts`, `expires_at`, `consumed_at`                                                                                                                   | internal (definer-only: the app role sees no rows)               |
| `auth_trusted_devices`    | one browser remembered for 30 days; no `school_id`                                            | `user_id`, `app`, `expires_at`, `last_used_at`, `revoked_at`                                                                                                                                                         | internal (definer-only)                                          |
| `mobile_sessions`         | one signed-in phone; no `school_id`                                                           | `user_id`, `platform`, `app_version`, `method`, `mfa`, `last_used_at`, `idle_days`, `revoked_at`, `revoked_reason`                                                                                                   | internal (definer-only)                                          |
| `mobile_web_handoffs`     | one 60-second code handing the phone session to a web page                                    | `session_id`, `user_id`, `app`, `target`, `expires_at`, `used_at`                                                                                                                                                    | internal (definer-only)                                          |
| `web_hops`                | one 60-second code opening the family website signed in from the staff website (My children)  | `user_id`, `app`, `school_id`, `target`, `expires_at`, `used_at`                                                                                                                                                     | internal (definer-only)                                          |
| `api_idempotency`         | one idempotency key a phone sent with an offline write (kept 2 days)                          | `user_id`, `key` (PK both), `route`, `status` (HTTP), `done_at`                                                                                                                                                      | internal (definer-only)                                          |
| `service_keys`            | one machine key for a data feed                                                               | `name`, `scopes`, `status`, `last_used_at`, `revoked_at`                                                                                                                                                             | internal                                                         |
| `user_preferences`        | one saved screen preference of a user                                                         | `user_id`, `pref_key` (e.g. `push.off`), `value`; unique (school, user, key)                                                                                                                                         | internal                                                         |
| `workflow_definitions`    | one approval route: its levels and who approves each                                          | `code`, `name`, `entity_type`, `levels` jsonb, `creator_roles`, `status`, `deleted_at`                                                                                                                               | master                                                           |
| `workflow_instances`      | one approval request about one record                                                         | `definition_id`, `entity_type`, `entity_id`, `subject`, `payload`, `status`, `current_level`, `requested_by`, `requested_at`, `completed_at`, `completed_by`, `cancel_reason`                                        | **main (approvals spine)**                                       |
| `workflow_steps`          | one level of one request                                                                      | `instance_id`, `level` (unique per instance), `name`, `assignee_user_ids[]`, `approved_by[]`, `status`, `acted_by`, `acted_at`, `note`, `due_at`, `reminded_at`, `escalated_at`, `escalated_to[]`                    | detail                                                           |
| `workflow_events`         | one event in a request's history                                                              | `instance_id`, `step_id`, `kind`, `actor_id`, `note`, `detail` jsonb, `occurred_at`                                                                                                                                  | history                                                          |
| `files`                   | one stored file (upload or generated)                                                         | `bucket`+`object_key` (unique), `content_type`, `size_bytes`, `original_name`, `owner_entity_type`, `owner_entity_id`, `classification`, `status`, `storage_driver`, `deleted_at`                                    | detail (reached through the 37 `*_file_id` columns)              |
| `jobs_outbox`             | one background job handed to the workers                                                      | `queue`, `payload` jsonb (job envelope), `status`, `attempts`, `last_error`, `available_at`, `locked_until`, `published_at`                                                                                          | internal                                                         |
| `audit_logs`              | one recorded change or privileged action (partitioned by month on `occurred_at`)              | `occurred_at`+`id` (PK), `actor_type`, `actor_user_id`, `impersonated_by`, `action`, `entity_type`, `entity_id` (text), `before`/`after`/`diff` jsonb, `permission_code`, `request_id`, `ip`, `user_agent`, `source` | **history (who changed what)** — always query this parent        |
| `audit_logs_202609`       | the audit rows of Sep 2026 (a partition)                                                      | as `audit_logs`                                                                                                                                                                                                      | internal — never query directly                                  |
| `audit_logs_202610`       | the audit rows of Oct 2026                                                                    | as `audit_logs`                                                                                                                                                                                                      | internal — never query directly                                  |
| `audit_logs_202611`       | the audit rows of Nov 2026                                                                    | as `audit_logs`                                                                                                                                                                                                      | internal — never query directly                                  |
| `audit_logs_202612`       | the audit rows of Dec 2026 (made ahead)                                                       | as `audit_logs`                                                                                                                                                                                                      | internal — never query directly                                  |
| `audit_logs_202701`       | the audit rows of Jan 2027 (made ahead)                                                       | as `audit_logs`                                                                                                                                                                                                      | internal — never query directly                                  |
| `audit_logs_default`      | audit rows outside every monthly partition (should stay empty)                                | as `audit_logs`                                                                                                                                                                                                      | internal                                                         |
| `audit_probe`             | a scratch table made by the database test suite (`amount`, `secret`); no migration creates it | `amount`, `secret`                                                                                                                                                                                                   | internal (test only — ignore)                                    |
| `data_subject_requests`   | one DPDP request of a student, guardian or employee                                           | `kind`, `principal_kind`, `principal_id`, `channel`, `status`, `received_on`, `due_on`, `handled_by`, `completed_at`, `export_id`, `change_request_id`                                                               | main (DPDP register)                                             |
| `breach_log`              | one personal-data breach                                                                      | `title`, `detected_at`, `status`, `data_classes[]`, `principals_affected`, `board_notified_at`, `principals_notified_at`, `owner`, `closed_at`                                                                       | main (DPDP register)                                             |
| `retention_runs`          | one retention policy applied to the school on one night                                       | `policy`, `keep_days`, `affected`, `ran_at`                                                                                                                                                                          | history (DPDP)                                                   |
| `cutover_runs`            | one go-live rehearsal or final cut-over                                                       | `kind` (rehearsal/final), `status`, `started_at`, `finished_at`, `signed_off_by`, `signed_off_at`                                                                                                                    | internal (legacy cut-over)                                       |
| `cutover_steps`           | one timed step of a cut-over run                                                              | `run_id`, `sequence`, `phase`, `code` (unique per run), `status`, `done_by`, `done_at`, `duration_s`                                                                                                                 | internal (legacy cut-over)                                       |
| `cutover_snapshots`       | the record counts taken from the old system or the new one for a run                          | `run_id`, `source` (legacy/live), `counts` jsonb, `taken_at`                                                                                                                                                         | internal (legacy cut-over)                                       |
| `hypercare_issues`        | one go-live support issue (frozen: copied into the helpdesk in 0056)                          | `number`, `title`, `module`, `severity` (s1–s4), `status`, `due_at`, `closed_at`                                                                                                                                     | internal (legacy; use `parent_queries` with `desk = 'provider'`) |
| `hypercare_updates`       | one note or status change on a hypercare issue                                                | `issue_id`, `author`, `status_from`, `status_to`, `created_at`                                                                                                                                                       | internal (legacy)                                                |

50 tables (the five monthly partitions and the default partition of `audit_logs` are tables of their own).

## How the tables join

**Spines.** Approvals: `workflow_instances`. Access: `user_roles`. Who changed what: `audit_logs`. Who can sign in:
`user_school_memberships` → `users`. Sign-ins: `login_events`. Most other modules only point _into_ this module
(`created_by`/`updated_by`/`*_by` → `users.id`, `*_file_id` → `files.id`, `workflow_instance_id` →
`workflow_instances.id`).

### Tenancy and set-up lists

- `schools.group_id → school_groups.id`
- `campuses.school_id → schools.id`; `class_sections.campus_id`, `holidays.campus_id`, `postings.campus_id`,
  `user_roles.campus_id`, `library_libraries.campus_id`, `rfid_devices.campus_id`, `timetable_periods.campus_id` → `campuses.id`
- `states.country_id → countries.id`; `cities.state_id → states.id`
- `school_bank_accounts.bank_id → banks.id` (fees module)
- The school profile and vendor addresses store country / state / city **names**, not ids: join a master by name
  (`states.name`, `countries.name`) when you need its code (e.g. `states.gst_code`).
- `school_settings` has no foreign keys: (school, `key`) with a date range. The value in force today is the row with
  the latest `valid_from` (then the highest `id`) among `valid_from <= today AND (valid_to IS NULL OR valid_to >= today)`
  — exactly what `app.setting(key)` returns.

### People and sign-ins

- `user_school_memberships.user_id → users.id`
- `user_school_memberships.person_ref_id →` `employees.id` when `person_type = 'employee'`, `guardians.id` when
  `'guardian'`, `students.id` when `'student'`; NULL for `'external'`. A user may hold several memberships in one
  school (e.g. a teacher who is also a parent): one per `person_type`.
- The person tables also point to the login directly: `employees.user_id`, `guardians.user_id`, `students.user_id`
  → `users.id`. Going from a person to their login, use the person table's `user_id`.
- `login_events.user_id → users.id` (for an impersonation row it is the _target_; the actor is `detail ->> 'actorUserId'`)
- Every `created_by`, `updated_by`, `requested_by`, `acted_by`, `decided_by`, `owner_id` … in the database → `users.id`
  (not `employees.id`). To show an employee code, go `users.id → employees.user_id`.

### Rights

- `user_roles.user_id → users.id`; `user_roles.role_id → roles.id`; `user_roles.granted_by → users.id`
- `role_permissions.role_id → roles.id`; `role_permissions.permission_code → permissions.code`
- `user_role_scopes.user_role_id → user_roles.id`; `scope_id →` `class_sections.id` when `scope_type = 'class_section'`
  (the only scope type the API enforces today; the other four exist in the enum only)
- `sod_rules.permission_a`, `sod_rules.permission_b → permissions.code`
- `delegations.from_user_id`, `delegations.to_user_id → users.id`; `delegations.role_id → roles.id` (NULL when `scope = 'purchase'`)
- `break_glass_events.user_role_id → user_roles.id` (the temporary grant it created); `.role_id → roles.id`; `.user_id → users.id`
- `impersonation_sessions.actor_user_id`, `.target_user_id → users.id`; `.person_ref_id →` students / guardians /
  employees by `person_type`; `portal_handoffs.session_id → impersonation_sessions.id`
- `mobile_web_handoffs.session_id → mobile_sessions.id`
- `web_hops.user_id → users.id`, `web_hops.school_id → schools.id`
- Role codes are also stored as plain text in other tables: `workflow_definitions.creator_roles[]`,
  `report_schedules.recipient_roles[]`, `mis_dashboards.roles[]`, `dashboard_role_defaults.role_code` → `roles.code`.

A user holds a permission today when (as `AccessService.queryPermissions` computes it):
`user_roles` row with `revoked_at IS NULL AND valid_from <= today AND (valid_to IS NULL OR valid_to >= today)`, its
role `status = 'active' AND deleted_at IS NULL`, and the right in `role_permissions` — **or** an active delegation of a
role that has the right (`revoked_at IS NULL AND now() BETWEEN starts_at AND ends_at`) — **or** a small baseline every
active employee gets in code (not in the tables).

### Approvals (the generic engine)

- `workflow_instances.definition_id → workflow_definitions.id`
- `workflow_steps.instance_id → workflow_instances.id` (one row per level, all created when the request starts);
  the step a request waits on: `st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'`
- `workflow_events.instance_id → workflow_instances.id`; `workflow_events.step_id → workflow_steps.id`
- `workflow_steps.assignee_user_ids[]`, `.approved_by[]`, `.escalated_to[]`, `.acted_by`, `workflow_instances.requested_by`,
  `.completed_by`, `workflow_events.actor_id → users.id`
- To the record the request is about, prefer the module's own column `<table>.workflow_instance_id →
workflow_instances.id` (one-to-one and indexed). Else `workflow_instances.entity_id → <table>.id`, choosing the
  table by `entity_type`:

| `entity_type`                                                 | `entity_id` is                                                            | module column pointing back                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `application`                                                 | `applications.id`                                                         | `applications.workflow_instance_id`                                                                                                                    |
| `admission_refund`                                            | `admission_refunds.id`                                                    | `admission_refunds.workflow_instance_id`                                                                                                               |
| `admission_cancellation`                                      | `admission_cancellations.id`                                              | `admission_cancellations.workflow_instance_id`                                                                                                         |
| `student_correction` / `class_correction` / `student_merge`   | `student_corrections.id` / `class_corrections.id` / `student_merges.id`   | each table's `workflow_instance_id`                                                                                                                    |
| `withdrawal_revoke`                                           | `student_withdrawals.id`                                                  | `student_withdrawals.revoke_workflow_instance_id`                                                                                                      |
| `fee_profile_change`                                          | `fee_profile_changes.id`                                                  | `fee_profile_changes.workflow_instance_id`                                                                                                             |
| `fee_waiver` / `fee_waiver_undo`                              | `fee_adjustments.id`                                                      | `fee_adjustments.workflow_instance_id` / `.undo_workflow_instance_id`                                                                                  |
| `fee_change_request`                                          | `fee_change_requests.id`                                                  | `fee_change_requests.workflow_instance_id`                                                                                                             |
| `fee_opening`                                                 | `fee_opening_uploads.id`                                                  | `fee_opening_uploads.workflow_instance_id`                                                                                                             |
| `misc_fee_request`                                            | `misc_fee_requests.id`                                                    | `misc_fee_requests.workflow_instance_id`                                                                                                               |
| `fee_refund`                                                  | `fee_refunds.id`                                                          | `fee_refunds.workflow_instance_id`                                                                                                                     |
| `hostel_withdrawal`                                           | `hostel_withdrawals.id`                                                   | `.workflow_instance_id` (the withdrawal) **and** `.revoke_workflow_instance_id` (its revoke) — same `entity_type` for both                             |
| `lesson_plan`                                                 | `lesson_plans.id`                                                         | `lesson_plans.workflow_instance_id`                                                                                                                    |
| `message_request`                                             | `message_requests.id`                                                     | `message_requests.workflow_instance_id`                                                                                                                |
| `consent_response`                                            | `consent_form_responses.id`                                               | `consent_form_responses.instance_id`                                                                                                                   |
| `cctv_request` / `employee_query`                             | `cctv_requests.id` / `employee_queries.id`                                | each table's `workflow_instance_id`                                                                                                                    |
| `certificate_request`                                         | `certificate_requests.id`                                                 | none (use `entity_id`)                                                                                                                                 |
| `vacancy`                                                     | `vacancies.id`                                                            | none (use `entity_id`)                                                                                                                                 |
| `employee_exit`                                               | `employee_exits.id`                                                       | `employee_exits.workflow_instance_id`                                                                                                                  |
| `staff_leave` / `staff_leave_cancel`                          | `staff_leave_requests.id`                                                 | `staff_leave_requests.workflow_instance_id` / `.cancel_instance_id`                                                                                    |
| `staff_regularisation`                                        | `staff_regularisations.id`                                                | `staff_regularisations.workflow_instance_id`                                                                                                           |
| `purchase_requisition` / `purchase_indent` / `purchase_order` | `purchase_requisitions.id` / `purchase_indents.id` / `purchase_orders.id` | each table's `workflow_instance_id`                                                                                                                    |
| `purchase_inspection`                                         | `goods_receipts.id`                                                       | `goods_receipts.workflow_instance_id`                                                                                                                  |
| `purchase_count` / `purchase_revaluation`                     | `stock_counts.id` / `stock_revaluations.id`                               | each table's `workflow_instance_id`                                                                                                                    |
| `gate_pass`, `appointment_request`, `transport_request`       | `gate_passes.id`, `appointments.id`, `transport_requests.id`              | old links only: these moved to their modules' own levels (0069, 0077, 0059); their definitions are inactive and waiting requests were cancelled (0113) |

The definition `code` is not always the `entity_type` (`admission_approval` → `application`, `message_approval` →
`message_request`, `vacancy_approval` → `vacancy`, one definition per consent form or per leave approval rule).
Group "kinds of request" by `workflow_instances.entity_type`.

Not every approval in the app is in these tables: admission registrations (stage levels), gate passes, transport
requests, appointments, purchase department approvals and a few others keep their own levels in their module.

### Files, jobs, audit

- `<table>.<x>_file_id → files.id` (37 columns: `students.photo_file_id`, `employees.photo_file_id`,
  `exports.file_id`, `person_documents.file_id`, `staff_leave_requests.document_file_id` …). Use these, not
  `files.owner_entity_type` / `owner_entity_id`, which only some uploads fill.
- `jobs_outbox.payload` is the job envelope `{schoolId, userId, requestId, kind, payload}`; `jobs_outbox.request_id`
  and `audit_logs.request_id` and `ai_audit.request_id` share the API request id — join on it to see everything one
  click did.
- `audit_logs.entity_type` is usually a table name (`students`, `fee_payments`, `workflow_instances`, `user_roles`,
  `school_settings` …), sometimes an aggregate (`student`, `application`, `hostel`, `payroll_cutover`);
  `audit_logs.entity_id` is the row id **as text** → compare with `<table>.id::text`.
- `audit_logs.actor_user_id`, `audit_logs.impersonated_by → users.id`

### DPDP and go-live

- `data_subject_requests.principal_id →` `students.id` / `guardians.id` / `employees.id` by `principal_kind`;
  `.export_id → exports.id` (the access copy); `.change_request_id → profile_change_requests.id`;
  `.requested_by_user`, `.handled_by → users.id`
- `breach_log.owner`, `breach_log.reported_by → users.id`
- `cutover_steps.run_id`, `cutover_snapshots.run_id → cutover_runs.id`; `hypercare_updates.issue_id → hypercare_issues.id`;
  `parent_queries.legacy_hypercare_id → hypercare_issues.id` (the helpdesk copy)

### Row-level security: what a report query can see

Read `packages/db/migrations/0002_rls.sql` and `0003_audit.sql`. The rules, precisely:

- **Session context.** The API (and every worker job) runs each transaction after
  `set_config('app.school_id', …, true)`, `app.user_id`, `app.allowed_school_ids` (every school the user belongs to),
  `app.academic_year_id` (the year chosen in the header), `app.request_id`, `app.impersonated_by` — all
  transaction-local. `app.current_school_id()` is `NULLIF(current_setting('app.school_id', true), '')::bigint`;
  `app.current_user_id()`, `app.allowed_school_ids()`, `app.current_academic_year_id()` read the others.
  With no context, `app.current_school_id()` is NULL and **every tenant table returns zero rows, without an error**.
- **The standard tenant policy.** `CALL app.apply_tenant_rls('<table>')` turns on `ENABLE` + `FORCE ROW LEVEL
SECURITY` and creates two policies: `<table>_tenant_isolation FOR ALL TO PUBLIC USING (school_id =
app.current_school_id()) WITH CHECK (school_id = app.current_school_id())`, and `<table>_migrator FOR ALL TO
edupro_migrator USING (true)`. Mart tables get the same through `app.apply_tenant_rls_in('mart', …)`.
- **Database roles.** `edupro_app` (API and workers: NOBYPASSRLS, rights on all public tables, the API refuses to
  start as the migrator); `edupro_migrator` (owner; runs migrations; its policies pass every row of every school;
  locally it is also a superuser); `edupro_etl` (the legacy loader: RLS applies, plus the `etl` schema);
  `edupro_readonly` (planned for BI; holds almost no grants today).
- **Tables that widen beyond "this school"** (the policy is not plain `school_id = current`):
  - `schools`: SELECT when `id = ANY (app.allowed_school_ids())`; UPDATE only the current school.
  - `school_groups`: SELECT when one of its schools is allowed.
  - `users`: SELECT when it is the caller, or shares a membership (not deleted) with **any** allowed school; plus a
    sign-in lookup by `app.auth_sub`; INSERT is open (invitations).
  - `user_school_memberships`: the tenant policy **plus** `_self` — a user sees their own memberships in every school.
  - `login_events`: SELECT when `school_id = ANY (app.allowed_school_ids())` or `user_id = app.current_user_id()`.
  - `audit_logs`: SELECT when `school_id = ANY (app.allowed_school_ids())`; INSERT only for the current school;
    UPDATE/DELETE refused by grant and by the trigger `app.reject_audit_mutation` (`audit.append_only`).
  - `roles`, `sod_rules`: system templates (`school_id IS NULL`) plus the current school's; `role_permissions`
    through its role; `permissions`: everyone reads everything.
- **Definer-only tables**: `auth_otp_challenges`, `auth_trusted_devices`, `mobile_sessions`, `mobile_web_handoffs`,
  `web_hops`, `api_idempotency`, `ai_model_settings`. Forced RLS and **only** the `<table>_migrator` policy (0250,
  0400, 0402, 0415, 0424): `edupro_app` sees no rows at all, silently. They are read and written only by `SECURITY DEFINER` functions
  (`app.login_policy`, `app.mobile_session_start`, `app.idempotency_begin`, `app.ai_model_get` …), which run as the
  owner. Do not report from them.
- **Audit partitions** (`audit_logs_YYYYMM`, `audit_logs_default`) have no RLS of their own and `REVOKE ALL` from
  `edupro_app` and `edupro_readonly`: the app role must read through `audit_logs`; an owner reading a partition
  directly sees every school.
- **Other schemas.** `mart.*`: tenant policy as above. `etl.*`: no RLS and no grant to the app role (only
  `edupro_etl` and the owner). `archive.attendance_marks`: no RLS and no grant to the app role in the migrations.
  `app.schema_migrations`: readable by the app (the list of applied migrations).

**What this means for report SQL**

1. Run report SQL as `edupro_app`, inside a read-only transaction that has set `app.school_id` (and `app.user_id`).
   Then tenant tables need no `school_id` filter and cannot leak another school's rows. Set `app.allowed_school_ids`
   to that one school (`'{<id>}'`), as the workers do, so the widening tables above cannot widen.
2. Even so, always write `school_id = app.current_school_id()` on `audit_logs`, `login_events` and
   `user_school_memberships`, and `id = app.current_school_id()` on `schools` — under the API's own context
   (`allowed_school_ids` = all the user's schools) they return other schools' rows.
3. Never run report SQL as `edupro_migrator`, a superuser or any BYPASSRLS role: every policy passes and totals add
   up all schools. A DBA who must do so filters `school_id` on **every** table of the query.
4. `SECURITY DEFINER` functions in `app` (e.g. `app.erase_principal`, `app.expire_exports`, `app.purge_login_events`)
   run as the owner and change data; a report or an AI model must never call them. Safe read helpers that run as
   the caller: `app.setting(key)`, `app.current_*()`, `app.live_counts()`.
5. The API pool sets `statement_timeout` to 15 s; long reports belong on the marts (see the AI and insights guide).

## Life-cycles and statuses

- **`row_status`** (`active` / `inactive`) on `schools`, `school_groups`, `campuses`, `users`, `user_school_memberships`,
  `roles`, `banks`, `countries`, `states`, `cities`, `workflow_definitions`, `service_keys`. Most of these also have
  `deleted_at` (soft delete: `schools`, `school_groups`, `campuses`, `users`, `user_school_memberships`, `roles`,
  `workflow_definitions`, `files`). "Current" = `status = 'active' AND deleted_at IS NULL`.
- **`users`**: an invited person who never signed in has `oneauth_sub = 'pending:<mobile>'` (claimed at first sign-in);
  an erased person has `oneauth_sub = 'erased:<id>'`, `display_name = 'Erased user <id>'`, `status = 'inactive'`,
  `deleted_at` set. `last_login_at` is refreshed on **every authenticated API request**, so it means "last seen".
- **`person_type`**: employee, guardian, student, external. **`role_kind`**: global, module. **`scope_type`**:
  class_section, subject, department, route, campus (only class_section is used).
- **`user_roles`**: in force when `revoked_at IS NULL AND valid_from <= today AND (valid_to IS NULL OR valid_to >=
today)`. Revoking sets `revoked_at`/`revoked_by`; rows are never deleted, so the table is the grant history.
  `reason` tells how it came: typed by an admin, `'employee onboarded'`, `'teacher assignment sync'`,
  `'first sign-in by code'`.
- **`delegations`**: in force when `revoked_at IS NULL AND now() BETWEEN starts_at AND ends_at`; `scope = 'purchase'`
  hands over purchase approvals only (no role).
- **`break_glass_events`**: open while `revoked_at IS NULL AND expires_at > now()` (`expires_at <= started_at + 4 h`);
  the worker job `app.expire_break_glass` (every 5 minutes) sets `revoked_at` here and on the linked `user_roles` row.
- **`impersonation_sessions`**: open while `ended_at IS NULL AND expires_at > now()`. `mode`: `full` (admin app
  impersonation), `view` (portal opened as someone, read only), `act` (act for them, no payments). `app`: admin,
  parent, teacher. Each start also writes a `login_events` row with `method = 'impersonation'`, and the actions done
  meanwhile carry `audit_logs.actor_type = 'impersonated_user'` and `impersonated_by`.
- **`login_method`**: oidc (One Auth), otp (code), dev (local only), compat (legacy apps), device, impersonation.
  **`login_outcome`**: success, denied, error — the web sign-in only writes `success`; `denied` comes from the legacy
  compatibility API.
- **`auth_otp_challenges`**: `purpose` login / second_factor; used when `consumed_at` is set; `attempts` counts tries.
- **`mobile_sessions`**: live while `revoked_at IS NULL` and used within `idle_days` (default 60); a new sign-in on the
  same phone revokes the old row (`revoked_reason`).
- **`workflow_status`** (`workflow_instances.status`): `pending` → `approved` (last level approved) | `rejected` (any
  level rejects; the remaining steps become `skipped`) | `cancelled` (requester or manager cancels, `cancel_reason`;
  also bulk-cancelled by 0113 and by module undo routines). Only one pending request per definition and record
  (unique index on `(definition_id, entity_id) WHERE status = 'pending'`); a re-raised request is a new row.
  `completed_at`/`completed_by` are set on approve, reject and cancel.
- **`step_status`** (`workflow_steps.status`): `pending` → `approved` | `rejected` | `skipped` (the request was
  rejected or cancelled before this level, or nobody holds the level). A level approved by itself because its
  approver raised the request shows `approved` with the note "Raised by this level's approver". A level with
  `need = 'all'` stays pending until every assignee is in `approved_by[]`.
  `current_level` moves to the next pending level; the next level's `due_at` starts then (`slaHours`).
- **`workflow_events.kind`**: started, approved, rejected, cancelled, reassigned, reminded, escalated, comment,
  delegated, skipped, passed (`detail` holds `level`, `partial`, `delegatedFrom`, `auto` …). This is the full history;
  the step row keeps only the last decision.
- **`workflow_definitions.levels`** jsonb: `[{level, name, resolver: {kind: role|named_user|position|any_of|
class_teacher|approver_chain|staff …}, slaHours, autoIfRequester, noSelfApproval, need, autoSkip, escalateTo}]`.
  Edits change future requests only; steps already made keep their assignees (levels marked `autoSkip`, used by
  vacancy approval, are worked out again as the set-up changes).
- **`file_status`**: `pending` (upload URL issued, object may not exist) → `ready` | `rejected`. **`file_class`**:
  public, internal, personal, sensitive. Deleting sets `deleted_at` (also done by export expiry and erasure).
- **`outbox_status`**: `pending` → `published` (worker took it) | `failed` (at the attempt limit, 5 by default; stays as a dead letter).
  A failed attempt below the limit stays `pending` with a later `available_at`.
- **`actor_type`**: user, impersonated_user, system_job (no `app.user_id`, e.g. workers and triggers fired by jobs),
  device, migration. **`audit_source`**: `api` (service writes, with `diff`), `trigger` (row images from
  `app.audit_row_change` on about 180 money, marks, payroll, purchase and admission tables), `job`, `migration`.
- **`data_subject_requests.status`**: received → in_progress → completed | refused; `kind`: access, correction, erasure,
  grievance; `channel`: parent_app, office, email, letter. Open = received or in_progress; late when `due_on < today`.
- **`breach_log.status`**: open → contained → notified → closed.
- **`cutover_runs.status`**: planned → running → done | aborted; **`cutover_steps.status`**: pending → done | skipped | failed.
- **`hypercare_issues.status`**: open → triaged → in_progress → fixed → verified → closed; `severity` s1–s4. Frozen since
  0056 (live tickets are `parent_queries` with `desk = 'provider'`; `provider_status` keeps these values).
- **`service_keys`**: usable while `status = 'active' AND revoked_at IS NULL`.

## Amounts, dates and counting rules

- **No money in this module** (only `audit_probe.amount`, a test table). Money changes appear inside `audit_logs`
  images: `before ->> 'amount'`, `after ->> 'amount'` are text — cast to `numeric`.
- **Times are `timestamptz`.** Group by the school's day with `(x AT TIME ZONE 'Asia/Kolkata')::date`; the month
  start in IST as a timestamp is `date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`.
  `schools.timezone` defaults to Asia/Kolkata. Dates (`date`): `user_roles.valid_from/valid_to`,
  `school_settings.valid_from/valid_to`, `data_subject_requests.received_on/due_on`.
- **`audit_logs`**: always bound `occurred_at` (a range lets the planner skip whole monthly partitions). Rows are
  append-only, so counts never change after the fact. One business action can write several rows (an API row plus
  trigger rows of the tables it touched, all with the same `request_id`) — count distinct `request_id` for "actions".
- **`diff`** is filled only on API rows that have both `before` and `after` as objects: `{field: {from, to}}` of the
  changed top-level fields. Trigger rows have `diff` NULL: compare `before -> key` with `after -> key`. One line
  per changed field, for both kinds of row (last 30 days):

```sql
SELECT (a.occurred_at AT TIME ZONE 'Asia/Kolkata') AS at_ist,
       a.entity_type, a.entity_id, a.action, a.source,
       k.key AS field,
       COALESCE(a.diff -> k.key -> 'from', a.before -> k.key) AS old_value,
       COALESCE(a.diff -> k.key -> 'to',   a.after  -> k.key) AS new_value,
       COALESCE(u.display_name, a.actor_type::text) AS actor
  FROM audit_logs a
  CROSS JOIN LATERAL jsonb_object_keys(
         CASE WHEN jsonb_typeof(COALESCE(a.diff, a.after)) = 'object'
              THEN COALESCE(a.diff, a.after) ELSE '{}'::jsonb END) AS k(key)
  LEFT JOIN users u ON u.id = a.actor_user_id
 WHERE a.school_id = app.current_school_id()
   AND (a.action = 'update' OR a.diff IS NOT NULL)
   AND a.occurred_at >= now() - interval '30 days'
   AND (a.diff IS NOT NULL OR a.before -> k.key IS DISTINCT FROM a.after -> k.key)
   AND k.key NOT IN ('updated_at', 'updated_by')
 ORDER BY a.occurred_at DESC;
```

- **Approval turnaround** = `completed_at - requested_at` on `approved` / `rejected` rows; waiting time of a pending
  request = now − `requested_at` (the whole request) or now − the previous step's `acted_at` (this level).
- **One row per what**: `user_school_memberships` one per (school, user, person_type); `workflow_steps` one per
  (instance, level); `user_role_scopes` one per (grant, scope_type, scope_id); `cutover_steps` one per (run, code);
  `hypercare_issues` one per (school, number); `user_preferences` one per (school, user, key); `roles` unique
  (school_id, code) with NULLs equal (one template per code); `school_settings` has **no** unique key — several
  rows per key, one in force per day.
- **Versions**: `school_settings` (`valid_from`/`valid_to`), `user_roles` (validity plus `revoked_at`). For "as of a
  date" use the same filters with that date instead of today.
- **Distinct people**: count `users.id`, not memberships — one user can be both an employee and a guardian.

## Answering report questions

All sketches assume the app role with `app.school_id` set (see row-level security above).

**1. Who changed this student's record, and what changed? (any record: change `entity_type` and `entity_id`)**

```sql
SELECT (a.occurred_at AT TIME ZONE 'Asia/Kolkata') AS at_ist,
       a.action, a.source, a.actor_type,
       COALESCE(u.display_name, a.actor_type::text) AS actor,
       ib.display_name AS impersonated_by,
       a.permission_code,
       a.diff,
       a.before,
       a.after
  FROM audit_logs a
  LEFT JOIN users u  ON u.id  = a.actor_user_id
  LEFT JOIN users ib ON ib.id = a.impersonated_by
 WHERE a.school_id = app.current_school_id()
   AND a.entity_type = 'students'
   AND a.entity_id = '123'
   AND a.occurred_at >= now() - interval '90 days'
 ORDER BY a.occurred_at DESC;
```

`entity_id` is text. Profile edits come from the API (`diff` filled); money and marks tables also have trigger rows.
For one line per changed field, see the field-by-field query under "Amounts, dates and counting rules".

**2. Fee receipts whose amount or status was edited this month, by whom (crosses into fees)**

```sql
SELECT (a.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS on_day,
       p.receipt_no,
       s.admission_no,
       a.before ->> 'status'             AS status_before,
       a.after  ->> 'status'             AS status_after,
       (a.before ->> 'amount')::numeric  AS amount_before,
       (a.after  ->> 'amount')::numeric  AS amount_after,
       COALESCE(u.display_name, a.actor_type::text) AS changed_by
  FROM audit_logs a
  JOIN fee_payments p ON p.id::text = a.entity_id
  JOIN students s     ON s.id = p.student_id
  LEFT JOIN users u   ON u.id = a.actor_user_id
 WHERE a.school_id = app.current_school_id()
   AND a.source = 'trigger'
   AND a.entity_type = 'fee_payments'
   AND a.action = 'update'
   AND a.occurred_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
   AND (a.before ->> 'status' IS DISTINCT FROM a.after ->> 'status'
        OR a.before ->> 'amount' IS DISTINCT FROM a.after ->> 'amount')
 ORDER BY a.occurred_at DESC;
```

Join on `p.id::text = a.entity_id` (casting `entity_id` to bigint fails on non-numeric ids of other entity types).

**3. How busy was each staff member in the system, month by month?**

```sql
SELECT date_trunc('month', a.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS month,
       u.display_name AS actor,
       count(*) AS actions,
       count(*) FILTER (WHERE a.actor_type = 'impersonated_user') AS while_impersonated,
       count(DISTINCT a.entity_type) AS kinds_of_record
  FROM audit_logs a
  JOIN users u ON u.id = a.actor_user_id
 WHERE a.school_id = app.current_school_id()
   AND a.source = 'api'
   AND a.occurred_at >= now() - interval '6 months'
 GROUP BY 1, 2
 ORDER BY 1 DESC, 3 DESC;
```

`source = 'api'` counts each recorded action once; trigger rows would count every touched row.

**4. Which approvals are waiting, for how long, and with whom?**

```sql
SELECT i.entity_type,
       d.name AS workflow,
       i.id   AS instance_id,
       i.subject,
       st.name AS waiting_level,
       (now() AT TIME ZONE 'Asia/Kolkata')::date - (i.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS days_waiting,
       COALESCE(st.due_at < now(), false) AS overdue,
       (SELECT string_agg(u.display_name, ', ' ORDER BY u.display_name)
          FROM users u WHERE u.id = ANY (st.assignee_user_ids)) AS approvers
  FROM workflow_instances i
  JOIN workflow_definitions d ON d.id = i.definition_id
  JOIN workflow_steps st ON st.instance_id = i.id
                        AND st.level = i.current_level
                        AND st.status = 'pending'
 WHERE i.status = 'pending'
 ORDER BY days_waiting DESC;
```

`assignee_user_ids` includes people added by escalation; delegates who may also act are in `delegations`.

**5. How long do approvals take, per workflow, over the last 90 days?**

```sql
SELECT d.code, d.name, i.status,
       count(*) AS requests,
       round(avg(extract(epoch FROM i.completed_at - i.requested_at) / 3600)::numeric, 1) AS avg_hours,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM i.completed_at - i.requested_at) / 3600))::numeric, 1) AS median_hours
  FROM workflow_instances i
  JOIN workflow_definitions d ON d.id = i.definition_id
 WHERE i.status IN ('approved', 'rejected')
   AND i.completed_at >= now() - interval '90 days'
 GROUP BY d.code, d.name, i.status
 ORDER BY requests DESC;
```

Leave out `cancelled` (not decided). Hours are clock hours, not working hours.

**6. Which approvers have the most requests waiting, and how many are past their time?**

```sql
SELECT u.display_name AS approver,
       count(*) AS waiting,
       count(*) FILTER (WHERE st.due_at < now()) AS overdue,
       min(i.requested_at) AS oldest_request
  FROM workflow_instances i
  JOIN workflow_steps st ON st.instance_id = i.id
                        AND st.level = i.current_level
                        AND st.status = 'pending'
  CROSS JOIN LATERAL unnest(st.assignee_user_ids) AS a(user_id)
  JOIN users u ON u.id = a.user_id
 WHERE i.status = 'pending'
   AND NOT (a.user_id = ANY (st.approved_by))
 GROUP BY u.id, u.display_name
 ORDER BY overdue DESC, waiting DESC;
```

A request with three possible approvers counts once for each of them; `approved_by` drops those who already
approved an "all must approve" level.

**7. Staff leave requests waiting for approval, with the employee (crosses into staff leave and HR)**

```sql
SELECT r.number,
       e.employee_code,
       e.display_name AS employee,
       e.department,
       r.from_date, r.to_date, r.days,
       st.name AS waiting_level,
       (now() AT TIME ZONE 'Asia/Kolkata')::date - (i.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS days_waiting
  FROM staff_leave_requests r
  JOIN employees e          ON e.id = r.employee_id
  JOIN workflow_instances i ON i.id = r.workflow_instance_id AND i.status = 'pending'
  JOIN workflow_steps st    ON st.instance_id = i.id
                           AND st.level = i.current_level
                           AND st.status = 'pending'
 ORDER BY days_waiting DESC;
```

Join through the module's `workflow_instance_id`; a cancellation request rides `cancel_instance_id` instead.
`employees.department` is legacy text (the HR guide explains the department master).

**8. Who holds which role today, and for which sections? (crosses into academics)**

```sql
SELECT u.display_name AS person,
       r.code AS role_code,
       r.name AS role,
       ur.valid_from, ur.valid_to, ur.reason,
       CASE WHEN count(sc.id) = 0 THEN 'no scope rows'
            ELSE string_agg(DISTINCT sc.scope_type::text || ':' || COALESCE(k.code || '-' || cs.name, sc.scope_id::text), ', ')
       END AS scopes
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id AND r.status = 'active' AND r.deleted_at IS NULL
  JOIN users u ON u.id = ur.user_id
  LEFT JOIN user_role_scopes sc ON sc.user_role_id = ur.id
  LEFT JOIN class_sections cs   ON sc.scope_type = 'class_section' AND cs.id = sc.scope_id
  LEFT JOIN classes k           ON k.id = cs.class_id
 WHERE ur.revoked_at IS NULL
   AND ur.valid_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND (ur.valid_to IS NULL OR ur.valid_to >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
 GROUP BY ur.id, u.display_name, r.code, r.name, ur.valid_from, ur.valid_to, ur.reason
 ORDER BY r.code, u.display_name;
```

"No scope rows" means the whole school — except a Class/Subject Teacher grant the system made (`reason` 'employee
onboarded' or 'teacher assignment sync'), which then reaches **no** section.

**9. Who can see student fee ledgers today (by role or by delegation)?**

```sql
SELECT u.id, u.display_name, 'role ' || r.code AS via
  FROM user_roles ur
  JOIN roles r             ON r.id = ur.role_id AND r.status = 'active' AND r.deleted_at IS NULL
  JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_code = 'fees.ledger.view'
  JOIN users u             ON u.id = ur.user_id
 WHERE ur.revoked_at IS NULL
   AND ur.valid_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND (ur.valid_to IS NULL OR ur.valid_to >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
UNION
SELECT u.id, u.display_name, 'delegated by ' || g.display_name
  FROM delegations dl
  JOIN roles r             ON r.id = dl.role_id AND r.status = 'active' AND r.deleted_at IS NULL
  JOIN role_permissions rp ON rp.role_id = dl.role_id AND rp.permission_code = 'fees.ledger.view'
  JOIN users u             ON u.id = dl.to_user_id
  JOIN users g             ON g.id = dl.from_user_id
 WHERE dl.revoked_at IS NULL
   AND now() BETWEEN dl.starts_at AND dl.ends_at
 ORDER BY 2;
```

Swap the permission code. The small employee baseline granted in code is not in the tables.

**10. Sign-ins per day and app over the last 30 days**

```sql
SELECT (le.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS on_day,
       COALESCE(le.detail ->> 'app', 'unknown') AS app,
       le.method,
       count(*) AS sign_ins,
       count(DISTINCT le.user_id) AS people
  FROM login_events le
 WHERE le.school_id = app.current_school_id()
   AND le.outcome = 'success'
   AND le.method <> 'impersonation'
   AND le.occurred_at >= now() - interval '30 days'
 GROUP BY 1, 2, 3
 ORDER BY 1 DESC, 2;
```

The explicit `school_id` filter matters (the policy shows all the caller's schools). Rows older than the retention
setting (default 365 days) are purged.

**11. Which classes have the most parents not using the parent app? (crosses into students and academics)**

```sql
SELECT k.code AS class,
       cs.name AS section,
       count(DISTINCT g.id) AS guardians,
       count(DISTINCT g.id) FILTER (WHERE u.id IS NULL) AS no_login_account,
       count(DISTINCT g.id) FILTER (WHERE u.id IS NOT NULL AND u.last_login_at IS NULL) AS account_never_used
  FROM enrolments e
  JOIN academic_years y    ON y.id = e.academic_year_id AND y.status = 'active'
  JOIN students s          ON s.id = e.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
  JOIN class_sections cs   ON cs.id = e.class_section_id
  JOIN classes k           ON k.id = cs.class_id
  JOIN student_guardians sg ON sg.student_id = s.id
  JOIN guardians g         ON g.id = sg.guardian_id AND g.deleted_at IS NULL
  LEFT JOIN users u        ON u.id = g.user_id AND u.deleted_at IS NULL
 WHERE e.status = 'active'
 GROUP BY k.display_order, k.code, cs.name
 ORDER BY k.display_order, cs.name;
```

A guardian with children in two sections counts in both. `last_login_at` is "last seen", so NULL = never used.

**12. DPDP requests past their due date**

```sql
SELECT r.id, r.kind, r.principal_kind, r.channel, r.status,
       r.received_on, r.due_on,
       (now() AT TIME ZONE 'Asia/Kolkata')::date - r.due_on AS days_overdue,
       h.display_name AS handled_by
  FROM data_subject_requests r
  LEFT JOIN users h ON h.id = r.handled_by
 WHERE r.status IN ('received', 'in_progress')
   AND r.due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date
 ORDER BY r.due_on;
```

Name the person by joining `principal_id` to students / guardians / employees by `principal_kind` — only if the
reader may see personal data.

## Traps

- **Widening policies.** `audit_logs`, `login_events`, `user_school_memberships`, `schools`, `school_groups` and
  `users` can return rows of the caller's _other_ schools. Filter `school_id = app.current_school_id()` (or
  `schools.id = …`) every time; count a school's people through memberships, never `count(*) FROM users`.
- **Running as the migrator** (as `explain.mjs` does, or a local superuser) shows every school. Numbers look plausible
  and are wrong. Report SQL runs as `edupro_app` with context.
- **No context = empty result**, not an error. A report that returns nothing may simply lack `app.school_id`.
- **Definer-only tables** (`mobile_sessions`, `auth_otp_challenges`, `auth_trusted_devices`, `mobile_web_handoffs`,
  `web_hops`, `api_idempotency`, `ai_model_settings`) return zero rows to the app role. "No phones signed in" is not a finding.
- **Audit partitions**: query `audit_logs`, never `audit_logs_202611`. Without an `occurred_at` range the query scans
  every month. `app.archive_audit_partitions` can move partitions older than 84 months into the `archive` schema
  (not deleted; no worker schedules it today).
- **Audit coverage is uneven.** Trigger rows exist only for the ~180 tables with `app.audit_row_change` (money,
  marks, payroll, purchase, admissions, certificates …); other tables are audited only where the API code writes a
  row. Missing audit rows do not prove nothing changed. Trigger images mask only the columns named on that trigger;
  API images mask keys such as aadhaar, pan, bank account, salary, caste, religion, health notes (`***`).
- **One action, many audit rows.** An API call writes its own row and the triggers write one per touched row; count
  distinct `request_id` for actions. `action` names are free text (`insert`/`update`/`delete` for triggers;
  `workflow.step.approved`, `reports.builder.export`, `library.renew` … for the API).
- **`entity_id` is text**: join with `<table>.id::text = a.entity_id`. `entity_type` is not always a table name.
- **`users.last_login_at`** is touched by every request (last seen, not last sign-in); sign-in counts come from
  `login_events` (written when a web app calls sign-in, for success only). `login_events.school_id` is the school
  chosen at sign-in or the user's first membership — a person of two schools may be counted under one.
- **Pending invitations**: `users.oneauth_sub LIKE 'pending:%'` are people invited who never signed in; the mobile
  number is inside that text.
- **Erased people** stay as rows with placeholder names (`Erased user <id>`, `Erased Pupil <id>`); exclude them from
  people counts by `status`/`deleted_at`.
- **Role scopes**: only `class_section` scopes are enforced. "No scope" is school-wide for hand-granted roles but
  _nothing_ for system-made teacher roles. A role code can exist both as a template and as a school role; join
  text role codes (`creator_roles`, `recipient_roles`, `mis_dashboards.roles`) to `roles.code` and de-duplicate.
- **Approvals**: `assignee_user_ids` grows on escalation (original approvers are not separated out; `escalated_to`
  holds the added ones). Steps exist for every level from the start, so "steps pending" overstates the queue: count
  only `level = current_level`. The same `entity_type` can have several definitions and two meanings
  (`hostel_withdrawal` covers the withdrawal and its revoke). Old `gate_pass`, `transport_request`,
  `appointment_request` instances were mass-cancelled in 0113 — do not read them as people's decisions.
- **Approvals outside the engine**: admission registrations, gate passes, transport requests, appointments,
  purchase department approvals keep their own levels; an "all approvals" report from these tables misses them.
- **`school_settings`** keeps several rows per key; read the one in force (`app.setting(key)`), not `LIMIT 1`.
  `value` is jsonb: a string comes back quoted — use `value #>> '{}'` for the bare text.
- **Masters by name**: addresses keep names, so a renamed state no longer matches old records.
- **`files.status = 'pending'`** rows may have no object behind them; `size_bytes` of those is what the browser
  claimed. Storage totals: `status = 'ready' AND deleted_at IS NULL`.
- **`jobs_outbox`** keeps every published job; it is not a queue length. Waiting jobs: `status = 'pending' AND
available_at <= now()`.
- **Legacy and test tables**: `hypercare_*` (frozen, copied into the helpdesk), `cutover_*` (go-live only),
  `audit_probe` (test scratch). Keep them out of school reports.
- **Time zone**: `CURRENT_DATE` and `now()::date` use the database session's time zone, not IST; always convert with
  `AT TIME ZONE 'Asia/Kolkata'`.

## Personal and sensitive data

- **Names and contact details**: `users.display_name`, `users.email`, `users.mobile`, `users.oneauth_sub` (may embed a
  mobile as `pending:<mobile>`); `auth_otp_challenges.sent_to`; `mobile_sessions.device_name`;
  `schools.contact` / `schools.address` (the school's, usually public); `campuses.address`, `campuses.geo`.
- **Network and device traces**: `login_events.ip`, `login_events.user_agent`, `login_events.detail` (legacy user
  name on compat rows); `audit_logs.ip`, `audit_logs.user_agent`; `auth_otp_challenges.ip`, `.user_agent`;
  `auth_trusted_devices.user_agent`.
- **Audit images**: `audit_logs.before`, `audit_logs.after`, `audit_logs.diff` hold whole records — names, mobiles,
  addresses, dates of birth, marks, fee amounts (the most sensitive keys are masked as `***`, personal ones are
  not). Never send them to an AI model; summarise by `action`/`entity_type` instead.
- **Free text about people**: `delegations.reason`, `break_glass_events.reason`, `impersonation_sessions.reason`,
  `workflow_instances.subject` (often a pupil's or employee's name), `workflow_instances.payload`,
  `workflow_steps.note`, `workflow_events.note`, `workflow_instances.cancel_reason`, `data_subject_requests.detail`,
  `data_subject_requests.outcome`, `breach_log.description`, `breach_log.actions`, `hypercare_issues.detail`,
  `hypercare_issues.workaround`, `hypercare_issues.resolution`, `hypercare_updates.body`, `cutover_runs.notes`,
  `cutover_steps.note`, `user_preferences.value`.
- **Files**: `files.original_name` (often a person's name), and every file whose `classification` is `personal` or
  `sensitive` (photos, Aadhaar, medical, bank proofs). Never pass `bucket`/`object_key` on.
- **Secrets — never select**: `auth_otp_challenges.code_hash`, `auth_trusted_devices.token_hash`,
  `mobile_sessions.refresh_hash`, `mobile_sessions.previous_hash`, `mobile_web_handoffs.code_hash`, `web_hops.code_hash`,
  `portal_handoffs.code_hash`, `service_keys.key_hash`, `api_idempotency.body`, `api_idempotency.request_hash`,
  `jobs_outbox.payload` (may carry message bodies and sign-in codes), `jobs_outbox.last_error`, and
  `school_settings.value` of provider or integration keys.
- **DPDP registers** (`data_subject_requests`, `breach_log`): who asked for what about whom — share counts, not rows.
