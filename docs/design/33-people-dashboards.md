# 33 · Student and employee dashboards; employee self-service profile

Benchmarked on Entab, Fedena, Teachmint and PowerSchool: strength and movement first, then today, then the
health of the records (what is missing, what waits for approval).

## Decisions (18 Oct 2026)

- Two dashboards, one per menu: People → **Student dashboard**, Employee management → **Employee
  dashboard**; figures first (rows of four), then tables, then small charts.
- Students: strength (by class, boys / girls, category, day scholar / hosteller, new / continuing, EWS),
  movement (admitted in the year and month, withdrawn, TCs, transfers in / out), today (sections marked,
  present / absent / short leave, birthdays), records (average completeness, below 80%, no photo, no Aadhaar,
  profile changes to approve). A class teacher sees their own sections.
- Employees: strength (teaching / non-teaching, department, designation, type, gender, no login), movement
  (joined / left, transfers, probation ending in 30 days, reaching 60 in 12 months), today (punched in, late
  after the ACR "late after" time, activity logs, birthdays and work anniversaries), records and HR (average
  completeness, required documents missing, documents expiring in 30 days, profile changes to approve, ACR of
  the latest cycle).
- Employees see their own profile in the staff app and download it as PDF with their own ID numbers in full.
- Employees ask for profile changes the way families do for students (0041): the school sets per field
  hidden / view / change with approval / change at once, proofs (its employee document types), the update
  window, and approvers (HOD or L1/L2 from the record, HR, a role, a named person; up to two steps).

## Built

- Part 1 (dashboards): `GET people/dashboard/students?class=`, `GET people/dashboard/staff?department=`
  (`people-dashboard.service.ts`); admin `/people/dashboard`, `/people/staff-dashboard`. Migration **0186**
  adds the employee self-service tables (`employee_portal_policies`, `employee_change_requests`,
  `employee_change_actions`) and rights (`people.staff_profile.manage`, `people.staff_change.approve`,
  `people.staff_change.override`). Test: `apps/api/test/people-dashboard.e2e-spec.ts`.
- Part 2 (employee self-service): `packages/db/src/employee-portal.ts` (levels, office-only keys: code,
  machine id, official email, employment, approvers; defaults: personal / contact / address / IDs / bank
  change with approval, statutory shown); API `employee-self.service.ts`:
  - staff: `GET me/employee-profile`, `POST me/employee-profile/changes`,
    `POST me/employee-change-requests/:id/cancel`, `POST me/employee-profile/print` (own copy, ID numbers
    in full, hidden fields left out; the worker checks it is the requester's own record), `GET me/exports/:id`;
  - school: `GET/PUT people/staff-profile/policy` (`people.staff_profile.manage`);
  - approvers: `GET people/staff-profile-approvals` (mine / all / decided), `POST …/:id/decide` (field by
    field; a reason when refusing; the last step or an override applies; stale check), `POST …/bulk`,
    `GET …/:id/proofs/:fileId`. Open to any signed-in user: the HOD / L1 / L2 from the record decide what
    is routed to them; HR (`people.employee.edit`) and override holders see all. Accepted proofs become
    the employee's documents.
- Admin: Employee management → **Staff profile approvals**, **Staff profile settings** (fields and
  documents, approvers with up to two steps per section, update window).
- Staff app: Office → **My profile** (sections, update per section with proofs, my requests with
  withdraw, Download PDF) and **Profile changes to approve** (shown when something waits on me).
- Test: `apps/api/test/employee-self.e2e-spec.ts`.
- Admin app (19 Oct 2026): the same **My profile** for staff who work in the admin app: Employee
  management → My profile (`/me/profile`, `/me/profile/edit?section=`), shown to every login linked to an
  employee record; the header name opens it. Same API (`me/employee-profile`, changes with proofs, print,
  `me/exports/:id` through `/me/exports/:id/file`), same rules; a login without an employee record sees a
  notice instead. Approvals stay under Employee management → Staff profile approvals.
- **Lists on My profile (19 Oct 2026, 0187):** education, languages, work experience and documents are
  sections of My profile in both apps. Staff profile settings → Fields and documents gets "Lists staff may
  update" (level per list: not shown / shown / change with approval / change at once; the document a change
  must carry), and Approvers lets each list have its own approvers (`approval.sections['list:<kind>']`).
  A row change is one key in the same `employee_change_requests` (`list:<kind>:<op>:<row>`, op add / edit /
  remove, `from` and `to` are the row as a JSON object); the API summarises rows as one line for the
  approval screens and the request lists, so those screens did not change. Edits and removals of a row
  already waiting are refused; a document is replaced by removing it and adding the new file. An approved
  document is filed on the record unverified: HR still ticks it against the original. The profile PDF
  already prints the four lists. Decisions: add, edit and remove with approval; approval never verifies.

## My photo (19 Oct 2026, 0188)

- **Policy:** `EmployeePortalPolicy.photo` = `view` (the office changes it) | `edit_approval`
  (default) | `edit_direct`; stored as `fields.photo` in `employee_portal_policies`, approvers under
  `approval.sections.photo` (else the default route). Staff profile settings → Fields → "Lists staff
  may update" has the Photo row; Approvers has "Photo".
- **The employee** (My profile, both apps, `MyPhoto.tsx`): the photo on file, a new one waiting
  (thumbnail, "Waiting for approval: new photo"), and "Send for approval" / "Change photo" with a
  JPG, PNG or WebP up to 5 MB. `POST me/employee-profile/changes { photo: fileId }`: the employee's own
  ready image upload only; one change at a time; `changes.photo = {from, to}` (file ids). Approved (or
  at once): `employees.photo_file_id` and a `person_documents` row of kind `photo`, as the office's
  upload would leave. Stale when the office changed the photo meanwhile.
- **Showing it:** staff hold no file right, so `GET me/employee-profile/photo[?file=]` gives the signed
  address of the photo on file or of the employee's own waiting upload; the apps pass the bytes through
  (`/api/me/photo` in admin, `/api/my-photo` in the staff app). Approvers see both pictures on the
  approval card through the request (`…/proofs/:fileId` accepts the request's photo ids).
- **Test:** `employee-self.e2e-spec.ts` "photo (0188)".

### Files are never named on screen (19 Oct 2026)

Document rows on My profile, their pending additions, the request lines and the approval cards show
the file as a **View** icon only (the admin's `/api/me/file/:id` and `/api/staff-proofs/:req/:file`
routes, the staff app's `/api/my-file/:id`), never the uploaded file's name; the row summary carries
the type, number and dates. `GET me/employee-profile/files/:fileId` gives a staff member the signed
address of a document on their record, their photo or an upload of theirs; an approver opens a document
row's file through the request's proofs endpoint.
