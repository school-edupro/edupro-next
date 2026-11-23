# Exams and results — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

The school sets up exam types (PT, Term) and, per academic year, exams (PT1, Term I) for some classes, each with
its subjects (papers: maximum, pass marks, date, parts such as Theory / Practical). Each student's subject choices
say who takes what. Teachers enter marks (or a code such as AB, or a grade) per subject and section, submit them;
the class teacher or HOD verifies them (verified = locked). The database then works out each student's exam result
(`exam_results`) and, through locked mark schemes ("result registers"), the term result (`term_results`). Teachers
also enter co-scholastic indicators, remarks, exam attendance and the HPC (Balvatika to II). The principal publishes
report cards class by class (`report_card_releases`), may hold a card, and then tells families. CBSE board results
(Class X / XII) are imported from the gazette file for the board analysis.

## Tables

| Table                       | One row is                                                                   | Key columns                                                                                                                                                                     | For reports                             |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| exam_types                  | a kind of exam (PT, Term)                                                    | code, name, areas[], weightage (stored, not used in sums), status, deleted_at                                                                                                   | master                                  |
| exams                       | one exam of a year                                                           | academic_year_id, exam_type_id, code (unique per year), starts_on, ends_on, marks_locked, show_on_portal, areas[], deleted_at                                                   | main (spine for exam reports)           |
| exam_classes                | a class that sits an exam                                                    | exam_id, class_id (unique pair), grade_scale_id (the class's result scale), indicators_locked, remarks_locked, attendance_locked, health_locked                                 | detail                                  |
| exam_subjects               | one paper of an exam for a class                                             | exam_id, class_id, subject_id (unique), max_marks (0 = grade-only), pass_marks, grade_scale_id, exam_on, starts_at, ends_at, entry_locked                                       | main (spine for marks)                  |
| exam_subject_parts          | a part of a paper (Theory, Practical, Geography…)                            | exam_subject_id, name, subject_id (sub-subject), max_marks                                                                                                                      | detail                                  |
| exam_type_subjects          | the "subject marks master": papers an exam type holds per class and year     | academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, is_optional, is_part                                                                               | master                                  |
| class_subject_parts         | default parts of a class subject (share of the maximum)                      | class_subject_id, subject_id, share                                                                                                                                             | master                                  |
| subject_groups              | a choice group of a class ("Second language: pick 1")                        | academic_year_id, class_id, name, kind (optional / additional), pick_min, pick_max                                                                                              | master                                  |
| class_streams               | a stream of a class (Science-PCM)                                            | academic_year_id, class_id, name                                                                                                                                                | master                                  |
| class_stream_subjects       | a class subject in a stream                                                  | stream_id, class_subject_id                                                                                                                                                     | master                                  |
| student_subjects            | one subject a student takes in a year                                        | academic_year_id, student_id, subject_id (unique), kind (compulsory / optional / additional), opted_additional, stream                                                          | main (who takes what)                   |
| student_subject_changes     | a subject swapped mid-year                                                   | academic_year_id, student_id, from_subject_id, to_subject_id, from_exam_id (first exam with the new subject), reason                                                            | history                                 |
| mark_codes                  | a code written instead of marks (AB, ML, EX, NA, OD, L, NEW ADM)             | code (unique), treatment, value, blocks_result, status                                                                                                                          | master                                  |
| mark_entries                | one student's mark in one paper                                              | exam_subject_id, student_id (unique), marks / code / grade (exactly one), absent, exempt, entered_by, updated_at                                                                | main (the raw marks)                    |
| mark_part_entries           | one student's mark in one part                                               | part_id, student_id (unique), marks, absent                                                                                                                                     | detail (parts add up into mark_entries) |
| exam_entry_status           | submit / verify state of a paper in a section                                | exam_subject_id, class_section_id (unique), status, submitted_by, submitted_at, verified_by, verified_at, entry_open                                                            | main (entry progress)                   |
| exam_entry_status_log       | each move of that state                                                      | exam_subject_id, class_section_id, from_status, to_status, note, actor_user_id, at                                                                                              | history                                 |
| exam_area_entry_opens       | a section's indicators / remarks / attendance / health reopened under a lock | exam_id, class_section_id, area, reason, closes_at, closed_at, closed_how                                                                                                       | history                                 |
| exam_results                | one student's computed result in one exam                                    | exam_id, student_id (unique), class_id, class_section_id, total, max_total, pct, grade, points, failed_subjects, result, rank_in_section, rank_in_class, computed_at            | main (cached, see traps)                |
| mark_schemes                | a mark register / result scheme, versioned                                   | academic_year_id, chain_id, version, purpose (result / register), term_code, class_ids[], def jsonb, status, computed_at, deleted_at                                            | master (with versions)                  |
| mark_scheme_access          | a person's rights on a register chain                                        | chain_id, user_id, can_run, can_edit, can_delete, can_assign                                                                                                                    | internal                                |
| term_results                | one student's term result from a result scheme                               | scheme_id, student_id (unique), term_code, class_id, class_section_id, subjects jsonb, total, max_total, pct, grade, division, result, failed[], rank_in_section, rank_in_class | main (term / annual result)             |
| grade_scales                | a grading scale                                                              | code, name, status, deleted_at                                                                                                                                                  | master                                  |
| grade_bands                 | one band of a scale                                                          | scale_id, min_pct, max_pct, grade, points, sort_order                                                                                                                           | master                                  |
| grade_registers             | a grade register (indicator grades sheet), versioned                         | academic_year_id, chain_id, version, class_ids[], def jsonb, access_type, status, deleted_at                                                                                    | master (with versions)                  |
| grade_register_access       | a person's rights on a grade register chain                                  | chain_id, user_id, can_run, can_edit, can_delete, can_assign                                                                                                                    | internal                                |
| indicator_sets              | a set of co-scholastic indicators or an HPC                                  | code, name, kind (indicators / hpc), grades[] (levels), level_words, deleted_at                                                                                                 | master                                  |
| indicators                  | one item of a set (tree: area → goal → competency)                           | set_id, code, name, area (text), parent_id, kind (level / text), levels[]                                                                                                       | master                                  |
| indicator_areas             | the school's list of areas (domains) and their print order                   | name, sort_order, status                                                                                                                                                        | master                                  |
| indicator_scales            | the school's list of level scales                                            | name, levels[]                                                                                                                                                                  | master                                  |
| indicator_set_classes       | the default set of a class                                                   | set_id, class_id (one set per class)                                                                                                                                            | master                                  |
| exam_indicator_sets         | the set a class uses in an exam                                              | exam_id, class_id (unique), set_id                                                                                                                                              | detail                                  |
| indicator_entries           | one student's level (or note) on one indicator in an exam                    | exam_id, indicator_id, student_id (unique), grade, note                                                                                                                         | main (co-scholastic)                    |
| remark_categories           | a remark list (A / B / C, "English remarks")                                 | code, name, subject_id, class_ids[], free_text                                                                                                                                  | master                                  |
| remark_bank                 | a ready-made remark                                                          | code (unique), text, class_id, category_id                                                                                                                                      | master                                  |
| exam_remarks                | the class teacher's remark of a student in an exam                           | exam_id, student_id (unique), remark, participation, promoted_to, bank_code                                                                                                     | detail                                  |
| exam_remark_items           | one remark per category per student per exam                                 | exam_id, student_id, category_id (unique), text, bank_code                                                                                                                      | detail                                  |
| exam_attendance             | days present / total for a student for an exam's term                        | exam_id, student_id (unique), days_present, days_total                                                                                                                          | detail                                  |
| hpc_feedback                | HPC words: the child's "All about me", the parent's, the teacher's           | exam_id, student_id, kind (unique), text, by_family                                                                                                                             | detail                                  |
| portfolio_items             | an HPC portfolio picture                                                     | exam_id, student_id, file_id, caption, indicator_id, deleted_at                                                                                                                 | detail                                  |
| report_card_templates       | a card design per band                                                       | code, name, band, layout jsonb, body_html, assets, version, status, deleted_at                                                                                                  | master                                  |
| report_card_signatures      | a signature or seal image printed on cards                                   | role, label, person_name, file_id, class_ids[], status                                                                                                                          | master                                  |
| report_card_releases        | a card release (exam / term / annual card)                                   | academic_year_id, term_code (unique per year), kind, exam_ids[], status, hide_defaulters, defaulter_min, released_at, withdrawn_at, withdrawn_reason                            | main (publishing)                       |
| report_card_release_classes | one class of a release published or revoked                                  | release_id, class_id (unique), status, released_at, withdrawn_at, withdrawn_reason, notified_count                                                                              | main (what families see)                |
| report_cards                | a rendered card PDF of a student                                             | release_id, student_id (unique), export_id, withheld, withheld_reason, rendered_at                                                                                              | detail                                  |
| report_card_holds           | a card held back for one student                                             | release_id, student_id (unique), reason, held_by, held_at                                                                                                                       | detail                                  |
| report_card_told            | families told about a release, per channel                                   | release_id, student_id, channel (unique), messages, message_ids[], told_at                                                                                                      | history                                 |
| board_result_imports        | one board file uploaded (old sheet or CBSE gazette)                          | board, class_label, exam_year, kind, status (import_status), committed_at, replaced_at, replaced_by, payload, report, figures (jsonb), source_text                              | internal (import log)                   |
| board_layouts               | a learned layout of a gazette file                                           | board, class_label, fingerprint, spec jsonb, source, active                                                                                                                     | internal                                |
| board_candidates            | one candidate of a saved gazette                                             | board, class_label, exam_year, roll_no (unique), name, sex, result, compartment[], total, percent, student_id, match, section, category…                                        | main (board results)                    |
| board_results               | one subject mark of one board candidate                                      | board, class_label, exam_year, roll_no, subject_code (unique), total, grade, result, absent, candidate_id, student_id                                                           | main (board subjects)                   |
| board_subjects              | a CBSE subject code and its kind                                             | board, class_label, code (unique), name, kind, subject_id                                                                                                                       | master                                  |
| board_teacher_overrides     | who taught a subject in a section for the board year, where it differs       | board, class_label, exam_year, section, code, employee_id or teacher_name, rolls[]                                                                                              | master                                  |
| board_year_figures          | an earlier year's headline figures typed in (no file)                        | board, class_label, exam_year (unique), appeared, passed, n90, n75, aggregate, pi, subjects jsonb                                                                               | history                                 |

Also read: **mart.exam_results** (schema `mart`) — one row per exam × class × section plus one whole-class row
(`class_section_id` NULL): pupils, complete, pass, fail, mean_pct, pass_pct, computed_at. It is a summary of
`exam_results`, rebuilt for every school by the hourly worker job `insights.results_mart`
(`app.refresh_exam_results_mart()`), not by the 15-minute mart refresh.

## How the tables join

Spine tables: **exams → exam_subjects → mark_entries** for marks; **exam_results** for one exam's result;
**term_results** (with its locked **mark_schemes**) for term and annual results; **report_card_releases** for
publishing; **board_candidates** for board results.

Exam set-up

- `exams.academic_year_id → academic_years.id`; `exams.exam_type_id → exam_types.id`
- `exam_classes.exam_id → exams.id`; `exam_classes.class_id → classes.id`; `exam_classes.grade_scale_id → grade_scales.id`
- `exam_subjects.exam_id → exams.id`; `exam_subjects.class_id → classes.id`; `exam_subjects.subject_id → subjects.id`
- `exam_subject_parts.exam_subject_id → exam_subjects.id`; `exam_subject_parts.subject_id → subjects.id` (the sub-subject)
- `exam_type_subjects (academic_year_id, exam_type_id, class_id, subject_id)` → the master an exam's papers are copied from (no FK from exam_subjects)
- `grade_bands.scale_id → grade_scales.id`

From a paper to its sections and students (a paper is per class, not per section)

- `exam_subjects.class_id = class_sections.class_id` and `class_sections.academic_year_id = exams.academic_year_id`
- `enrolments.class_section_id → class_sections.id`, `enrolments.academic_year_id = exams.academic_year_id`, `enrolments.status = 'active'`
- `mark_entries.exam_subject_id → exam_subjects.id`; `mark_entries.student_id → students.id`
- `mark_part_entries.part_id → exam_subject_parts.id`; `mark_part_entries.student_id → students.id`
- `mark_entries.code = mark_codes.code` (text match, no FK)
- `exam_entry_status (exam_subject_id, class_section_id) → exam_subjects.id, class_sections.id`; same pair in `exam_entry_status_log`

Who takes what

- `student_subjects (academic_year_id, student_id, subject_id) → academic_years, students, subjects`
- `class_subjects (academic_year_id, class_id, subject_id)` (academics guide) → `class_subjects.group_id → subject_groups.id`
- `class_stream_subjects.stream_id → class_streams.id`; `class_stream_subjects.class_subject_id → class_subjects.id`
- `class_subject_parts.class_subject_id → class_subjects.id`
- `student_subject_changes.from_exam_id → exams.id` (+ `from_subject_id`, `to_subject_id → subjects.id`)
- Use the functions, not a hand join: `app.student_exam_subject_kind(student_id, exam_id, subject_id)` returns
  compulsory / optional / additional, or NULL when not taken in that exam.

Results

- `exam_results.exam_id → exams.id`; `.student_id → students.id`; `.class_id → classes.id`; `.class_section_id → class_sections.id`
- `term_results.scheme_id → mark_schemes.id`; `.student_id`, `.class_id`, `.class_section_id`, `.academic_year_id` as above
- `mark_schemes.previous_id → mark_schemes.id`; versions share `chain_id`; `mark_scheme_access.chain_id` matches `mark_schemes.chain_id`
- `mark_schemes.def -> 'exams'` = `[{key, examId}]` (the exams a scheme reads, as text ids)
- `mart.exam_results (exam_id, class_id, class_section_id)` → `exams`, `classes`, `class_sections`

Indicators, remarks, attendance, HPC (all per exam × student)

- `indicator_entries.exam_id → exams.id`; `.indicator_id → indicators.id`; `indicators.set_id → indicator_sets.id`; `indicators.parent_id → indicators.id`
- `exam_indicator_sets (exam_id, class_id) → set_id`; `indicator_set_classes.class_id → set_id` (default set)
- `lower(indicators.area) = lower(indicator_areas.name)` (text match; gives the print order)
- `exam_remarks / exam_attendance / hpc_feedback / portfolio_items (exam_id, student_id)`
- `exam_remark_items.category_id → remark_categories.id`; `remark_bank.category_id → remark_categories.id`; `exam_remarks.bank_code = remark_bank.code` (text)
- `grade_registers.previous_id → grade_registers.id`; `grade_register_access.chain_id` matches `grade_registers.chain_id`

Report cards

- `report_card_releases.academic_year_id → academic_years.id`; `exams.id = ANY(report_card_releases.exam_ids)`
- `report_card_release_classes.release_id → report_card_releases.id`; `.class_id → classes.id`
- `report_cards / report_card_holds / report_card_told (release_id, student_id)`; `report_cards.export_id → exports.id`
- `comms_messages.id = ANY(report_card_told.message_ids)` (comms guide)
- `report_card_signatures.file_id → files.id`; `report_card_releases.templates` = `{band or class_<id>: template id}`

Board results

- `board_candidates.import_id → board_result_imports.id`; `.student_id → students.id`; `.academic_year_id → academic_years.id` (may be NULL)
- `board_results.candidate_id → board_candidates.id`; `board_results.import_id → board_result_imports.id`
- `board_results (board, class_label, subject_code) = board_subjects (board, class_label, code)`; `board_subjects.subject_id → subjects.id`
- `board_teacher_overrides.employee_id → employees.id`; match on (class_label, exam_year, section, code)
- `enrolments.board_roll_no` = `board_candidates.roll_no` (how candidates are matched)

Out to other modules

- Teachers: `teacher_assignments (academic_year_id, class_section_id, subject_id, kind, valid_to IS NULL) → employees` (HR guide)
- Fees: `mart.fee_dues (student_id, academic_year_id, due_on, balance)` for the card fee rule
- Attendance: `attendance_sessions / attendance_marks` (exam attendance can be counted from them)
- Health: `health_records.exam_id → exams.id` (height / weight per exam; not in this module)

## Life-cycles and statuses

**exams.status / exam_types.status / grade_scales.status** (row_status active / inactive) and `deleted_at`. Count
`deleted_at IS NULL`. An inactive exam is still a real exam with marks.

**exams.marks_locked, exam_subjects.entry_locked**: no marks may be written. Locking the whole exam sets both;
a class lock sets `entry_locked` on that class's papers. **exam_classes.\*_locked** lock the other areas of a class.
**exams.areas / exam_types.areas**: which areas an exam takes (marks, indicators, remarks, attendance, health).

**exam_entry_status.status** (text): `open` → `submitted` (teacher, every taker has a mark or code) → `verified`
(class teacher, coordinator or a holder of `exams.marks.verify`; verified = locked). A verifier may send it back
(`submitted → open`). Reopening `submitted` or `verified` → `open` needs the right `exams.marks.unlock` and a reason, and is refused
while the class is published in a release. **No row means `open`** (rows are written on the first submit). Every move
is in `exam_entry_status_log` (an "opened for entry" under a lock is logged as `open → open`). `entry_open` = the admin
reopened this one sheet while the exam stays locked (counts only while the exam or paper is locked).
_Final marks = `status = 'verified'`._ Marks of open or submitted sheets are drafts.

**exam_area_entry_opens**: open while `closed_at IS NULL AND closes_at > now()`; `closed_how` done / admin / lock /
lapsed. History only.

**mark_entries** — one value per row: `marks`, or `code`, or `grade` (a grade-only paper, `max_marks = 0`).
`absent` is true only for code `AB`, `exempt` only for code `EX`; other codes (ML, NA, OD, L, NEW ADM) leave both
false with `marks` NULL. **mark_codes.treatment**: `zero` (0 of the maximum, AB), `exclude` (out of the maximum),
`fixed` (value marks), `percent` (value % of the maximum), `pro_rata` (filled from the term's other exams in a scheme;
out of the maximum in one exam). `blocks_result` = the subject counts as failed (AB by default). A code not in
`mark_codes` counts as AB → zero, anything else → exclude.

**student_subjects.kind**: `compulsory`, `optional` (counts in the total), `additional` (printed, kept out of the
total). `opted_additional` = the student's own "Opt" tick (kind is then `additional`). **A student with no rows for a
year takes every subject of the class** (as compulsory). Once any row exists, the rows are the full list.

**exam_results.result** (text): `pass`, `fail` (at least one failed subject: a blocking code, or marks below
`pass_marks`), `incomplete` (a paper the student takes has no entry yet; no rank). Rebuilt in full for one exam by
`app.compute_exam_results(exam_id)`: on every verify, reopen, open-for-entry, whole-exam unlock, and the "Compute"
button. Only students with an **active** enrolment at that moment, and at least one counted paper (marks paper,
taken as compulsory or optional), get a row.

**mark_schemes.status**: `draft` → `locked` → `superseded` (a newer version of the same chain was locked; its
term results are deleted). An unlocked scheme goes back to `draft`; its old term results stay but do not print.
`purpose = 'result'` makes term results (one locked result scheme per class and term_code); `register` is a sheet only.
`deleted_at` = in the bin.

**term_results.result**: `pass`, `compartment` (failed subjects ≤ the scheme's `compartmentUpTo`), `fail`, `absent`
(a blocking code in a counted subject: no total), `incomplete` (a mark missing: no total). Each subject in
`subjects` jsonb has its own `status` pass / fail / absent / incomplete. `division` only when result = pass.
Rebuilt by `computeIn` (scheme "Compute", and on every verify of an exam the locked, already computed scheme reads).
_Count only rows whose scheme is `status = 'locked' AND deleted_at IS NULL`_ (what the cards print).

**grade_registers.status**: draft / locked / superseded, as mark schemes. **indicator_sets.kind**: indicators / hpc.
**indicators.kind**: level (rated) / text (written observation). **hpc_feedback.kind**: self / parent / teacher.

**report_card_releases.status**: `draft` → `submitted` (sent to the principal) → `released` (published) →
`withdrawn` (with a reason). **report_card_release_classes.status**: `released` / `withdrawn`, per class. Publishing
the release writes a released row for every class; the first class published makes the release `released`; revoking
the last class withdraws it. **kind**: `exam` (test slip from exam_results), `term` (term result), `annual`.
_A family sees a card only when: release `released` AND its class row `released` AND no `report_card_holds` row AND
not (hide_defaulters AND overdue fees > defaulter_min)._

**report_card_told**: a family counts as told only while one of its `message_ids` is a `comms_messages` row not
`cancelled` / `failed`. Publishing sends nothing; telling is a separate step.

**board_result_imports.status** (import_status): `validated` (read, not saved), `committed` (saved), `failed`.
`replaced_at` set = a later file of the same class and year replaced it. **board_candidates.result**: the word CBSE
printed — PASS, COMP (compartment), FAIL, ER (essential repeat), ABST (absent), RW (withheld), RL (later), UFM, XXXX.
**board_candidates.match**: roll (board roll no), name, picked (by hand), none (not found), not_ours (marked "not our
student"). **board_subjects.kind**: language, main, skill, additional, internal. **board_layouts.active**: kept for
the next file.

## Amounts, dates and counting rules

- No money here except `report_card_releases.defaulter_min` (rupees: overdue fees above it hide the card).
- **Marks**: `numeric(6,2)`. A paper's maximum is `exam_subjects.max_marks`; parts add up to it. Percent of one mark
  = `marks * 100 / max_marks`. Grade-only papers (`max_marks = 0`) never count in totals.
- **exam_results totals** count only papers with `max_marks > 0` that the student takes as compulsory or optional in
  that exam. `total` = marks + code values; `max_total` leaves out papers with an excluded code; `pct = total * 100 /
max_total` (2 decimals); `subjects` = papers counted, `entered` = with a non-excluded entry, `absent` = AB codes,
  `exempt` = papers with any excluded code (not only EX). Grade from `exam_classes.grade_scale_id` by pct (first band
  by `sort_order` whose `min_pct..max_pct` holds it). **Ranks are dense** (1, 2, 2, 3) by pct, among non-incomplete
  rows (fails included), per section and per class.
- **term_results**: worked out in the API from the scheme's `def` (columns: raw exam marks, parts, averages, best of N,
  sums, conversions, attendance slabs). `total` / `pct` NULL when absent or incomplete. **Ranks are competition
  ranks** (1, 2, 2, 4) by total or pct (the scheme's `rankBy`). `failed` = subject **codes** failed. `subjects` jsonb:
  `[{key, subjectId, code, name, kind, values:{col:{v,max,code?}, _total:{v,max}}, total, max, pct, grade, status,
inFinal}]`.
- **Parts**: a part's marks go to `mark_part_entries`; the paper's `mark_entries` row is the **sum of the parts entered**
  (absent in every part = AB). Do not add parts and paper together.
- **mart.exam_results**: `pupils` = all exam_results rows; `complete` = not incomplete; `mean_pct` = average pct of
  complete rows; `pass_pct = pass * 100 / complete` (incomplete pupils are left out of the base).
- **Dates**: group exams by `exams.starts_on` or `app.exam_day(exam_id)` (first day, else first paper, else creation
  date — the order the app uses). Papers by `exam_subjects.exam_on`. Everything is by **academic year**
  (`exams.academic_year_id`); there is no financial year here.
- **Board**: keyed by `exam_year` (the calendar year of the board exam), not by academic year (`academic_year_id` may
  be NULL for older years). `board_candidates.percent` = average of **all** subjects with marks, not CBSE's best five
  (the app's analysis works out best five in code with the school's rules). "Appeared" = at least one subject with
  marks. Subject figures: `board_results.total` per `subject_code`, named and typed through `board_subjects`
  (`kind = 'internal'` subjects carry grades, not marks); the default rules count a subject failed below 33 and a
  distinction from 75 (the school can change them in the board rules setting). Use `board_year_figures` only for a
  year with no saved candidates.
- **One row per**: mark_entries (paper, student); exam_results (exam, student); term_results (scheme, student) — a
  student has one per term_code per locked scheme; indicator_entries (exam, indicator, student); report_card_releases
  (year, term_code); report_cards / holds (release, student); board_candidates (board, class, year, roll);
  board_results (board, class, year, roll, subject).
- **Current vs history**: mark_schemes and grade_registers keep versions (use `status = 'locked'` for the one in use);
  exam_results / term_results are rebuilt (no history: the row is the latest compute); exam_entry_status_log and
  report_card_told keep history.

## Answering report questions

**1. Class-wise pass % and mean % of an exam** (fast, from the mart)

```sql
SELECT m.exam_code, m.exam_name, m.class_code, COALESCE(m.section, '(whole class)') AS section,
       m.pupils, m.complete, m.pass, m.fail, m.mean_pct, m.pass_pct, m.computed_at
  FROM mart.exam_results m
  JOIN academic_years y ON y.id = m.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = m.class_id
 WHERE m.exam_code = 'T1'
 ORDER BY k.display_order, m.class_section_id NULLS FIRST, m.section
```

Up to an hour behind `exam_results`, which is itself as of the last verify / compute. The NULL-section row is the class total.

**2. Top three of a class in an exam**

```sql
SELECT k.code || '-' || cs.name AS section, r.rank_in_class, r.rank_in_section,
       s.admission_no, s.display_name, r.total, r.max_total, r.pct, r.grade
  FROM exam_results r
  JOIN exams e ON e.id = r.exam_id AND e.deleted_at IS NULL
  JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = r.class_id
  LEFT JOIN class_sections cs ON cs.id = r.class_section_id
  JOIN students s ON s.id = r.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
 WHERE e.code = 'T1' AND k.code = 'X' AND r.result <> 'incomplete' AND r.rank_in_class <= 3
 ORDER BY r.rank_in_class, s.display_name
```

Dense ranks: more than three pupils can share ranks 1–3.

**3. Subject-wise analysis of a class in an exam** (takers, entered, AB, mean, highest, pass)

```sql
SELECT sub.code AS subject, es.max_marks, es.pass_marks,
       count(*) AS takers,
       count(me.id) AS entered,
       count(*) FILTER (WHERE me.code = 'AB') AS absent,
       count(*) FILTER (WHERE me.code IS NOT NULL AND me.code <> 'AB') AS other_codes,
       round(avg(me.marks), 2) AS mean_marks,
       max(me.marks) AS highest,
       min(me.marks) AS lowest,
       count(*) FILTER (WHERE me.marks IS NOT NULL AND es.pass_marks IS NOT NULL AND me.marks >= es.pass_marks) AS passed
  FROM exams e
  JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
  JOIN exam_subjects es ON es.exam_id = e.id AND es.max_marks > 0
  JOIN classes k ON k.id = es.class_id
  JOIN subjects sub ON sub.id = es.subject_id
  JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = e.academic_year_id AND cs.deleted_at IS NULL
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
  LEFT JOIN mark_entries me ON me.exam_subject_id = es.id AND me.student_id = en.student_id
 WHERE e.code = 'T1' AND e.deleted_at IS NULL AND k.code = 'IX'
   AND app.student_exam_subject_kind(en.student_id, e.id, es.subject_id) IS NOT NULL
 GROUP BY sub.code, es.max_marks, es.pass_marks, app.subject_seq(es.class_id, e.academic_year_id, es.subject_id)
 ORDER BY app.subject_seq(es.class_id, e.academic_year_id, es.subject_id), sub.code
```

Counts only pupils who take the paper; `app.subject_seq` gives the class's print order. Mean is over real marks only.

**4. Which sheets are not verified yet** (marks entry progress)

```sql
SELECT e.code AS exam, k.code || '-' || cs.name AS section, sub.code AS subject,
       COALESCE(st.status, 'open') AS status, st.submitted_at, st.verified_at,
       (SELECT count(*) FROM enrolments en
         WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
           AND app.student_exam_subject_kind(en.student_id, e.id, es.subject_id) IS NOT NULL) AS takers,
       (SELECT count(*) FROM enrolments en JOIN mark_entries m ON m.student_id = en.student_id AND m.exam_subject_id = es.id
         WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active') AS entered
  FROM exams e
  JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
  JOIN exam_classes ec ON ec.exam_id = e.id
  JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = e.academic_year_id
                        AND cs.deleted_at IS NULL AND cs.status = 'active'
  JOIN classes k ON k.id = cs.class_id
  JOIN exam_subjects es ON es.exam_id = e.id AND es.class_id = ec.class_id
  JOIN subjects sub ON sub.id = es.subject_id
  LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
 WHERE e.code = 'T1' AND e.deleted_at IS NULL AND COALESCE(st.status, 'open') <> 'verified'
 ORDER BY k.display_order, cs.name, sub.code
```

The same grid the admin's Marks status page builds. A missing status row is "open".

**5. Pupils failing two or more subjects in a term**

```sql
SELECT k.code || '-' || cs.name AS section, s.admission_no, s.display_name,
       t.term_code, t.result, cardinality(t.failed) AS failed_count, array_to_string(t.failed, ', ') AS failed_subjects,
       t.pct, t.grade
  FROM term_results t
  JOIN mark_schemes m ON m.id = t.scheme_id AND m.status = 'locked' AND m.deleted_at IS NULL AND m.purpose = 'result'
  JOIN academic_years y ON y.id = t.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = t.class_id
  LEFT JOIN class_sections cs ON cs.id = t.class_section_id
  JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
 WHERE t.term_code = 'T1' AND t.result IN ('compartment', 'fail') AND cardinality(t.failed) >= 2
 ORDER BY k.display_order, cs.name, cardinality(t.failed) DESC, s.display_name
```

Always join the locked scheme: a draft or binned scheme can still have old term_results rows.

**6. One student's marks in every exam of the year**

```sql
SELECT e.code AS exam, app.exam_day(e.id) AS exam_day, sub.code AS subject, es.max_marks,
       CASE WHEN me.code IS NOT NULL THEN me.code
            WHEN me.grade IS NOT NULL THEN me.grade
            ELSE me.marks::text END AS shown,
       me.marks,
       COALESCE(st.status, 'open') AS entry_status,
       app.student_exam_subject_kind(s.id, e.id, es.subject_id) AS taken_as
  FROM students s
  JOIN enrolments en ON en.student_id = s.id AND en.status = 'active'
  JOIN academic_years y ON y.id = en.academic_year_id AND y.status = 'active'
  JOIN class_sections cs ON cs.id = en.class_section_id
  JOIN exams e ON e.academic_year_id = y.id AND e.deleted_at IS NULL
  JOIN exam_subjects es ON es.exam_id = e.id AND es.class_id = cs.class_id
  JOIN subjects sub ON sub.id = es.subject_id
  LEFT JOIN mark_entries me ON me.exam_subject_id = es.id AND me.student_id = s.id
  LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
 WHERE s.admission_no = 'A1234'
   AND app.student_exam_subject_kind(s.id, e.id, es.subject_id) IS NOT NULL
 ORDER BY app.exam_day(e.id), e.id, app.subject_seq(cs.class_id, y.id, es.subject_id)
```

Shows the code or grade where there are no marks; `entry_status` tells final (verified) from draft.

**7. Report-card publishing by class: published, held, families told**

```sql
SELECT r.term_code, r.name, r.kind, r.status AS release_status, k.code AS class,
       COALESCE(x.status, 'not published') AS class_status, x.released_at, x.withdrawn_reason,
       (SELECT count(*) FROM report_card_holds h
          JOIN enrolments en ON en.student_id = h.student_id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
          JOIN class_sections hcs ON hcs.id = en.class_section_id AND hcs.class_id = k.id
         WHERE h.release_id = r.id) AS held,
       (SELECT count(DISTINCT t.student_id) FROM report_card_told t
          JOIN enrolments en ON en.student_id = t.student_id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
          JOIN class_sections tcs ON tcs.id = en.class_section_id AND tcs.class_id = k.id
         WHERE t.release_id = r.id
           AND EXISTS (SELECT 1 FROM comms_messages cm WHERE cm.id = ANY (t.message_ids)
                        AND cm.status NOT IN ('cancelled', 'failed'))) AS families_told
  FROM report_card_releases r
  JOIN academic_years y ON y.id = r.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id IN (SELECT ec.class_id FROM exam_classes ec WHERE ec.exam_id = ANY (r.exam_ids))
  LEFT JOIN report_card_release_classes x ON x.release_id = r.id AND x.class_id = k.id
 ORDER BY r.term_code, k.display_order
```

The classes of a release are the classes of its exams. "Told" follows live messages (crosses into comms).

**8. Cards families cannot open because of fees** (crosses into fees)

```sql
WITH dues AS (
  SELECT d.student_id, d.academic_year_id, sum(d.balance) AS overdue
    FROM mart.fee_dues d
   WHERE d.due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date
   GROUP BY d.student_id, d.academic_year_id
)
SELECT r.name AS release, k.code || '-' || cs.name AS section, s.admission_no, s.display_name,
       du.overdue, r.defaulter_min,
       EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = s.id) AS also_held
  FROM report_card_releases r
  JOIN academic_years y ON y.id = r.academic_year_id AND y.status = 'active'
  JOIN report_card_release_classes x ON x.release_id = r.id AND x.status = 'released'
  JOIN class_sections cs ON cs.class_id = x.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
  JOIN classes k ON k.id = cs.class_id
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
  JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
  JOIN dues du ON du.student_id = s.id AND du.academic_year_id = r.academic_year_id
 WHERE r.status = 'released' AND r.hide_defaulters AND du.overdue > r.defaulter_min
 ORDER BY r.name, k.display_order, cs.name, en.roll_no
```

The same rule the parent app applies today. `report_cards.withheld` only records the rule at the time the PDF was made.

**9. Low attendance against the exam result** (crosses into attendance)

```sql
WITH ex AS (
  SELECT e.id, e.academic_year_id, y.start_date, COALESCE(e.ends_on, (now() AT TIME ZONE 'Asia/Kolkata')::date) AS upto
    FROM exams e JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
   WHERE e.code = 'T1' AND e.deleted_at IS NULL
), att AS (
  SELECT am.student_id,
         count(*) AS marked_days,
         count(*) FILTER (WHERE am.code NOT IN ('A', 'LV')) AS present_days
    FROM ex
    JOIN attendance_sessions se ON se.academic_year_id = ex.academic_year_id AND se.kind = 'day'
                               AND se.on_date BETWEEN ex.start_date AND ex.upto
    JOIN attendance_marks am ON am.session_id = se.id
   GROUP BY am.student_id
)
SELECT k.code || '-' || cs.name AS section, s.admission_no, s.display_name,
       round(100.0 * a.present_days / NULLIF(a.marked_days, 0), 1) AS attendance_pct,
       r.pct, r.grade, r.result
  FROM ex
  JOIN exam_results r ON r.exam_id = ex.id
  JOIN class_sections cs ON cs.id = r.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN students s ON s.id = r.student_id AND s.deleted_at IS NULL
  LEFT JOIN att a ON a.student_id = r.student_id
 WHERE round(100.0 * a.present_days / NULLIF(a.marked_days, 0), 1) < 75
 ORDER BY k.display_order, cs.name, attendance_pct
```

Present = every day mark except A and LV, as the registers count it. For the printed card's figure use `exam_attendance`.

**10. Teacher-wise subject results** (crosses into HR)

```sql
SELECT COALESCE(emp.display_name, concat_ws(' ', emp.first_name, emp.last_name)) AS teacher, emp.employee_code,
       sub.code AS subject, k.code || '-' || cs.name AS section,
       count(me.marks) AS marked,
       round(avg(100.0 * me.marks / es.max_marks), 2) AS mean_pct,
       count(*) FILTER (WHERE es.pass_marks IS NOT NULL AND me.marks < es.pass_marks) AS below_pass
  FROM exams e
  JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
  JOIN exam_subjects es ON es.exam_id = e.id AND es.max_marks > 0
  JOIN subjects sub ON sub.id = es.subject_id
  JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = e.academic_year_id AND cs.deleted_at IS NULL
  JOIN classes k ON k.id = cs.class_id
  JOIN teacher_assignments ta ON ta.class_section_id = cs.id AND ta.subject_id = es.subject_id
                             AND ta.academic_year_id = e.academic_year_id AND ta.kind = 'subject_teacher' AND ta.valid_to IS NULL
  JOIN employees emp ON emp.id = ta.employee_id
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
  JOIN mark_entries me ON me.exam_subject_id = es.id AND me.student_id = en.student_id AND me.marks IS NOT NULL
 WHERE e.code = 'T1' AND e.deleted_at IS NULL
 GROUP BY emp.id, emp.display_name, emp.first_name, emp.last_name, emp.employee_code, sub.code, k.display_order, k.code, cs.name
 ORDER BY teacher, k.display_order, cs.name, sub.code
```

Uses today's live assignments (`valid_to IS NULL`); two teachers of one section and subject both get the same pupils.

**11. Board results by year** (pass, compartment, fail, average)

```sql
SELECT bc.class_label, bc.exam_year,
       count(*) AS candidates,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM board_results br WHERE br.candidate_id = bc.id AND br.total IS NOT NULL)) AS appeared,
       count(*) FILTER (WHERE bc.result = 'PASS') AS passed,
       count(*) FILTER (WHERE bc.result = 'COMP') AS compartment,
       count(*) FILTER (WHERE bc.result IN ('FAIL', 'ER')) AS failed,
       round(avg(bc.percent), 2) AS mean_percent_all_subjects,
       count(*) FILTER (WHERE bc.student_id IS NOT NULL) AS linked_to_student,
       count(*) FILTER (WHERE bc.match = 'not_ours') AS marked_not_ours
  FROM board_candidates bc
 WHERE bc.board = 'CBSE'
 GROUP BY bc.class_label, bc.exam_year
 ORDER BY bc.class_label, bc.exam_year DESC
```

Mean is over all marked subjects, not best five. The app's analysis counts every candidate of the file (not_ours too).

**12. How many pupils take each subject of a class** (subject choices)

```sql
SELECT k.code AS class, sub.code AS subject, csub.is_elective, g.name AS choice_group, g.kind AS group_kind,
       count(DISTINCT en.student_id) FILTER (
         WHERE ss.id IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM student_subjects any_ss
                            WHERE any_ss.student_id = en.student_id AND any_ss.academic_year_id = en.academic_year_id)
       ) AS students_taking,
       count(DISTINCT en.student_id) FILTER (WHERE ss.kind = 'additional' OR ss.opted_additional) AS as_additional
  FROM class_subjects csub
  JOIN academic_years y ON y.id = csub.academic_year_id AND y.status = 'active'
  JOIN classes k ON k.id = csub.class_id
  JOIN subjects sub ON sub.id = csub.subject_id
  LEFT JOIN subject_groups g ON g.id = csub.group_id
  JOIN class_sections cs ON cs.class_id = csub.class_id AND cs.academic_year_id = csub.academic_year_id AND cs.deleted_at IS NULL
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = csub.academic_year_id AND en.status = 'active'
  LEFT JOIN student_subjects ss ON ss.student_id = en.student_id AND ss.academic_year_id = en.academic_year_id
                               AND ss.subject_id = csub.subject_id
 WHERE csub.status = 'active'
 GROUP BY k.display_order, k.code, csub.sort_order, sub.code, csub.is_elective, g.name, g.kind
 ORDER BY k.display_order, csub.sort_order NULLS LAST, sub.code
```

A pupil with no choice rows takes every subject. Mid-year changes are not applied here (use `app.student_exam_subject_kind` per exam).

## Traps

- **exam_results and term_results are caches.** They are rebuilt on verify / reopen / compute, not on every mark
  save. Marks typed after the last compute are not in them; a pupil who left after it still has a row; a pupil who
  joined after it has none. For "live" numbers go to `mark_entries`. `computed_at` tells the age.
- **mart.exam_results lags twice**: up to an hour behind exam_results (hourly job), which lags the marks. It also has a
  whole-class row (`class_section_id` NULL): do not add it to the section rows.
- **Draft vs final marks.** `mark_entries` holds marks of open and submitted sheets too. For official figures join
  `exam_entry_status` and keep `status = 'verified'` (no row = open).
- **"Not absent and not exempt" ≠ "has marks".** ML, NA, OD, L and NEW ADM leave both flags false with NULL marks.
  Use `marks IS NOT NULL` for real marks and `code` for codes. Averages of `marks` skip coded rows.
- **Grade-only papers** (`max_marks = 0`) hold `grade`, not marks; dividing by `max_marks` fails. Filter `max_marks > 0`.
- **Not every enrolled pupil takes every paper.** Count takers with `app.student_exam_subject_kind(...) IS NOT NULL`
  (it applies subject choices and mid-year changes per exam). Additional subjects are taken but not in totals.
- **Parts**: the paper's `mark_entries` row is already the sum of `mark_part_entries`. Adding both double counts.
- **A paper is per class**, not per section: reach sections through `class_sections` of the exam's year. Join
  `academic_year_id` on every step or you mix years (class ids are reused every year).
- **Ranks**: exam ranks are dense (1, 2, 2, 3) by pct; term ranks are competition (1, 2, 2, 4). Do not compare them.
  Incomplete (and in terms, absent) pupils have no rank.
- **Term results of the wrong scheme.** A superseded scheme's rows are deleted, but an unlocked (draft) or binned
  scheme keeps its old rows. Join `mark_schemes` with `status = 'locked' AND deleted_at IS NULL`.
- **term_results.failed holds subject codes**, not ids; `subjects` is jsonb (read with `jsonb_array_elements`).
- **Report cards**: `report_cards` has rows only for cards rendered to PDF; `withheld` there is a snapshot of the fee
  rule at render time. What a family can see is the live rule (release + class row + hold + fees today).
- **Told ≠ row exists.** A `report_card_told` row whose messages were all cancelled or failed is not "told".
- **Soft deletes**: exams, exam_types, grade_scales, indicator_sets, mark_schemes, grade_registers, portfolio_items,
  report_card_templates have `deleted_at`. Marks of a deleted exam stay in mark_entries: always join `exams` with
  `deleted_at IS NULL`.
- **Merged / deleted students**: a merge moves marks to the kept record, but filter `students.deleted_at IS NULL`
  (and `merged_into_id IS NULL`) anyway.
- **Board**: re-saving a gazette deletes and rewrites all candidates and results of that class and year (ids change);
  the old import stays with `replaced_at`. `board_results.result` on gazette rows is the candidate's overall result,
  not the subject's. Rows from the old sheet import (`kind = 'sheet'`) have no `candidate_id`. `exam_year` is not an
  academic year.
- **Weightage columns** (`exam_types.weightage`, `exam_subjects.weightage`) are stored but nothing computes with them;
  term weighting lives in `mark_schemes.def`.
- **Text joins**: `mark_entries.code → mark_codes.code`, `indicators.area → indicator_areas.name`, `*.bank_code →
remark_bank.code`, `chain_id` (no FK) — check case and spaces.
- **Time zone**: `computed_at`, `released_at`, `told_at` are timestamptz; group by the Asia/Kolkata date.

## Personal and sensitive data

- **Names**: `board_candidates.name`, `board_results.candidate_name`, `board_teacher_overrides.teacher_name`,
  `report_card_signatures.person_name`; names reached through `students`, `employees`, `users` (by / entered_by columns).
- **Raw files with names and marks**: `board_result_imports.source_text` (the whole gazette text), `.payload`,
  `.report`; `board_results.raw`. Never send to an AI model. `board_layouts.spec` / `notes` came from masked lines; keep
  them internal.
- **Sensitive categories**: `board_candidates.sex`, `category`, `religion`, `ews`, `cwsn` (disability), `boarder`,
  `staff_ward` — mask or aggregate only.
- **Free text about a child**: `exam_remarks.remark`, `participation`; `exam_remark_items.text`; `indicator_entries.note`;
  `hpc_feedback.text` (the child's own words, the parent's, the teacher's); `report_card_holds.reason`;
  `student_subject_changes.reason`; `exam_entry_status.remark` and `exam_entry_status_log.note`;
  `exam_area_entry_opens.reason`; `report_card_releases.withdrawn_reason`; `report_card_release_classes.withdrawn_reason`.
- **Money about a family**: `report_cards.withheld_reason` (names the overdue amount).
- **Images**: `portfolio_items.file_id` (photos of children), `report_card_signatures.file_id` (signature images),
  `report_card_templates.assets`.
- **Marks and results themselves** are personal data of a child: send only aggregates (class, section, subject) to an AI
  model, or mask the student (`admission_no` / name) first.
