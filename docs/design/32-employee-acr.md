# 32 · Employee ACR (annual confidential report)

Rebuilds the earlier ERP's ACR (self-appraisal → HOD → Principal, teaching and non-teaching forms) as a real
cycle with statuses, server-side rules and disclosure, benchmarked on the government APAR (KVS, CBSE
schools) and HR suites (Darwinbox, Keka).

## What the earlier ERP did (studied, no data copied)

- Keyed on employee + financial year; a window (start/end) checked only on the pages.
- Teaching: self-appraisal in steps (basic, education, experience, training, documents), 8–10 self-ratings
  (1–5); HOD rated a question bank (7 categories, 6-point scale) and wrote 5 remarks; Principal gave a
  remark category, a remark and agree / partly / disagree with the HOD.
- Non-teaching: 12 self-ratings and 5 text sections; HOD rated 21 parameters (5-point); Principal two
  remarks.
- Locks: the employee's form locked once the HOD rated, the HOD's once the Principal finished (in the
  page only). No send-back, no grade, no disclosure to the employee; 4 of 10 teaching self-ratings were
  never saved; status guessed from which rows existed.

## Decisions (18 Oct 2026)

- **Levels are configurable** per staff group (teaching / non-teaching), like other approval levels: as many
  as the school wants (up to 6), each filled by the employee's own **ACR HOD** or **L1/L2/L3 approver**
  (from the employee record), or by a **role**, a **designation** or a **named person**; each level either
  **rates** (the rating questions and remarks) or **reviews** (grade, agree / partly / disagree, remarks).
  Start: HOD (ACR HOD, rates) → Principal (designation, reviews).
- **Scoring:** weighted ratings → score % → grade by bands (start: ≥90 Outstanding, 75 Very good, 60
  Good, 45 Average, <45 Below average; the last two adverse). A reviewing level may change the grade with a
  reason.
- **Disclosure:** once all levels are done the employee sees the ACR, acknowledges it, and may object
  within N days (start 15) when the grade is adverse; the school decides (upheld / revised).
- **Self-appraisal fills itself** from the school's records: leave and late arrivals (staff punches),
  results of the classes taught (exam results), education / experience / training / documents (employee
  profile), and the daily activity log summary.

## Part 1 — set-up (migration 0184, built)

- Tables: `acr_settings` (rating words, days to object), `acr_grade_bands`, `acr_levels`,
  `acr_questions` (part self / rate; teaching / non-teaching / both; section, scale or text, weight,
  required, order, on/off), `acr_cycles` (year, self-appraisal window, reviews-by date, draft / open /
  closed), and for part 2 `acr_reports`, `acr_reviews`, `acr_events`.
- `app.acr_seed` gives a school the starting levels, grades and the earlier forms' questions (no data).
- Rights: `people.acr.manage`, `people.acr.view` (School Admin, Group Admin).
- API `people/acr/setup` (+ `/settings`, `/levels`, `/questions`), `people/acr/cycles`.
- Admin: Employee management → **ACR set-up** with tabs Cycles, Approval levels, Questions, Scale and
  grades. Test: `apps/api/test/acr.e2e-spec.ts`.

## Part 2 — the flow (migration 0185, built)

- **Start a cycle** (`POST people/acr/cycles/:id/start`): an ACR for every active employee who has none
  (run again for later joiners); teaching or non-teaching from the department / employee type (contract
  staff of a mixed department: teaching when they have classes that year); each level's people resolved
  (ACR HOD / L1–L3 from the record, role, designation, named person; never the employee). Levels left with
  nobody are listed; the school fills them (`PUT reports/:id/levels/:seq/people`).
- **Self-appraisal** (`PUT reports/:id/self`, `POST …/self/submit`): only the employee, only inside the
  window (or after being sent back), every required answer, ratings within the scale. On submit the
  school's facts are kept with it: days present and late arrivals (staff punches after the "late after"
  time, set in Scale and grades), results of the sections taught (latest exam: students, average, pass %
  at 33, distinctions at 75), education / experience / documents, the activity log. The office enters
  the leave taken (`PUT reports/:id/office`).
