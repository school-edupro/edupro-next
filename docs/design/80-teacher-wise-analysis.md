# 80 · Teacher-wise with the Result Analysis figures

Status: built 6 Nov 2026 (no migration; **As built** at the end). Asked by the school on a mark register's Run, Reports → Teacher-wise
(`/exams/schemes/417/register?place=s:143&report=teacher`), with a screenshot of the Result Analysis
figures: "in this page add share parameter".

## What there is

- **Teacher-wise** (doc 68, phase 2): a block per subject teacher (Teacher assignments), a row per class
  the teacher teaches (section × subject, "shared" when two teachers share it) with Students, Appeared,
  Avg %, Pass %, Highest, Failed, and a Total row; "No teacher mapped" last.
- **Analysis** (the old Result Analysis, 5 Nov): per subject, the figures down the side — Total
  students, Absent, Appeared, the register's % bands (0-32, 33-40, 40-50 … 90-100), the cumulative
  counts (at least 50% … at least 90%), Highest marks (out of the maximum), Lowest marks, Average marks,
  Passing % — each count opening its students. The bands and cut-offs are the register's (step 6,
  Result analysis).

## Decisions (user, 6 Nov 2026)

| Question      | Answer                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Layout        | **Figures down, classes across**: a column per class the teacher teaches, then a Total column                      |
| Avg %, Failed | **Kept**, after Average marks and Passing %                                                                        |
| Total         | **Counts and % always; Highest, Lowest and Average marks only when every class has the same maximum** (else blank) |

## Plan

1. **A block per teacher** ("MRS RAO"), as now in order ("No teacher mapped" last): the figures down the
   side — Total students, Absent, Appeared, the bands, the cumulative counts, Highest marks, Lowest
   marks, Average marks, Passing %, Average %, Failed — and across: a column per class ("VI-A ·
   ENGLISH", a slot's language as its own; "shared" in the heading's tooltip when two teachers share
   it), then **Total** (every class of the teacher together). The figures are the Analysis' own (the
   same rules: absent = withheld, appeared = a % worked out, Passing % = passed ÷ appeared), each count
   opening its students; the bands' and the cumulative headings grouped as in Analysis.
2. **Total**: the counts, the bands, the cumulative, Passing %, Average % (over every student who
   appeared, each class weighted by its size) and Failed over all the classes; Highest / Lowest /
   Average marks only when every class has the same maximum.
3. **Note** as now (who the teacher is, the rules, "assign the teacher to credit them").
4. Help (Mark registers → Run → Reports) and doc 68's list; the files as the other reports.

## Parts

1. **The engine**: `teacherWise()` in `packages/db/src/mark-register-reports.ts` on the Analysis' figures
   (the shared `figures` taken out of `analysis()`); unit tests — the rows, a column per class and the
   Total, the marks blank in Total with two maxima, counts that open their students, no teacher last.
2. **The checks**: the register e2e (the block's figures), help and doc 68; register 417 (VI-A, and the
   class) in the browser with axe.

## Not in scope

A teacher's own login seeing only their block (the Run rights stay as they are); exam-wise splits of a
teacher's classes (an exam-wise register already shows the exam picked).

## As built (6 Nov 2026)

- **Engine** (`packages/db/src/mark-register-reports.ts`): `analysisFigures()` — the Result Analysis
  figures taken out of `analysis()` (the bands and cut-offs, the figures' columns and `figures(title,
takers)`), used by Analysis and Teacher-wise alike; `teacherWise()` — a block per teacher titled
  "MRS RAO — 2 classes", the rows Total students … Passing %, Average % (over the students who
  appeared), Failed; a column per class "VI-A · ENGLISH" ("(shared)" in the heading when two teachers
  share it: visible in print, not a tooltip) and Total (shaded), whose Highest / Lowest / Average marks
  are blank when the classes' maxima differ; the note as before plus the Total's rule.
- **Tests**: unit (the rows and columns, the figures matching the old Teacher-wise totals, a count's
  students, a shared class, two maxima leaving the Total's marks blank); `mark-registers` e2e (the
  title, Total last, the rows, the Total adding up the classes). Register 417 on Alpha, VI-A and Class
  VI in the browser with axe: clean.
- **Help** and doc 68's list.
