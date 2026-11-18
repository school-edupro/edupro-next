# 88 — CBSE board result analysis (Class X and XII)

Status: **planned 17 Nov 2026** — decisions below; build in phases A–E on "go".

## 1. The ask

On **Exams → Board results** (`/exams/board-results`): the school uploads the result file CBSE sends (a `.TXT`
"School / Roll No wise Gazette") for Class X or XII and an academic year, and gets the full result analysis the
school prepares today by hand. CBSE's TXT layout differs between Class X and XII and changes from year to year, so
EduPro uses the Claude API to understand a new layout; the results go into the database and every report is made
from there.

## 2. What the school shared (structure only — the files hold real student data; never copied or committed)

`new folder/cbse/` in the repository folder:

- **Two CBSE gazette files** (X and XII, ~311 candidates each). Plain ASCII, CRLF, fixed-width printout: a page
  header (date, examination, region, page; column headings) repeated on every page, a "SCHOOL : - code name" line,
  then **two lines per candidate**:
  - Class X (2026): line 1 = roll no (8 digits), FL flag, sex (M/F), name, up to **7 subject codes**, result,
    compartment subject; line 2 = marks + grade under each code (`087 A2`; `AB E` for absent).
  - Class XII (2026): the same, but **6 wider subject slots** and three **internal-subject grades** (GR1–GR3) before
    the result. So the two classes already differ, and each year can differ again.
  - Result words seen: PASS, COMP, ER, ABST, RW, RL. No totals at the end of the file.
- **Two annexure workbooks** ("Board Annexures 2025-26", X and XII) — the reports the school makes today (§6).
- **Two mapping sheets** typed by hand for every file: (1) board roll no → admission no., stream (XII), section,
  category (boarder / staff / other), SC/ST/OBC/GEN, religion, EWS, CWSN, sixth subject; (2) section × subject code →
  teacher (optionally only some roll numbers, e.g. a language group).

## 3. Benchmark

