# 65 — Examinations v2: term schemes and registers, subject choices, submit-verify-publish, DPS Noida cards, the HPC (plan, 29 Oct 2026)

Asked: understand the old examination module (`new folder/EANDE`, the school's PHP "Examination and
Evaluation") and make the examination module from it, following the Mobilise design guideline; the
examination module already in EduPro Next is to be checked against it and extended, not replaced.

## What was found

**EduPro Next today** (Sprints 14-18, migrations 0024-0030, 0084; `apps/api/src/modules/exams`):
exam types (with a weightage), exams per class with subjects (max / pass marks, weightage, elective
flag, date, lock), parts (Theory / Practical, Science in three), percentage grade scales per class per
exam, marks only through `app.enter_marks` (absent / exempt), indicator sets and grades, remark bank,
exam attendance, health, `app.compute_exam_results` (total, %, grade, pass / fail / incomplete, dense
rank in section and class), register, analysis (subjects, sections, top 10), promotion proposals,
report-card templates per band (primary "HPC" grades, middle "CCE", secondary components PT best-of
→ 10 + NB 5 + SE 5 + 80, senior 70 / 30) with releases, PDFs, fee-defaulter withholding, the parent
portal, CBSE board result import, the results mart. Teacher app: marks grid, exam register (remarks,
attendance, health). Gaps:

- the weightages are stored but never used; a term is only a list of exams on a release, its total a
  raw sum; best-of lives only in the card renderer, so ranks, pass / fail and promotion are per exam;
- no student-wise subjects: `is_elective` is ignored, non-takers come out "incomplete";
- marks codes are absent and exempt only; `max_marks > 0`, so a grade-only subject cannot be set;
- one lock (marks); no submit / verify; unlock has no reason; results recompute only by hand;
- the release is draft → released by one manager, parents are not told;
- no admin marks screen, no Excel upload of marks, no Excel of the register or the analysis;
- indicators are flat (code, name, area), and there is no screen to assign a set or enter grades;
- no pre-primary band (Nursery / KG fall into "primary"); the HPC is grades + descriptors only;
- **bug**: the template designer's check (`report-cards.dto.ts`) does not know the `hpc_descriptors`
  section nor a section's `mode` / `columns`, so saving the primary layout is refused and the
  secondary / senior term columns are silently dropped.

**The old module** (current generation, Oct 2026): exams per master class with upload switches
(marks, remarks, health, indicators, attendance, portal, report card); subjects per class and exam
(max, weightage, theory / practical, elective, order, lock); **student subject mapping** (subject
slots, streams, optional / additional, bulk, auto, CSV); mark entry by class → exams → subject from
the teacher's class mapping, codes AB, ML, EX, NM, NA, OD, L, NEW ADM, max 0 = grade only, Excel
upload, every write audited; locks per exam and class for marks, indicators, remarks, attendance and
health; indicators in three levels (group → indicator → sub-indicator → descriptor; option, text or
file entry, portfolio photos); remarks in categories with free text and "promoted to"; attendance
counted from daily attendance; **the Dynamic Mark Register**: a register template per class with
column kinds raw / part, average (all, best N, sum), convert (scale to a maximum, or a weight %),
attendance slab (≥96 % → 5 … ≥76 % → 1), mark-code treatments (zero, exclude, fixed, % of max,
pro-rata), rounding (whole numbers, .5 kept, round up), grade bands, result rules (33 %, XI-XII theory
and practical 33 % each, 1-2 subjects failed = compartment, 3 or more = fail, AB = absent), divisions
(1st ≥60, 2nd ≥45, pass ≥33), competition rank, versions that are locked and published, access per
register; DPS Noida report cards (I-V a six-page learning record; VI-VIII Term 1 and Term 2 side by
side; IX; X pre-term / mid-term; XI; XII), signatures by designation with images, a per-student
show / hide, publishing to the portal; toppers (top N, above / below a %), section-wise subject
analysis, missing marks, upload status, mark-range bands, merit lists by rank or division.

Card formulas of the old module (DPS Noida, current): VI-VIII PT 15 (MT1 / MT2 average converted) +
Subject Enrichment 5 + term exam 80 (with practical / listening / speaking), each term on its own,
whole numbers; IX Monday test 15 + SE 5 + practical + Term 1 80, AI / IFM out of the total; X Monday
test 35 + theory 50 / 70 / 80, the sixth subject out of the total; XI weekly test 20 + ASL 10 +
practicals 10 + theory 80, the additional subject printed last and out of the total; XII Monday test
35 + theory, all six subjects counted. Scales: VI-XII A1 91, A2 81, B1 71, B2 61, C1 51, C2 41, D 33,
E below; I-V A* 91-100, A 81-90, B* 71-80, B 61-70, C 51-60, D 50 and below; co-scholastic and
discipline A-C.

## Benchmark

Entab CampusCare, Edunext, Fedena, MyClassboard, Teachmint and the CBSE / NCERT guidance: an
assessment scheme per class and term (components, conversions, best-of, weightage) is set once and
drives the grade book, ranks, promotion and the card; registers are reports of the same numbers; marks
go teacher → verifier → locked, a reopen needs a reason; the principal publishes, parents are told and
read the card in the app; the foundational stage (Balvatika to Class II) uses the NCERT Holistic
Progress Card (domains, curricular goals, competencies on levels, the child's and the parent's voice,
portfolio); every grid uploads and downloads Excel.

## Decisions (asked 29 Oct 2026)

1. **Term marks: a scheme builder with CBSE presets, and the old register copied as it is.** One engine
   for both: a **mark scheme** is a register template (the old Dynamic Mark Register's columns and
   rules); any number of free registers may be made from it; one scheme per class and term is marked
   **the result scheme**, which makes the term result, ranks, promotion and the report card. Presets
   from the old DPS Noida formulas for VI-VIII, IX, X, XI and XII to start from.
2. **Report cards: the DPS Noida formats** on the existing template engine.
3. **Balvatika to Class II: the NCERT HPC** (NEP 2020).
4. **Submit, verify, publish**: the teacher submits a subject, the class teacher or HOD verifies it
   (locked), the principal publishes the results and cards, parents are told; reopening needs a
   reason.

Decided here, change any before building:

- **Subject choices**: each student's subjects for the year (the class's compulsory ones by default;
  optional, additional and stream choices per student, in bulk and by Excel); an additional subject is
  shown but kept out of the total unless the scheme counts it. Marks open only for a student's own
  subjects; a student without the subject is "not taken", never "incomplete".
