# 69 · Grade, Remark, Attendance and Height & Weight registers like the legacy

Status: built 3 Nov 2026 (parts 1–3; migrations 0300, 0301) · companion of docs/design/68 (mark registers)

## Why

The school's legacy Registers menu has five registers: Mark, Grade (indicators), Remark, Attendance and
Height & Weight (`EANDE/dynamic_mark_register.php`, `dynamic_grade_register.php`,
`dynamic_student_register.php?type=remark|attendance|health`). EduPro rebuilt the Mark Register
(docs/design/68, `/exams/schemes`); the other four existed only as entry sheets, one exam and one section
at a time (Exams → an exam → Indicators / Remarks / Attendance / Health, the teacher app's Indicators
and Exam register), with no register across exams and sections, no files and no per-register rights.

Benchmark: Entab CampusCare and Edunext print a co-scholastic (indicator) grade sheet per class with a
choice of terms and descriptors; Fedena's "Co-scholastic report" is fixed per exam group. None offers
the legacy's saved grade registers with per-register rights, "as per mapping" access and the overall
grade per group; this rebuild keeps them.

## Decisions (user, 3 Nov 2026)

| Question                          | Answer                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grade register                    | **The same as the legacy**: saved registers, 4-step builder, Run as a class sheet or student-wise, Overall per group, files; Run / Edit / Copy / Assign / Access / Lock / Delete, versions, a Deleted bin |
| Access "As per mapping"           | **A teacher sees only the indicators given to them** in Teacher assignments (kind Indicator); All = every indicator of the register                                                                       |
| Remark, Attendance, Height&Weight | **Reports like the legacy**: nothing saved; class, a section or all, one or more exams; PDF / Excel; managers every section, teachers their own sections                                                  |
| Where                             | **One Registers page with a switch** like the legacy menu: Mark · Grade · Remark · Attendance · Height & Weight                                                                                           |

## The legacy, in short (process reference: `new folder/EANDE`, never its data)

**Grade register.** A register = classes, assessments (exam types, each with a short header label, in
order), the indicator tree with exclusions (an exclusion list, so descriptions added later appear),
short labels per description, manual order per level, display (description header full or D1…,
sub-indicator header row, legend, proper-case names, text for a blank grade, student columns Sr / Name /
Roll / Adm in any order), Overall per group (off, most frequent, points scale with a grade scale) and
the access type. Run: a section; filters by indicator and sub-indicator; the class sheet (header rows
group, indicator, sub-indicator, description, term; one column per description × term; an Overall block
per group) or student-wise (a block per student); a Grade summary (counts per grade, each opening its
students) and an Analysis (% per grade per group and indicator; all sections side by side); PDF
(paper, orientation, fit) and Excel for one section or all. List: Run, Edit (a locked register's save
makes a new version), Versions (restore always as a new register), Copy (classes, not the assignments),
Assign (Run / Edit / Delete / Assign per person, delegated assign), Access (All / As per mapping), Lock,
Delete (not when locked) and a Deleted bin; names unique per year.

Overall rule: per student, group and term over the leaves shown; blanks ignored; grades compared
trimmed and upper-case. Most frequent: the highest count; a tie goes to the grade higher in the scale,
then A→Z. Points: needs two scale grades with points; the average of the points of the grades in the
scale, printed as the scale grade nearest it (a tie goes to the higher points).

**Student registers.** Read-only. Class, a section or all sections, exams (from the data). Remark: per
exam the remark categories used, the code's text (section + exam mapping, then class + exam, then any),
Other, Promoted to. Attendance: per exam Present / Total / %, Overall when two or more, a cut-off %
(default 75) marking those below, a summary and a "below" list. Height & Weight: per exam height, weight
and BMI (switch), the change from the first to the last, class averages. Managers see every section;
others the sections they teach.

## Kept from EduPro on purpose (and legacy quirks not copied)

