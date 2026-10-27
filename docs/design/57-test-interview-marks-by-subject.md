# 57 — Test and interview marks by subject and parameter (plan, 27 Oct 2026)

Asked: in admission set-up, the written test stage should take a bulk Excel of marks by subject, where
the subjects are not fixed; the interview stage should take a bulk upload of interview scores. The admin
decides the parameters of each paper (subject names, skills), then marks are entered and uploaded.
Reference: the legacy DPS Faridabad **Result Report** (`/Admin/Admission/result-report.php`, process
note shared by the user): subject columns with maximum marks, total and percentage, Add / Upload Excel /
Export Excel / Export PDF, filters by class, registration no. and percentage band, and an "Adm Unlock"
date when the result is released to the family.

## Today

- A Test or Interview stage (`admission_stages`, kinds `test` / `interview`) holds **one** maximum for
  every class (`max_marks`), and a candidate gets **one** marks figure per stage
  (`admission_stage_results.marks`), entered on Tests and interviews (a slot's candidates), on the
  registration page / approval review, or in the Excel decisions sheet (doc 55, one "Marks" column).
- Merit = the form's points + the live marks of every stage (`process-engine.ts`, `meritOf`).
- No subjects, no skills, no percentage, nothing shown to families.

## Benchmark

Entab, Fedena, Edunext, MyClassboard and the legacy DPS page: entrance papers per class with maximum
marks per subject, Excel template per class with a column per subject, total and %, absent marked,
percentage bands, a pass mark per subject and a cut-off, interview rubrics (parameters with scores),
result release on a date with the marks shown in the parent portal, export to Excel and PDF, and a
check that every registration number in the file exists.

## Decisions (asked 27 Oct 2026)

1. **Papers per stage and class.** In Admission set-up, every Test and Interview stage gets a paper per
   class: its parts (Test: subjects such as English 100, Maths 50; Interview: parameters such as
   Communication 10, Confidence 10), each with maximum marks. A class's maximum for the stage = the sum
   of its parts. Copy a paper from another class.
2. **All subjects together.** One sheet per class (and stage) with a column for every part, filled and
   uploaded in one go, like the DPS page. The screen grid shows every part too.
3. **Interview: one score per parameter**, agreed by the panel, entered once per candidate, with a
   remark.
4. **The admin uploads** the candidates' sheet (no per-subject markers).
5. **The sheet carries the decision**: a Decision column with **Select** (approved: moves to the next
   stage) or **Hold**; blank = marks only, no decision yet. The upload records the decision at the
   level the candidate waits at, on behalf of that level (as admins do in doc 55).
6. **Families see the marks after a release date** (the DPS "Adm Unlock"): per session, class and stage,
   a release date and time; after it the candidate portal shows each part's marks, the total and %.

Decided here, change any before building:

- The parts' names are free (they are often not academic subjects: Mental Ability, Reasoning,
  Communication). Academic subjects of the class are offered as quick picks.
- A part may have a **pass mark**, and a paper a **minimum total %**: below either shows a "Below
  cut-off" flag on the results grid, the merit list and the review. Nothing is rejected by itself.
- **Absent**: a column on the sheet (Y). An absent candidate has no marks; with a decision it is
  recorded as absent.
- **Not in the sheet: Reject** (you named Select / Hold). Rejecting stays on the review screen. Say if
  the sheet should also take "Not selected".
- Papers are school-wide (set-up), not per session; every marks row keeps the part's name and maximum
  as they were, so changing a paper later does not change past results.
- Marks of a candidate already decided at the stage may be corrected by an admin with a reason (merit
  re-worked, logged); the decision stays.
- A stage with no paper for a class works as today (one marks figure, the stage's maximum).

## Parts

### Part 1 — papers in Admission set-up (migration 0265) — built 27 Oct 2026

- Admission set-up → Stages: a Test or Interview stage gets **Papers by class**: pick a class, add parts
  (name, maximum, pass mark optional), order them, minimum total % (optional); **Copy from class**;
  shows the class's maximum (sum). Classes without a paper show "one marks figure, maximum N".
- Data: `admission_paper_parts (stage_id, class_id, name, max_marks, pass_marks, sort_order, status)`,
  `admission_papers (stage_id, class_id, min_percent)`; audited.
- API: `GET/PUT admissions/stages/:id/papers[/:classId]`, copy.
- Tests: API e2e (save, copy, maximum = sum, a part in use is switched off not deleted).
- **As built:** page **Admission set-up → Test and interview papers** (`/admissions/setup/papers`,
  also linked as "Papers by class" under each Test / Interview stage): stage tabs, the classes on the
  left (each "N subjects · out of T" or "One figure · out of M"), the chosen class's paper on the right
  (name with quick picks: the school's scholastic subjects plus Mental Ability, General Knowledge,
  Reasoning; for an interview Communication, Confidence, General awareness, Behaviour, Parent
  interaction), Up / Down / Remove, the total as it is typed, minimum total %, **Save the paper**, and
  **Copy this paper to** ticked classes (their parts replaced). Saving no parts leaves the class on one
  figure. API `GET admissions/stages/:id/papers`, `PUT …/papers/:classId` (answers `{paper}`),
  `POST …/papers/copy {fromClassId, toClassIds}`; set-up managers change, `admissions.cycle.view` reads.
  `app.admission_stage_max(stage, class)` gives the class's maximum, now used by decisions (marks
  checked against it), the registration review, the Excel decisions sheet and a slot of one class.
  Checked: `admission-papers.e2e-spec.ts` 4 pass, the admission suites (86) pass, axe on the page and
  on Admission set-up; browser: rows typed and not saved (no paper made in Alpha).

