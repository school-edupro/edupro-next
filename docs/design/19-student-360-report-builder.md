# 19. Student 360 profile and report builder

Post-freeze change, 2026-09-30. Commits `6acc9b8` (A), `3dfb269` (B), `d3c1f67` (family requests),
`7a6945a` (C), `d622d11` (D), `b980508` (E) and the phase F commit (legacy workbook and docs).

## Why

The school's data collection sheet (`Student_Information_Collection.xlsx`, Field Guide tab) defines
about 190 fields in 14 sections. EduPro stored a fraction of them, had no editor for the rest, no
bulk update by admission number, and no saved or shared custom reports. The legacy PHP builder
(`Admin/StudentManagement/student_report_builder.php`) saved column templates per year and exported
a bare CSV.

Decisions taken with the school (2026-09-30): the School / Branch field is dropped; Aadhaar, PAN
and bank account numbers are encrypted and masked, full values only for users the admin grants the
Sensitive data viewer role; drop-down lists are school-editable masters; one guardian record is
shared by siblings; PDF holds 15 columns on A4 and 25 on A3.

## Model

- **Catalogue**: `packages/db/src/student-fields.ts`, generated from the Field Guide. 188 fields,
  each with section, label, type, required flag, list code, show-when rule, sensitivity and storage.
  Keys are stable; never rename a key that holds data.
- **Storage** (migration 0036):
  - core columns stay (first and last name, date of birth, gender, blood group, category, admission
    date and number);
  - residential address in `students.address`;
  - everything else in `students.profile` and `guardians.profile` (JSONB, validated by the catalogue);
  - sensitive values in `students.secure` and `guardians.secure`, AES-256-GCM
    (`field-crypto.ts`, key `FIELD_ENCRYPTION_KEY`, required in production);
  - `students.profile_completeness` (0 to 100) for lists and filters.
- **Lists**: `profile_lists` master (list code, value, order), seeded from the Lists tab; State and
  Country also accept the geography masters. A school without rows falls back to the defaults.
- **Rules**: `student-profile.ts` parses DD-MM-YYYY dates, normalises mobiles, PAN, IFSC, matches list
  values case-insensitively, computes age as on 31 March of the session's start and staff ward.
- **Read and write**: `student-profile-store.ts`. The batch reader loads any number of students in
  three queries. The writer merges only the keys sent, creates and links the father, mother or
  guardian record on first use, and treats a masked value sent back as "unchanged".

## Surfaces

| Surface                         | Where                                                                   |
| ------------------------------- | ----------------------------------------------------------------------- |
| Quick add                       | `/people/students/quick-add`, `POST people/profile/quick-add`           |
| Full profile editor             | `/people/students/:id/profile`, `GET/PATCH people/students/:id/profile` |
| Bulk update / create from Excel | `/people/students/bulk`, `people/profile/bulk/*`                        |
| Family change requests          | parent app Profile, `engagement/change-requests` entity `profile`       |
| Lists master                    | `/masters/system?tab=profile_lists`                                     |
| Report builder                  | `/reports/builder`, `reports/builder/*`                                 |

## Report builder

- Definitions in `report_definitions` (spec JSONB: columns with custom headers, filters, sort,
  options), shares in `report_shares` (user or role, view or edit), migration 0038.
- Access: owner, shared user, shared role, or `reports.builder.manage`. Only the owner or a manager
  shares or deletes. Running needs `people.student.view`; class-section scope applies to the runner.
- Rows: `packages/db/src/report-builder.ts` loads the profile values plus class-section, status,
  completeness, fee group, student type, fee discount, transport route and stop, then filters and
  sorts on resolved values (so any field, whatever its storage, can be filtered).
- Exports: dataset `report_builder` in the export pipeline. The worker
  (`apps/workers/src/renderers/report-builder.ts`) writes the letterhead into Excel (header block,
  frozen filterable header, print titles, paper, orientation, page footer) and PDF (repeated header
  row, page x of y). An export with full ID numbers opens only for its requester or a sensitive-data
  viewer.

## Bulk upload

The template carries an Instructions sheet and a hidden Lists sheet for drop-downs. The check step
stores validated rows in `master_imports` (sensitive values encrypted), shows old → new per field,
and reports each bad cell. Commit applies each row in a savepoint and audits per student. The reader
also accepts the data collection workbook as it is: the header row is found by "Admission No",
S.No-only rows are skipped, separate Class and Section columns are matched, and unused columns are
reported with the reason. Re-saved workbooks whose cell notes break exceljs are retried without the
notes.

## Tests

- API e2e: `student-profile.e2e-spec.ts` (13), `report-builder.e2e-spec.ts` (6).
- Worker: `report-builder.test.ts` (letterhead, logo, IST time, print setup).
- Accessibility (axe): quick add, full profile tabs, bulk pages, lists master, builder list, new and
  saved report with preview.

## Open points

- The legacy workbook dry run (2026-09-30) found 114 rows, none ready: 100 lack caste category and
  day scholar or hosteller, 76 are registrations without an admission number, a few mobiles are
  invalid, and the target school's classes and sections must exist first. Report:
  `~/Documents/student_data/Student_Import_Check_2026-09-30.xlsx`.
- Fee ledger and attendance columns in the builder are the next step (the dataset list allows more
  than `student_profile`).