- **Levels** (`PUT/POST reports/:id/levels/:seq[/submit]`): only that level's people, only at its turn.
  A rating level answers the rating questions (weighted score % → grade); a review level gives a grade
  (a different one from the level before needs a reason), agree / partly / disagree and remarks.
  `POST reports/:id/send-back` (with a reason) returns it one step, to the employee from level 1.
- **After the last level** the ACR is shown to the employee (score of the last rating level, grade of the
  last level, adverse from the bands, days to object counted). The employee acknowledges (final) or, for
  an adverse grade within the days, objects; the school decides upheld or revised (`decide`). An ACR not
  objected to in time becomes final by itself.
- **Who sees what:** the school's ACR people everything; the employee their own (the levels only once
  shown to them); a level's people everything up to their level. Every step is in `acr_events`.
- Lists: `board` (a cycle's ACRs with status, level, who it waits on, score, grade), `mine`, `to-assess`.

## Part 3 — screens (built)

- **Admin, Employee management → Employee ACR** (`/people/acr`): the cycle, Start the cycle / Add new
  joiners / Close, figures by status first (and "waiting on nobody"), filters (status, staff, name or
  reviewer), the list with who each ACR waits on, **Print the shown** (up to 100, one per page, signature
  lines; Save as PDF from the print dialog) and **Excel** (CSV that Excel opens, same filters).
- **One ACR** (`/people/acr/:id`): the shared sheet (`AcrSheet` in `packages/ui`): the school's facts,
  the self-appraisal, each level (filled or the form at its turn, send back), the result, acknowledgement
  and objection, the steps; below it, for the school: leave taken (office), who fills each open level,
  and the decision on an objection.
- **Employee page → ACR tab**: the employee's ACRs by cycle, and where the approvers are set.
- **Staff app → Office → My ACR** (`/acr`): my ACR (fill the self-appraisal, see the result,
  acknowledge or object) and **ACRs to assess** (the levels waiting on me) with the same sheet.
- Tested in the browser on Alpha's test cycle "ACR 2026-27" (started 18 Oct 2026 with the user's
  agreement): one self-appraisal and one HOD level filled; the Principal level is left for the user.

## My ACR in the admin app (19 Oct 2026)

Office staff who work in the admin app (an accountant, a clerk) asked where their ACR was: the staff
app's Office → My ACR had no twin. Now Employee management → **My ACR** (`/me/acr`, shown to every
staff login beside My profile) lists my own reports and the ones waiting on me as a level, and
`/me/acr/:id` shows the sheet (`AcrReport`) with the same self-appraisal, level, acknowledge and
objection controls the staff app has; the admin's `/people/acr/:id` stays the HR view.

## Assessors per employee (19 Oct 2026, 0189)

The school assigns who assesses whom per employee, not by role (the earlier ERP's ACR Master: HOD and
Principal by employee code, per financial year, with an Excel import). Decisions: an **Assessors** tab in
ACR set-up; the second level per employee too, the Principal as the default; assignments live on the
employee record and are copied into each cycle.

- **Record:** a new field **ACR reviewer** (`acr_reviewer`, Approvers section) beside ACR HOD. A new
  level kind **`acr_reviewer`** reads it and falls back to the designation on the level (the Principal)
  when nobody is set; migration 0189 turns the seeded "Principal by designation" level into it (the
  designation kept as the fallback) and the seed does the same for new schools.
- **Assessors tab** (`GET/PUT people/acr/setup/assessors`): every active employee with a searchable
  picker per employee-wise level in use (the columns follow the levels of both groups), filters (name or
  code, department, staff group, only those with nobody), "set for the shown rows", the missing count,
  Save of the changed rows, and a CSV (employee_code, name, department, one column per level holding
  employee codes) to download, fill in Excel and upload. References are ids or codes; nobody assesses
  themselves; rows with a problem are reported and the rest saved.