- **Edunext** — CBSE Class X/XII analysis from the TXT, 30+ reports, year-on-year comparison
  ([product](https://cbseresultanalysis.edunexttechnologies.com), [upload steps](https://helpcenter.nexterp.in/helpcenter/?p=13701)).
- **Jupsoft** — TXT upload → student-wise, subject-wise, topper reports, Excel export, graphs
  ([product](https://jupsoft.com/cbse-result-analysis)).
- **Open-source converters** exist because the gazette TXT cannot be analysed as it comes
  ([CBSE Result Converter](https://github-users.yhajoa.workers.dev/luciferchase/CBSE-Result-Converter)).
- **Kendriya Vidyalaya result analyses** — Performance Index **PI = Σ(students at a grade × weight) × 100 ÷
  (students × 8)**, weights A1 8 … E 0; percentage bands 33–44.9 / 45–59.9 / 60–74.9 / 75–89.9 / 90–100; five-year
  tables ([example](https://no2portblair.kvs.ac.in/sites/default/files/CBSE%20Result%20Analysis%20Class%20X%202021.pdf),
  [PI sheet](https://avadihvf.kvs.ac.in/sites/default/files/PI_0.pdf)).

None documents adapting to a format change by itself, and none clearly documents teacher-wise analysis. EduPro
does both, and fills the two hand-made mapping sheets from its own records.

## 4. Decisions (17 Nov 2026, all the recommended answers)

1. **Claude learns the layout; EduPro reads every row.** Claude sees only the column headings and 3–4 sample
   records with names and roll numbers replaced by dummies, and describes where each field sits; EduPro reads every
   candidate itself, checks it, and shows a preview before anything is saved. A layout once learned is kept, so the
   same format never calls Claude again. Names and marks never leave EduPro.
2. **The extra data comes from EduPro's records** — students matched by board roll number (else by name within the
   class), section / stream / EWS / CWSN / category / religion / boarder / staff ward from the student record,
   teachers from the year's subject-teacher assignments. A review screen fixes anyone unmatched; the two Excel
   sheets can still be uploaded to override.
3. **Reports: the 10 annexures + extras** — on screen, one Excel in the workbook's layout, a PDF with the
   letterhead; plus the Performance Index per subject / section / teacher, a 5-year trend, compartment / absent /
   withheld lists, each teacher's own result page (for the ACR), and the board result on the student's record.
4. **Past years: upload the earlier TXT files** the same way; type a year's headline figures only when its file is
   lost.

## 5. Design

### 5.1 Upload, read, check, preview, confirm

1. **Board results → Upload result file**: board (CBSE), class (X / XII), examination year (2026 = session
   2025-26; an EduPro academic year is linked when one exists, so past years work too), the `.TXT` (≤ 2 MB). The
   file is stored (View / Download icons) with the import.
2. **Which layout?** EduPro takes the file's _fingerprint_: the column-heading lines with spaces normalised and
   the examination name with its year removed. A stored layout with the same fingerprint (board + class) is used
   at once. Built in from the start: the 2026 Class X and Class XII layouts (so those files never need the AI).
3. **A new layout → Claude.** EduPro sends Claude the heading block and 3–4 candidate records copied with every
   letter of a name replaced by another letter and every digit of a roll number by another digit, keeping each
   column's position (fixed-width), plus the field list to locate. Claude returns the layout as JSON validated
   against a strict schema:
   - page-header and school-line patterns to skip; lines per candidate (and which line holds what);
   - per field: start column and width (or a pattern) — roll no, flag, sex, name, each subject slot's code, marks
     and grade, internal grades (XII), result, compartment subject;
   - the tokens meaning absent (`AB`), the grade set, the result words.
4. **EduPro reads every record with the layout** (no AI) and **checks it**: a mark and a grade for every code;
   marks 0–100 or absent; grades from the set; result words known (an unknown word is shown, not guessed);
   duplicate roll numbers; candidate count; a grade that cannot go with the mark is flagged. A layout that fails
   on more than a few records is refused with what failed — the user may try again (Claude is asked once more,
   told what failed) or send the file to support.
5. **Preview** (nothing saved): candidates, subjects, results by word, students matched / to review, problems by
   row. **Confirm** saves it; a later upload of the same class and year replaces it, the earlier one kept as a
   version in the import history (who, when, file).
6. **Without an AI key** (`AI_PROVIDER=mock`): known layouts work; a new one says the AI reader is not set up.

### 5.2 Claude (packages/ai)

- Through `packages/ai` (its budget meter, redaction and `ai_audit` record: who, when, tokens, cost — no
  student data in it), moved onto the official TypeScript SDK `@anthropic-ai/sdk`.
- Model `claude-opus-5-5` (the project default), structured output with the layout schema
  (`output_config.format` / `messages.parse`), adaptive thinking, a refusal answered as "could not read this
  layout", a bounded timeout. About 3–5 thousand tokens a new layout — a few rupees at most, once per format.
- The key lives only in the server's environment (`ANTHROPIC_API_KEY`, Key Vault in production) — set by the
  school's IT, never typed into EduPro.
- A layout made by Claude is kept with its source (`built-in` / `claude` / `edited`), the model, the date and the
  file it was learned from.

### 5.3 Matching students

Board roll no on the year's enrolment (`enrolments.board_roll_no`) → else the admission number if the file carries
one → else the name within Class X / XII of that year (normalised; the sex must agree). One clear match is taken;
several or none go to **Review students** (search and pick, or "not our student"). Confirmed matches write the
board roll number to the enrolment, so next year's and the compartment file match at once.

### 5.4 What the annexures need from EduPro (snapshot at confirm)

Per candidate: section and stream (XII); category (SC/ST/OBC/GEN), religion, EWS, CWSN from the profile;
**boarder** (hostel allotment), **staff ward** (profile / fee staff ward) → "Boarder / Staff / Other". Per section ×
subject: the teacher from `teacher_assignments` (the CBSE code joined to EduPro's subject through §5.5), with
overrides on **Teachers** (a section's subject split between teachers by roll number, as the old sheet allowed).
Stored with the import, so a report reprints the same after students move on.

### 5.5 CBSE subject codes

A **CBSE subjects** list (code, name, class X / XII, language yes/no, main / additional / internal) seeded with
the CBSE codes, each linked to the school's EduPro subject (pre-linked by name, changeable). A code in a file that
the list lacks is shown on the preview to add.

### 5.6 Data (migration 0396 onwards)

- `board_layouts` — board, class, fingerprint, spec JSONB, source, model, learned_from import, active.
- `board_result_imports` (existing) — add exam year, layout, version, file, `replaced_by`; status preview /
  committed / replaced.
- `board_candidates` — one per candidate: roll no, name as printed, sex, flag, result word, compartment subjects,
  internal grades, best-five total and %, all-subjects total and %, student, and the §5.4 snapshot.
- `board_results` (existing, one per candidate × subject) — keep; add absent, grade point.
- `board_subjects` (§5.5); `board_teacher_overrides`; `board_year_figures` (typed headline figures of a year
  without a file).

### 5.7 Rules the reports use (settings, defaults from the shared workbooks)

- **Best five**: X — the best five subjects with one language (an additional sixth subject may replace one, as
  CBSE allows); XII — English plus the best four. The rule is a setting; the shared 2026 workbooks are the check:
  EduPro's figures must equal theirs (verified locally on the real files, never committed).
- **Distinction** = 75 and above; **A grades** = A1 + A2; bands as in each annexure; **PI** as §3.
- Absent, RW (withheld) and RL (later) candidates are counted where the workbook counts them (registered vs
  appeared).

## 6. Reports (Board results page: Upload · Results · Analysis · Teachers · Set-up)

The 10 annexures, each on screen with class, year and section filters, and all of them in **one Excel** laid out
as the school's workbook plus a **PDF** with the register letterhead and signature boxes:

1. **School summary** — % at 90+ and 75+, school aggregate % for 5 years, registered / appeared / absent /
   failures / compartments / qualified / 90+ / 75+, top 10 (rank, roll no, name, section, best-five total, %);
   XII adds first twenty positions, full scores by subject, subject-wise distinctions and aggregate.
2. **Overall result** with boys / girls (passed, average %, highest / lowest, % bands) and the **subject-wise
   table** (appeared, failures, compartments, passed, averages, 100s, mark bands by boys / girls).
3. The overall table for **EWS / non-EWS / CWSN** (and the other categories).
4. **Subject-wise summary** (appeared, absent, pass, fail, max, min, average, total, distinctions, grade counts).
5. **This year against last year** by subject (appeared, highest, A grades, compartments, failures, distinctions,
   average, % change).
6. **Best five toppers** and the subject performance table.
7. **Section-wise analysis** by subject with the teacher (bands ≥90 … <30, highest, lowest, average).
8. **Subject-wise analysis** — each subject's sections and teachers.
9. **Subject performance** (subject average, A grades, highest, 100s, distinctions).
10. **ACR report subject-wise** — mark bands 0–20 … 91–100 per subject (and per teacher, for the ACR).

**Extras**: Performance Index per subject, section and teacher; 5-year trend (aggregate, pass %, 90+, PI by
subject); compartment, absent, withheld / later lists (with the student, section, contact for the office);
**My board results** for a teacher (own subjects and sections only); the board result on the student's record
(and on the parent app, the school may switch it on); figures on the exam dashboard.

## 7. Rights

`exams.board_result.import` — upload, confirm, review students, teachers, CBSE subjects, settings.
`exams.board_result.view` — every report. A teacher without it sees only **My board results**.

## 8. Phases (each gated: plan items, typecheck, lint, tests, a browser + axe pass)

- **A — Read the file.** Layout fingerprint and store; the built-in 2026 X / XII layouts; reader + checks;
  Claude layout learning in packages/ai (SDK, schema, masking, audit, budget); upload → preview → confirm →
  versions. Tests: both layouts on made-up files in the same shapes; a changed layout learned through a mocked
  Claude reply; masking (no name or roll number in the request); refused layouts.
- **B — Match and complete.** Student matching + Review students; the §5.4 snapshot; CBSE subjects list;
  teachers + overrides; the two old sheets accepted as an override upload.
- **C — The 10 annexures.** On screen, Excel in the workbook's layout, PDF; the best-five / distinction / band
  rules as settings; local check against the shared 2026 workbooks (figures equal).
- **D — Extras.** PI, teacher pages, lists, student record, dashboard figures.
- **E — Past years.** Upload earlier years (old layouts learned once each), typed figures where a file is lost,
  the 5-year trend and Annexure 5 from them.

## 9. Open points

- What the **FL** column's `I` means (122 of 311 Class X candidates carry it; none in XII) — shown as printed
  until the school says.
- The school's IT sets the Claude key on the server before the first new layout.

## As built — phase A, reading the file (17 Nov 2026)

- **Reader** (`apps/api/src/modules/exams/board-gazette.ts`, pure): a layout is data (`FieldAt` = line of the
  record, 0-based start, width; width 0 = absent). `readGazette` reads every record and checks it — a 3-digit
  code (a cut-off code means the layout does not fit), marks 0–100 or the absent token, a CBSE grade, a known
  result word (PASS, COMP, FAIL, ER, ABST, RW, RL, UFM, XXXX; another is kept with a warning), no roll number
  twice; a blank marks line (an absent / UFM candidate) is kept without error. `layoutFits` = candidates found and
  errors on ≤ 5 % of them (at least 1). The fingerprint = the examination title (dates, region, page, years
  removed) + the column headings, spaces collapsed.
- **Built-in layouts** for 2026, measured on the school's files (the data sits one or two columns right of its
  heading — why the AI sees sample lines, not only headings): X — 7 slots at 64 + 7k, grade +4, result 114,
  compartment 132; XII — 6 slots at 65 + 8k, grade +5, internal grades 114 / 117 / 120, result 126, compartment 144. Checked locally on the real files: 311 + 311 candidates, no problem, counts equal the annexures.
- **Finding a layout**: the school's kept layouts and the built-in ones with the same fingerprint; else each known
  layout of the class that reads the file with no error; else Claude.
- **Claude** (`board-layout-ai.ts` + `packages/ai/src/structured.ts`, official `@anthropic-ai/sdk` 1.9):
  `claude-opus-5-5`, structured output (`output_config.format` json_schema, effort high), the server-side refusal
  fallback (`fallbacks: "default"`); the reply validated again (`LayoutZ` + fields inside the record). What it
  sees (`maskedSample`): the heading block (date and region masked, the school line replaced) and up to four
  records (the first, the widest, one with an absent mark, one with COMP / not PASS), token by token: grades and
  result words kept, every other digit → 9, every 2+ letter run → X, single letters kept — every column in place;
  a column ruler. Retry ("Ask the AI again") adds the failed checks (field and message, values removed). The
  school's monthly AI token budget (`AI_SCHOOL_MONTHLY_TOKENS`, summed from `ai_audit`) applies; every call writes
  `ai_audit` (kinds `board_layout`, `board_layout_refused`, `board_layout_error`; tokens, cost; no student data).
  No key (`AI_PROVIDER=mock`) → 409 `board.ai_not_set_up`; refusal → 422 `board.ai_no_layout`; unusable reply →
  422 `board.ai_bad_layout`.
- **Data (0396)**: `board_layouts` (learned, inactive until its file is saved; one active per fingerprint);
  `board_result_imports` + kind, exam year, layout key / how, the file's text, figures, replaced at / by,
  academic year optional; `board_candidates` (one per candidate: result, compartment, internal grades, total and %
  of the subjects with marks, student and how matched); `board_results` + exam year, candidate, slot, absent; one
  row per board, class, exam year, roll, subject (the Sprint 18 Excel / CSV import uses the same key).
- **API** (`/exams/board-results`): `POST gazette` (preview), `GET imports/:id`, `GET imports/:id/file`,
  `POST imports/:id/relearn`, `POST imports/:id/commit` (gazette or sheet), `GET years`, `GET layouts`,
  `POST layouts/:id/active`. Saving replaces the earlier saved file of the same board, class and year (its rows
  removed, the import marked replaced) and keeps a learned layout.
- **Admin**: Board results with tabs Upload (the .TXT form with class and academic year, the uploads list, the
  Excel / CSV import folded) · Results · Analysis · Set-up (layouts, switch off / use again; English + Hindi);
  each upload's page (figures; next step — save, ask the AI again, saved / replaced; the file View / Download and
  the layout; folded problems, results by word, subjects, candidates).
- **Tests**: unit `board-gazette.spec.ts` (6: both layouts, the checks, a moved layout refused, masking, the reply
  schema), `packages/ai/test/structured.test.ts` (3); e2e `board-gazette.e2e-spec.ts` (5: preview → save, students
  by roll and name, replace, a new layout learned with no name / roll / mark in the request and `ai_audit`
  written, kept → fingerprint next time, switched off → learned again, a wrong layout failed → asked again →
  passes, no AI / refusal / bad reply, Class XII, not a gazette, the auditor can look but not upload); Sprint 18
  still passes. A browser pass (test school): every tab and three upload pages, axe clean at 1440 and 375 px.

## As built — phase B, matching and completing (17 Nov 2026)

- **Matching**: board roll number on the enrolment, else the name within the class that year — unique and agreeing
  on sex where the record has it. On save the board roll number is written to a found student's enrolment (only
  where none is set), so the next file matches by it.
- **Details snapshot** (`BoardDetailsService.snapshot`, at save, on a pick, and on "Take the details again"):
  section (the enrolment that year), stream / religion / EWS / CWSN (the profile), category (the student's column),
  boarder (a hostel allotment overlapping the year), staff ward (a linked guardian marked school staff); kept on
  `board_candidates` with `details_from` record / sheet / none (0397).
- **Review students** (`GET imports/:id/review`, `POST candidates/:id/student`): candidates not found first; the
  class's unlinked students, likely ones first (name words, same sex); link (details + roll follow), not ours,
  unlink; one student is one candidate a year.
- **CBSE subjects** (`board_subjects`, `board-subjects.ts`): seeded per class on first use (names checked against the
  school's annexures; e.g. 119 Sanskrit (Communicative), 303 Urdu Course-B, 409 Food Production, the 8xx skill
  subjects of XII, 500 / 502 / 503 internal), linked to the school's subjects by name words; a code a file prints
  that is not listed is added unnamed; renaming updates the saved results' subject names. `GET / POST / PUT subjects`.
- **Teachers**: the year's `teacher_assignments` (subject teacher, through the code's school subject) unless
  `board_teacher_overrides` says otherwise (for listed roll numbers first, then the whole section); an override may
  name a teacher who is not an employee. `GET teachers` (sections × codes of a saved year, the teachers with their
  candidate counts, the overrides), `POST teachers`, `DELETE teachers/:id`; `teacherResolver` serves the analysis.
- **The school's old details sheet** (`POST imports/:id/details-sheet`): sheet 1 (BoardRollNo, admission no.,
  section, stream, category Boarder / Staff / Other, SC/ST/OBC/GEN, religion, EWS, CWSN) overrides those
  candidates' details and links one not found by its admission number; sheet 2 (Section, SubjectCode, Teacher,
  roll numbers) replaces that year's overrides, teachers matched to employees by name, else kept as written.
- **Admin**: the saved upload's "Students and details" card (counts; Review students; take the details again;
  upload the details sheet); the Review students page; the Teachers tab (class and year, Set a teacher, remove);
  Set-up → CBSE subjects (X / XII, edit, add a code). English + Hindi on the main page.
- **Tests**: unit `board-subjects.spec.ts` (2); e2e `board-details.e2e-spec.ts` (5: details from the record and the
  roll number kept, a name that disagrees on sex not matched, review / pick / not ours / unlink / one student once,
  subjects seeded / linked / unnamed code / renamed, teachers from assignments and overrides by section and roll,
  the details sheet, refresh). Browser pass at 1440 and 375 (saved page, review with a picker, teachers with the
  dialog open, subjects): axe clean.

## As built — phase C, the ten annexures (17 Nov 2026)

- **Counting** (`board-analysis.ts`, pure): one saved class and year → the headline and the ten annexures, each a
  list of tables (columns with heading groups, rows), so the screen, the workbook and the PDF print the same
  figures. `BoardAnalysisService` loads the candidates (one section, when asked), their subjects, the school's
  CBSE subjects (languages first, English first of them), the four years before (their headline, for the five-year
  rows), the year before (per subject, for Annexure 5) and the teacher of each section's subject.
- **Rules learned from the school's 2026 workbooks** (now the defaults; `exams.board_rules` setting, Set-up →
  Analysis rules, valid from the day saved):
  - Best five = the best language + the best four others (XII: English + the best four, the same figures).
  - Grades counted **from the marks** on the workbooks' scale (A1 91–100, A2 81–90, B1 71–80, B2 61–70, C1 51–60,
    C2 41–50, D pass–40, E below) — CBSE's printed grades are positional and differ; "as printed" is the other
    choice. A grades = A1 + A2. "Total no. of division" = A1 … D (E is not a division).
  - Distinction from 75; failure = marks under 33. A subject CBSE lists as the candidate's compartment counts as a
    compartment, not a pass (the workbook counts it as passed — see below).
  - A candidate absent throughout (ABST, UFM …) is registered, not appeared, and in no subject's count; one absent
    in a subject is in that subject's total and its absent count.
  - Bands: the overall (best-five %) ≥90, 75–89.9, 60–74.9, 45–59.9, <45; the subject table 91–100 … 41–50 and
    33–40 (boys / girls); sections ≥90, 80–89 … 30–39, <30; ACR 0–20, 21–32, 33–40, 41–50 … 91–100.
  - Annexure 5's "% diff": the change in the share of those who appeared, in percentage points; average: marks.
- **Layout choices**: Annexure 1 shows the top 10 (X) / first twenty positions (XII), and for both classes full
  scores, distinctions, the highest in each subject and A1 + A2; Annexure 3 is one table, a row a group (EWS,
  non-EWS, boarders, day scholars, staff wards, SC, ST, OBC, general, CWSN); Annexure 7 a table a section,
  Annexure 8 a table a subject with an all-sections line; Annexure 10 adds the bands by teacher (for the ACR).
  Teachers sharing a section's subject are named together ("A, B").
- **Files** (`board-analysis-file.ts`): the workbook has sheets Annexure-1 … Annexure-10 (title band, heading
  groups merged, Annexure 4 as a block a subject, the rules line); the PDF (one annexure or all) is `tablePdf` on
  the register letterhead, tables with the same columns run on with heading bands, A3 for the wide ones, Prepared
  by (the user, the time) / Checked by / Principal at the end. Each export is audited.
- **API**: `GET analysis` (classLabel, examYear, section), `GET analysis/file` (format xlsx | pdf, annexure),
  `GET / PUT rules` (the import right changes them).
- **Admin**: the Analysis tab — class, examination, section and annexure; six figures; the annexure's tables (the
  first three open, the rest folded); PDF of this annexure / of all (View + Download), the Excel workbook; the old
  per-subject table of imported rows kept in a fold. Set-up → Analysis rules. English + Hindi.
- **Local acceptance on the school's real files** (structure only, never committed; a script in the scratchpad
  compared every figure it could place):
  - **Class XII: 2,671 figures equal, 38 differ**, all explained: (1) the one compartment candidate's two
    compartment subjects — EduPro counts them as compartments, the workbook as passes (Annexures 2, 4, 5, 7, 8);
    (2) the workbook's lowest subject band is 34–40, so a mark of 33 is in no band (EduPro: 33–40); (3) the
    workbook's CWSN block of Annexure 3 is empty though the details sheet marks 30 CWSN students.
  - **Class X: 681 equal, 191 differ.** The X file is CBSE's revised gazette: seven subjects (184, 085, 303, 041,
    241, 086, 087) carry higher marks than the workbook was made from, so every figure that depends on marks
    differs there; the counts (registered, appeared, absent, results, subject entries, boys / girls, sections) are
    equal. Besides: two absent candidates are not in the details sheet (non-EWS 258 against 256); the workbook's
    Annexure 3 boys / girls passed % are 0; a candidate absent in Computer Applications is counted absent there
    (the workbook leaves them out of that subject).
