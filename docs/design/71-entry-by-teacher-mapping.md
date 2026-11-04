# 71 · Who enters what: indicators and remarks by teacher mapping, height and weight in the teacher app

Status: planned 4 Nov 2026 (decisions below); parts 1–3 to build on "go part N"

## Why

Three things the school found on 4 Nov 2026:

1. **Indicators.** Teacher assignments → _Indicator_ already maps a teacher × sections × indicator
   areas (migration 0301, docs/design/69), but only the grade registers read it. Entering indicators
   (`/exams/:id/indicators`, the teacher app's _Indicators and progress card_) is the class teacher's
   alone, so the Art or PE teacher mapped to their area cannot enter it. There is no Excel upload.
2. **Remarks.** On `/remarks?exam=758&section=143` (PT2 · VI-A) only _Any other_ shows, for the class
   teacher. Causes: the categories' class lists (Academic progress and Conduct were put on Class VII
   that morning; Mathematics and Science are on the test class Fee Demo only), and VI-A had no class
   teacher that day. There is no way to give a category to a teacher who is neither the class teacher
   nor the teacher of its subject (the PE teacher writing _Sports_).
3. **Height and weight.** The class teacher's entry exists but is hidden in the teacher app's _Exam
   register_ ("Remarks, exam attendance, height and weight"); only Term I takes it. No Excel.

## Benchmark

- **Legacy** (`t-webservices/GetIndicator.php`, `submit_indicator.php`): `teacher_indicator_mapping`
  (EmpID × Class × indicator code × sub-indicator code); a teacher sees only their mapped indicators; in
  the primary classes a teacher with no mapping gets every indicator of the class.
  `exam_remark_mapping`: the remarks offered per class. `health_record` (height, weight, BMI by month)
  entered by the class teacher.
- **Entab CampusCare, Edunext, Fedena, Teachmint** (and the CBSE practice behind them): co-scholastic
  areas are graded by the teacher of the activity (Art Education by the art teacher, Health & PE by the
  PE teacher), discipline and the general remark by the class teacher, subject remarks by the subject
  teacher; height and weight per term by the class teacher, BMI worked out; every teacher sees only
  their own entry list, with an Excel sheet to download, fill and upload.

## Decisions (user, 4 Nov 2026)

| Question                              | Answer                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a teacher is mapped to indicators | **By area, optional indicators**: teacher × sections × areas as now; optionally narrowed to single indicators inside the areas. The teacher app shows only those, with Excel download / upload                                    |
| What the class teacher enters then    | **Everything, can correct**: a mapped teacher enters only their areas; the class teacher still enters or corrects every area; an area mapped to nobody stays with the class teacher                                               |
| Who writes a remark category          | **As now + teacher mapping**: a general category the class teacher's, a subject category the subject teacher's; plus a Teacher assignment _Remarks_ naming categories for any teacher in chosen sections. Excel download / upload |
| Height and weight in the teacher app  | **Own page per term exam**: a _Height and weight_ item for the class teacher, exams that take it (Term I, Term II), the last reading shown, BMI worked out, Excel download / upload; the report card prints it                    |

## Design

### Access (all parts)

A mapped teacher must reach the sections of their mapping. `app.sync_teacher_scopes` (0016) gives
roles and `class_section` scopes from class and subject teacher assignments only; an Indicator-only
teacher today reaches no section (0304). It is redefined: the Subject Teacher role is held (and scoped)
while the person has a subject teacher, **Indicator** or **Remarks** assignment, and its sections are
those of all four kinds. The entry check (`ExamEntryService.assertMayEnter`) learns the two kinds:
indicators accept an Indicator assignment of the section; remarks a Remarks assignment naming the
category.

### Part 1 — indicators by mapping

- **Data** (migration 0305): `teacher_assignments.indicator_ids BIGINT[] NOT NULL DEFAULT '{}'` (kind
  Indicator only, like `indicator_area_ids`): none = every indicator of the areas; some = only those
  (each must lie in one of the areas, or the areas are none = every area). The sync above.
