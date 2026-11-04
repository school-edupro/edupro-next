# 72 · Register builder: subjects without a paper of their own

Status: planned 4 Nov 2026 (decisions below); parts 1–2 to build on "go part N"

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