- **Found on the way**: the school's details sheet writes "EWS" / "CWSN" for yes — the reader now takes the
  column's own word as well as Y / Yes.
- **Tests**: unit `board-analysis.spec.ts` (6: the three best-five rules, the headline and bands, subject outcomes
  and both grade bases, groups and categories, sections split by roll with the all-sections line and ACR by teacher,
  five years and the year before); e2e `board-analysis.e2e-spec.ts` (5: all ten annexures of a made-up file, one
  section, the workbook's sheets and blocks, PDFs and the audit, rules as a setting with rights and validation,
  teachers sharing a section and a class with nothing saved); `board-details.e2e-spec.ts` now also reads the
  EWS / CWSN words. Browser pass at 1440 and 375 (annexures 1, 2, 4, 7, 10 with a section, an empty class, Set-up):
  axe clean.

## As built — phase D, the extras (17 Nov 2026)

- **Counting** (`board-analysis.ts`): `piOf` — the Kendriya Vidyalaya PI, Σ(grade weight) × 100 ÷ (students × 8),
  weights A1 8 … D1 2, D2 1, E 0 from CBSE's printed grade (a missing grade weighed from the marks); `yearFigures`
  — a year's headline with pass % and PI and each subject's PI and average (the trend's rows; phase E adds typed
  years without subjects). Three more annexures in the same list, workbook (sheets "Performance Index",
  "Five-year trend", "Lists") and PDF: **11** PI by subject (the printed grade counts, an all-subjects line), by
  section with its teacher, by teacher; **12** the five-year trend (the school; PI and average by subject and year);
  **13** compartment (with the subjects), absent, failed / withheld / later — each with the admission number and the
  primary guardian's mobile (`board_candidates` → `students`, `student_guardians`). `teacherView(input, employeeId)`
  — a teacher's sections × subjects (section-wise figures + PI), ACR bands and their students' marks.