### Part 2 — the results sheet and grid (the DPS Result Report) — built 27 Oct 2026

- New page **Admissions → Test results** (`/admissions/results`): session, class, stage (Test or
  Interview), slot (optional); filters registration no. / name, % band (0-10 … 91-100), Below cut-off,
  decided / waiting.
- **Grid**: candidates who have reached the stage: roll no., registration no., name, a column per part
  (`English (100)`), Absent, Total, %, Below cut-off, Decision (Select / Hold / done), Remark. The admin
  enters on screen and saves (all parts together).
- **Excel**: Download the sheet for the class (locked registration no. and name, a column per part with
  0..max checks, Absent Y, Decision drop-down Select / Hold, Remark; total and % as formulas) → Upload
  (.xlsx or .csv) → **check**: each row OK or its error (registration no. not found in this class and
  stage, marks over the maximum, not a number, decision not allowed) → **Apply** the good rows.
- Apply: marks saved per part (`admission_part_marks`, with the part's name and maximum kept); with a
  decision, the stage result is written at the candidate's current level with the total as marks (merit
  re-worked); without one, the marks wait for the decision.
- **Export** Excel and PDF of the grid as filtered (letterhead PDF, A4/A3 landscape).
- Merit list, score report, registration page and approval review show the parts.
- Doc 55's Excel decisions sheet: for a stage and class with a paper, the Marks column is left out
  (marks come from the results sheet).
- Tests: API e2e (sheet built per class, upload checks, apply with Select / Hold / blank, absent,
  merit = points + total, correction with reason), a11y on the page.
- **As built (migration 0266):** `admission_part_marks` (a mark per part, the part's name and maximum
  kept) and `admission_stage_marks` (absent, total, out of, remark per candidate and stage). Page
  **Admissions → Test results** (`/admissions/results`): session, class, stage, slot, name / number,
  % band, cut-off and "stands" filters; four figures (candidates, waiting, marked, below cut-off); the
  grid with a box per part, Absent, the total and % as typed, where the candidate stands (Waiting, Held,
  Selected, Not selected, Sent back) with "Below cut-off", Decision (Marks only / Select / Hold) for
  those waiting, Remark; **Save N changes** saves every changed row, each on its own (an error stays on
  its row). A decided candidate's marks change only with a reason (a box appears); the decision's
  marks follow, merit is worked again and the registration's history says "marks corrected to … ·
  reason". **Sheet and downloads**: Download the sheet (the candidates waiting, held or sent back; a
  column per part `English (50)` with 0..max checks, Absent (Y), Total and % as formulas, Decision
  Select / Hold, Remark; key `EPMARK:` in A3), upload .xlsx or .csv → **Check** (each row Ready /
  Skipped / Error, and "Registration numbers not found in this class and stage") → **Save N rows**;
  Export Excel / Export PDF (letterhead, A4) of the grid as filtered. A blank cell in the sheet is not
  changed; Select needs marks and is refused for an absent candidate (Hold them). A decision is made at
  the level the candidate waits at, through the same rules as the review (an admin not named in the
  level is written into the remark: "by … for …"); without a remark it reads "Test results".
- A class with no paper shows a note pointing to Test and interview papers (one marks figure stays on
  Tests and interviews and the review, as before).
- A decision made elsewhere (the review, Excel decisions) after marks were uploaded carries their
  total, once per stage. The Excel decisions sheet (doc 55) leaves out its Marks column for a class
  with a paper.
- The registration page and the approval review (admin and staff app) show each stage's marks by part
  ("English 40/50 · Maths 48/50 · total 88/100"); the candidate portal does not (part 4 releases them).
  The merit list and score report keep showing the total.
- API: `GET admissions/results/options`, `GET admissions/results`, `PUT admissions/results`,
  `GET/POST admissions/results/sheet` (`?apply=1`), `GET admissions/results/export?format=xlsx|pdf`;
  reading needs the registrations, saving and the sheet the tests and interviews right.
- Checked: `admission-results.e2e-spec.ts` 7 pass (no paper, screen save with errors and filters,
  sheet check then apply with Select / Hold / absent and an unknown number, correction with reason,
  review decision carrying the total, CSV, the registration's marks, exports); all admission suites
  pass; axe on Test results, the registration and the review. Browser: Alpha has no paper yet (the note
  shows); the grid was tried on the test school's own data (typing, the reason box, a refused save).

### Part 3 — interview parameters and entry everywhere

- The same papers for Interview stages (parameter, score); the remark column is the panel's remark.
- Tests and interviews (a slot's candidates) and the review screen take marks by part when the class has
  a paper (the total is worked out); the single marks box stays for classes without one.
- Admissions list / report builder: Test total, Interview total and % as columns.
- Tests: API e2e for interview papers; a11y.

### Part 4 — results to families after a release date

- On the results page: **Release to families** per session, class and stage: a date and time (now or
  later), changeable until it passes, and "Withdraw" before it.
- Candidate portal: the registration shows "Test result" / "Interview result" after the release: each
  part's marks, total, % (absent shown as Absent); nothing before it.
- Optional **Tell the families** button once released: an email / SMS / WhatsApp from a new template
  `admission_result` (sent by the workers; nothing is sent by itself, there is no scheduler).
- Tests: API e2e (hidden before, shown after, withdraw), portal a11y.

## Not in this plan

Per-subject markers, panel members' separate scores, grades instead of marks, automatic rejection by
cut-off, a scheduled message at the release time.
