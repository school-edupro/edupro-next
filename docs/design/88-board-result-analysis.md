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