- **Rights** (migration 0398): `exams.board_result.own` — group / school admin, academic coordinator, class and
  subject teachers. The whole analysis stays with `exams.board_result.view`.
- **API**: `GET mine` (own; the employee linked to the sign-in, each class's latest saved year or `examYear`; the
  resolver gives every teacher of a shared section), `GET student/:id` (view; each saved year with the best five),
  `GET summary` (view; each class's latest year), `GET / PUT parents` (the `exams.board_result.parents` setting, off
  by default; changing it needs the import right; audited), `GET exams/mine/board-results` (`exams.family.view`;
  the family's children through the viewer, nothing while the setting is off).
- **Screens**: staff app **My board results** (Exams group; the shared staff menu), the student's Academics tab
  **Board results** card, the parent app's Results page (a card a saved year; Hindi strings), the Exams page's
  **Board results** figures (pass %, aggregate, 90%+ per class; PI in the hint), Set-up → **Board results on the
  parent app**.
- **Tests**: unit `board-analysis.spec.ts` (+3: PI printed and from marks, a year's figures with the trend and the
  lists, a teacher's view holds only their sections); e2e `board-extras.e2e-spec.ts` (4: annexures 11–13 with the
  contact from the guardian, a teacher's own page and who cannot see it, the student's record and the exam page's
  figures, the parent switch off → on with the rights around it); `board-analysis.e2e-spec.ts` now expects the
  extras. `teacher-a11y.spec.ts` lists `/my-board-results`. Browser pass (admin annexures 11–13, Exams, the
  student's Academics tab, Set-up; staff app; parent app) at 1440 and 375: axe clean.

## As built — phase E, earlier years (17 Nov 2026)

- **An earlier file**: the upload's year list offers, after the academic years, the ten examinations before the
  first one ("2022 examination (an earlier year, not in EduPro)"); the file is sent with `examYear` alone, saved
  with no academic year (its candidates kept by roll number, nothing to match or snapshot) and analysed like any
  other. A layout CBSE used then is learned once (phase A).
- **Typed figures** (migration 0399 `board_year_figures`, one row a class and year): registered, appeared, passed,
  compartments, failures, 90% / 75% counts, aggregate, PI, a note, and `subjects` (code → appeared, highest, A
  grades, compartments, failures, distinctions, average, PI). Checks: passed and 75%+ ≤ appeared, 90%+ ≤ 75%+, a
  code once. `GET / PUT / DELETE year-figures` (view / import / import; audited). A year with a saved file refuses
  typed figures (409) and, if they were typed earlier, the file wins.
- **Analysis**: the four years before come from saved files, else typed figures (shares worked out from the counts);
  the year before (Annexure 5) from its file, else its typed subjects. Typed figures are the whole class's, so a
  one-section analysis leaves them out.
- **Admin**: Set-up → **Earlier years' figures** (X / XII; the typed years with "file saved" where a file now
  covers one; Type a year's figures / Edit in a dialog — headline fields and a subject line each, commas or tabs,
  pasted rows work; Remove). English + Hindi.
- **Found on the way**: annexures 11–13 could not be opened by their links (the annexure number was checked as
  1–10 in the page, the file route and the API) — now 1–13, with a PDF of Annexure 13 in the phase D e2e.
- **Tests**: e2e `board-years.e2e-spec.ts` (3: a file saved by its examination year alone, analysed and in the five
  years; typed figures — rights, checks, refused for a year with a file, corrected — in the five years, the trend
  and Annexure 5, left out for one section; removed again, audited). Browser pass (Set-up with the edit dialog
  open, Upload, Annexures 12 and 5) at 1440 and 375: axe clean.

## After phase E — the details sheet to fill (18 Nov 2026)

- The saved upload's **Upload the details sheet** dialog leads with **Download the sheet to fill**
  (`GET imports/:id/details-sheet`, import right, audited `exams.board_result.details_template`): sheet 1 "Students"
  — one row a candidate (BoardRollNo, name as printed, a linked student's admission number, stream for XII, section,
  Boarder / Staff, SC/ST/OBC/GEN, religion, EWS / CWSN as Y) with pick-lists on the coded columns; sheet 2
  "Teachers" — each section × subject code with the Teachers tab's overrides, else the year's assigned teachers, one
  row a teacher; sheet 3 "How to fill" with the CBSE subject codes. The headings are the school's, so the reader
  (`detailsSheet`) takes it back unchanged; a blank cell keeps what EduPro has.
- The button is a real button with a "No details yet" line, and the Analysis tab links to the file's Students and
  details and warns while no candidate has a section.
- Test: `board-details.e2e-spec.ts` + 1 (the auditor cannot download; the layout and pre-filled values; a cell
  changed and uploaded back is applied). Browser pass with the dialog open at 1440 and 375: axe clean.
- **Teachers not saved (18 Nov 2026)**: on Alpha a filled sheet updated 311 candidates but no teacher — the Teachers
  tab's teacher cells were empty (the class had no subject-teacher assignments to pre-fill), rows without a teacher
  were skipped silently, and the sections were written "X-A" while EduPro names them "A". Now: a section with the
  class in front ("X-A", "10 A", "XII-B") is read as the section; teacher rows are counted (saved, no teacher, no
  section, no 3-digit code) and the year's teacher list is replaced only when at least one row names a teacher; the
  page says "The students were updated, but no teacher was saved" with the counts; the downloaded sheet has a
  **Staff** tab and a pick-list of staff names in the Teacher column. e2e + 1 (blank teachers keep the list and are
  counted; "X-B" read as B; the Staff tab), browser check of the message.

## The Results tab as the school's "Student Marks Data" (18 Nov 2026)

- **Results** now lists a saved year a candidate a row (the old screen the school shared): Sr#, roll number, name
  (gender and class-section under it), Subject-1 … Subject-N (CBSE's short name — "English Lng & Lit", "Maths Std" —
  with the full name on hover, marks, grade; marks not counted in the aggregate shown light), result (compartment
  subjects under it), aggregate / max, total % and rank. Filters: class, examination, section, calculation method
  (`best5` — the school's rule from Set-up — or `all` subjects, max 100 each), result, percentage band, sort (rank,
  roll, name, section), search, rows a page (25 / 50 / 100 / 500) with pages. Ranks are the class's, dense (1, 2, 3,
  3, 3, 4), by the percentage. It replaces the Sprint 18 list of imported rows (a row a candidate × subject); the
  per-subject summary of Excel / CSV imports stays under Analysis, folded.
