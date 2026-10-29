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

## As built (29 Oct 2026)

- **Part 1** (45b957b, migration 0276): `student_subjects` (year, student, subject, kind, stream) and
  `app.student_subject_kind()` (no choices recorded = every subject, as before); `mark_codes` seeded
  per school on first use (`app.mark_codes_seed`: AB zero + fails the subject; ML, EX, NA, OD, L, NEW
  ADM out of the maximum; a school's own code: zero / exclude / fixed / percent / pro-rata, pro-rata
  is out of the maximum in one exam); `mark_entries.code` and `.grade` (one of marks, code, grade;
  absent / exempt kept and following AB / EX); `exam_subjects.max_marks` may be 0 (grade-only, its own
  `grade_scale_id` or the class's); `exam_classes` locks for indicators, remarks, attendance, health
  (marks stay per subject); `class_band` `pre_primary` (only when set on the class). `app.enter_marks`
  takes codes and grades and refuses a subject the student does not take; `app.compute_exam_results`
  leaves out subjects not taken, additional and grade-only ones and applies each code's treatment.
  API: `GET/PUT exams/mark-codes`, `POST exams/grade-scales/presets` (CBSE_8POINT, PRIMARY_6POINT,
  CO_SCHOLASTIC_3; the HPC levels come with part 5), `PUT exams/:id/class-locks` (opening needs
  `exams.marks.unlock`), `GET exams/:id/marks/excel`, `POST exams/:id/marks/upload` (preview; `apply`
  saves only without errors; a part takes marks or AB), `exams/subject-choices` (sections, list, put,
  defaults, excel, upload). The marks sheet gives `codes`, `grades`, each row's `code`, `grade` and
  `taken`; the register sheet and the report card show a code in place of marks and a grade-only
  subject's grade. Admin: Exams → an exam → Marks entry (any section / subject / part, codes, grades,
  Excel), Subject choices (menu), grade scale per subject and entry locks on the exam page, Marks codes
  and Add the ready-made scales on Exam types and scales. Teacher app: a Code column instead of the AB /
  EX ticks, grades for grade-only subjects, "Does not take the subject". Template designer fix: the
  check accepts `hpc_descriptors`, `mode`, `columns`, `descriptors` and the `pre_primary` band.
- School admins hold `exams.marks.unlock` and not `exams.marks.enter` (the separation of duties kept),
  so the admin marks screen is read-only for them; the exam office or teachers with the entry right
  enter there.
- **Part 2** (migration 0277): `exam_entry_status` (exam subject × section: open / submitted /
  verified, by / at, remark) with `exam_entry_status_log`; rights `exams.marks.verify` (school and
  group admins, academic coordinators) and `exams.result.publish` (school and group admins);
  `app.enter_marks` refuses a student whose section's entry is not open. API (`exam-status.service.ts`):
  `GET exams/:id/entry-status` (every section × subject: takers, entered, status, counts),
  `GET exams/entry-status/waiting`, `POST exams/:id/entry-status/submit` (every student who takes it
  entered), `verify` (the class teacher or a coordinator of the section, or the verify right; the one
  who submitted only with the verify right; the exam's results worked out again), `send-back` (a note),
  `reopen` (`exams.marks.unlock` and a reason; refused while a release with the exam is published).
  Releases: draft → submitted ("Send to the principal") → released (`exams.result.publish`: families
  told by SMS and e-mail through the `result_published` template, `notified_count`) → withdrawn (a
  reason); `unverified` and `held` on a release; `PUT exams/report-cards/releases/:id/holds` holds one
  student's card (a reason): no message, the family sees it withheld and the PDF is refused
  (`report_card.held`). SMS goes once the school gives the template its DLT id (as every SMS).
  Admin: Marks status page per exam (figures, filters, Submit / Verify / Send back / Reopen), the
  status and the steps on the marks screen, Send to the principal / Publish / Withdraw (reason) and Hold
  on Report cards, the pre-primary band in releases and templates. Teacher app: the sheet's status and
  Submit for verification; Verify marks (class teachers) with Verify and Send back.
- Tests: exams-v2 e2e 13 (presets, codes, grade-only, choices, codes and grades, results, type locks,
  marks and choices by Excel, submit, verify, send back, reopen, waiting, publish with a held card and
  a withdrawal); sprint 14-18, 20, exam parts, permission coverage 66; db rls and report card; etl
  exams; a11y exam pages (marks, status, subject choices, report cards, masters) and the teacher app.
- **Part 3** (a7e85dd, migration 0278): the engine `packages/db/src/mark-scheme.ts` (`computeScheme`,
  `schemeProblems`, `roundBy`, `SCHEME_PRESETS`): columns raw (an exam's marks, or a part by name;
  `wholeIfNoParts`), average (all or best N; with a maximum, the average % of it), sum (a code's
  out-of-the-maximum part leaves the maximum too), convert, attendance slabs (from the exams' attendance
  days); a maximum may be "rest" (what the other sources of the marks obtained leave of its `target`);
  the exams' marks are worked out first, then pro-rata codes (the student's share of the subject's other
  exams), then the columns made from them. Rounding none / two / whole (half up) / half_kept / up. A
  blocking code (AB) makes the subject and the result "absent"; a missing mark "incomplete" (no rank);
  compartment up to N subjects; divisions only for a pass; competition ranks by total or % in section and
  class among the ranked. Ready-made DPS_VI_VIII, DPS_IX, DPS_X, DPS_XI (theory and practical each),
  DPS_XII (all six subjects count). Tables `mark_schemes` (purpose result / register, term code, classes,
  `def` JSON, draft / locked / superseded, versions with `previous_id`) and `term_results`. Locking a
  result scheme refuses another locked one holding a class for the term; locking a new version
  supersedes the one it came from (its term results go). API `exams/schemes` (presets, list, get,
  create from a preset with `examMap` or from `def`, put while a draft, delete a draft, lock,
  new-version, compute, register `?classSectionId|classId&view=marks|merit&format=json|xlsx|pdf`).
  Admin: Exams → Mark schemes and registers (list, new from a ready-made scheme with its exams mapped
  or blank), a scheme's page (the column editor, result rules, divisions, attendance slabs, grade
  scale; Lock, Work out the term results, New version, Remove), the register (section or class, by
  roll or merit list, Excel, PDF view / download). Not done: promotion proposals from term results.
