# RBAC permission catalogue (foundation and reference module)

Permission codes are `module.resource.action`. The catalogue is generated from `@RequirePermission()` decorators at API start; this document is the human-readable design for the foundation sprints and the first module roles. Codes marked MFA require step-up.

## 1. Permissions

| Code | Description | MFA |
|---|---|---|
| `platform.school.view` | View school profile and campuses | |
| `platform.school.manage` | Edit school profile, campuses, branding | |
| `platform.year.view` | View academic and financial years | |
| `platform.year.manage` | Create years, set active, edit dates | |
| `platform.year.lock` | Lock a stage (attendance, exams, fees) or close a year | Yes |
| `platform.year.reopen` | Reopen a locked stage | Yes |
| `platform.year.rollover` | Run the rollover wizard | Yes |
| `platform.settings.view` | View school settings | |
| `platform.settings.edit` | Edit school settings | |
| `platform.audit.view` | View audit logs for the school | |
| `platform.audit.export` | Export audit logs | Yes |
| `platform.files.upload` | Obtain signed upload URLs | |
| `access.role.view` | View roles and their permissions | |
| `access.role.manage` | Create and edit school roles | |
| `access.assignment.view` | View who holds which role | |
| `access.assignment.manage` | Grant and revoke roles and scopes | Yes |
| `access.delegation.create` | Delegate an own role for a period | |
| `access.delegation.manage` | Manage any delegation in the school | |
| `access.session.impersonate` | Start an impersonation session | Yes |
| `access.membership.manage` | Invite users to the school, deactivate memberships | Yes |
| `academics.class.view` | View classes | |
| `academics.class.create` | Create a class | |
| `academics.class.edit` | Edit a class | |
| `academics.class.delete` | Soft-delete a class | |
| `academics.class_section.view` | View sections (scope: class_section) | |
| `academics.class_section.create` | Create a section in the working year | |
| `academics.class_section.edit` | Edit a section | |
| `academics.class_section.delete` | Soft-delete a section | |

## 2. System role templates (seeded, `school_id IS NULL`)

| Role | Kind | Permissions |
|---|---|---|
| Group Admin | global | all `platform.*`, all `access.*`, every module's `*.view`; must be granted per school (a group admin is a member of every school in the group) |
| School Admin | global | `platform.*` except `platform.year.rollover`, `access.*` except `access.session.impersonate`, all module permissions of the school |
| Auditor | global | every `*.view`, `platform.audit.view`, `platform.audit.export`; no write permission may be added (enforced by `roles.kind = 'global'` and `is_system`) |
| Support Engineer | global | `platform.*.view`, `access.*.view`, time-boxed by `valid_to`; no PII export permissions |
| Academic Coordinator | module | `academics.*` |
| Class Teacher | module | `academics.class.view`, `academics.class_section.view` (scoped), attendance and daily-work permissions when those modules arrive |
| Subject Teacher | module | `academics.class.view`, `academics.class_section.view` (scoped by subject), marks permissions later |
| Parent | global | parent portal permissions (added in Sprint 9) |
| Student | global | student portal permissions (added in Sprint 9) |

## 3. Segregation of duties (seeded templates)

| Permission A | Permission B | Reason |
|---|---|---|
| `access.assignment.manage` | `platform.audit.export` | A person who grants roles must not be able to remove the evidence trail |
| `fees.receipt.create` | `fees.receipt.reverse` | Cashier cannot reverse own receipts (fees module, Sprint 13) |
| `payroll.run.compute` | `payroll.run.approve` | Maker and checker (payroll module, Sprint 25) |
| `exams.marks.enter` | `exams.marks.unlock` | Entry and unlock separated (exams module, Sprint 15) |

## 4. Scopes

| Scope type | Applies to | Source of truth |
|---|---|---|
| `class_section` | Class Teacher, Subject Teacher assignments | `teacher_assignments` when the academics module lands; until then set directly on the assignment |
| `subject` | Subject Teacher | same |
| `department` | HR roles | `employee_postings` |
| `route` | Transport staff | `routes` |
| `campus` | Campus-limited admins | `campuses` |

## 5. Legacy mapping (for the ETL in Sprint 4)

| Legacy | Target |
|---|---|
| `user_menu_master` rows per employee | one `user_roles` row per matching module role, chosen by the cluster of `ApplicationName` values (Fees cluster -> Fee Cashier or Fee Manager by presence of setup pages; EANDE cluster -> Exam Coordinator; HRM cluster -> HR Manager; Admin_panel cluster -> School Admin) |
| `admin.suser = 'Admin'` | Group Admin membership in every school of the group |
| `teacher_class_mapping.teacher_type = 'classteacher'` with `is_true = 1` | Class Teacher role with `class_section` scopes |
| `teacher_class_mapping.teacher_type = 'subjectteacher'` | Subject Teacher role with `subject` and `class_section` scopes |
| `classcoordinator`, `coordinator` | Academic Coordinator role scoped to the mapped classes |
| `student_edit` flags | `people.student.edit`, `people.student.delete`, `people.student.export`, `admissions.application.edit`, `admissions.application.approve` |
| `library_employee_permission`, `dashboard_employee_permission`, `employee_access` | Librarian role, `reports.dashboard.view`, module roles respectively |
| `campus_role` | `campus` scope on the relevant assignments |
| `tbl_module_settings.admin_bypass_userids` | dropped; the named users receive the explicit permission |
