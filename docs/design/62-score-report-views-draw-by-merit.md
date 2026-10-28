# 62 — Score report views (written, interview, merit list); draw by merit total, and printing slips (plan, 28 Oct 2026)

Asked:

1. Score report (`/admissions/score-report?cycleId=4&classId=172`): a filter for Written, Interview and
   Merit list.
2. Draw of lots (`/admissions/draw`): make the draw slips on the merit basis only, and explain how to
   print them.

## What was found

- **Score report** is one wide list: every merit criterion's points, each written-test subject, the
  written total, form points, the grand total, the rank and each level's decision. There is no way to
  see the written-test result or the interview result on its own.
- **Draw of lots** groups candidates by their **form points**. For a class with a test (Class IX) the
  merit is form points plus the test and interview marks, so the groups do not follow the merit list.
- **No slip can be printed in Alpha**: a slip needs points confirmed, and approving Document check level
  1 does not confirm them (confirming is a separate step on the registration), so 0 candidates are
  confirmed; the View / Download icons only appear for a group with confirmed candidates, and they are
  small. Nothing on the page says how to print.

## Benchmark

Entab, Edunext, MyClassboard and the DPS Result Report: the result report has a type (Written test
result, Interview result, Merit list) with its own columns and rank; the draw is held among candidates
tied at the last seats of the merit list; points are frozen at the first verification; slips are printed
with one clear Print button, A4, with cut lines, and the office has printed guidance.

## Decisions (asked 28 Oct 2026)

1. **Score report views**: **Merit list** (today's report: points, the written and interview totals, the
   grand total, the merit rank), **Written test** (its subjects, total, %, rank by written marks) and
   **Interview** (its parameters, total, %, rank by interview marks). Excel and PDF follow the view.
2. **Draw groups by merit total** (points + written + interview marks), the merit list's order; for a
   class with no test (nursery) the merit total is the points.
3. **Document check level 1 approval confirms the points** as they stand (the office may adjust them
   before, with a reason).
4. **Printing**: a big **Print slips** button (the A4 PDF ready to print) and Download; **how-to-print**
   steps on the page; **Merit no.** and **merit total** as slip details the school can tick; **blank
   slips**.

Decided here, change any before building:

- A class with more than one test or interview stage gets a view per stage, named after it.
- In a stage view, the rank is by that stage's total (ties share a rank); candidates who reached the
  stage are listed, those without marks last.
- Registrations already approved at Document check level 1 get their points confirmed once (a
  migration), so the draw works on today's data; undoing that approval clears the confirmation.
- The draw page lists **merit totals** (with how many are confirmed); its heading placeholder
  `{points}` becomes `{merit}` (both accepted); recorded draws keep their total.
- Merit no. on a slip is the candidate's place in the merit list (the score report's rank).
- Blank slips: one A4 page of empty slips in the session's layout (heading, empty lines), any number of
  pages.

## Parts

### Part 1 — Score report views

- API: `view` = `merit` (default) or a stage id; a stage view's columns (parts or one marks column,
  total, %), rows of those who reached the stage, rank by the stage total; the views offered for the
  class in `options` / the report.
- Page: a view switch (Merit list | Written test | Interview) above the table, acting at once; the
  downloads follow the view.
- Tests: e2e (written view columns and rank; interview view; merit view unchanged); a11y; browser on
  Class IX.

### Part 2 — Draw by merit total, points confirmed at level 1, printing

- Document check level 1 approval sets `points_confirmed_at` (and undo clears it); migration 0272
  confirms the points of live level-1 approvals.
- Draw: totals, group, slips, check and record by **merit total**; Merit no. and merit total slip
  details; `{merit}` placeholder.
- Page: **Print slips** and **Download** buttons; "How to print" steps (Print slips → A4, 100 % / actual
  size, no "fit to page" → cut on the dashed lines → fold each slip twice → into the box → after the
  draw, Record the draw in the order drawn, scanning the barcodes); **Blank slips** (pages: 1-20).
- Tests: e2e (approval confirms, undo clears; groups by merit; merit no. on slips; blank slips PDF);
  a11y; browser.

## Not in this plan

Changing how the merit total is made; slips in languages other than English.

## As built (28 Oct 2026)

- **Part 1** (d10b016): `view` on the score report (`merit` or a stage id) and its downloads; the
  report gives `views` (Merit list, then each Written test / Interview stage with marks in the class's
  process) and `view`. A stage view: those who reached the stage (or have marks there), its parts and
  total, %, the rank by the total (equal totals share it; cancelled / withdrawn not ranked), only that
  stage's levels. Page: "Merit list | Written test result | Interview result" links above the table.
  Excel headed "<stage> result: <class>", PDF the stage's columns with % last.
- **Part 2**: migration 0272 confirms the points of live Document check level-1 approvals (Alpha: 14
  confirmed) and lets slips show `merit` and `merit_no`. `decideWith` confirms the points on Document
  check level 1 approval (if not already); `undo` of that approval clears them. The draw groups by
  `applications.merit` (form points + marks): `merit` replaces `points` in totals, group, slips,
  check, record (the hand-draw table's `points` column holds the merit total), options `withMerit`;
  group candidates carry their form points and merit no. (`meritOrder` with the class's seed, as the
  score report ranks); slip details Form points, Merit total, Merit no.; heading `{merit}` (`{points}`
  filled the same); default heading "Draw slip - {class} (merit {merit})". `GET admissions/draw/blank`
  (pages 1-20) prints empty slips in the class's layout. Page: Print slips (N) and Download buttons,
  "How to print the slips and hold the draw" steps, Blank slips (pages) form.
- Tests: admission-draw e2e 8 (merit totals, level-1 confirmation and undo, blank slips, merit
  details), admission-results 17, admission-v2 updated (points confirmed by the Document check
  approval); all admission suites + permission coverage 116; a11y draw (4) and score report (3).
- Follow-up (asked 28 Oct): the view is a **Report** filter in the filter row (a select that applies at
  once, the other filters kept) instead of the links above the table: Merit list, Written test
  result, Interview result; a result the class has no stage for is listed but greyed out ("not in
  Class VI's process"). Each view carries its stage's `kind`.
- Change (asked 28 Oct, after part 2): **the draw works on the form's merit points only** (test and
  interview marks are not added) and **slips print for every registered candidate** (registered or
  under review, with points), Document check level 1 approval is not needed. Totals list points,
  candidates and how many are confirmed; a candidate whose points are not confirmed yet is badged on the
  page but gets a slip. Level 1 approval still confirms the points (0272 stays). `points` is again the
  draw's field (DTO, totals, group, slips, check, record, records; options `withPoints`); a slip's
  Merit total detail shows the candidate's own merit. Recording a drawn slip still needs the candidate
  at Selection (offers are made there).
