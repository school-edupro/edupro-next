# 13 · Master-data framework

Every master a school maintains — fee heads, the month-to-instalment mapping, transport slabs,
discounts, banks, classes, sections, subjects, timetable periods, holidays, routes, stops, vehicles,
drivers, exam types, grade scales and bands, indicator sets and indicators, the remark bank, message
templates, groups, query categories, campuses — gets the same screen and the same abilities, in the
legacy "Fees Setup" shape the office already knows, in Mobilise tokens:

- **Records per page**, **Add / Edit**, **Clone from year** (year-bound masters), **Bulk update**
  (one column on ticked rows), **Filter** (search and status), **Excel** and **PDF** (and CSV through
  the export centre), **Upload Excel** with a downloadable template, a dry run and a commit.
- "Showing 1 to 50 of 240 records (page 1 of 5)", S.No, an edit icon and an activate / deactivate
  icon per row.

## 1. Registry, not screens

`packages/db/src/masters.ts` holds one **definition** per master: table, group, view and manage
permissions, whether rows belong to an academic year, the natural key and its ON CONFLICT target,
the fields (type, required, identity, options, ref lookup, bulk-updatable, array) and the ordering.
From that one definition come:

| Ability     | Where                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grid        | `GET /masters/:master/rows?page&size&q&status&filters[...]` — the list SELECT is generated (refs joined to show their code)                                                                                                    |
| Export      | every master is also a dataset `master_<id>` → `POST /reports/exports` with `xlsx`, `csv` or `pdf`, rendered by the workers like any report                                                                                    |
| Template    | `GET /masters/:master/template` — an .xlsx with the accepted headers, a sample row and a Notes sheet with the rules                                                                                                            |
| Upload      | `POST /masters/:master/imports/validate` (xlsx base64 or CSV text) → report by row and column, stored in `master_imports`; `POST /masters/:master/imports/:id/commit` replays the validated rows as upserts on the natural key |
| Add / edit  | `POST /masters/:master/rows` — the grid form goes through the same field rules as an upload row                                                                                                                                |
| Status      | `PUT /masters/:master/rows/:id/status` — masters are never deleted from the grid                                                                                                                                               |
| Bulk update | `POST /masters/:master/bulk` — one bulk-marked column on many ids                                                                                                                                                              |
| Clone       | `POST /masters/:master/clone` — year-bound masters copy into another year, skipping keys that exist (dates and the year shift for periods and holidays)                                                                        |

Rules of the upload: headers match by text or key, case- and punctuation-insensitive; refs are given
as codes (class code, route code, scale code) and resolved inside the school; a **blank optional cell
leaves the column alone** (defaults on insert, the current value on update); duplicates within the
file are rejected; a table constraint the rules did not cover (a CHECK across columns) refuses the row
with a 400, never a 500; at most 5,000 rows and 4 MB per file; nothing is ever deleted by an upload.

## 2. School and year

Every master table carries `school_id` with row-level security; every route runs under the caller's
tenant, so a school only ever reads and writes its own masters (the e2e spec proves the cross-school
cases: rows, upload commits and exports). Year-bound masters (periods, slabs, discounts, sections,
holidays) work within the academic year chosen in the header; the clone is the way to prepare the
next year.

## 3. Permissions

No new permission: each master names the existing pair of its module (`fees.master.view / manage`,
`academics.class.view / edit`, `transport.route.view / manage`, `exams.master.view / manage`,
`comms.template.view / manage`, `platform.school.view / campus.manage` …). The routes are
`@AuthenticatedOnly()`; the guard loads the effective permissions and the service checks the entry's
own permission, so the registry view a caller gets is already filtered to what they may see and
manage. Query categories use `engagement.query.view` to see and `platform.settings.edit` to manage.

## 4. Admin

`/masters/{fees|academics|transport|exams|communication|system}` — one page per group with a tab per
master, reached from each module's menu as "… setup". The screen is server-rendered with forms
(progressive enhancement, no client state); the bulk form is detached from the grid through the
`form` attribute so a row's status toggle can be its own form. Column headers come from the registry
(English); the chrome is bilingual.

The earlier purpose-built screens stay for what needs domain logic beyond a row: fee structures per
class, period generation, grade scale editing with bands, route stops with students, RFID devices
(a device needs a key issued), workflow definitions, roles and years.

## 5. Out of scope, recorded

Payment modes are an enum on receipts (cash, cheque, DD, online, bank), not a master; houses and
categories are free text on students (the student import carries them); RFID devices, workflow
definitions, roles, settings and years keep their own screens; Hindi column headers for masters.