- **API**: `PUT /academics/teacher-assignments/:id/areas` takes `{ areaIds, indicatorIds }`; the bulk
  create and the Excel import of assignments take areas (and indicator codes) for an Indicator row.
  `GET /exams/:id/indicators` marks each indicator `mine` (the class teacher, a coordinator, an
  unscoped office: all; a mapped teacher: their areas / indicators) and says why a section shows
  nothing; `PUT` refuses an indicator not theirs (409 `exams.indicator_not_mapped`, the codes named).
  `/exams/:id/entry/sections` returns `indicators: true` for a section the caller may rate.
  **Excel**: `GET /exams/:id/indicators/sheet?classSectionId=` (roll, name, one column per indicator
  of the caller's, the scale's levels listed) and `POST /exams/:id/indicators/upload` (preview, then
  apply; the same checks; a level not on the scale refused per cell).
- **Admin**: Teacher assignments → _Assign a teacher_ with kind Indicator picks the areas (and,
  folded, single indicators of the sets the chosen classes use) in the same form; the row's fold-out
  shows and edits both. Excel template columns `Indicator areas`, `Indicators`.
- **Teacher app** _Indicators and progress card_: the sections the teacher rates (class teacher or
  mapped); a mapped teacher sees their indicators only, the class teacher every indicator with who
  else enters it ("Art Education · entered by E021"); Download / Upload the sheet.
- Tests: e2e (mapping saved and checked, entry refused outside it, class teacher all, sheet round
  trip, the sync's scopes for an Indicator-only teacher); a11y (the form, the teacher page); help.

### Part 2 — remarks by mapping

- **Data** (migration): `teacher_assignment_kind` gains **remarks**;
  `teacher_assignments.remark_category_ids BIGINT[] NOT NULL DEFAULT '{}'` (kind Remarks only, at least
  one). A Remarks assignment of a category not in the class's list is refused (it would show nothing).
- **API**: `remark-items` `may` per category: class teacher (general), subject teacher (its subject)
  or a Remarks assignment naming it. The sheet says why nothing shows: "No remark category is set for
  Class VI (Exams → Set-up → Remark categories and bank)" / "You write no category in this section". **Excel**
  download / upload of the section's categories the caller writes (a list-only category: the bank's
  codes).
- **Admin**: Teacher assignments kind _Remarks_ with a category picker; Remark categories list shows
  the classes and who writes each ("class teacher", "Mathematics teacher", "+ 2 mapped").
- **Teacher app** _Remarks_: sections where the teacher writes any category (not only their own
  sections' class teacher), the categories they write editable, the others read-only; the reasons
  above; Download / Upload.
- Tests: e2e, a11y, help.

### Part 3 — height and weight page

- **Teacher app**: a menu and home item **Height and weight** (class teacher, `exams.health.enter`):
  the exams that take height and weight, the teacher's sections; per pupil the last reading (date, from
  an exam or a school health check), height, weight, BMI worked out on the page and saved by the API,
  blood group as today; Save; Download / Upload the sheet. _Exam attendance_ gets its own item the same
  way; _Exam register_ stays for the three together.
- **API**: `GET /exams/:id/health/sheet`, `POST /exams/:id/health/upload` (preview, apply; ranges
  checked: height 50–220 cm, weight 5–150 kg, else the cell refused).
- **Home**: a _To enter_ card for the teacher: per exam open now, what is theirs and not done (marks,
  indicators, remarks, height and weight).
- Tests: e2e (sheet round trip, ranges, only the class teacher), a11y, help.

## Found while planning (data, not code)

- On 4 Nov 2026 VI-A, VI-B and VII-A have no class teacher (E006's VI-A assignment ended that day); a
  section without one has nobody to write general remarks or height and weight until one is assigned.
- The remark categories' class lists are the school's own set-up (31 Oct: all but _Any other_ limited to
  Fee Demo; 4 Nov: Academic progress and Conduct on VII): to see them in VI, add Class VI to them in
  Exams → Set-up → Remark categories and bank.
- The demo login dev-teacher (E006) has no assignment now and holds an unscoped _Exam office_ role
  granted by hand (it enters marks in every section).
