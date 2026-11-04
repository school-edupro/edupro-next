# 70 · Subject marks master: an exam's papers and maximum marks come from a master

Status: built 3 Nov 2026 (parts 1–2; migration 0302); part lines 4 Nov 2026 (migration 0303)

## Why

An exam's Set-up → Subjects step (`/exams/:id/setup?step=subjects&classId=`) asks, for every exam and
every class, each subject's maximum and pass marks, optional and grade scale (with "apply one maximum to
all" and "copy another class" of the same exam). Nothing remembers that PT1 in Class VI is 40 marks, so
each new exam is typed again and two exams of one type can disagree by mistake.

The school's legacy kept a **Subject Master** (`EANDE/define_subjectmaster.php`,
`classwise_subjectmaster.php`, table `exam_subject_master`): per exam type and class, the subjects with
their maximum marks, optional flag and order; every exam of the type read it. Entab CampusCare
(Exam–Subject mapping per class and assessment), Edunext (max-marks set-up per term and class), Fedena
(exam group subjects per batch) and Teachmint (assessment templates) all keep the maxima in a master and
let the exam only choose the papers held.

## Decisions (user, 3 Nov 2026)

| Question                    | Answer                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the master is keyed on | **Exam type × class** (PT1 · Class VI · English 40 …); the sections of a class share it                                                                                                                           |
| The exam's Subjects step    | **Select only, from the master**: maximum, pass and scale are read-only there; it ticks the papers the class sits. Marks change in the master                                                                     |
| What the master holds       | **Maximum, pass marks, grade-only scale and Optional** per subject; parts stay in Class set-up (share of the maximum, docs/design/67)                                                                             |
| A master changed later      | **Follow until marks exist**: exams of the type follow at once for classes with no mark entered; where marks exist the exam keeps its marks, shows "differs from master" and the exam office may Apply (a reason) |

## Design

