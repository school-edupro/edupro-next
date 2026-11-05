# 74 — The Term 1 report card for VI-VIII, and the periodic test slip in its look

Status: plan (5 Nov 2026). Asked by the school from its old system's Class VIII Term 1 card (a real
pupil's card: its structure and wording only are used here, no names or numbers of it).

## The shared card

One A4 page, portrait, ruled boxes with green rules and light grey heading rows:

1. **Header**: the school's logo on the left, a second emblem on the right; the school's name centred
   (large, in the school's colour), its address in brackets and "Affiliated to CBSE, Delhi,
   Affiliation No. …" under it. Under the header, centred: "ACADEMIC SESSION: 2026-2027" and
   "REPORT CARD".
2. **Pupil**: two columns of "label : value" — Student's Name, Father's Name, Mother's Name on the
   left; Admission No., Roll No., Class / Section on the right. No photo.
3. **Scholastic areas**: "SCHOLASTIC AREAS" over the subject names, "TERM-1 (100 Marks)" over the
   columns *Periodic Test (15)*, *Subject Enrichment (5)*, *Half Yearly Examination (80)*, *Marks
   Obtained (100)*, *GRADE*. The parts with two decimals (9.64, 4.50, 64.50), the marks obtained a
   whole number, the grade. The pupil's subjects only, the elective (a third language) among them.
   No total, percentage or rank rows.
4. **Co-scholastic and health, side by side**: on the left "CO-SCHOLASTIC AREAS: TERM 1 [on a 3-point
   [A-C] Grading Scale]" with GRADE (Work education, Visual art, Performing arts, Health & physical
   education, Literary & creative skills, Scientific skills); on the right "Health Status" (Height
   (cm), Weight (kg)) and "Attendance" (No. of Working Days, No. of Days Attended, % of Attendance).
5. **Discipline**: one row, "DISCIPLINE (ON A 3-POINT [A-C] GRADING SCALE)", with its grade.
6. **Class teacher's remark**: "CLASS TEACHER'S REMARK : ( name )" and the remark (one or two lines).
7. **Place and date**: "PLACE: <the school's town>" left, "DATE: dd-mm-yyyy" right.
8. **Signatures**: Parent, Class Teacher, Coordinator, Vice Principal, Principal, School Seal — the
   signature images over the names, the seal image over "School Seal".
9. **Grading key**: "Grading Scale For Scholastic Areas: Grades are awarded on an 8-point grading
   scale as follows", a two-row table: Marks Range 91-100, 81-90, 71-80, 61-70, 51-60, 41-50, 33-40,
   32 & Below; GRADE A1, A2, B1, B2, C1, C2, D, E (Needs Improvement).

## What EduPro has

- The Term I result register (364, locked, VI-VIII) is already built as the card's columns: Periodic
  test (15) (the periodic tests averaged and scaled), Subject enrichment (5) (the activities averaged
  and scaled), Term exam (80), total out of 100, grade (CBSE A1-E). A term card release (`kind
  'term'`, T1: release 1) prints from it through the `term_marks` section.
- "Report card VI-VIII (Term 1 and Term 2)" (`rc_vi_viii`) prints the same figures, but in our
  general look: pupil grid with a photo, Total / Percentage / Grade / Rank rows, co-scholastic by exam,
  attendance and health as separate tables, the remark categories with labels, three signatures and a
  seal circle, the key as one line; it runs to two pages.
