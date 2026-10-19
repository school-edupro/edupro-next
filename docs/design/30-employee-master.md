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

## Follow-up (18 Oct 2026, migration 0178)

- The staff drop-downs (MaritalStatus, NatureOfAppointment, StaffRole, PayBand, Language, Qualification,
  EducationMode) are rows of the profile lists master for every school (`app.staff_profile_lists_seed`,
  also run when the employee pages first open), so they are seen and edited in System setup → Profile
  lists (students and staff), `/masters/system?tab=profile_lists&q=<List>`; a list a school already
  filled is left as it is.
- Each drop-down on the employee form says where its list is kept (Profile lists, Staff setup,
  System setup cities / states / countries, Fees setup banks).
- (migration 0179) Profile lists no longer keep Country, State or City: those are the System setup
  masters Countries, States and Cities (the forms read them first; a school without them falls back to
  the built-in country and state lists in code). The old rows are removed and the list codes are no
  longer offered.

## Teaching subjects, documents, posting lists (18 Oct 2026, migrations 0180–0181)

- **Teaching subjects**: several per employee from Academics → Subjects (`employee_subjects`; the free
  text field is retired, its values matched to subjects by name or code). Profile tab card; list column
  and filter "Teaching subjects".
- **Employee document types** (Staff setup): the school's list, each required for all / teaching /
  non_teaching staff or none, and whether it expires; seeded with 20 usual types (photo, Aadhaar, PAN,
  resume, 10th, 12th, graduation, B.Ed./D.El.Ed., TET, experience, relieving, appointment, joining,
  police verification, medical fitness, bank proof, address proof …). Teaching or not comes from the
  department's staff group, else the employee type's (`app.employee_staff_side`);
  `app.employee_documents_due` gives each type with required / on file / valid (not expired).
- **Documents tab**: every type with Missing / On file / Expired, the files with View / Download icons,
  number and validity, "Mark checked" against the original (by whom), Remove; Upload a PDF or image
  (5 MB) per type, the validity date needed when the type expires. The file becomes the employee's
  (`files.owner_entity`), served only through its employee (`GET people/staff/:id/documents/:doc/file`,
  `people.document.view`). List columns "Required documents missing" and "Documents" (Complete /
  Pending).
- **Posting**: department and designation are the Staff setup lists (a value from before stays shown).
- **Profile PDF** (renderer `employee_profile`, `POST people/staff/:id/print`): A4 on the letterhead —
  photo and key facts (code, type, designation, department, joining, service, birth, contact, campus,
  reports to), every section with the filled fields that apply, teaching subjects, education, languages,
  experience, transfers, the documents for employment (required / on file / checked), declaration and
  signature lines (employee, HR, Principal); Aadhaar / PAN / account masked unless the requester holds
  `people.sensitive.view` today (checked by the worker). "Profile PDF" on the employee page waits for it:
  View (to print) and Download. Test: `apps/workers/test/employee-profile.test.ts`.

## Staff transfers (18 Oct 2026, migration 0182)

- **Within the school** (`POST people/staff/:id/campus-move`): another campus from a date, optionally a
  new department / designation; the active year's posting changes, a transfer row (campus → campus) and
  a remark are added.
- **To another school of the group** (Alpha → Beta), as for students (0049): the source sends a request
  (`POST people/staff/:id/transfer`; date, order number, note) to a school from `app.transfer_targets()`;
  one open request per employee. The request carries a snapshot (profile values with ID numbers
  encrypted, education, languages, experience, transfers, documents with type code and file, photo,
  subjects, login). `employee_school_transfers` is seen by both schools (RLS).
- **The target accepts** (People → Staff transfers, `people.staff_transfer.manage`): its own code (next
  code offered), department, designation, staff type and campus. The employee is created there keeping
  the joining date; rows, subjects (by name), documents (by type code, file bytes copied) and photo are
  copied; values the target's lists do not hold are listed as "left to fill"; the login gets a staff
  membership at the target. `app.employee_transfer_close_source` (owner's rights) closes the source:
  left on the date (inactive once the date has passed), leaving reason, transfer row, remark, membership
  ended. The target may turn it down, the source may cancel, each with a reason. Test:
  `apps/api/test/employee-transfer.e2e-spec.ts`.

## The employee's page rebuilt like the student's (19 Oct 2026, 0188)

Asked for: the page showed no photo; rebuild it as the student profile, the benchmark being the best
school ERPs (a hero with the photo, the facts at a glance, completeness, the actions, then tabs).

- **Hero** (`components/employees/EmployeeHero.tsx`): the photo (`/api/files/:id/view`) or initials,
  **Add / Change photo** for `people.employee.edit` (`uploadEmployeePhoto` → `POST
people/employees/:id/documents` with kind `photo`, which sets `employees.photo_file_id`), name,
  status and login badges, code · staff type · designation, department; facts (date of birth and age,
  gender, blood group, joined on and years of service, nature of appointment, campus, reports to,
  teaches); who to call (mobile, email, emergency contact, tap-to-call); the completeness meter; the
  actions: Edit full profile, Profile PDF, ID card, Make a staff login, Open as… (0188).
- **Tabs** with counts: Overview (new, the default), Profile (the full editor and teaching subjects),
  Education, Languages, Experience, Transfers and remarks, Documents (missing count), Posting, ACR.
  The list's row menu: Open, Edit full profile, …, Open an app as them….
- **Overview** (`EmployeeOverview.tsx`): posting (with direct reports), documents for employment
  (missing / expired named), education and work in short, then every profile section as a card with
  the filled fields and the required empty ones named, each with Edit to the Profile tab; approvers
  for those who may see ACRs.
- **The employee's own photo** (decision: HR sets it on the page; the employee may ask for a change
  from My profile with approval): see docs/design/33, "My photo".

## Training records (19 Oct 2026, 0188)

The legacy "Add Training Detail" (training date, topic, venue, duration, name of organisation, date
of entry) is a row list like education and work experience: `employee_training` (migration 0188),
the `training` kind in `EMPLOYEE_LISTS` / `EMPLOYEE_ROW_SCHEMAS`, the **Training** tab on the
employee's page (table, add, remove; the overview names the latest), the profile PDF, the transfer
snapshot, and on My profile under the staff profile policy (`list:training`, default with approval;
usual proof a training certificate). Date of entry defaults to the day the row is added.
