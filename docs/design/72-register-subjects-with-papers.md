# 72 · Register builder: subjects without a paper of their own

Status: built 4 Nov 2026, parts 1–2 (no migration)

## Why

On 4 Nov 2026 saving a new mark register (`/exams/schemes/new`) for Class VI was refused:

> To fix first: GEO · average: choose the columns it is made from; GEO · Average: choose the columns it
> is made from; HIST · average: …; HIST · Average: …

Geography and History & Pol Science are on Class VI's subject list (Academics → class subjects), so
step 2 (Subjects) offers them next to Social Science, and they were ticked. But in PT1, PT2, ACT1, ACT2
and Term I they are not papers: they are marked as **parts of Social Science** (the subject master has
them under Social Science; the exam parts point to them). A column chain built on one subject (PT1 +
PT2 → average, ACT1 + ACT2 → Average) and copied to every subject left out, in Geography and History,
every exam column (they have none of those exams) and kept the two averages with nothing to average.
The save check then refuses, without saying why.

It is not only these two. The builder's subject list joins the classes' subject lists to the exam
papers, so every sub-subject marked as a part (Geography, History, Political Science in Social Science;
Physics, Chemistry, Biology in Science) and every subject on a class list with no paper at all (offered
to nobody) is offered as a subject of its own.

## Benchmark

- **Legacy** (Term Mark Register): the subjects of a register are the exam's subjects; a subject's
  parts (sub-subjects) are columns under it, never subjects of their own.
- **Entab CampusCare, Edunext, Fedena (CCE), Teachmint, PowerSchool gradebook**: the report or register
  template picks main subjects; their components / sub-subjects are listed under them and shown as
  columns if wanted. "Apply to all subjects" applies a template only where the assessments exist and
  reports the subjects it skipped. A validation message names the cause and the fix.

## Decisions (user, 4 Nov 2026)