- **Open cycle:** the board's **Re-read assessors** (`POST people/acr/cycles/:id/reresolve`) gives the
  levels not yet done the people the set-up and the records give now; a level the office filled by hand
  keeps them when the record gives nobody. **Saving assessors does this at once** for the employees
  saved (the Assessors tab and its CSV upload, and the Approvers section of an employee's record):
  `AcrFlowService.refreshAssessors` runs the same per-ACR refresh after the records are written, so an
  employee's ACR never shows the people of an earlier record. Re-read stays for records changed another
  way (a bulk import, a transfer).
- Test: `acr.e2e-spec.ts` "assessors (0189)".

## Every level on the Assessors tab; a person on two levels assesses once (19 Oct 2026, 0190)

- The Assessors tab shows **one column per level of the chain** of each staff group (as many levels as
  Approval levels holds): a picker where the level reads the record (ACR HOD, ACR reviewer, L1–L3), the
  fixed people otherwise (a designation, a role, a named person). Teaching and non-teaching chains may
  differ; the header names both. The CSV's columns are the record fields in use.
- **Same person on two levels in a row:** when a level's people are exactly those of the level before it
  (the last one not skipped), the level is **skipped** (`acr_reviews.status = 'skipped'`, with a note)
  and the ACR goes on to the next level; with nothing left it is shown to the employee after the first
  of them submits. Recomputed on start, on Re-read assessors and when the office changes a level's
  people; a done level is never touched. The sheet shows "skipped: same person as level N".
- **Re-read assessors** also rebuilds the chain of ACRs still at the self-appraisal when the set-up's
  levels changed since the cycle started (levels added or removed).
- Test: `acr.e2e-spec.ts` "a person on two levels in a row assesses once (0190)".

## Forms and questions (19 Oct 2026, 0191)

The school's requirements note: separate self-appraisal forms per staff category and **a different
questionnaire for each approval level**, allotted automatically by category and level. Decisions: level
questionnaires separate per category (a form may also serve all staff); scores averaged across the
levels that rate, the last level setting the grade; sections carry weights and show a score.

- **Tables:** `acr_forms` (name, part self | level, staff group teaching | non-teaching | both, on/off),
  `acr_form_sections` (title, help, weight, order); `acr_questions` now belong to a form and a section
  (`part`, `staff_group`, `section` kept in step for the seed); kind adds `yesno`. `acr_levels.form_id`
  names a level's questionnaire (none: the grade and remarks only); `acr_reports.self_form_id` and
  `acr_reviews.form_id` snapshot the forms an ACR was made with. `app.acr_forms_from_questions` builds
  the four starting forms from the question bank (also after the seed) and points rating levels and
  ACRs already made at them.
- **Set-up → Forms and questions:** the self-appraisal forms and the level questionnaires as lists;
  Add form, open a form: sections (add, change, move up, remove when empty) with questions (add,
  change, move up, switch off; rating, written or yes / no; weight; required), the form's name,
  category and description, switch off, and Copy as the start of another. **Approval levels** gets a
  Questionnaire per level; a rating level must have one.
- **Flow:** every level answers its own questionnaire; its ratings give the level's score by section
  (question weights within a section, section weights across sections); a reviewing level is offered
  the grade of the average of the scores so far and may give another with a reason; the ACR's score is
  the average of the levels that rated and the last level's grade stands. The sheet shows each form's
  sections with help and section scores, and the result lists the levels' scores.
- API: `people/acr/setup/forms` (POST, PUT, `:id/copy`), `setup/sections` (POST, PUT, DELETE),
  `setup/questions` (formId, sectionId); `reports/:id` returns `forms` by id, `self.formId`,
  `self.sections`, `levels[].formId`, `levels[].sections`. Test: `acr.e2e-spec.ts` "forms, sections
  and questions (0191)" and the flow cases.
- **Used by levels, from the form's side (19 Oct 2026):** the Add form card and a questionnaire's own
  card tick the levels (of either chain) whose people answer it (`PUT people/acr/setup/forms/:id/levels`);
  a ticked level drops the questionnaire it had, a level that rates the questions cannot be left without
  one, and levels of the other staff group are refused unless the form is for all staff. The Approval
  levels tab's Questionnaire box is the same setting seen from the level's side.
- **Open cycles follow the set-up until a step is filled (19 Oct 2026):** saving levels, a form or a
  form's levels also gives every ACR of an open cycle the questionnaire its level has now, for levels not
  yet filled (matched by number, label and action), and the self form its category has now for ACRs whose
  self-appraisal has no answers yet. Filled steps keep the form they were answered on. Found when the HOD
  still saw the old questionnaire on ACRs started before a new one was assigned.
- **Who sits at each level, and why it came back (19 Oct 2026):** the employee always sees the name and
  code of the people at every level (only their answers wait for disclosure). A send-back is the latest
  step until the next action: its reason, who sent it and when show as a notice on the self-appraisal
  for the employee (`self.returned`) or on the level that must act again (`levels[].returned`), beside
  the Steps list.
- **One record field per chain (19 Oct 2026):** two levels of a chain cannot both read the same
  record field (for example HOD and Principal both as "the employee's ACR HOD"): they would always be
  the same person and the Assessors tab would show one person in two columns. Saving levels refuses it
  (`acr.level_same_person`); where an old set-up still has it, the Assessors tab shows the later column
  as "same as level N" instead of a second picker. Alpha's teaching Principal level was set to the
  employee's ACR reviewer with the Principal as fallback.

## Self-appraisal forms per employee type (19 Oct 2026, 0192)

- The employee master's **Employee type** (Staff setup → Employee types: Class Four, Teaching Regular,
  Teaching Contract…) is a finer list than the ACR's two sides. Each type carries a staff group the
  ERP reads; the ACR side of an employee comes from the department first, else from that group
  (`app.acr_staff_group(employee, year)`, the rule a cycle start uses: contract staff in a department
  for both are teaching when they have classes that year).