- Rights on a register belong to its chain (as mark registers): versions, the bin and restores keep them.
- Every read checks the right (the legacy loaded any register's set-up by id).
- The grades are read for the register's exams and classes (the legacy read indicators by group only),
  and a duplicate entry cannot happen (one entry per student, exam and descriptor).
- The student-wise layout follows the student columns chosen.
- Height & Weight needs the health view right (sensitive), besides the register rights.
- English only, like the mark registers.

## Parts

- **Part 1** — Exams → Registers with the switch (Mark · Grade · Remark · Attendance · Height & Weight;
  the menu entry renamed Registers); the Remark, Attendance and Height & Weight registers: API (exams of
  the class from the data, the sheet per section or all, files at once), admin page, e2e, a11y, help.
- **Part 2** — Grade registers saved: migration (grade_registers with a version chain, grade_register_access,
  permissions as the mark registers'), API (list, builder data, save, versions, lock, copy, delete and
  bin, assign with delegation, access type, rights report), admin list and 4-step builder with preview.
- **Part 3** — Grade register Run: class sheet and student-wise, filters, Overall, Grade summary,
  Analysis (this section, all sections), PDF / Excel for one section or all, "as per mapping".

## As built (part 1, 3 Nov 2026)

- API `GET /exams/registers/:type` (remark | attendance | health; `StudentRegistersController`,
  `StudentRegistersService`, `student-registers.dto.ts`): `classId`, `section` (an id or `all`), `exams`
  (ids), `cutoff`, `bmi`, `format` json | pdf | xlsx with `paper`, `orientation`, `fit`. JSON gives the
  classes and sections open to the person, the exams with entries for the class's sections (the year's,
  in date order), the exams picked (default the first) and per section its sheets and notes. Files are
  made at once with the mark registers' `registerPdf` / `registerXlsx` (a section a page; a section's
  summary tables follow it on the page).
- Rights: `exams.marks.view` (and `exams.health.view` for Height & Weight). Every section for holders of
  `exams.registers.manage` or `exams.registers.assign`; else the sections in this year's Teacher
  assignments (any kind; a coordinator every section of the class). No section: no class, and the page
  says where they are assigned.