- "Periodic test slip (VI-VIII)" (`test_slip_middle`, the exam releases' design: PT1 …) prints one
  exam: Subject / Maximum marks / Marks obtained / Grade, Total · Percentage · Grade tiles, the remark,
  three signatures.
- Data the card needs that exists: the school's name, logo, address, affiliation; the second emblem
  as the design's picture `logo_2` (0308); the pupil, parents, admission no, roll, class and section;
  the term's columns and grades; co-scholastic grades per area and exam; height, weight; attendance per
  exam; the general remark and the remark categories; the class teacher's name; signature images by
  role (parent, class teacher, coordinator, vice principal, principal) and the seal (role `seal`); the
  grade scale with its remarks.
- Missing: the school's town on its own (the card prints the address as one line) — the address has
  `city`, it is added to the card data as `school.city`.
- On Alpha, register 364 puts Hindi in the SUBJECT-2 slot with the foreign languages, so a VIII pupil
  who takes Hindi and French prints only one of them (the slot takes one member).

## Decisions (asked 5 Nov 2026)

- A new ready-made design **"Report card VI-VIII (Term 1)"** exactly like the shared card, used on the
  Term 1 card release for VI-VIII; **"Periodic test slip (VI-VIII)"** takes the same look with its one
  exam's marks (maximum, obtained, grade).
- **All six signature places** as on the card, each with the uploaded image where the school has one
  (a blank line over the name where not).
- Decided here (the shared card's own look, as the learning record did in doc 73): green rules and
  light grey heading rows; the school's name in the school's colour; the other bands' slips stay as
  they are.

## Design

### The sections (`packages/db/src/classic-card-html.ts`, prefix `cl_`)

A family of sections drawn as ruled boxes, used by both designs; the existing sections stay as they
are for the other cards.

- `cl_header`: logo left, emblem right (`logo_2`; nothing when not uploaded), the name centred, the
  address in brackets, "Affiliated to CBSE, Delhi, Affiliation No. …" (only with an affiliation
  number); under it "ACADEMIC SESSION: <year>" and the title (option `title`, default "REPORT CARD";
  the slip: the exam's name, e.g. "PERIODIC TEST 1").
- `cl_student`: the two columns of "label : value"; options for the labels are not needed (the
  card's wording).
- `cl_term_marks`: from the term result (`termResults`, the release's term): "SCHOLASTIC AREAS" and
  "<TERM-1> (<max> Marks)" over the columns; each column of the register with its label (Periodic
  test (15) …), then Marks obtained (<max>) and Grade; option `termLabel` (default "TERM-<n>"),
  `decimals` for the parts (default 2), the total as the register works it out. The pupil's subjects
  in the register's order; an additional subject marked as now; no total rows.
- `cl_exam_marks` (the slip): one exam: Subject name / Maximum marks / Marks obtained / Grade, the
  header band "<exam name> (<max> Marks)"; under the table one ruled row: Total, Percentage, Grade.
- `cl_co_health`: the co-scholastic table on the left (the areas of the term's last exam, without the
  Discipline area; title "CO-SCHOLASTIC AREAS: <TERM 1> [on a 3-point [A-C] Grading Scale]", the
  points from the scale's levels), on the right Health Status (height, weight) and Attendance (working
  days, days attended, % to one decimal). A side with nothing entered keeps its rows with blanks.
- `cl_discipline`: the Discipline area's grade (option `area`, default "Discipline").
- `cl_remark`: "CLASS TEACHER'S REMARK : ( <class teacher> )" and the general remark of the term's
  last exam, then the remark categories' words as sentences (no labels), at most four lines.
- `cl_sign`: "PLACE: <town>" and "DATE: <the card's date>" (dd-mm-yyyy: the date the card is made),
  then the roles (option `roles`, default parent, class teacher, coordinator, vice principal,
  principal) and the seal, each with its image over a line and the name under it.
- `cl_grade_key`: the grade scale as the two-row table (marks ranges from the scale's bands, the
  lowest "<n> & Below", the lowest grade with its remark in brackets when it has one).

The page: A4 210 × 297 mm, margins 8 mm, one page for up to 9 subjects and 8 co-scholastic areas (the
rows shrink a little for more); the print CSS in hex as the other card styles.

### The designs

- `rc_vi_viii_t1` **"Report card VI-VIII (Term 1)"** (band middle): `cl_header`, `cl_student`,
  `cl_term_marks` (term T1), `cl_co_health`, `cl_discipline`, `cl_remark`, `cl_sign`, `cl_grade_key`.
  Added to the ready-made cards (Install the ready-made cards adds it where missing).
- `test_slip_middle` **"Periodic test slip (VI-VIII)"**: `cl_header` (title: the exam), `cl_student`,
  `cl_exam_marks`, `cl_co_health`, `cl_discipline`, `cl_remark`, `cl_sign`, `cl_grade_key`. A
  migration (0309) gives the new layout to the schools' `test_slip_middle` rows still on the old
  layout (a school's own changed copy is kept, as 0308 did for the HPC).
- The designer's Pictures: the emblem slot `logo_2` is offered for these designs too.

### On Alpha (dev data, after the build)

- Install the ready-made cards (adds "Report card VI-VIII (Term 1)"); set it as the Term 1 release's
  design for VI, VII and VIII (the release is released: its cards print with the new design from
  then; nothing is sent).
- Optional, asked at the end: register 364's slot — Hindi out of SUBJECT-2 into a "Second language"
  slot with Sanskrit, the foreign languages into a "Third language" slot, so a pupil with Hindi and
  French prints both (364 is locked: the change is a new version, locked again).

## Parts

1. **The sections and the card data**: `cl_*` in `classic-card-html.ts` with their CSS, `school.city`,
   the sample data for the designer; unit tests (each section's rows and labels, the term label and
   maximum, decimals, the co-scholastic split without Discipline, the remark lines, the key's ranges,
   one page for 7 subjects).
2. **The designs**: `rc_vi_viii_t1` in the ready-made cards, the new `test_slip_middle` layout, 0309
   for the existing slips, the emblem picture for them; API e2e (install adds it once; the slip
   upgraded, a changed one kept; a term card and an exam card render with them); the help.
3. **On Alpha and the check**: install, set the Term 1 release's design for VI-VIII; print VIII-A's
   card and an exam card (PT1) to PDF and compare with the shared card page by page (one A4 page, the
   same boxes and order); the designer's preview with axe. Then the question on register 364.

## Not in scope

The other bands' slips and cards; a Term 2 / annual version of this card (the same sections with
`termLabel` "TERM-2" can be added later); the card's photo (the shared card has none).

## As built (5 Nov 2026)

- **Sections** (`packages/db/src/classic-card-html.ts`, exported; `CL_CSS` in every card document):
  `cl_header` (logo, the name, "( address )", "Affiliated to <board>[, Delhi for CBSE], Affiliation No.
  …" when there is a number, the second emblem `logo_2`; "ACADEMIC SESSION: 2026-2027" from 2026-27
  and the title, or the release's name with `releaseTitle`), `cl_student`, `cl_term_marks` (the
  release's term, else option `terms[0]`, else the first; "TERM-1 (100 Marks)" when every subject has
  one maximum; the parts to `decimals` (2), the total as the register works it out; a heading's
  "(15)" on a line of its own), `cl_exam_marks` (one test: maximum / obtained / grade, then TOTAL and
  PERCENTAGE rows; several tests: each one's marks and grade and the total), `cl_co_health` (one
  table, a narrow gap column between the sides, so the rows always meet; the co-scholastic items of
  every area but Discipline, each with its last grade; height and weight without trailing zeros; the
  last exam with attendance, % to one decimal; the shorter side takes blank rows), `cl_discipline`
  (nothing when there is no Discipline area or item), `cl_remark` (the general remark of the latest
  exam, then the categories' words, four lines at most), `cl_sign` (Place: the school's town, Date: the
  day the card is made; parent, class teacher, coordinator, vice principal, principal and the seal,
  each image over its name), `cl_grade_key` (the bands high to low, the lowest "<n> & Below", the
  lowest grade with its remark when the scale has one). The frame: `<div class="cl">` inside `.rc`;
  the page's padding 6 × 7 mm; rows 7 mm; the header's green #1B7F37 (5.1 : 1 on white), the rules
  #3C9D4E, the headings' fill #E9E9E9.
- **Data**: `school.board` (schools.board) and `school.city` (address.city); the sample has both.
- **Designs**: `CLASSIC_TERM_LAYOUT` → ready-made `rc_vi_viii_t1` "Report card VI-VIII (Term 1)";
  `CLASSIC_SLIP_LAYOUT` → `test_slip_middle`; 0309 moves a slip still on the first layout (the other
  bands' slips unchanged).
- **Designer**: Pictures shows the second emblem only for a `cl_` design. The API's layout schema now
  takes the `lr_` and `cl_` section types, `mode: 'slip'`, the learning record's `caption`,
  `termLabels`, `note`, `remarks`, the classic `releaseTitle`, `termLabel`, `decimals`, and up to seven
  signing roles — the learning record's and the slip's layouts were refused on save before.
- **Help**: the VI-VIII card and slip; the term card's example no longer names a school.
- **Tests**: `packages/db/test/classic-card.test.ts` (9: each section's rows, the slip with one and with
  two tests, the rows meeting with more areas, the six places with images and the seal, the key, the
  designs, a frame per pupil); `report-card.test.ts` (the ready-made list; the old slip tests on the
  I-V slip); API e2e `exam-schemes` (installed once; the Term 1 card from a release: the session, the
  term heading, the parts, 79, the six places, the seal's image, the key; the designer saves a classic
  layout with `termLabel` and `decimals`), `exam-hpc` (the learning record's layout saves); the card
  suites pass (exam-schemes, exam-hpc, exam-promotion-remarks, exams-v2, sprint17, sprint18: 50 tests).
- **On Alpha**: 0309 applied (Periodic test slip (VI-VIII), id 1092, v2); the ready-made cards
  installed (Report card VI-VIII (Term 1), id 1450); the Term 1 release (1) prints it for VI, VII and
  VIII (its status unchanged, nothing sent). VIII-A's Term 1 card and PT1 slip printed to PDF: one A4
  page each, the boxes in the shared card's order. The designer's preview with axe: clean (after the
  header's green was darkened).
- **Differences from the shared card that are Alpha's data**: the key's lowest grade has no word (the
  school's grade scale has no remark for E; the card prints "E (Needs Improvement)" once it has); the
  principal's signature is set for IX-XII only; the second emblem is not uploaded; register 364 puts
  Hindi and the foreign languages in one slot, so a pupil with Hindi and French prints one of them.
  The workers render the PDFs with the package built before they started: they take the new card
  when restarted.
