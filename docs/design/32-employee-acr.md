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