- A **self-appraisal form may name employee types** (`acr_forms.employee_type_ids`, ids from Staff
  setup; the name on the record, `profile.staff_type`, is what matches). `app.acr_self_form(side,
employee)` picks the most specific active form: for their side naming their type → for all staff
  naming their type → for their side → for all staff; ties by the order on the Forms tab. Used at cycle
  start, on Re-read, on the set-up saves that refresh open ACRs still at an untouched self-appraisal, and
  when an ACR made before forms existed first needs one. The levels' questionnaires stay per side.
- Forms tab: the employee types as tick boxes on Add a form and on the form card (a self form only);
  the list and the form header say the types and how many active employees the form serves now. The
  ACR board gets a **Form** column. API: `employeeTypeIds` on `POST/PUT setup/forms`; absent on PUT
  leaves them; unknown ids are refused (`acr.employee_type`); a copy carries them.
- **At run time the user side follows every change at once** (no Re-read needed): a set-up save
  (levels, forms, a form's levels) runs `AcrFlowService.refreshOpenCycles`; a record save (the
  employee's profile, the Assessors tab, a transfer) runs `refreshEmployees` for that employee. For an
  ACR **not yet submitted** the record decides the side again (`app.acr_staff_group`: department,
  employee type, classes this year), the chain is rebuilt when the levels changed shape, and the self
  form is the one the set-up gives now (a draft keeps the answers to questions still on it). For every
  ACR the levels not yet done take the people the records give and the questionnaire their level has
  now; filled steps keep what they were answered on. The sheet reads sections and questions live, so a
  question added or switched off shows at once.
- Test: `acr.e2e-spec.ts` "a self-appraisal form per employee type (0192)" and "open ACRs follow the
  record and the set-up at once".
- **Sample forms for a dev school:** `node scripts/fixtures/acr-sample-forms.mjs --school 1` makes,
  through the API as the dev admin, one self-appraisal form per employee type of Staff setup (Class
  Four, Teaching Regular, Teaching Contract, Non-Teaching Regular, Non-Teaching Contract, Visiting
  Faculty; each for all staff, naming its type) and one questionnaire per approval level (HOD, L1, L2,
  L3, Principal), attaching each to the levels with that label in both chains (`--attach no` to skip).
  A form whose name exists is left alone, so it can run again. Seeded in Alpha on 19 Oct 2026.

## A person assesses once, the board shows every level, the ACR PDF (19 Oct 2026)

- **Same person anywhere in the chain:** a level whose people are exactly those of an earlier level
  that stands (done, or not skipped) is skipped with "Same person as level N (label); assessed there",
  whether the two levels are in a row or not; it comes back when the people change.
- **Nobody set (20 Oct 2026):** a level with nobody is skipped with "Nobody set for this level;
  skipped" when a later level has someone, so the ACR goes past it (HOD → Principal when L1 is
  empty). When nobody is set anywhere after it, the ACR waits there and the board counts it under
  "waiting on nobody". Someone put there before the ACR reaches it brings the level back; a level the
  ACR has gone past stays as it is. Test: "a level with nobody set is skipped when a later level has
  someone".