- **Marks codes** as a master: AB (absent), ML (medical), EX (exempt), NA (not applicable), OD (on
  duty), L (late admission), NEW ADM; each with its treatment in a scheme (zero, out of the total,
  fixed marks, % of the maximum, pro-rata from the other exams) and whether it blocks the result (AB
  does). Absent and exempt as today map to AB and EX.
- **Grade-only subjects** (max 0: art, PE) take a grade from the subject's scale.
- Grade scales get presets (CBSE A1-E, primary A*-D, co-scholastic A-C, HPC levels) and may be set per
  subject as well as per class.
- **Locks per entry type** (marks, indicators, remarks, attendance, health) on an exam and class.
- **Status per subject and section**: open → submitted (teacher) → verified (class teacher, HOD or
  coordinator of that subject) → locked; a verifier may send it back with a remark; reopening a
  verified subject needs `exams.marks.unlock` and a reason (kept in the history).
- Results are worked out again on their own when marks change after verification (and before
  publishing); a published result is changed only by withdrawing it with a reason.
- **Publish**: the principal (a new right `exams.result.publish`) publishes a term's results and cards
  for chosen classes; parents get an SMS / app / e-mail message with the card in the parent app;
  per-student hold (the old show / hide) on top of the fee rule.
- **Signatures by role** (principal, vice principal, coordinator, class teacher) with an uploaded
  image, per class band; the class teacher's from the section.
- **Attendance on the card** counted from daily attendance for the term's dates (the office may
  correct it); present codes as daily attendance counts them.
- Classes I and II use the HPC; the DPS Noida I-II learning record is kept as a template the school may
  choose instead.
- Every new screen follows the Mobilise design (tokens, searchable drop-downs, View / Download icons,
  figures-first dashboards); Excel upload and download on every marks grid and register.

## Parts

### Part 1 — Subject choices, marks codes, grade-only subjects, locks per entry type, admin entry and Excel

- Migration: `student_subjects` (year, student, subject, kind compulsory / optional / additional,
  stream); `mark_codes` (code, name, blocks result, default treatment; seeded); `mark_entries.code`;
  `exam_subjects.max_marks` may be 0 (grade-only) with `grade_scale_id`; locks per entry type on
  `exam_classes`; `class_band` gains `pre_primary`; grade-scale presets.