- `board-marks.ts` (`marksRows`, `filterMarks`, `shortSubject`), `GET marks`, `GET marks/file` (xlsx: every column
  of the old screen, a subject as name / marks / grade; PDF: A3 letterhead with signature boxes; audited
  `exams.board_result.marks_export`). A `.ep-table-tight` style (tokens only) keeps the many columns on a 1280-wide
  screen.
- Tests: unit `board-marks.spec.ts` (3: dense ranks with ties, all subjects, filters and sorts); e2e
  `board-analysis.e2e-spec.ts` + 1 (the list, ranks, filters, pages, the files). Browser + axe at 1440, 1280, 1024
  and 375.

## The Reports tab: Range Wise Subject Summary (18 Nov 2026)

- A **Reports** tab between Analysis and Teachers holds ready-made reports (a list; more join it). The first is the
  school's old **Range Wise Subject Summary**: a block a subject (name order, internal subjects left out), 21 rows —
  total students, appeared, absent, pass, fail, compartment, distinction, 1st / 2nd / 3rd division, A1 … E1 grades,
  highest, lowest, average — a Count and a % (of those appeared) a year, the earlier years first. Filters: class,
  examination, compare with 0–4 saved years before, gender (all / boys / girls), subject.
- Divisions are exclusive (they add up to those who appeared, as the old report's do): distinction from the
  distinction marks, 1st from 60, 2nd from 45, 3rd from the pass marks. Grades follow the Set-up rule; the row
  labels carry the mark ranges when grades are counted from the marks.
- `board-reports.ts` (`rangeSubjectSummary`), `GET reports/range-subjects` and `/file` (xlsx as on screen; PDF on the
  letterhead with heading bands and signature boxes; audited `exams.board_result.report_export`).
- Printing: the PDF puts each subject on a page of its own (the headings and the Prepared / Checked / Principal
  boxes on every page); the Excel sheet has a page break before each subject, fits the page width and repeats the
  headings.
- Tests: unit `board-reports.spec.ts` (2); e2e `board-years.e2e-spec.ts` + 1 (two saved years compared, girls only,
  one subject, the files). Browser + axe at 1440 and 375. The e2e also checks one PDF page a subject.
- **Range Wise Summary** (the old "Result Summary", 18 Nov 2026): the class's result in one table — total students,
  appeared, absent (share of all), pass / fail / compartment by the CBSE result, distinction and the three divisions
  and eight aggregate ranges (90–100 … 33–39.99, below 33; the rows after the old screen's row 10 were not in the
  screenshot, so these are EduPro's) by each student's aggregate (`best5` or `all`), highest / lowest / average
  aggregate. Filters: class, examination, compare with 0–4 saved years (none by default, as the old screen),
  calculation method, gender. `rangeOverall` in `board-reports.ts`, `GET reports/range-overall` and `/file`; the file
  builders take the report's labels (`SUBJECT_LABELS`, `OVERALL_LABELS`). Tests: unit + 1, e2e + 1.
- **Subject Summary** (the old "All Subject Performance Report (Percentage-Based, Not Grade-Based)", 18 Nov 2026): a
  row a subject (short names, the school's order) and a total line — appeared (boys, girls), failures, compartments,
  pass, boys' and girls' pass (No. and %), average % (all, boys, girls), highest, and boys / girls in each marks range
  A1 (91–100) … E1 (0–32), by the marks whatever the grade setting. Filters: class, examination, gender, subject.
  `subjectPerformance` in `board-reports.ts` returns an `AnTable` (heading groups); `GET reports/subject-summary` and
  `/file` (`singleTableXlsx`, `singleTablePdf` — A3, the total bold). The admin's `GroupedTable` draws heading groups.
  Tests: unit + 1, e2e + 1.

## Result Analysis, First 5, frozen columns (18 Nov 2026)

The school's old "Result Analysis" page (its review notes in the user's file `result_summary_page.md`), with the
answers chosen: one report with two views, boys vs girls as three rows a subject, "First 5 subjects" everywhere,
frozen first columns on every wide report table.

- **Result analysis** (Reports): **Table** — a row a subject (24 figures: total, appeared, absent No./% of all, pass /
  fail / compartment No./% of appeared, highest, lowest, average, distinction and 1st / 2nd / 3rd division No./%,
  the eight grades) and the total line(s); gender "Boys vs girls" gives an All, a Boys and a Girls row a subject.
  **Graphs** — pass % over the years (the CBSE result; one subject's passes when a subject is chosen; a line a gender
  for boys vs girls), grades by subject (stacked A / B / C / D / E groups), marks by subject (highest, average,
  lowest), one subject's grades across the years; each chart with its numbers folded under it. Filters on both
  views: class, examination, years in the charts (0–4 saved years before), gender, subject, result (the old page
  hid its result filter). `resultAnalysisTable`, `resultCharts` in `board-reports.ts`; `GET reports/result-analysis`
  and `/file` (the table as Excel / A3 PDF).
- The old page's faults put right: the grades add up to those appeared (marks: D from the pass marks to 40, E below;
  printed: D1 + D2 as D); grade ranges in the headings only when counted from the marks; a proper title; no
  duplicate chart; the same filters on both views; frozen columns; the division cut-offs in the note.
- **First 5 subjects** (`first5`): the first five subjects with marks in the order CBSE printed them, over 500 — a
  calculation method next to the best five and all subjects on the Results tab and the Range wise summary.
- **Frozen columns**: `.ep-table-freeze-2` / `-3` (packages/ui, tokens only) keep the number, code / roll and
  subject / name in view on the Results tab, Subject summary and Result analysis; the shared line chart's last label
  now ends at its point instead of being cut.
- Tests: unit + 2 (`board-reports.spec.ts` result analysis and charts; `board-marks.spec.ts` first five), e2e + 1
  (`board-years.e2e-spec.ts`: table, boys vs girls, charts over two years, files, first five). Browser + axe at
  1440 and 375 (table frozen while scrolled, graphs, first five on Results and Range wise summary).

### The graphs: every grade, every subject across the years, a PDF (18 Nov 2026)

Asked: a PDF of the Graphs view; "grades across the years" for all subjects, not one; the share of students at each
grade in "Grades by subject" (e.g. English A1 %). Answers chosen (benchmarked against the usual ERP result-analysis
dashboards): a PDF drawn by EduPro, a small chart a subject, 100% bars with % labels, every grade A1 … E1.

- **Data** (`resultCharts`): `grades` (A1 … E1); `gradeSpread` a subject — `appeared`, `counts[8]`, `pct[8]` (of those
  who appeared); `subjectYears` — every subject shown (all, or the one in the filter), a year each with `appeared`,
  `counts[8]`, `pct[8]`. Printed grades with a gap: the shares stay of those who appeared, so a bar may not reach 100%.
- **Screen**: grades by subject as `PercentBarChart` (100% bars, the share on each part with room; `of` = appeared);
  eight grade tones (A1/A2 green, B1/B2 navy, C1/C2 cyan — the second of each pair soft — D amber, E1 red; soft tones
  and part-label colours in packages/ui); grades across the years as a grid of small `BarChart`s (`width` 400, two a
  row on a desktop, one on a phone; % scale rounded to tens; a bar a year, the latest darkest; the legend gives each
  year's appeared). Numbers tables: count and share.
- **PDF** (`board-charts-pdf.ts`, pdf-lib, A4 upright, no worker): the letterhead, the scope (with the years
  compared), pass % over the years (the scale starts under the lowest value, in tens), grades by subject as
  horizontal 100% bars, marks by subject as three bars a subject, then every subject's grades across the years two a
  page; a numbers table under each chart; the note and the signature boxes (Prepared by, Checked by, Principal);
  page numbers. `GET reports/result-analysis/file?view=graphs&format=pdf` (Excel of the graphs refused, 400; audited
  as `result-analysis-graphs` with the years compared); admin `reports/analysis/pdf?view=graphs` (View + Download).
- Tests: unit `board-reports.spec.ts` (eight grades, shares, every subject across the years, the filter) and
  `board-charts-pdf.spec.ts` (+2: pages, one subject and an empty year); e2e `board-years.e2e-spec.ts` (the data, the
  graphs PDF, no Excel). Browser + axe at 1440 and 375 (no sideways page scroll; View/Download served inline/saved).

## The Reports tab: Topper Report (18 Nov 2026)

The school's old "Topper Report" (its review notes in the user's file `toppers_page.md`), built with its own suggested
fixes as the defaults.

- **What it shows** (`board-toppers.ts`, `toppersReport`): the class's toppers by the aggregate (`best5` / `first5` /
  `all`, from the Results tab's `marksRows`) and each subject's toppers by its marks (CBSE's printed order, internal
  subjects out, one subject a code), each with up to three lists: **top N ranks**, **lowest N ranks** (lowest first),
  a **percentage list** (at or above / at or below; a subject's marks for subjects). Filters: class, examination,
  **section** (a real section — the old form's "Section" was the class), gender, method, show (class / subjects /
  both), subjects (ticked; none = all), top (0–50, default 5), lowest (0–50, default 0), percentage, compare (0–4).
- **Ranks are dense** (1, 1, 2): "top 5" is five ranks and may be more students — each list says both ("Top 5 ranks
  — 12 students"), the old report's unclear "No. of Toppers: 5" put right. A section or gender filter ranks within
  it; the class rank shows beside (the overall list).
- **Over the years** (compare): a year a row, oldest first — ranked, highest %, at rank 1, where the top N ranks
  start, in the top N ranks, 95%+ and 90%+ — and a bar chart of the highest % and the cut-off (0–100).
- **Screen**: the lists as tables with a bar a student on a fixed 0–100 scale (navy top, amber lowest, cyan
  percentage); subject blocks under "Subject toppers". **Files**: `GET reports/toppers` and `/file` (audited
  `exams.board_result.report_export`, report `toppers`); PDF A4 upright on the letterhead — a heading band a block, a
  subheading a list, a bar column (0–100), each block kept on one page when it fits, the years as a full-width table,
  the note and signature boxes; Excel one sheet in the same order. `tablePdf` gained three opt-in options: a column
  `bar` (scale), `keepBlocks`, and `wide` for the small tables after.
- The old report's other faults do not arise: no duplicate subjects (CBSE codes), no bar a page (no chart pages),
  names in the table rather than turned on an axis, a proper title, required fields marked.
- Tests: unit `board-toppers.spec.ts` (3: ties, section and class rank, lowest first; subjects, ticked subjects,
  percentage list; boys and the years); e2e `board-years.e2e-spec.ts` + 1 (lists, girls with class rank, years, PDF
  and Excel, top over 50 refused). Browser + axe at 1440 and 375.

## Analysis rules a class: the best five built, the school's grade scale (18 Nov 2026)

The user asked for configurable rules: grades the school can edit or add to, and a best five set per class (XII:
English + four main subjects or English + the best four leaving the optional subject out; X: the first five or the
best five). Answers (all the recommended ones): a rule builder of five subjects, an own grade scale a class, optional
subjects chosen by subject kind, today's rules for every year shown.

- **Rules** (`board-rules.ts`, the setting `exams.board_rules` now `{ X?, XII? }`, history kept as before): a class's
  `bestFive { include: language | english | none, rest: best | printed, optional: replace | never | failed,
  optionalKinds }`, `distinction`, `passMarks`, `grades: marks | printed`, `scale [{ grade, from, to }]`. A class not
  saved uses the defaults; the one set saved before the classes had their own is read for both (`readRules`);
  saving one class keeps the other (`writeRules`). Defaults = the old behaviour: the best language + best four,
  optional may replace a weaker one (X: skill + additional optional; XII: additional), scale A1 … D 33–40, E1 0–32 —
  so the acceptance figures do not move.
- **Best five** (`bestFive`): the subject always in (from the class's non-optional subjects, else an optional one
  unless they never count), the rest by marks or CBSE's printed order, then each optional subject (best first) fills
  a gap or replaces the weakest pick (`replace`), nothing (`never`), or — passed — only a failed pick (`failed`,
  CBSE's rule). Always out of 500; the codes come back anchor first, then by marks.
- **Scale**: 2–12 grades named 1–4 letters/digits/+/- (A1, B+, E), unique, 100 at the top, 0 at the bottom, each
  ending one below the one above (`scaleProblem` says which row is wrong; the DTO sorts the rows highest first).
  `gradeOn`: marks on the scale (a grace half takes its whole number), or the printed grade matched by name, else by
  its letter when only one grade has it (D1/D2 → D, E → E1). A grade below the pass marks is failing ("total no. of
  division" = the passing grades); the A grades are every grade named A… (column "A1+A2", or "A+, A").
- **Everywhere**: Annexure 4's grade columns (`g<name>`; the default's last grade is now `gE1`, as the reports
  already called it), Range Wise Subject Summary and Result Analysis grade rows/columns with each grade's marks,
  Subject Summary's mark ranges = the scale, the charts' `grades` + `tones` (`gradeTones`: passing grades green,
  navy, cyan … the last amber, failing red; the screen and the graphs PDF use the same — four more light tones in the
  design system: info, muted, warning and danger soft). The KV Performance Index keeps its fixed weights on the
  grades CBSE printed (a national formula). Notes say the rule in words (`ruleWords`).
- **API**: `GET rules?classLabel=`, `PUT rules` `{ classLabel, …rules }` (import right; audited with the class). The
  admin's board actions show a form check's first message when the API sends no detail.
- **Set-up**: Analysis rules with a Class X / XII switch; three framed sections — Best five (always counted, the rest,
  optional subjects, the optional kinds as ticks, the saved rule in words), Marks and grades, Grade scale (12 rows:
  the saved grades then blanks; a half-filled row is sent back naming the row). The Analysis tab's rules line links
  to the class's rules.
- Tests: unit `board-rules.spec.ts` (5: scale checks and sorting, grading on the scale and printed, the old setting
  read and the other class kept, words and tones, annexures + result analysis + charts + graphs PDF on a five-grade
  scale), `board-analysis.spec.ts` + 1 (the builder: printed order, never / failed / replace, kinds); e2e
  `board-analysis.e2e-spec.ts` (class X saved with its own scale, a gap refused with the message, XII still default).
  Browser + axe at 1440 and 375 (save, a gap refused, the phone's three scale columns fit).

