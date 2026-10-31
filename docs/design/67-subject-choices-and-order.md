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

## Against the legacy Student Subject Mapping (31 Oct, migration 0291)

From the legacy process guide (Student / Master Subject Mapping). Decisions: keep the Save bar (the
legacy saved every pick at once, with no undo); the legacy **Opt** tick becomes the student's own
**additional** subject; Science / Social Science sub-subjects stay **exam parts** (no per-student
tick); the class teacher edits, **subject teachers see** their sections read-only in the teacher app.

| Legacy                                             | Here                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Student Subject Mapping (section)                  | **Students (section-wise)** tab                                                                                                                                                                                                                                    |
| Subject-1…7 drop-downs                             | a column per choice group, Other subjects, Stream                                                                                                                                                                                                                  |
| Opt tick (optional = Y)                            | **Opt** column: the student's own additional subject (`student_subjects.opted_additional`), kept out of the total and printed last; it stays when the set-up sets kinds again; Excel column "Additional (out of total)"                                            |
| Bulk Assign All (section)                          | **Set many at once** (those without one / every student / ticked)                                                                                                                                                                                                  |
| Master Subject Mapping: Total / Mapped per section | **Whole class** tab: every section × subject "taking / students", Not set, Missing a choice                                                                                                                                                                        |
| Master Bulk Assign All                             | **Set for the whole class** (`POST exams/subject-choices/bulk`): one column for every section the caller may set, saved at once after a confirming tick; each student in their own section; a student with marks in a subject it would take off is left and listed |
| Export Excel / PDF (page size, orientation)        | Section and whole-class list as PDF (landscape or upright) and Excel; the Excel to fill and upload; the summary PDF / Excel                                                                                                                                        |
| Subject Count Reports                              | the Whole class summary and its files                                                                                                                                                                                                                              |
| Users (one student by admission no)                | **Find a student in any section** (admission no or name) opens their section filtered to them                                                                                                                                                                      |
| Delete (trash, soft)                               | **Clear** on a row (back to "Not set"); nothing is lost: every change is in the audit trail                                                                                                                                                                        |
| student_subject_mapping_log                        | **History** on a row: who added, took off or changed each subject, from the audit log                                                                                                                                                                              |
| Teachers see their classes                         | class teacher edits; subject teachers read only (`sections[].mine`)                                                                                                                                                                                                |

## Registers by numbered slots; sub-subjects set once per class (31 Oct, migrations 0292–0293)

Decisions: the mark registers use **numbered slots** (legacy Subject-1 … Subject-n), for the single-exam
register (screen, Excel, PDF) and the term registers of the mark schemes; sub-subjects are set **once per
class**; parts show in the **registers**, the report card prints the **total** only.

- **Slots**: each student's own subjects in the class's order (`app.subject_seq`), additional last, fill
  Subject-1, Subject-2, …; a subject the student does not take has no column at all (a Hindi student
  has no Sanskrit or German cell). Each cell is the subject's code and its marks (AB, EX, a code or a
  grade), "A" for an additional one; when every student has the same subject in a slot its heading says
  so. Excel / PDF: per slot "Subject", "Marks" and, when its subject is entered in parts, "Parts"
  ("GEO 20, HIS 21, POL 22"), under a merged Subject-n heading. Term registers: per slot "Subject" then
  the scheme's printed columns and the grade. `register-sheet` rows carry `slots` (exam subject ids) and
  `parts`; subjects carry their `parts`; the scheme register JSON carries `slots`.
- **Parts per class**: Class set-up → "Entered in parts" lists a subject's sub-subjects from the subject
  master (Social Science → Geography, History, Pol. Sc.) with a share each (`class_subject_parts`).
  `app.apply_class_parts(exam_subject)` gives an exam subject the class's parts when it has none and no
  marks: the exam's maximum split by the shares, whole marks rounded down for all but the last part,
  which takes the rest (80 with 1:1:1 → 26 + 26 + 28; shares 27:27:26 give exactly that). It runs when
  an exam's subjects are saved and when the class set-up is saved (for the year's exams). Each part's
  teacher enters it (existing part entry); the parts add up to the subject's marks, so results and the
  card read the total as before. An exam may still change its parts on its own set-up.

## The Students grid in the legacy layout (31 Oct)

The section grid looks like the legacy Student Subject Mapping, on the same rules: a row per student
(Sr no. with the bin = Clear and the history clock, Name with admission no and what is missing), Stream,
then **Subject-1 … Subject-n** in the class's order. A slot is a subject everyone takes (shown fixed), one
pick of a choice group (a group that takes two has two slots), or an elective ("Select subject" / the
subject). Under each drop-down the **Optional** tick = the student's own additional subject (kept out of
the total; an additional group's subjects are ticked and fixed); a subject entered in parts lists its
sub-subjects ticked (they come from Class set-up, not per student). Each column heading has **Bulk
assign all** (every student of the section; nothing is saved until Save); Stream has **Bulk stream all**.
The card's toolbar: Export to Excel, Export PDF (view / download), Subject count report (the Whole class
tab); "Find a student in any section" stays above. Bring last year's choices, the Excel to fill and the
upright print sit in cards under the grid. Styles: `.ep-subchoice*` in packages/ui app.css (tokens only).

## Class set-up as a slot template (31 Oct)

Decisions: a **slot template per class** (Number of subjects N, then for Subject-1 … N the subjects allowed);
the optional subject stays the **Optional tick** on any slot; every student must fill **exactly N**.

- Class set-up shows "Number of subjects" and a row per slot: the subjects allowed (chips, "+ Add a choice"),
  a name for a choice ("Second language"), sub-subject parts under a subject that has them, ↑ ↓ and remove.
  A row with one subject = everyone takes it; several = a choice; rows offering the same subjects = one
  choice taking that many ("Same as Subject-k (a second pick)"). A subject is in one slot (or in rows with
  exactly the same subjects). Streams stay below (subjects of the choice slots).
- Saved through the same set-up API: a single-subject slot is `take: all`; a choice is a group with
  `min = max = its slots` (so fewer shows "Missing", more is refused); the class's other subjects are
  `free` ("Not in a slot": no student is offered them; the grid shows such a column only while a student
  of the section still has one). The order printed is the slot order.
- Existing set-ups load as slots: a compulsory subject is one, a group as many as it takes; electives go
  to "Not in a slot".

## A template that does not fit marks already entered (31 Oct)

A student keeps every subject with marks this year (unless marked NA). When a choice slot takes fewer than
the student's marked subjects in it (VI-A on Alpha: marks in Hindi and a foreign language, Subject-2 "one
of Hindi, French, German, …"), the grid says so on the row before saving ("Has marks in HIN and FREN:
Subject-2 takes 1", counted under "Missing or too many"), and Save keeps the other students: the API's
`PUT exams/subject-choices` with `partial: true` saves the rows that fit and returns `refused` with the
reason ("has marks this year in HIN and FREN, but Subject-2 takes 1: let it take 2 in Class set-up (or
give one its own slot), or mark the extra one NA"). Without `partial` (uploads, other callers) one row that
does not fit still refuses the lot.
