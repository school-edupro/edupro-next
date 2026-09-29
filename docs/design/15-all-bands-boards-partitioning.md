# 15 · Sprint 18: all class bands and boards, partitioning review, library completion

Plan row S18 (weeks 37–38), AI track S17–19. Migration `0030`.

## 1. Report cards for every band

The Sprint 17 engine renders one term from per-exam cells. Sprint 18 adds the **scholastic modes** the
CBSE bands need, as layout options — no new tables:

| Band      | Layout                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary   | **HPC** (holistic progress card): scholastic grades per subject (no totals), indicator areas with descriptors (A exceeds, B meets, C approaching), attendance, health, remarks                              |
| Middle    | **CCE**: scholastic marks and grades per exam with the term total, co-scholastic grades per area, rank in section                                                                                           |
| Secondary | **Components**: internal assessment columns built from exams (PT best-of-two scaled to 10, notebook 5, subject enrichment 5) plus the annual exam scaled to 80, total 100, grade, rank in class and section |
| Senior    | **Theory / practical**: per subject theory and practical columns (exams tagged by component), total, grade                                                                                                  |

Implementation: `scholastic.mode: 'marks' | 'cce' | 'components'` with `columns: [{ label, examCodes,
agg: 'sum' | 'avg' | 'best', scale }]` in the layout; the renderer scales each column from the exam
cells (`marks / max × scale`), aggregates, totals and grades from the class scale. `hpc_descriptors`
is a new section type (indicator grade → descriptor). Default layouts of all four bands are updated
and the snapshot harness covers each. Ranks: rank in section and in class both offered.

## 2. Board result import (CBSE files)

- `students.board_roll_no` (the board's roll number, per year in `enrolments.board_roll_no`).
- `board_results` (school, academic year, board, class label, roll number, student id when matched,
  subject code and name, theory, practical, total, grade, result, raw row) with a `board_result_imports`
  log (file, rows, matched, unmatched, report).
- `POST /exams/board-results/imports/validate` takes the CBSE result CSV (`ROLL NO, NAME, SUB CODE,
SUB NAME, THEORY, PRACTICAL/IA, TOTAL, GRADE, RESULT` — the shape of the school-wise result file the
  board publishes) or the compact one-row-per-pupil layout (`SUB1 … GRD6`), matches pupils by board
  roll number then by name within the class, reports unmatched rows, and `…/commit` stores them.
  `GET /exams/board-results?year&classLabel` lists with a subject-wise analysis; dataset
  `board_results` exports. Admin **Exams → Board results**.

## 3. Library completion

- **Sale**: `library_sales` (copy, buyer kind and id or name, price, receipt reference); a copy must be
  `withdrawn` or `damaged`; it becomes `sold`.
- **Digital library**: `library_digital_items` (title, kind link/file, url or file id, category,
  audience students/employees/everyone, class band filter, status); families and staff list what they
  may open; admin maintains through the masters framework (group Library).
- **Stock verification**: `library_stock_checks` (started, finished, counted, found, missing) and
  `library_stock_check_items`; a check takes scanned accession numbers (pasted or uploaded), marks
  `last_verified_on` on found copies, lists missing ones and can mark them `lost` on close.

## 4. Partitioning review and archive strategy (ADR-014)

Row growth at the pilot (about 3,000 pupils): `mark_entries` ≈ 150 k/year, `attendance_marks` ≈
650 k/year, `fee_payment_allocations` ≈ 60 k/year. Range partitioning pays off past several million
rows and complicates the unique keys the procedures rely on; the decision is **no partitioning in
Release 1**, with three measures instead: the missing index `fee_payment_allocations (payment_id)`,
`archive` copies of closed years' attendance marks moved by `app.archive_closed_years()` (monthly job
`archive.closed_years`, keeps the live table one to two years deep), and a re-check of the numbers at
the M4 gate with the query plans of the day book and the attendance marts.

## 5. Transport requests on the workflow

The default `transport_request` definition gains an escalation to `school_admin` after its 72-hour
SLA, so the Sprint 17 reminders and escalation apply; the direct decision stays for schools without
the definition.

## 6. AI track: results analytics for the principal

**Insights → Results** reads `mart.exam_results`: pass % and mean by class and section for each
exam of the year, the exam-to-exam trend, and the weakest subjects from `exam_results` joined to
`mark_entries`; a catalogue entry lets the assistant answer "results of class VI in PT1".

## 7. Out of scope, recorded

ETL of transport and library history (no dump); board result files of other boards (ICSE, state
boards) — the importer is column-mapped, so a second mapping is a small addition.
