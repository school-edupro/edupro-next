# 30 · Employee master

Decided with the product owner on 18 Oct 2026, benchmarked on the staff profile of the legacy ERP (the
DPS Noida employee profile: basic, contact, bank, identity, employment, education, languages, work
experience, remarks and transfers). Built in three parts.

## Decisions

- Employee code: **auto, editable**: the prefix most codes use, its highest number plus one
  (DPSN692 → DPSN693); the office may type another; a code already used is refused.
- Quick onboarding: **name, gender, mobile, employee type, department, designation, date of joining**
  (email optional); the rest on the profile, completeness showing what is missing.
- A **staff login** by a tick (on by default) on onboarding and on the profile afterwards.
- **Education, languages, work experience, transfers and remarks** are rows on the profile.
- Every drop-down is a master: Staff setup (departments, designations, employee types) and the profile
  lists (now for students and staff: marital status, nature of appointment, role, pay band, language,
  qualification, education mode; religion, category, blood group, nationality … shared).
- The address follows the student pattern (lines 1–3, city, state, country, PIN), present and
  permanent, with "same as present".

## Part 1 (migrations 0175–0176)

- **Staff setup** (`/masters/staff`): `departments`, `designations` (both with a staff group teaching /
  non-teaching / both) and `employee_types` (with the staff group the ERP reads: teaching, non_teaching,
  contract, visiting). Seeded with the usual Indian school lists plus the department and designation
  texts employees already carried; a school gets them when the master first opens
  (`app.staff_masters_seed`).
- **Field catalogue** `packages/db/src/employee-fields.ts`: 84 fields in 8 sections (basic, contact and
  emergency, address, employment, statutory, identity documents, bank, approvers). Stores: employees
  columns, `employees.address.{present,permanent}`, `employees.profile`, `employees.secure` (Aadhaar,
  PAN, bank account, AES-GCM, masked unless `people.sensitive.view`). Validation is the student
  catalogue's (`normaliseValue`, now typed on the field's shape). The employee type sets
  `employees.employee_type`. Approvers (ACR HOD, L1–L3) are picked by "NAME (CODE)" and kept as ids; an
  employee cannot approve themself. Age and years of service are computed. `employees.completeness`.
- **API** `people/staff`: `GET catalogue` (the student catalogue's shape, so the same field boxes serve),
  `POST onboard` (next code, a posting for the active year, a remark "Onboarded", an optional login in a
  savepoint so a login that cannot be made never undoes the onboarding), `GET/PUT :id/profile`,
  `POST :id/login`, `POST/PUT/DELETE :id/rows/:kind` (education, languages: once each, experience: end
  after start, transfers, remarks: system remarks cannot be changed). A leaving date makes the employee
  inactive with a system remark.
- **Login** `app.employee_create_login` (SECURITY DEFINER): links an account with the same email (or the
  only one with the same mobile), else makes one; staff membership with the employee id; Subject Teacher
  role for teaching, contract and visiting staff.
- **Admin**: `/people/employees/new` (quick onboard, "Complete the profile" / "Onboard another"),
  `/people/employees/:id` with tabs Profile (section tabs, completeness, jump to missing, save only
  what changed), Education, Languages, Experience, Transfers and remarks, Posting and documents; Make a
  staff login; Staff setup in the People menu.
- Test: `apps/api/test/employee-master.e2e-spec.ts`.

## Part 2 (18 Oct 2026, migration 0177): the list like the students list

- **Engine**: the report builder has two datasets, `student_profile` and `employee_profile`
  (`ReportSpec.dataset`, default students). Filters, sort, search and shaping take the dataset's fields
  (`reportDataset()`); `loadEmployeeReportRows` gives one row per employee with every catalogue value plus
  record columns (name, status, staff group, login, completeness worked out from the values, reports to)
  and the rows summed up (highest qualification by the usual order, all qualifications, languages, years
  of experience before joining). Sensitive values masked unless `people.sensitive.view`; approvers by name.
- **API** `people/staff/grid/fields`, `POST people/staff/grid` (columns, filters, sort, search: in every
  employee whatever the status, status active / inactive / all, page; counts: total, active, inactive,
  teaching, non-teaching, no login, profile incomplete), `POST people/staff/grid/export` (an export job on
  the employee dataset, Excel or PDF, the PDF limited to 25 columns on A3).
- **Report builder**: `GET reports/builder/fields?dataset=employee_profile` (needs `people.employee.view`),
  reports saved with their dataset (0177 widens the check), preview and export load the dataset's rows;
  the worker builds employee files. "New employee report" on the builder; a report opens with its own
  dataset's fields.
- **Admin** `/people/employees`: the students list's screen for staff: status, quick filters (staff group,
  employee type, department, designation, gender, staff login), search by name, code, mobile or email,
  More filters (any field), Columns (choose, order, rename; saved per user as `employees.list`), sortable
  headers, pages, Export Excel / PDF, Save as report, Staff setup and Onboard.

## Part 3 (18 Oct 2026): Excel upload

- **API** `people/staff/bulk`: `GET template?mode=update|create&fields=&includeInactive=` (Instructions,
  hidden Lists for the drop-downs, the Employees sheet; update pre-filled by employee code with the
  current values and approvers by code, never the Aadhaar / PAN / account; create: the onboarding
  columns first marked *, a "Create staff login (Yes/No)" column), `POST bulk/validate` (by label or key;
  the student rules: blank = no change, CLEAR empties, a masked number leaves it; create: a blank code
  gets the next free number, a used code refused, the onboarding fields needed; every value checked by
  the catalogue, approvers by code; old → new preview with IDs masked; kept in `master_imports` as
  `employee_profile_update` / `employee_profile_create`), `GET bulk/:id`, `POST bulk/:id/commit` (once,
  within a day; each row in a savepoint; new employees get the posting of the year, a remark
  "Onboarded (Excel upload)" and, when asked, a staff login in its own savepoint; a leaving date makes
  inactive), `GET bulk` (recent), `GET bulk/:id/result` (every row's outcome as Excel).
- **Admin** `/people/employees/bulk` (tabs Update existing / Add new; choose columns by section; upload
  .xlsx or .csv; check; Apply with a confirmation; result file), "Excel upload" on the employee list.
  The older CSV import (People → Bulk import) now takes students only and points employees here (its
  API is unchanged).
- Tests: the part 3 cases of `apps/api/test/employee-master.e2e-spec.ts` (templates, create with next
  codes and logins, errors by cell, commit once, update old → new, CLEAR, masked numbers).