- **Part 4** (migration 0279): `report_card_signatures` (role principal / vice principal /
  headmistress / coordinator / class teacher / exam in-charge / seal, label, name, image, classes; a
  class's own first), `exam_remarks.participation` and `.promoted_to`. The card data carries the
  student's term results (the locked result schemes' printed columns), signatures (images embedded by
  the worker and the preview), the class teacher, the marks codes, participation and promoted to; the
  student's class id. New card sections: `term_marks` (terms side by side, `terms`, `gradesOnly`),
  `cover` (the learning record's first page), `participation`, `promotion` (result, division, promoted
  to), `signatures` by `roles`, `seal`, `evaluation_key` (grades, how the marks are made, the codes),
  `page_break`; `co_scholastic` takes `areas` and `examCodes`, `attendance` `examCodes`. The template
  designer accepts them. `DPS_NOIDA_TEMPLATES`: dps_i_ii and dps_iii_v (learning record, primary),
  dps_vi_viii (Term 1 and Term 2, middle), dps_ix (Parts 1-5) and dps_x (secondary), dps_xi and dps_xii
  (senior); `POST exams/report-cards/templates/dps` installs them. A release's `templates` takes
  `class_<id>` keys before the band's (the API check, the batch and the worker). Signatures API
  (`exams/report-cards/signatures`, PNG / JPEG up to 300 KB, checked by its first bytes). Admin:
  Install the DPS Noida cards (templates page), Signatures and seal (with View / Download of the image),
  Template of each class on a release. Teacher app: exam register "Took part in" and "Promoted to".
  Not done: remark categories (the class teacher's remark is one text with the bank); they go with
  part 5's teacher feedback.
- Tests: mark-scheme unit 10; report-card renderer 10 (the DPS cards); exam-schemes e2e 8 (schemes,
  term results, register, DPS install, signatures, remarks, a card preview with the term result and a
  per-class template); all exam suites + permission coverage 74; db rls; workers 41; a11y schemes,
  report cards, templates, signatures, the teacher app (exam register added).
- **Part 5** (migrations 0280, 0281): `indicator_sets.kind` (indicators / hpc) and `level_words` (a
  level's word on the card); `indicators.parent_id` (one level deep: area → item → sub-item; an item
  with items under it is a heading, not entered), `kind` (level / text: a written observation),
  `description`, `descriptors` (level → what it means for the item); `indicator_entries.grade` may be
  empty when a note is given. `hpc_feedback` (exam, student, self / parent / teacher, `by_family`) and
  `portfolio_items` (a photo file, caption, the item it shows; soft-deleted). Right
  `exams.family.feedback` (parents). The NCERT foundational set (`hpc-preset.ts`, code
  HPC_FOUNDATION): six domains, thirteen curricular goals as headings, twenty-four competencies with a
  meaning per level (Beginner "Tries it with a lot of help", Progressing "Does it with some help",
  Proficient "Does it on their own"), the words Stream / Mountain / Sky; the school edits it. API:
  `PUT exams/indicator-sets` takes `kind`, `levelWords` and per item `parentCode`, `kind`,
  `description`, `descriptors` (up to 150 items; levels up to 20 letters; three levels at most);
  `POST exams/indicator-sets/hpc` adds the set once; `GET exams/:id/indicators` gives the tree
  (`heading`), `locked`, and for a progress card each child's feedback and photo count;
  `PUT exams/:id/indicators` refuses a heading, a level for a written item and an unknown level, and
  removes an entry given neither; `PUT exams/:id/hpc-feedback` (what a parent wrote in the app is
  kept: `exams.feedback_by_family`); `GET/POST exams/:id/portfolio`, `DELETE …/:itemId`,
  `GET …/:itemId/image` (PNG / JPEG up to 1 MB checked by its first bytes, twelve per child and exam,
  file classification personal); `GET/PUT exams/mine/feedback` (a parent, while the class's
  indicators and the exam are open); `POST exams/report-cards/templates/hpc`. The exam's classes carry
  `indicatorSetId`. All of it follows the indicators' entry right (class teacher or coordinator of the
  section) and lock. Card data: `hpc` (the term's exams with the HPC, levels and words, the tree with
  the level per exam, the last note and the meaning of the last level, the three voices, six photos
  filled by the worker and the preview); flat `indicators` leave out headings. Sections `hpc_record`,
  `hpc_feedback`, `portfolio`; template `hpc_foundational` (pre-primary; Classes I and II take it per
  class on the release). Admin: Exams → Indicators and HPC (the sets with their tree, add the NCERT
  set and its card, the set editor: levels, words, items with area, under, takes, meanings), the set
  per class on the exam page, an exam's Indicators and HPC (section and area grid with goals as
  column groups; a child's words and portfolio with View / Download and Remove, photo upload).
  Teacher app: Indicators and progress card (the same, Hindi labels). Parent app: Results shows "Your
  feedback for the progress card" per exam while it is open.