1. **Step 2 list:** a subject marked only as a part is shown under its main subject ("Social Science —
   parts: Geography, History & Pol Science") and cannot be ticked on its own; it can be ticked only
   where it has a paper of its own (Geography in VIII's ACT2), with a note of those exams. A subject with
   no paper and no part is shown greyed: "no paper in this year's exams".
2. **Copy to subjects:** a subject the copied columns do not fit (none of their exams) is marked in the
   dialog ("no paper in PT1, PT2, ACT1, ACT2") and left out; in the subjects it does copy to, an average
   or sum left with nothing to work on is dropped too (and what is made from it), and the note says what
   was left out.
3. **Saving:** the message names the cause ("Geography, History & Pol Science have no paper of their
   own in this register's exams: they are marked inside Social Science") with a button **Take them out**;
   opening a saved register that has such a subject shows the same note in step 2.

## Design

### Part 1 — what a subject is in the year's exams; step 2

- **API** `GET /exams/schemes/builder` (`MarkSchemesService.builder`): each subject also gets
  - `partOf`: the subjects whose papers carry it as a part, with the exams and classes
    (`exam_subject_parts.subject_id`; e.g. Geography: Social Science in PT1, PT2, ACT1, ACT2, Term I);
  - each part gains `subjectId` beside its `code`.
    Its `papers` stay as they are (Geography: ACT2 · VIII, out of 5).
- **`packages/ui` / `apps/admin/lib/register-builder.ts`:** `subjectStanding(data, subjectId, examIds?)`
  → `own` (a paper in the exams), `part` (no paper; a part of …), `none` (neither); `examIds` absent:
  every exam of the year (step 2 before any column), present: the register's exams (save check).
- **Step 2 (`RegisterBuilder`):** the tiles are the subjects with a paper of their own; a composite
  subject's tile says "parts: Geography, History & Pol Science (step 3: Each part a column)"; a
  sub-subject with papers in some exams only shows "own paper: ACT2 (VIII); else inside Social Science";
  the parts and the subjects with no paper are listed below, greyed and not tickable, with the reason.
  The elective slot's member list follows the same rule (a slot of parts makes no sense).
- A subject already in the register (a saved one, or ticked before) that is not `own` stays ticked so
  it can be unticked, with the note "no paper of its own in this year's exams (inside Social Science)".

### Part 2 — Copy to subjects; the save check

- **Copy to subjects (`RegisterColumns`, `copyColumns`):** the dialog lists the other subjects with
  what the copy would leave out (from the same rule as the copy); a subject where nothing of the chain
  is left ("no paper in PT1, PT2, ACT1, ACT2") is unticked and not tickable, with the reason.
  `copyColumns` drops an average / sum whose sources all went (and, as now, a conversion of a dropped
  column; repeated until nothing changes), so no empty column is copied; the note lists per subject what
  was left out.
- **Save check (`RegisterBuilder.problems`):** before the column problems, the subjects in the register
  that have no paper of their own in its exams, in one line with the cause ("Geography, History & Pol
  Science have no paper of their own in this register's exams: they are marked inside Social Science"),
  and the alert gets a **Take them out** button (removes them, and from slots; the message is checked
  again). Their own column problems are not listed as well (they go with the subject). The alert shows
  every problem line, not only the first six.
- **API** (create / update of a register, `MarkSchemesService.check`): the same rule refuses with
  `exams.register_subject_no_paper` (409, `extra.subjects`), so another client cannot save one either; a
  v1 preset (`subjectsOf`, exam papers only) is not touched by it.
- **Words:** `registerProblems` for an average with no columns says "nothing to average: choose the
  columns it is made from" (in `packages/db` and the copy in `packages/ui`).

### Tests

- Unit (`register-builder`): `subjectStanding` (own / part / none, by exams); `copyColumns` to a subject
  with none of the exams leaves nothing and is reported; an average left without sources is dropped, and
  a conversion of it.
- API e2e: the builder data's `partOf` and the parts' `subjectId`; saving a register with a part-only
  subject is refused with `exams.register_subject_no_paper`; the DPS preset still saves and locks.
- Browser / a11y: step 2 with a composite subject (parts listed under it, greyed rows), the copy dialog
  with a subject left out, the save alert with **Take them out**; axe on the builder.
- Help: `apps/admin/content/help/exams.md` (registers: subjects in step 2, copy, the message).

## Found while planning (data, not code)

- Class VIII's ACT2 has Geography, Political Science, Physics, Chemistry and Biology as papers of their
  own (out of 5, no marks: VIII's students do not take them as subjects) while the other exams mark them
  inside Science and Social Science; and ACT2 VIII has no Science paper. Under part 1 Geography and
  Political Science would show "own paper: ACT2 (VIII)". If that set-up is not meant, the school changes
  ACT2's subjects for VIII (Exams → Set-up → Classes and subjects).

## As built (4 Nov 2026, parts 1–2)

- **Engine** (`packages/db/src/mark-register.ts`, copied to `packages/ui` by
  `scripts/sync-mark-register.mjs`): `PaperSubject`, `subjectStanding(subjects, id, examIds?)` (own /
  part / none, the exams of its own papers, the subjects it is inside), `subjectsWithoutPaper(def,
subjects)` (a plain subject, or a slot none of whose members has a paper, in the register's exams;
  nothing before it reads an exam), `noPaperMessage` (the words used by the builder and the API);
  `registerProblems` says "nothing to average / add up, choose the columns it is made from". The
  `partOf` of the plan is worked out from the parts' `subjectId` instead of being sent.
- **API** (`MarkSchemesService`): the builder's parts carry `subjectId`; `assertPapers` on create,
  update, copy and lock refuses with `exams.register_subject_no_paper` (409, `extra.subjects`); **copy
  for other classes** keeps only subjects with a paper in the register's exams for those classes (a
  subject only on their list, or only a part, is in `dropped`; a register that reads no exam yet keeps
  the classes' lists). Presets are untouched (their subjects come from the papers).
- **Admin**: `subjectNote` (`lib/register-builder.ts`) for step 2's tiles (parts named on the main
  subject; "own paper: ACT2 (VIII); else inside Social Science"); the greyed group **Not a subject of
  their own in this year's exams**; a subject already in the register without a paper stays tickable
  (warning tone) to untick; slot members only from subjects with a paper; a warning with **Take them
  out** in step 2 once the register reads exams. `pruneColumns` and `copyColumns` (left-out list = every
  source column not in the target, conversions included); the copy dialog greys a subject the chain
  does not fit ("no paper in PT1-2026", the exam's code), says what each other one loses, **Tick every
  subject it fits**. Saving lists every problem (no longer the first six), the cause first, with
  **Take them out** (also in step 6's list).
- Tests: `packages/db/test/mark-register.test.ts` (+3: standing, without paper and the words, the
  average message); `apps/api/test/register-subject-papers.e2e-spec.ts` (builder parts, refusal, save
  and lock, copy leaving out a subject on the list); the register suites pass (6 suites, 44 tests);
  `copyColumns` / `pruneColumns` / `subjectNote` checked with a throwaway script; the builder on Alpha
  (Class VIII: step 2, the copy dialog, the save alert and Take them out; Class VI: Geography and
  History greyed) with axe at 1280 and 375 in a throwaway spec, nothing saved. Help:
  `apps/admin/content/help/exams.md` (Mark registers).
- **Later (4 Nov 2026), found on register 365 (Class VI):** a subject entered in parts (Social Science:
  Geography, History & Pol Science) copied from a whole-marks subject showed no parts, and **Parts in
  columns** did nothing without part columns. `withPartColumns` (`lib/register-builder.ts`) turns each
  whole-marks exam column of a subject with parts into its parts in one cell with their sum, the sum
  keeping the column's key (averages and totals made from it stay): step 3's **Show its parts in each
  exam**, **Parts in columns** ticked on whole marks (parts first, a column each), and **Copy to
  subjects**'s tick "A subject entered in parts shows its parts" (on by default). A new **elective
  slot** takes the columns of its first member that had some (the languages' chain) instead of
  starting empty; "add its columns" names the step (step 3, Columns). The subject's panel then says so in a notice
  ("Social Science is entered in parts (…), but its exam columns read only the whole marks, so the parts
  do not show in the register.") with the button beside it — the header button was easy to miss. A subject ticked in step 2 once others have columns starts with a copy of
  the first one's chain (`copyColumns`, its parts shown; Hindi taken out of a language slot and ticked again
  had been left with none); "add its columns" also says "or Copy to subjects from another subject".
- **Later (5 Nov 2026), as the old register's step 2:** step 2 has a **Composite subjects** box: each
  ticked subject with parts, its sub-subjects (the part's name, the master subject's name in brackets
  when it differs), whether they show (**Show its parts in each exam** while its columns read whole
  marks) and **Child subjects in columns** (`childInColumns`, the same as step 3's **Parts in
  columns**). **Subject order** marks it *composite* and lists its sub-subjects under it with ▲ ▼: the
  order is kept on the subject (`RegSubject.childOrder`, part names; the API keeps it, at most 12) and
  applied to its columns (`withChildOrder`: inside each cell of parts, or an exam's own part columns,
  the columns change places and a heading naming the parts follows), so the sheet needs no change;
  new part columns follow it (`partsOf` / `childrenOf` sort by it). In step 3 **Same marks as entry**
  of a composite subject starts on "Parts in one cell (+ sum)". Checked on register 365 (Social
  Science: Geography, History & Pol Science; Computer Science: Theory, Practical) in a throwaway spec,
  axe clean, nothing saved; the API e2e saves and reads back `childOrder`.
- **Later (5 Nov 2026), parts a column each read twice alike:** with **Child subjects in columns** on,
  each exam's parts headed only by their names (GEOGRAPHY, HISTORY & POL SCIENCE, then again for the
  next exam), so the preview looked as if the parts came twice. `buildSheet` now adds a third heading
  row whenever a part of a group prints as a column of its own: the exam (the group's heading without
  its "(GEO/HIS)") spans its parts in the second row, the parts are under it, every other heading of
  that row reaches down two rows; a sheet without such parts keeps its two rows. The screen's sticky
  heading has a third offset; the PDF splits "MT1 (35)" over two lines in any heading that reaches the
  last row (the Excel export already merged any shape). Checked: an engine test, the register e2e
  suites (39 tests), a sample PDF, and register 365's preview (Social Science: MT1, MT2, ACT1, ACT2, HY
  each over Geography | History & Pol Science) with axe, nothing saved.
- **Later (5 Nov 2026), an exam-wise register for VI-VIII (made from the old register's guide):** two
  gaps. (1) Classes differ in a subject's parts: Science is in parts in VIII only, Social Science has
  History in VI and Political Science in VII-VIII. A parts cell now prints only the parts the
  student's class has, a blank cell when it has none, and the class's whole marks as a plain cell when
  it enters the subject without parts (the group's first part has `wholeIfNoParts`, set by
  `withPartColumns` and by step 3's parts in one cell). (2) Exam-wise: `examView` takes a subject's sum
  of the exam's parts as the exam's own column (no extra whole-marks column), and `buildSheet` applies
  the same view (`SheetOptions.exam`, given by Run and the preview), so the sheet prints the picked
  exam only — it printed every exam's columns before. Register **411 "Examwise Register Class
  VI-VIII"** made on Alpha (draft): exam-wise, VI-VIII, roll order, subjects in the header; English,
  Hindi, Mathematics, Science (phyisic / Chemistry / BIOLOGY, as Alpha's master spells them), Sanskrit,
  Computer Science (whole marks), Social Science (History & Pol Science / Political Science /
  Geography); the class's subject order; PT1, PT2, ACT1, ACT2, Term I; codes AB (0, holds the total),
  ML (pro-rata from the other exams, 100 %), L, EX, NA (left out of the maximum) for every exam; final
  total / % / grade / rank by total, .5 up, no result column; optional subjects by the subject choices,
  additional ones out; Sr, Adm no, Student (roll hidden); division label, proper case, auto decimals;
  CBSE A1-E; 60 / 45 / 33; no analysis. Checked: an engine test, the register e2e (exam-wise prints
  its exam only), Run for VI-A, VII-A (no marks yet), VIII-A on PT1 and Term I, and the builder's
  steps with axe.
