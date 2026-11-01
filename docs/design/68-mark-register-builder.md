# 68 · Mark registers like the legacy Term Mark Register

Status: phase 1 built 1 Nov 2026 (migration 0296) · replaces the scheme editor of docs/design/65 part 3 · phase 2 next

## Why

`/exams/schemes` works out term marks (averages, best of N, conversions, attendance slabs, codes,
rounding, pass rules, ranks) but every subject gets the same columns, the page is one long form, and
it has no copy, bin, versions view, per-register rights, all-sections exports or reports. The school's
own PHP page `EANDE/dynamic_mark_register.php` (with its lib, api, engine and ui scripts, 16 Oct 2026)
is the process the staff know: a six-step builder with a live preview, per-subject column chains, and a
Run screen with nine reports. This rebuilds `/exams/schemes` on that process, in the Mobilise design,
on EduPro's own data (exams, class parts, choice groups, mark codes, grade scales).

Benchmark: Entab CampusCare and Edunext build a "result formula" per subject from assessment
components with weightages and a preview; Fedena combines exam groups with weightages; PowerSchool
keeps grade-calculation formulas per course with versions. None of them offers the legacy's per-column
"Sub from" for medical absence, the dummy preview you can type into, or delegated per-register rights.

## Decisions (user, 1 Nov)

| Question         | Answer                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columns          | **Per subject, with Copy to subjects** and the Weightage builder (the legacy model); ready-made schemes fill every subject                                                              |
| Rights           | **Like the legacy**: managers see and manage every register; others see only registers assigned to them with Run / Edit / Delete / Assign per register; delegated assign; Rights report |
| Grades and codes | **Copied into the register** from the masters (grade scale, divisions, mark codes per exam), editable, "Import from another register"                                                   |
| Scope            | **Phased**: phase 1 = list, builder, engine, Run register + merit + downloads, rights; phase 2 = the eight reports                                                                      |

## Legacy → EduPro

| Legacy                                                                       | EduPro                                                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Exam type (PT-1, Term 1) assigned to a subject, max in `exam_subject_master` | An exam of the year (`exams`) and its `exam_subjects` row for the class (max, parts)                            |
| Composite subject (PHY/CHE/BIO, TH/PR), children from the master             | The exam subject's parts (`exam_subject_parts`: a sub-subject or Theory / Practical), set once per class (0292) |
| Elective slot (THIRD LANGUAGE: SAN / FRE / GER)                              | A slot of the register; offered from the class's choice groups (doc 67), editable                               |
| Subject Mapping priority                                                     | The class's subject order (`app.subject_seq`, doc 67) unless the register's own order is on                     |
| Optional = Y in the mapping                                                  | A student's additional subject (`student_subjects.opted_additional` / kind additional)                          |
| `exam_attendance`                                                            | `exam_attendance` (days present / total per exam)                                                               |
| Mark codes per register and exam                                             | Copied from `mark_codes` per exam into the register                                                             |
| Grade bands, divisions                                                       | Copied from the class's grade scale (`grade_scales`) and 60 / 45 / 33                                           |
| Report Card: Yes (one register per class)                                    | A **result** register with its term (one locked per class and term), as today                                   |
| Roles screen (Create / Edit / Delete / Run / Assign)                         | Access → Roles: `exams.registers.manage`, `exams.registers.assign`                                              |
| Schema check                                                                 | Not needed (migrations)                                                                                         |

## The register (definition v2)

