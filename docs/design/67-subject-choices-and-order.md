# 67 · Subject choices and the class's subject order

Status: built 31 Oct 2026 · extends docs/design/65 (part 1, subject choices) · migration 0289

## Why

The old Exams → Subject choices page gave every student a C/O/A drop-down for every subject (40
students × 8 subjects = 320 drop-downs). It did not know that Hindi, Sanskrit and French are "pick
one", had no column-wide setting, no counts, no search and no check for a missing choice; the stream
was typed in. Report cards and the mark register followed one school-wide order (the subject master's
display order), so a class could not have its own sequence; the legacy system kept a **Priority per
class** (`exam_subject_master.subject_pri`). The single-exam card and the register also listed every
subject of the class, even those a student does not take.

Benchmark: Entab and Fedena keep a subject sequence per class and elective groups ("choose one"),
PowerSchool works from course requests per student, Teachmint offers streams for XI–XII.

## Decisions (user, 31 Oct)

| Question               | Answer                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Where the order lives  | **Per class** (for the year), starting from the subject master's order                       |
| How choices are picked | **Choice groups** per class; compulsory subjects come automatically                          |
| Streams                | **Defined per class**: a stream is a set of subjects; choosing it ticks them                 |
| Who sets choices       | **The office** (any section) **and the section's class teacher**; a subject with marks stays |

## Model (0289)

- `class_subjects.sort_order` — the class's place for the subject (NULL: not placed; printed after the
  placed ones in the subject master's order). `class_subjects.group_id` — its choice group.
- `subject_groups` (class, year, name, kind `optional` | `additional`, `pick_min`, `pick_max`).
  Optional counts in the total, additional is printed and kept out of it.
- `class_streams` + `class_stream_subjects` (a stream's subjects, by class subject).
- `app.subject_seq(class, year, subject)` — where a subject prints. Every ordered query uses it: report
  card (single exam and term), mark register (screen, Excel, PDF), mark entry, exam set-up, status,
  analysis, scheme register, date sheets.
- A guard trigger: a subject everyone takes (`is_elective = false`) is in no group; a group belongs to
  the subject's own class and year.
- Permission `exams.choices.manage` (school admin, group admin, academic coordinator, exam office).
  A class teacher (teacher assignment of kind `class_teacher`) with `exams.marks.enter` sets their own
  section without it. The class set-up (order, groups, streams) needs `exams.master.manage`.

## Rules

- A subject is taken by **everyone** (compulsory), is **one of a group**, or is an **elective** anyone
  may pick. A group holds one place in the order; each student's own subject from it prints there.
- A student's list = the compulsory subjects + the stream's + those picked. Kinds follow the set-up
  (compulsory, optional, additional). A group takes **at most** its number (refused above it); below
  its least the row shows "Missing: <group>" (not refused, so the office can fill in steps).
- No choices recorded = the student takes every subject (as before). The page shows "Not set".
- A subject in which the student has marks this year is **not taken off** (refused with the subject's
  code). A mark changed to **NA** (not applicable) does not count, so a wrong mapping can be undone.
- Saving the set-up adds a new compulsory subject to every student who has choices and sets every kind
  again from the groups (e.g. a group turned additional).
- A class with no subjects mapped (Masters → Class and subject mapping) offers its exams' subjects:
  each student's are ticked one by one, kinds kept; no groups, streams or order.
- Cards: a subject the student does not take is left off; additional subjects print last, marked
  "(additional)". Register: "—" for a subject not taken, a small "A" for an additional one.

## Screens

**Admin → Exams → Subject choices**, three tabs:

1. **Students** (a section): compulsory subjects once at the top; a column per group (a drop-down, or
   ticks when a group takes more than one), the stream, the other electives as ticks; a status per row
   (Complete / Missing: … / Not set). Filters All · Missing a choice · Not set, search by name,
   admission or roll no. **Set many at once**: a column, a value, for those without one / every
   student / the ticked ones. "Chosen so far" counts follow the edits. Save bar with a leave warning.
   Quick ways: **Bring last year's choices** (students without choices; subjects the class still has,
   the stream when it is still one), **Give them the compulsory subjects**, Excel download/upload.
2. **Class set-up** (a class): the order with ↑ ↓ (a group moves with its subjects; subjects move
   inside their group), "Who takes it" per subject, the groups (name, counts in the total or
   additional, pick at least / at most), the streams (name, subjects ticked). One Save.
3. **Counts** (a class): students taking each subject, section by section, with "Students" and "No
   choices yet" rows; PDF (View / Download) and Excel.

**Teacher app → Subject choices**: the class teacher's sections; the same columns as a form, and
"Bring last year's choices".

**Excel**: Admission no, Name, Stream (when the class has streams), a column per group (subject codes,
a drop-down when one is picked), Other subjects (codes, comma between). Every row in the sheet sets
that student; a student left out keeps theirs. Errors per row before saving.

## API

`GET exams/subject-choices/sections` (with `canEdit`), `GET|PUT exams/subject-choices`,
`POST …/defaults`, `POST …/last-year`, `GET …/excel`, `POST …/upload`, `GET|PUT …/setup?classId=`,
`GET …/counts?classId=`, `GET …/counts/file?classId=&format=xlsx|pdf`. PUT rows take
`subjects: [{ subjectId, kind? }]`; with a set-up the kind is worked out, without one the kind given
(or the student's current one) is kept.

Tests: `apps/api/test/subject-choices.e2e-spec.ts`, `exams-v2.e2e-spec.ts` (fallback without a set-up).

## Class and subject mapping (Masters), 31 Oct (migration 0290)

- The edit form's **Class** and **Subject** are drop-downs (type to search): a wrong class or subject
  is corrected on the row itself (`rekey`); a mapping that would repeat one the class has is refused.
  A mapping moved to another class leaves its place in the order, its group and its streams behind.
- `class_subjects.status` (active / inactive) with the grid's Deactivate / Activate and a Status
  filter: a subject the class no longer studies is made inactive, not removed. Inactive mappings drop
  out of the class's subjects everywhere (Academics class subjects, subject choices and set-up,
  teacher assignment checks, daily work, syllabus, the academics board); exams that already hold the
  subject keep it. "Clone from year" copies the status; saving the class's subjects under Academics
  makes the listed ones active again.