- **Board:** `GET people/acr/board` rows carry `levels[]` (seq, label, status, people, filledAt,
  grade, skippedNote) for ACR managers only, never on an employee's own list. The screen shows a
  **Levels** column with one chip per level (✓ filled, … with them now, – skipped), the details on
  expand (people, status, date, grade, the skip note), an **At level** filter (ACRs now with that
  level) and a search that also matches the levels' people.
- **PDF:** `POST people/acr/pdf { ids }` (people.acr.view, up to 100 ACRs of the school) queues the
  `acr_report` export; the workers render `renderers/acr-report.ts` on the letterhead: the employee's
  facts, Part A the self-appraisal (answers by section with section scores, attendance and leave,
  self score), Part B each level (people, filled by whom and when, answers, score, grade, remarks; a
  skipped level with its note), Part C the result (score, grade, disclosure, objection, decision),
  the steps, and signature lines for the employee and every level; a page break per ACR. The ACR page
  has **PDF** (and the print view); the board has **PDF of the N shown**; both wait for the file with
  the export watcher. Only what the ACR holds is printed; the requester must still hold
  people.acr.view when the job runs.
- Tests: `acr.e2e-spec.ts` "a person assesses once anywhere in the chain…"; workers
  `test/acr-report.test.ts`.
- **Header approvals (20 Oct 2026):** the admin header's approvals icon and My approvals count the ACRs
  at the signed-in person's level (`GET people/acr/to-assess`, asked for everyone, empty for those who
  sit at no level) as the group "ACRs to assess", each item opening `/me/acr/:id`. An approver sees a
  new ACR there the moment it reaches their level.

## The sheet shows the guidelines and the employee's record (20 Oct 2026, 0193)

- **Guidelines** (`acr_settings.guidelines`, ACR set-up → Scale and grades): one text for the school,
  shown above every self-appraisal with its line breaks, in the admin and the staff app. Not printed.
- **The employee's record** on the sheet (`GET reports/:id` → `records`) and the printout: personal
  particulars (date of joining, designation at joining, present designation, department, employee type,
  regularisation, last promotion and upgradation, pay band — pay band only, no salary), educational,
  experience and training details, and the documents on file with View (`GET
reports/:id/files/:fileId` gives a signed address to whoever may see the ACR; the apps pass it
  through at `/api/acr-file/:id/:fileId` and `/api/my-acr-file/:id/:fileId`). Leave status gains
  half-pay leave and the late arrival slips the office enters (`office_facts.hpl`, `lateSlips`).