Stored in `mark_schemes.def` with `v: 2` (v1 schemes and the five DPS ready-made schemes convert on
read: their columns become every subject's columns).

- **Details**: name (unique in the year, ignoring case and spaces; versions share it), classes (one or
  more), student order (roll / A–Z / rank: 1st Div, 2nd Div, Pass, then the rest), layout (**subjects
  in the header**, or **Subject-1, Subject-2 …** with the subject in each student's row: doc 67's
  slots), type (**general**, or **exam-wise**: the exam is picked at Run).
- **Exams it reads**: a short key per exam of the year (PT1, TERM …).
- **Subjects** in order: a subject, or a slot (name + member subjects, "show child breakup"). Per
  subject: show its Total column, Total out of (scale the total to a maximum), round off, grade, %,
  count in the final (when "this register" decides optional subjects), child subjects in columns.
- **Columns** per subject, each a key + name:
  - _exam marks_ (an exam; a subject with parts reads their sum, or each part as a column / one
    stacked "breakup" cell with Sum / Average / Both at the foot);
  - _average_ of existing columns or of the parts: all, best N (blanks not attempted are skipped, a
    real 0 counts), or sum;
  - _conversion_ of an exam or of an existing column: scale (marks ÷ max × target) or weightage %
    (marks × %); "each part" makes one per part and their sum;
  - _attendance_ slabs (≥96 % → 5 … ≥76 % → 1) from the exam's attendance days.
  - Options: in the final total · grade after it · round off (whole, an exact .5 kept) · hide (kept in
    the maths) · show code (a conversion prints AB instead of 0) · **Sub from** (where a pro-rata code
    takes its marks: skip, one column, or all other exams) · per slot member: its own exam (or not
    applicable) and its own conversion target.
  - Helpers: **Copy to subjects** (same chain; children matched by name, re-pointed to the target's
    own parts, or collapsed for a plain subject; an exam the target lacks is skipped and listed),
    **Weightage builder** (per part: raw / weighted to a target / skip → one weighted total).
- **Mark codes** per exam: code, meaning, treatment (count 0 · leave out of the maximum · fixed marks
  · % of the maximum · pro-rata from other exams with a %), blocks the total, show the value with "*";
  "a blocking code in an optional subject also withholds the final"; import from another register,
  copy to other exams.
- **Final**: total, %, grade, rank (by total or %), round off (none / .5 up / .5 kept), result column
  (pass / compartment up to N subjects / fail / absent), theory and practical each must pass (XI-XII),
  optional subjects decided by the students' choices or by this register (and whether they add into
  the final), show maximum marks, student columns (Sr, Name, Roll, Adm: order and show), division label,
  proper-case names, blank for not-taken subjects, child maximum in breakup cells, class-average row,
  decimals for values / final total / % (shown cut, not rounded up, as the legacy does).
- **Grading**: bands (from %), division cut-offs (1st 60, 2nd 45, pass 33), result-analysis bands and
  cumulative cut-offs (phase 2 reports).

## Engine (packages/db, pure, also copied to the UI for the preview)

Per student and subject, columns in dependency order (loops and missing sources refused), values kept
at 2 decimals:

