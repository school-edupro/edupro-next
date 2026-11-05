# 77 · Failing students: by how many subjects, with every subject's marks, teachers and parents

Status: built 5 Nov 2026 (no migration; **As built** at the end). Asked by the school on a mark register's
Run, Reports → Failing students (`/exams/schemes/:id/register?place=…&report=failing`): pick the students
failing in 2, 3 or 4 subjects (a number and a range), and see their marks subject by subject.

## What it does today (doc 68, phase 2)

- "Students failing in one or more subjects": a line per failed subject (section, student, the subject,
  its %, the final total and %), "NIL" for a section with nobody failing.
- No filter: a **subject** picked changes nothing; the number of subjects failed is not shown or
  filterable; the student's other subjects are not shown.
- A student whose final is not complete yet (marks missing) is listed with the subjects already failed.

## Benchmark

- **PowerSchool** At Risk report: a field for the **minimum number of failing classes**, the failing
  courses and grades listed per student; the Current Grades report filtered to D and F.
- **Kendriya Vidyalaya** result analyses (the format Indian schools print): appeared / pass / compartment
  / fail counts and a subject-wise table of failures.
- **CBSE practice**: failing one or two subjects = compartment, more = fail; the register already
  follows the register's "compartment up to N" setting.
- University ERPs: an "Arrears list" (students with subjects to clear).
- None found shows a count range _and_ the marks of every subject on one sheet; EduPro can.

## Decisions (user, 5 Nov 2026; the plan changed twice the same day)

| Question                      | Answer                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| The number of subjects failed | A **from – to** range (2 to 2, 3 to 4, 2 and more)                                              |
| A marks range too             | **Yes**: a **final % from – to** besides the count                                              |
| Which students                | Only those **with a final worked out** (Compartment / Fail); incomplete finals left out         |
| The list                      | **A table per count** ("Failed in 2 subjects", "Failed in 3 subjects" …), a line per student    |
| What marks show               | **Every subject's marks** out of its maximum, the failed ones in red                            |
| Teachers                      | **The class teacher**, and **each failed subject's teacher** (Teacher assignments)              |
| Parents                       | **The father's and mother's mobile** beside the student, for follow-up calls                    |
| A subject picked              | The students failing it                                                                         |
| Summaries on top              | **Two**: sections × failed in 1 / 2 / 3 / 4 / 5+, and each subject × sections (how many failed) |

## Plan

1. **Filters**: **Failed in from – to subjects** (1–10; to empty = and more: "2 to 2" = exactly two,
   "3 to 4", "2 and more") and **Final % from – to** (0–100). The titles say them.
2. **Who**: students with a final worked out and at least one failed subject (Compartment or Fail); a
   student whose marks are still missing is not listed (the note above the report names them).
3. **Summary by count**: the sections (rows) and the class against **Failed in 1 / 2 / 3 / 4 / 5 or
   more** and Total, each count opening its students; the count range's columns marked.
4. **Summary by subject**: each subject (a slot's languages apart) against the sections and the class:
   how many failed it, each count opening its students.
5. **A table per count** in the range ("Failed in 2 subjects — 3 students"; counts with nobody left
   out; "Nobody in this range" when none at all): a line per student — Section · Roll · Student · Adm
   No · Parent mobile (F / M) · Class teacher · a column per subject in the register's order with its
   marks out of the maximum (failed in red; a code as itself; "—" not taken; a slot: the student's own
   subject's code and marks) · Final total · % · Result · Teachers of the failed subjects ("ENGLISH –
   Mrs Rao · CS – Mr Das"). Students by section, then roll.
6. **A subject picked** (English): only the students failing it; everything else as above.
7. The Run page: **Failed in from / to**, **Final % from / to** and **Show** (as Toppers); the downloads
   carry them; the API loads the sections' teachers and the listed students' father and mother mobiles
   for this report (staff with the register's Run right only, as the register itself); help, doc 68;
   unit tests (counts, ranges, subject, teachers, mobiles, incomplete left out), the register e2e, a11y.

## Built where

- `failing()` in `packages/db/src/mark-register-reports.ts` (`ReportInput.failFrom`, `failTo`,
  `pctFrom`, `pctTo`, the picked `subject`, `teachers`, and `parents`: a student's father / mother
  mobile); `RegisterQuerySchema` `failFrom`, `failTo` (1–10) beside `pctFrom`, `pctTo`;
  `MarkSchemesService` passes them and loads the teachers and the parents' mobiles for `failing`; the
  Run page and the `/api/exam-register` download route.

## Questions for the school

Answered 5 Nov 2026 (Decisions above).

## As built (5 Nov 2026)

- **Engine** (`failing()` in `packages/db/src/mark-register-reports.ts`; `ReportInput.failFrom`,
  `failTo`, `parents`, with `pctFrom`, `pctTo`, `subject`, `teachers`): the students with a final
  (Compartment / Fail) in the % range, failing the subject picked; the counts table (sections, the
  class, Failed in 1–4 and 5+, Total; the range's columns shaded; a note with the filters); the subjects
  table (each subject or slot language × sections and the class); a table per number failed in the
  range with a line per student (Section in a class, Roll, Student, Adm No, Parent mobile, Class teacher,
  the subjects someone listed takes — the marks out of the maximum, a failed one in red with its name
  as the tooltip, a slot with the member's code, "—" not taken — Final total, %, Result, the failed
  subjects' teachers or "no teacher mapped"); "Nobody …" when no one is in the range. A failed subject
  is one that counts in the final.
- **API**: `failFrom`, `failTo` (1–10; a "from" above the "to" refused, 400); for `failing` the
  sections' teachers and the parents' mobiles (`parentMobiles`: father and mother, else the first
  guardian, "F 98… · M 97…") are loaded, and every subject is passed (a subject picked only chooses the
  students).
- **Admin**: the Run page's **Failed in from / to**, **Final % from / to** and **Show**, a help line;
  the downloads carry the filters (`/api/exam-register` takes `failFrom`, `failTo`).
- **Tests**: unit (the counts, the subjects, the lines with mobiles and teachers, red cells, the count
  and % ranges, a subject, nobody, one section); `mark-registers` e2e (the blocks, the note, nobody,
  the 400); the Run page in the browser with axe (register 417, VI: the counts, Failed in 4 after Show,
  the Excel link keeps the filter).