- **Signatures on the printout** (`employees.signature_file_id`, 0193): the office uploads a signature
  image on the employee page (`POST people/employees/:id/signature { fileId }`, people.employee.edit;
  shown small under the photo). Each signature line of the PDF names who signs with code and
  designation: the employee (signed on submission, with the date) and, for a filled level, the person
  who filled it (by their login) with the date; a level not yet filled names its people. The signature
  image prints above the line only once that step is filled.
- Test: `acr.e2e-spec.ts` "the sheet carries the school’s guidelines and the employee’s record".

## Attachment questions (20 Oct 2026, 0194)

- A question of kind **file**: the person answering attaches up to three of their own files (images or
  PDFs, 5 MB each) as the answer; not scored; required means at least one file on submission. The
  sheet shows each as a View icon with a remove button while editable, and an "Attach a file" button
  that uploads through the app (`acrUploadFile` / `uploadAcrFile`; the slot comes from `POST
reports/:id/files`, open to the employee, the levels and the office without a platform file right)
  and puts the id on the answer. The API keeps only files the person uploaded (`files.created_by`), ready
  and not deleted; files already on the saved answer stay. A file on an answer is part of the ACR:
  `GET reports/:id/files/:fileId` opens it for whoever may see the ACR. The printout prints images
  small under the question and notes a PDF.
- Set-up: Forms and questions → kind "Attachment (files the person uploads)". Works on the levels'
  questionnaires too (the level attaches, the later levels and the office see).
- Test: `acr.e2e-spec.ts` "an attachment question (0194)".

## The board's filters and pages; Principal's remarks (20 Oct 2026, 0195)

- **Board:** filters for Department and Employee type (from the rows), the page size (25, 50, 100)
  with Previous / Next and the count, all in the address. Print, PDF and Excel take every row matching
  the filters (PDF capped at 100 ACRs); the filter logic is shared (`filterAcrRows`) with the Excel
  route, which gains an Employee type column. The board rows carry `employee.type`.
- **Principal's remarks** (`acr_remarks`: grade, text, sort_order, active; `acr_reviews.remark_ids`):
  standard lines per grade, seeded with two plain lines per band, edited on ACR set-up → Principal
  remarks (the whole list saved at once; a line left out switches off but stays on ACRs that carry it),
  downloaded as CSV and uploaded in the legacy export's layout (grade, remark, status: "02/05 - Below
  Average" reads as the band, "Excellent" as the top band, "Very bad" as the bottom; doubles and
  dashes are skipped). On the sheet the **final level** (the last that stands) sees the lines for the
  grade it chose as tick boxes above its remarks; ticked lines count as remarks. The view gives
  `remarkLines`, `levels[].final`, `remarkIds`, `remarkTexts`; the employee sees them with the level
  once disclosed; the PDF prints them as "Standard remarks".
- Test: `acr.e2e-spec.ts` "Principal’s remarks (0195)".

## The ACR as steps; instructions per level; the board's selects (20 Oct 2026, 0196)

- **Steps:** the sheet (admin and staff app) shows a step bar above the self-appraisal: 1. Self-appraisal,
  then each level numbered, with the person and a mark (Filled, Now, Not yet, Skipped). The step the
  ACR is at opens first; the others fold and open on click (or from the bar). The records and the
  result stay as cards. The self-appraisal step carries the school's guidelines at its top.
- **Instructions per level** (`acr_levels.instructions`, 0196): a text per level under Approval levels,
  shown at the top of the level's step while it is being filled; empty gives a plain default for a
  rating level, a review level or the final approval. The view gives `levels[].instructions`.
- **Selects:** `.ep-select` draws the Lucide chevron inside its right padding (multi-selects stay
  lists); the board's filter fields fit their columns, so no control is clipped.
- Test: `acr.e2e-spec.ts` "instructions per level (0196)".