- Sheets (the mark registers' `Sheet`, so the screen uses `RegisterSheet`): Sr, Adm No, Roll No, Student
  (proper case when typed all capitals or all small), then a column group per exam.
  - Remark: General remark (`exam_remarks.remark`), each category with an entry in that exam
    (`exam_remark_items`, the categories' order), Participation; "No remarks" for an exam without any;
    Promoted to = the last given across the exams picked. Remark cells wrap (`SheetCell.wrap`, new: the
    PDF breaks the text over lines, Excel wraps, the screen wraps up to 24rem).
  - Attendance: Present, Total, % (2 decimals; below the cut-off red and bold), Overall when two or more
    exams (sums); a Summary (students, with attendance, class average of the students' %, below) and a
    "Below N%" list, lowest first.
  - Height & Weight: Height (cm), Weight (kg), BMI (worked out, 1 decimal; Hide), Change (last − first
    non-zero, signed) when two or more exams; Class averages per exam (measured, height, weight, BMI).
    Several measurements of a student in one exam: the latest (`recorded_on`), counted in a note.
  - Notes: no entries; students who left the section but have entries (not shown); repeated
    measurements.
- Shared: `register-head.ts` (letterhead, logo, "generated on") now serves both register services.
- Admin: `/exams/registers/[type]` (class, section, cut-off / BMI apply on change; exams ticked, then
  Show; Download as the mark registers'), `RegistersSwitch` on it and on `/exams/schemes`; the menu entry
  is now **Registers**; file route `/api/student-register/[type]/[format]`.
- Tests: `apps/api/test/student-registers.e2e-spec.ts` (5); a11y entries for the three pages.

## As built (part 2, 3 Nov 2026)

- Migration 0300: `grade_registers` (name 2–150, `class_ids`, `def` JSONB, `access_type` all | mapping,
  status draft | locked | superseded, `version`, `previous_id`, `chain_id` set by a trigger as mark
  registers, created / updated / locked / deleted by and at) and `grade_register_access` (per chain and
  person: run, edit, delete, assign). The same permissions as mark registers (`exams.registers.manage`,
  `exams.registers.assign`; their descriptions now name both).
- Engine `packages/db/src/grade-register.ts` (copied to `packages/ui` by `scripts/sync-mark-register.mjs`
  for the builder's preview; a unit test keeps the copies equal): `GradeRegisterDef` (exams with
  headers, areas and indicators left out, short labels, own order of areas / items / indicators, roll or
  alphabetical, full or numbered headers, legend, proper case, blank text, Overall off | mode | points,
  grade scale best first, student columns), `arrange` (areas → items → indicators; an item without
  sub-items is its own column), `overallOf` (the legacy rules), `scaleFromLevels` (letters best first,
  words lowest first), `buildGradeSheet` (the class sheet; numbered headers add a Legend table),
  `sampleGradeData`, `gradeProblems`.
- The legacy's four levels map to EduPro's three: group = area (the areas master's order), indicator =
  item (a heading, or the item itself when rated), description = the rated item; written observations
  (`kind = 'text'`) are not grades and are left out. The tree is the union of the sets the classes use in
  the assessments (`exam_indicator_sets`).
- API `/exams/grade-registers` (`GradeRegistersController`, `GradeRegistersService`, rights as the mark
  registers', the staff list from them): list (newest first; assessments, assignees, in use, same
  name), builder (`?classIds=&examIds=`: classes with "no grades yet", the year's exams that take
  indicators for those classes, the tree, the sets' levels), get, create, save (a draft in place; a
  locked one makes or reuses the next draft), lock (the earlier locked version is superseded), unlock,
  access-type (managers; the whole chain), delete (drafts) and the bin, restore (renamed on a clash),
  versions, restore-version (a new register with the chain's people), copy (classes; not the people),
  access (delegated assign as mark registers), rights report and remove. Saving refuses what
  `gradeProblems` finds with the classes' tree (no assessment, nothing ticked, points without a scale).
- Admin: `/exams/grade-registers` (the switch's Grade Register), `/new` and `/[id]/edit` with
  `GradeRegisterBuilder` (4 steps, a step's gaps stop Next, preview from step 3); `RegistersList` and the
  register server actions take a `kind` (mark | grade): an Assessments column, the Access button and
  dialog for grade registers; Run arrives with part 3.
- Tests: `packages/db/test/grade-register.test.ts` (8), `apps/api/test/grade-registers.e2e-spec.ts` (7),
  a11y entries for the list and the new builder.

## As built (part 3, 3 Nov 2026)

- Run `GET /exams/grade-registers/:id/run` (Run right): `classSectionId` (any section of the register's
  classes with students; the first by default), `layout` class | student, `report` sheet | summary |
  analysis | analysis-all, `areas` (keys joined by |) and `items` (ids) to filter, `format` json | pdf |
  xlsx, `all` (every section), paper / orientation / fit. JSON: the sections, the exams with their
  headers, the filter's choices (the section's areas and items, as per mapping), the sheets and the notes
  (an exam with no indicator set for the class, the mapping). Each section reads its class's tree for the
  register's exams and the students' `indicator_entries`.
- Engine: `buildStudentWise` (a table per student: area and indicator printed once, the indicator's
  short label or description, a column per term, an Overall row per area; in a PDF each student is a
  page), `gradeSummary` (per indicator and Overall and term: a count per grade — the scale's in order,
  others A→Z — blanks and students; each count drills to its students), `gradeStats` / `gradeAnalysis`
  (% of the grades given per area, indicator and Overall; graded, blank) and `gradeAnalysisAll` (per
  area and Overall, a column per section: "B 66.7% · A 33.3% (n)").
- Files: the mark registers' `registerPdf` / `registerXlsx` (the letterhead, "Grade Register · name ·
  report"); every section a page (student-wise every student).
- As per mapping (migration 0301): `teacher_assignments.indicator_area_ids` (only for kind indicator;
  none = every area), set by `PUT /academics/teacher-assignments/:id/areas` (assignment managers;
  audited) and shown with the row (`indicatorAreas`). A run of a mapping register by someone who neither
  manages nor assigns registers keeps to the areas of their Indicator assignments of that section; with
  none it shows nothing and says why.
- Admin: `/exams/grade-registers/[id]/run` (section and layout apply on change; Filter; the four views as
  chips; Download as the mark registers'), Run in the list, file route `/api/grade-register/[id]/[format]`;
  Teacher assignments: an Indicator row's areas with a fold-out to tick them.
- Tests: engine 11, API e2e `grade-registers` 11 (the runs, the files, as per mapping); the suites that
  read teacher assignments pass (28).

## Found while planning (for parts 2–3)

- Teacher assignments of kind **Indicator** mapped a teacher to a **section only**: there was no record
  of which indicators a teacher rates. **Decided 3 Nov 2026: areas on the assignment** — an Indicator
  assignment also picks one or more indicator areas (the areas master) for its section; "As per
  mapping" shows such a teacher only those areas' indicators (built with part 3).