- Tests: exam-hpc e2e 5 (the set added once and its rules, levels and notes, headings refused, the
  three voices, photos, the parent's feedback kept and the lock, the card printing all of it);
  renderer 12 (two for the HPC card); all exam suites + permission coverage 79; db 73; workers 41;
  a11y the new admin pages, the teacher and family walks.
- **Part 6** (no migration): `exam-analysis.service.ts`. `GET exams/:id/reports/:kind` with
  `classId`, `classSectionId`, `format=json|xlsx|pdf`: `subjects` (each subject by section: students,
  appeared, absent, mean, mean %, highest, lowest, passed, pass %; a class line under several
  sections), `ranges` (students per band of the subject %: the class's grade scale when a class is
  chosen, the school's own lower ends `ranges=90,75,33`, else ten-point bands; a % between two bands
  goes to the lower), `toppers` (`top` N by the rank in the class or `by=section`, `minPct`,
  `belowPct`, or `subjectId` for a subject's toppers with competition ranks; needs the results worked
  out), `teachers` (each subject teacher's sections and subjects: appeared, mean %, pass %, highest %,
  their overall line; "(no subject teacher)" for the rest), `status` (per section and subject:
  students, entered, to enter, the status, submitted and verified by and when; a summary), `missing`
  (the students without a mark or a code, under a heading per section and subject).
  `GET exams/schemes/:id/divisions` (a locked result scheme: the merit list under a heading per
  division in the scheme's order, then compartment / fail / absent / incomplete; the count per
  section and in all). Staff read their scoped sections; subjects a student does not take and
  grade-only subjects are left out. Excel: a sheet per table; PDF: the first table, the others under
  it. Report builder datasets `exam_marks`, `exam_results`, `term_results` (locked schemes; the
  working year, or `academicYearId`; `examId` / `termCode`; scoped by section). Admin: an exam's
  Reports (the report, class, section and its filters; the tables; Excel, PDF View / Download through
  `/api/exam-report/<id>/<kind>/<format>/<filters>`), Merit by division on a locked result scheme,
  links from the exam and its result analysis.
- Tests: exam-analysis e2e 8 (each report's figures, ranges by the scale and the school's own, the
  toppers' filters, teachers, status and missing, Excel and PDF of each, divisions refused for a
  draft, the datasets); all exam suites + report builder + permission coverage 98; db 73; a11y the
  report pages.
- Not done: promotion proposals from the term results (part 3) and remark categories (part 4).
