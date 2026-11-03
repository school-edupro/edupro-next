# 70 · Subject marks master: an exam's papers and maximum marks come from a master

Status: planned 3 Nov 2026 · parts 1–2 to build

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