- Codes by the register's rule for that exam: zero → 0; leave out → no value and the maximum shrinks;
  fixed → min(amount, max); % of max; pro-rata → (sources' marks ÷ their maxima) × max × % (capped),
  sources by Sub from. A blocking code passes up through averages and conversions and withholds the
  subject and the final ("–", no rank) — except a best-N that still has N unblocked sources.
- Average all: mean of values and of maxima; sum: Σ; best N: the N highest marks. Conversion scale /
  weight. Round off per column before anything built on it.
- **One total** (the legacy's subject total and final could disagree): the ticked columns minus any
  column another ticked column is built from; the same set gives the subject total, its %, grade, the
  final and pass / fail.
- Final = Σ counted subjects; % = rounded final ÷ max; grade from the register's bands; division only
  for a pass; competition rank (1, 1, 3) by total or %, in the section and across the class (merit).
- Result from the code rules (not the letters "AB" / "ML"): a blocking code → absent; a subject below
  the pass % → failed; 0 failed → pass, up to N → compartment, more → fail; XI-XII theory and
  practical each when switched on.
- Each section runs with its own class's parts and maxima; a class without a subject or part skips it.
- Exam-wise: only the picked exam's columns (and those built only on it) count; the rest stay hidden
  for pro-rata.

## Screens (Mobilise)

- **Registers list** (`/exams/schemes`): search by class; table Register (name, version, Locked,
  Result · T1, Same name), Classes, Created / Updated by, Actions (Run, Edit, Versions, Copy, Assign,
  Lock / Unlock, Delete with a second click); Deleted drawer (restore, rename on clash); New register.
- **Builder** (`/exams/schemes/new`, `/exams/schemes/:id/edit`): a six-step stepper (Details ·
  Subjects · Columns · Mark codes · Totals · Final), Back / Next / Save (Save on every step when
  editing); under it the **preview**: two sample students with marks you can type over (or "Try a real
  section"), computed cells tinted, the final tinted. Saving a locked register makes the next version
  (a draft) and keeps the locked one until the new one is locked.
- **Run** (`/exams/schemes/:id/register`): Class (each section, then "VI · all sections (merit)"),
  Exam (exam-wise), Subject (all, or one subject's own sheet with its rank and result); **Reports ▾**
  (Register in phase 1; Result summary, Analysis, Entry status, Toppers, Teacher-wise, At-risk,
  Failing students, Compare sections in phase 2); Rank / Division order for merit; **Download ▾** PDF,
  Excel, all sections PDF (a section a page), all sections Excel; PDF asks paper (A4 / A3 / Legal /
  Letter), orientation and fit to width (remembered on this computer). A note lists what to check:
  subjects nobody in the section takes, a slot student with two members, withheld finals, students
  without marks, exams without marks.
- **Assign** dialog (per register: staff by designation or search, Run / Edit / Delete / Assign, copy
  from another register) and **Rights report** (who holds what on which register; PDF / Excel; remove).

## Rights

`exams.registers.manage` (school admin, group admin, exam office): every register, build, edit,
delete, lock, assign. `exams.registers.assign`: hand out rights on every register. Anyone else sees
only the registers assigned to them (`mark_scheme_access`: run, edit, delete, assign); a person with
Assign on one register may pass on only the rights they hold, never Assign. Every change is audited.

## Kept from EduPro on purpose

- Divisions are given only to a pass (the legacy printed "2nd Div" beside a compartment).
- A result register makes the term results that feed report cards, promotion and the division list.
- The subject order, slots and parts come from the class set-up (doc 67) rather than a second copy.

## Phases

**Phase 1**

- Part A — engine v2 + v1 conversion + unit tests (the five ready-made schemes give the same numbers).
- Part B — migration (chain, access, permissions), API: save / copy / delete and restore / versions
  and restore as new / lock and unlock / assign and rights report / run (section, merit, exam-wise,
  subject) / files (PDF, Excel, all sections), e2e.
- Part C — admin: list, builder with preview, Run with Download, Assign, Rights report; a11y; help.

**Phase 2** — the eight Run reports (Result summary, Analysis, Entry status, Toppers, Teacher-wise,
At-risk, Failing students, Compare sections) on the same computed rows.

## As built (phase 1, 1 Nov 2026)

- **Part A** — `packages/db/src/mark-register.ts` (pure; copied to `packages/ui` by
  `scripts/sync-mark-register.mjs`, a unit test keeps the copy equal): `computeRegister`, `examView`,
  `countedColumns`, `registerProblems`, `newRegisterDef`, `defaultCodes`, `buildSheet` / `byDivision`
  (the one layout of the screen, the PDF, the Excel and the builder's preview), `cutFixed`,
  `properCase`, `orderStudents`. `computeScheme` (v1) converts with `fromV1` and runs it: the ten v1
  tests pass; pro-rata now follows the legacy (other exams' marks over their maximum).
- **Part B** — migration 0296: `mark_schemes.chain_id` (trigger), `updated_by`, `deleted_by`;
  `mark_scheme_access`; `exams.registers.manage` / `.assign` for school admin, group admin, exam office
  (the academic coordinator is no longer a manager by role: give them registers with Assign, or the
  right in Access → Roles). API: list (one row per register, by rights), get, create (built, v1, or a
  ready-made scheme: the one-language choice groups become a slot), save (a locked one → its next
  version), lock / unlock, bin and restore, versions and restore as new, copy, builder data, staff,
  access (delegation), rights report and remove, Run (section, merit by rank or division, exam-wise,
  one subject; JSON sheet + rows + notes; PDF A4 / A3 / Legal / Letter either way round with fit; Excel
  a sheet per section). Term results keep each subject's printed values and `_total`; report cards
  (`printedColumns`) and the division list read v2. e2e `mark-registers` (8 tests).
- **Part C** — admin: `/exams/schemes` (list, search by class, row actions, Deleted, Rights report,
  ready-made start), `/exams/schemes/new` and `/:id/edit` (`RegisterBuilder`, `RegisterColumns`,
  `lib/register-builder.ts`), `/:id` (overview), `/:id/register` (Run: `RegisterSheet`,
  `RegisterDownloads`); the menu entry is "Mark registers". a11y: the list, the new builder and a
  register's overview, Run and every builder step.
- The sample "Term I result (sample)" (VI-VII) is a v2 register now, its languages in the SUBJECT-2
  slot (scripts/seed-exam-sample.mjs).
