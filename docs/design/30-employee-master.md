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

## Part 2 (next): the list like the students list

Status tabs, quick and more filters over the catalogue, column show / hide and order saved per user
(`/me/preferences/employees.list`), Excel / PDF export, "Save as report" (an `employee_profile` dataset
in the report builder), pagination.

## Part 3 (next): Excel upload

Template from the catalogue, validate (row errors), commit; create or update by code; replaces the CSV
import for employees.