- API: subject choices (class default, per student, bulk, Excel up / down); `app.enter_marks` takes
  codes and checks the student's subjects; locks per entry type; marks Excel template and upload
  (checked row by row, a preview first).
- Admin: Exams → an exam → **Marks entry** (class, section, subject, the grid with codes, Excel up /
  down); Subject choices page; locks per entry type on the exam page; the teacher grid takes codes.
- Fix: the template designer's check takes `hpc_descriptors`, `mode` and `columns`.
- Tests: e2e (codes, not taken, grade-only, locks per type, Excel upload with errors), a11y, browser.

### Part 2 — Submit, verify, publish

- Migration: `exam_subject_status` (exam, class, section, subject: open / submitted / verified /
  locked, by / at, remark), history; `exams.result.publish`; release status gains approved /
  published; per-student hold.
- API: submit, verify, send back, reopen with a reason; a marks-pending report (who has not entered or
  submitted, per subject and section); results worked out again after a change; publish (principal)
  with the parents' message; withdraw with a reason.
- Admin and teacher app: status badges on the grids, Submit and Verify buttons, a "Waiting to verify"
  list for verifiers, Marks pending, Publish results.
- Tests: e2e (the chain, send back, reopen reason, publish tells parents, hold), a11y, browser.

### Part 3 — Mark schemes and registers (the Dynamic Mark Register)

- Migration: `mark_schemes` (scope: classes, term name, the exams in it; versions; locked; the class's
  result scheme or a free register), `mark_scheme_columns` (kind raw / part / average all · best N ·
  sum / convert to a maximum · weight % / attendance slab / total; source columns; maximum; rounding;
  printed or hidden), the scheme's mark-code treatments, grade bands, result rules (pass %, theory and
  practical each, compartment up to N subjects, divisions, rank by total or %, ties share), who may use
  it; `term_results` (student, term, subject columns, total, %, grade, division, result, ranks).
- Engine in `packages/db` (one place, unit-tested against the old formulas); CBSE / DPS Noida presets
  VI-VIII, IX, X, XI, XII.
- API and admin: Schemes (build, copy a preset, preview on a section, lock a version, make it the
  class's result scheme), Register (any scheme on a section or class: the sheet on screen, Excel, PDF;
  merit list by rank or division); term results feed ranks, promotion and the cards.
- Tests: unit (each preset reproduces the old card's numbers on sample rows, rounding, best-of,
  attendance slab, codes, compartment / fail / absent, competition rank), e2e, a11y.

### Part 4 — DPS Noida report cards

- Templates on the existing engine: III-V learning record, VI-VIII Term 1 / Term 2, IX, X (pre-term,
  mid-term), XI, XII, plus I-II as an alternative; reading the term results; co-scholastic and
  discipline per term, participation, health, attendance, remarks (categories and "promoted to"),
  signatures by role with images, school seal, evaluation key.
- Signature setup (role, image, bands); remark categories; the per-student hold.
- Tests: snapshot per card (no real student data), e2e (data from the result scheme, hold), browser.

### Part 5 — The HPC for Balvatika to Class II, and three-level indicators

- Migration: indicator groups → indicators → sub-indicators → descriptors, entry kind (level, text,
  photo); HPC domains, curricular goals and competencies (NCERT foundational stage seeded, editable);
  levels master (default Beginner / Progressing / Proficient, the old cards' Exemplary may be added);
  portfolio photos; the child's "All about me" and the parent's feedback (entered by the teacher, or by
  the parent in the parent app).
- Teacher app and admin: assign indicator sets to an exam's classes (missing today), indicator / HPC
  entry grid per section with photos; the HPC card template.
- Tests: e2e, a11y, browser.

### Part 6 — Analysis and exports

- Section-wise subject analysis, mark-range bands (the school's ranges), toppers (top N, at or above /
  below a %), merit list by division, subject-teacher analysis, missing marks, upload status; each as a
  screen with Excel and PDF; register and analysis datasets in the report builder.
- Tests: e2e, a11y.

## Not in this plan

Exam timetable / date sheet, admit cards, seating plan, invigilation, question papers, answer-sheet
tracking, re-evaluation, exam fee, supplementary (compartment) exam marks, physical-education test
batteries (AAHPERD), ICSE / state board cards, moving the old module's mark history in (ETL).
