# 78 · Missing marks and absentees: two more reports on a mark register's Run

Status: built 6 Nov 2026 (no migration; **As built** at the end). Asked by the school on a mark register's Run (`/exams/schemes/417/register`,
Reports): "add missing report and absent report".

## What there is

- **Entry status** (doc 68, 5 Nov): per section, a line per subject with its teacher and, per exam,
  "entered / takers" with Complete / Partial / Not started and a "n pending" pop-up of names. It counts;
  it does not print who is missing, and nothing lists the absentees.
- **The old system**: `section_wise_missing_report.php` — class, exam and Theory / Practical / Both
  picked; a row per section, a column per subject: "entered / students" (green when complete, red when
  not) and the subject's teacher under it; no names. `class_wise_absent_report.php` is a copy of the
  mark-entry screen (nothing to take from it).
- **The data**: each student's marks per subject and exam (a mark, a code such as AB / ML, or nothing;
  a subject in parts has each part's mark or "absent"); who takes a subject comes from the subject
  choices and the class's papers in the exam; the sections' subject teachers and class teacher
  (Teacher assignments) and the parents' mobiles are already loaded for Entry status and Failing
  students (doc 77).

## Benchmark

- School ERPs used in India print a **"marks not entered" list** per subject and teacher before results,
  for the exam office to chase teachers, and an **absentee list** per exam for the class teachers to
  call home (re-test or medical certificate).
- The old system's missing report gives the counts per section and subject with the teacher; the names
  were looked up one subject at a time on the mark-entry screen.

## Decisions (user, 6 Nov 2026)

| Question               | Answer                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing report, layout | **By subject and teacher**: a line per subject × exam still incomplete, its teacher, missing / takers, the students' names                                                                 |
| What counts as absent  | **AB only**: the code AB on a paper, or a part marked absent                                                                                                                               |
| Absent report, layout  | **A line per student**: counts on top, then per section a line per absent student with roll, name, admission no, the parents' mobiles, the class teacher, where absent and how many papers |

Decided here (as the other Run reports): both follow the place picked (a section, or a class: each
section in turn), the **Subject** picker (that subject only), and an **Exam** picker (All exams, or
one of the register's exams; an exam-wise register: the exam picked at Run); both download as Excel and
PDF like the other reports.

## Plan

1. **Missing** (`report=missing`):
   - **Who is missing**: a student who takes the subject (subject choices) in an exam the class has a
     paper for, with no mark and no code; a subject in parts: any part not entered (the parts named,
     "Geography"). A code (AB, ML …) counts as entered — the absent report lists the AB.
   - **Counts on top**: the sections (and the class) × the exams: missing papers ("12 papers · 5
     students"), each opening the names; the total.
   - **A table per section** ("Missing marks — VI-A"): a line per subject × exam with anything missing,
     in the register's subject order then exam order: Subject (a slot: the member's name) · Exam ·
     Teacher (the section's subject teachers, or "no teacher mapped") · Missing / Takers · Students
     ("3 Rudra Bhat, 7 Aarav Mehta …", roll then name, the parts in brackets). "Nothing missing" when a
     section is complete. A note: "Missing = no mark and no code; a code (AB, ML …) counts as entered."
2. **Absent** (`report=absent`):
   - **Who**: a paper with the code AB, or a part marked absent (the part named).
   - **Counts on top**: the sections (and the class) × the exams: how many students absent, each opening
     the names; the total of students and papers.
   - **A table per section** ("Absent — VI-A"): a line per student absent at least once, by roll: Roll ·
     Student · Adm No · Parent mobile ("F 98… · M 97…") · Class teacher · Absent in ("PT1: ENGLISH,
     MATHEMATICS · TERM I: SCIENCE (Geography)") · Papers. "Nobody absent" when none.
3. **Filters**: the Run page shows an **Exam** picker for these two reports (All exams / each exam of
   the register; for a general register too, only for these reports); the Subject picker as today; the
   titles and the note name the filters; the downloads carry them.
4. **API**: the two report kinds; `exam` accepted for them on a general register (an exam not of the
   register refused, as now); the sections' teachers for both and the parents' mobiles for `absent`
   (the register's Run right, as Failing students).
5. **Help** (Mark registers → Run → Reports) and doc 68's report list.

## Parts

1. **The engine**: `missing()` and `absent()` in `packages/db/src/mark-register-reports.ts`, the kinds in
   `REPORTS`; unit tests — takers from the subject choices, a code counts as entered, a part missing,
   AB on a paper and on a part, ML not absent, the exam filter, a subject, a class with two sections,
   nothing missing / nobody absent, the mobiles and teachers.
2. **The API, the Run page and the checks**: the query (`report` kinds, `exam` for these two), the
   teachers and mobiles loaded, the Exam picker, the downloads; help and doc 68; the register e2e (the
   blocks, an unknown exam refused); register 417 in the browser with axe, nothing saved.

## Not in scope

Messages to teachers or parents from these reports (they are lists to print or download; Alpha has live
providers); missing co-scholastic grades, remarks or attendance (Entry status of those stays on the
exam's own pages).

## As built (6 Nov 2026)

- **Engine** (`packages/db/src/mark-register-reports.ts`): `papersOf()` (each student's paper of a
  subject in an exam: the class has the paper and the student takes the subject; the register's
  subject order, then exam order; `ReportInput.exam` one exam, `subject` one subject), `missingOf()`
  (no mark and no code; in parts, the parts with no entry), `absentOf()` (code AB, or parts marked
  absent); `missing()` — the counts (sections, the class; each exam and Total: "3 papers · 2
  students", the same text on screen and in the files, the names and what is missing on a click), then
  a table per section (#, Subject, Exam, Teacher or "no teacher mapped", Missing / takers in red, the
  students by roll with the parts missing; "Nothing missing"; the class teacher in the note);
  `absent()` — the counts (students per exam, Students, Papers), then a table per section (Roll,
  Student, Adm No, Parent mobile, Class teacher, Absent in, Papers; "Nobody absent"). `REPORTS`:
  "Missing marks", "Absent students" after Entry status.
- **API**: `report=missing|absent`; for them `exam` applies on any register (an exam-wise register: the
  exam picked), returned as the run's `exam` and `examName` (the page heading and the file names say
  it); the sections' teachers for both, the parents' mobiles for `absent`.
- **Admin**: the Run page's **Exam** picker for these two (All exams + each exam on a general
  register), a help line under the filters; the download route takes the two kinds.
- **Tests**: unit `mark-register-missing-absent.test.ts` (5: the menu; counts, drill, lines with
  teachers and a missing part; one exam, one subject, nothing missing; absent with AB on a paper and a
  part, ML not counted, a slot's own language, parents, class teacher; one exam, one subject, nobody
  absent); e2e `mark-registers` (the titles, nothing missing, Chitra absent in UT1 Maths, `exam=UT2` on
  a general register, an unknown exam refused). Register 417 on Alpha in the browser with axe (VII-A
  Missing marks at MT1, VI-A Absent students): clean.
