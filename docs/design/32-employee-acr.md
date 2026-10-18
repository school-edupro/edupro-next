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

## Part 2 — the flow (next)

Start a cycle (an ACR for every active employee, the levels resolved to people), self-appraisal (window
enforced on the server, auto facts), each level in turn (only its people; send back one step with a reason),
score and grade, disclosure, acknowledgement, objection and decision, events log.

## Part 3 — screens (after)

Employee ACR board (progress by status, "waiting on me", reminders), ACR tab on the employee page, "My ACR"
and "ACRs to assess" in the staff app, the printed ACR (PDF, bulk) and the Excel export.