**Table** `exam_type_subjects` (migration 0302): school, academic year, exam type, class, subject,
`max_marks` (0 only with a grade scale: a grade-only subject, as `exam_subjects`), `pass_marks`
(≤ max), `grade_scale_id`, `is_optional`, updated by / at; unique (year, type, class, subject); audit,
RLS. Per year (the legacy's was per financial year): "Copy from last year" starts a new year.

**Master screen** — Exams → Set-up, a new tab **Subject marks**: an exam type × class overview (how many
subjects set, or "not set"); a type and a class open a grid of the class's subjects in the class order
(docs/design/67) with Max, Pass, Grade-only scale, Optional and remove; add a subject of the class;
**Apply one maximum and pass to all**; **Copy to other classes** (the classes that study those subjects);
**Copy from another exam type**; **Fill from an exam** already set up (its marks for the classes it
has); **Copy from last year**; Excel and PDF of the type. Rights: `exams.master.manage` to change,
`exams.master.view` to read.

**Exam's Subjects step** — the class's papers from the master of the exam's type: each row ticked by
default (an Optional subject too), Max / Pass / Scale shown, not editable; Parts and the progress-card
set as now. No master for the type and class: the step says so, links to Subject marks, and offers "Fill
the master from this exam" when the exam already has subjects. The API takes only which subjects are
held (it reads the marks from the master); a subject not in the master is refused.

**When the master changes** — for every exam of the type in the year: a class with no mark entered in
that subject takes the new maximum, pass, scale and optional at once (parts follow, as today); a subject
with marks keeps its own and is shown "differs from master" on the exam (Subjects step and Overview) and
in the master's overview; **Apply** (exams.master.manage, a reason, audited) moves it to the master's
values unless an entered mark is above the new maximum (the students are listed). A copied or new exam
takes its papers from the master.

## Parts

- **Part 1** — migration 0302; API: the master (read a type × class, save it, overview, copy to
  classes, copy from a type, fill from an exam, copy from last year, Excel / PDF); admin tab Subject
  marks; e2e, a11y, help.
- **Part 2** — the exam's Subjects step from the master (select only), the API's subjects save takes
  only the papers; a master change follows into unmarked exams; "differs from master" with Apply
  (reason); new and copied exams from the master; e2e, a11y, help.

## As built (part 1, 3 Nov 2026)

- Migration 0302 `exam_type_subjects` as designed (a grade-only row: maximum 0, its scale, no pass marks).
- API `/exams/subject-marks` (`SubjectMarksController`, `SubjectMarksService`; view `exams.master.view`,
  change `exams.master.manage`): `GET overview` (types × classes, subjects set), `GET ?typeId=&classId=`
  (the list in the class order `app.subject_seq`, the subjects the class studies, last changed),
  `PUT` (the whole list; checks marks, scale, duplicates; audited), `POST copy` (to classes of the type:
  only what each studies, "not studied there" reported; to exam types of the class; a subject there takes
  the copied marks, the others stay), `POST fill` (an exam's subjects, every class, into its type's
  lists; a class's scale for a grade-only paper), `POST last-year` (the previous year by start date; what
  is set stays), `GET file` (a type's lists as Excel / PDF with the school's head).
- Admin: Exams set-up tab **Subject marks** (`/exams/subject-marks`): the type × class grid (a count or
  —), the list editor (`SubjectMarksEditor`: max, pass, scale, optional, remove, add a class subject, max
  / pass for all, a leave warning), Copy / Fill / Copy from last year forms, Excel and PDF
  (`/api/subject-marks/[typeId]/[format]`).
- Tests: `apps/api/test/subject-marks.e2e-spec.ts` (6); a11y for the grid and a list.

## As built (part 2, 3 Nov 2026)

- `subject-marks-follow.ts`: `followSubjectMarks` (a paper with no mark, whole or in a part, of an
  unlocked exam of the year takes the master's maximum, pass, scale and Optional; parts fitted, a class's
  parts given) — run after a list is saved, copied (each target), filled or brought from last year (the
  responses say how many papers followed) and after an exam is copied; `fillExamFromSubjectMarks` — a
  new exam's classes, and a class added to an exam, get the class's list (exams that take marks).
- A subject taken out of a list is **not** removed from exams (its date sheet and parts would go): the
  exam shows it as not in the list and the office unticks it.
- `ExamsService.findExam` returns `subjectMarks` (the list per class of the exam's type) and per paper
  `marked`, `master` and `differs`; `setSubjects` with a list for the class takes the marks from it (a
  marked paper keeps its own, a held paper not in the list keeps its own, a new subject not in the list
  is refused `exams.not_in_master`); without a list it keeps the marks given (exams set up before the
  master, the date sheet). `POST /exams/:id/subjects/:examSubjectId/apply-master` {reason}
  (`exams.master.manage`, audited): refused for a locked exam, a paper marked in parts, a mark above the
  new maximum (the students named) or numeric marks on a grade-only line.
- Admin Set-up → Classes and subjects: with a list, `ExamSubjectsEditor` in master mode (the list's
  subjects, ticked when held — all when the class has none; marks, pass, optional and scale shown, not
  edited; "apply to all", "copy from class" and adding subjects hidden; parts must add up to the
  maximum; Differs with Apply and a reason; Not in the list); without one, a notice with the link and
  **Fill the subject marks from this exam**, and the papers listed. English and Hindi.
- Tests: `subject-marks.e2e-spec.ts` (10: part 1's 6 and following, differs and Apply, the save, new /
  added class / copied exams); the exam suites without a master pass unchanged; a11y for the step.

## After part 2 (4 Nov 2026, user: "parts of Social Science: the marks from the master")

- In the Subjects step's parts, a part picked as a sub-subject (or "entered by the teacher of" one) takes
  that sub-subject's maximum from the master (`masterMax`); with no line, what is left of the subject's
  maximum.
- Unticked papers' marks (text from the master) show muted rather than faded (contrast).

## Part lines (4 Nov 2026, user: a "Part of" tick)

The school uses both shapes: in PT1 · VI Geography and History are papers of their own; in PT1 · VIII
Geography 13 and Political Science 22 are the parts of Social Science 35. A rule (sub-subject lines are
parts) would split VI wrongly, so a line says so itself.

- Migration 0303: `exam_type_subjects.is_part` — a part of its subject (the line's subject's parent in the
  subject master), with a maximum and no pass marks, scale or Optional (a check). The service checks the
  subject is in the list as a paper and its part lines add up to its maximum (400
  `exams.subject_marks_parts`). `app.apply_master_parts(exam_subject)`: a paper with no mark (whole or
  in a part) of an unlocked exam takes the master's parts of its subject — one per part line, named after
  the sub-subject (its teacher enters it), the line's maximum, the class order — when they add up to the
  paper's maximum; its other parts go. Returns 1 when they changed.
- Follow (`followSubjectMarks`): part lines are not papers (`NOT is_part`); then every unmarked paper
  with part lines takes them (a change of the parts alone follows too); `fillExamFromSubjectMarks`
  makes papers of the paper lines only, then their parts. Unticking "Part of" later leaves an exam's
  parts as they are (they may be Class set-up's or the exam's own).
- Exams: `subjectMarks` rows carry `partOf`; a paper's `master` is its paper line; `differs` also when
  its parts differ from the master's (a marked paper). `setSubjects` refuses a part line as a new paper
  (409 `exams.master_part`); `setParts` refuses an unmarked paper whose parts come from the master (409
  `exams.parts_from_master`); a marked paper keeps changing its own parts. Apply on a paper marked as one
  figure whose master has parts: 409 (clear the marks to take the parts).
- Master: **copy** takes a subject's parts with it (the target's other parts of it go); to a class, a
  part only where the class studies its subject; a target whose parts no longer add up refuses the copy
  (409, nothing copied). **Fill from an exam**: a paper entered in parts by its sub-subjects (one part
  each, adding up to it) gives part lines, and the master's other parts of a paper the exam holds go.
  **Last year** copies the tick. Excel / PDF: a **Part of** column.
- Admin, Subject marks: a **Part of** column (a tick naming the subject, for a line whose subject is
  in the list); a part shows under its subject, its pass / scale / Optional replaced by "the subject's";
  the sums live under the table ("Social Science 35 = Geography 13 + Political Science 22"); sub-subjects
  that add up to their subject but are not ticked are offered **Make them parts of …**. "Max for all"
  leaves parts alone.
- Admin, the exam's Subjects step: part lines are not rows; a paper with master parts shows "n parts"
  and, opened, the parts read-only with a link to Subject marks (until marked); a paper the exam holds
  that is a part line says "A part of … in the subject marks: untick it"; a subject whose sub-subjects
  are papers of their own in the master says how to tick them. The one-click "Take the parts from the
  subject marks" (part 2 follow-up) is replaced by the tick. English and Hindi.
- Tests: `apps/api/test/subject-marks-parts.e2e-spec.ts` (6); the exam suites unchanged; axe on the
  list (ticked), an exam with master parts and the PT1-2026 · VIII hint.
