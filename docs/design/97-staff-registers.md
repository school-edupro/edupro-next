# 97 — Registers for staff: the staff website's Exam register and the staff app

## The ask (22 Nov 2026)

"http://localhost:3002/exam-register: this exam register the same as http://localhost:3000/exams/schemes, and the
staff mobile app shows these registers — how to manage."

The admin's Registers (`/exams/schemes` and its tabs) run five registers: **Mark Register** (mark registers built by
the office: a section, the class ranked together, an exam, a subject; the Reports menu — summary, analysis, entry
status, missing, absent, attendance, toppers, teacher-wise, at-risk, failing, compare; PDF / Excel), **Grade
Register** (indicator grades: the class sheet or student-wise, the grade summary and analysis), **Remark**,
**Attendance** and **Height & Weight Register** (a class's sections and exams). The staff website's `/exam-register`
is where the class teacher fills remarks, exam attendance and height and weight; the app has that (docs/design/96
parts 17–18) but no registers.

Since docs/design/96 part 19 a class or subject teacher sees the mark and grade registers of the classes they teach,
with Run, for the sections they teach; the student registers already showed a teacher their sections.

## Decisions (asked)

- **Website: add register tabs.** The Exam register keeps **Fill the register** as its first tab and gains the
  admin's five: Mark Register, Grade Register, Remark Register, Attendance Register, Height & Weight Register — each
  for the person's own classes and sections (what the API gives them). Building, changing, locking and giving rights
  stay in the admin app.
- **Run: the same as the admin's** — the sheet with its choices (section, exam, subject; the class ranked together
  where the person may), the Reports menu, PDF and Excel.
- **App: on screen and files** — pick the register, the section, the exam (and a subject or a report); the sheet as a
  table that slides sideways; PDF and Excel in the app's file viewer.

## Phases (each checked complete — plan and all tests — before the next)

- **A** the admin's register sheet, its count drill-down and the downloads menu, and the register types, move to the
  shared UI package (`@edupro/ui`); the admin uses them from there, unchanged.
- **B** the staff website: the Exam register's tabs; each register's list (what the person may run) and run pages as
  the admin's (the sheet, the choices, the Reports, PDF / Excel through the staff website's own download routes);
  Hindi words; checked in a browser as a teacher.
- **C** the staff app: Exam register gets the registers — the five kinds, a register's run (section, exam, subject,
  report), the sheet as a sideways table, PDF / Excel in the file viewer.
- **D** tests (website accessibility list, app tests in light, dark, Hindi, twice the text), the web preview, close.

## As built (22 Nov 2026)

- **A.** `@edupro/ui` gains `RegisterSheet`, `CountDrill`, `RegisterDownloads` (`components/`) and the register
  types (`register-views.ts`: `RunResponse`, `RegisterRow`, `GradeRunResponse`, `GradeRegisterRow`,
  `StudentRegisterResponse` …); the admin's files re-export them. Checked: the admin's Registers pages (a mark
  register's run and a report, a grade register's run, the Remark and Attendance registers) render with their sheets
  and downloads; axe clean.
- **B.** Staff website: `RegisterTabs` on the Exam register (Fill the register · Mark · Grade · Remark · Attendance ·
  Height & Weight Register — the last three with the marks view right, Height & Weight with the health view);
  `/exam-register/mark` and `/exam-register/grade` list the registers the person may run (a card a register: name,
  Locked / Draft, Result, classes, exams, subjects, Run); `/exam-register/mark/[id]`, `/exam-register/grade/[id]` and
  `/exam-register/[type]` are the admin's run pages (the choices, the Reports menu, PDF / Excel) with the staff links;
  the download routes are the admin's at the same paths (`/api/exam-register/…`, `/api/grade-register/…`,
  `/api/student-register/…`); `lib/api.ts` gives the staff website the admin's `apiFetch` / `getMe`; Hindi words
  added. Checked on Alpha as the demo teacher (desktop and phone): every tab and run page (a mark register with
  Result summary and Toppers, a grade register with its summary, the three student registers) shows its sheet and
  Download, the Excel comes; axe clean. The staff accessibility list gains the five register pages.
- **C.** App: the Exam register (whole) has two tabs — **Fill the register** and **Registers** (`registers.dart`):
  the five kinds as chips; a mark or grade register's card (name, Locked / Draft, Result, classes, exams, Run);
  **a mark register's run** — Class (the person's sections; the class ranked together only where allowed), Exam
  (exam-wise, Missing / Absent), Subject, Report (Register and the reports; their own choices: Top, % from / to,
  order; failed in from / to, final %; borderline margin; From / To), notes, the result counts, the sheet or the
  report's tables; **a grade register's run** — the four reports, Section, Layout, a Filter by area and indicator;
  **the Remark, Attendance, Height & Weight registers** — Class, Section (All sections), cut-off %, BMI, the exams as
  chips, a sheet a section. PDF and Excel (and every section's) open in the file viewer (the answer's base64; PDF on
  Legal, landscape, fitted). `register_sheet.dart` draws a sheet: a header naming each column (a group over its
  columns joined in, spans and row spans laid out as a browser does), cells spanning columns, the tints (worked out,
  final, codes, not taken), badges, ratios, a count that opens its students; it slides sideways. Calls added:
  `MarkSchemesController_list`, `_register`, `GradeRegistersController_list`, `_run`, `StudentRegistersController_run`.
  The generator no longer writes `Object??` for a query field of more than one type.
- **D.** Tests: `staff_test.dart` — the column labels; the Registers tab (only registers with Run), a mark register's
  sheet, notes and counts, Compare sections not offered without the class ranked together, Result summary and its
  drill-down, PDF with the paper; a grade register's report and area filter; the remark register's exams; light,
  dark, Hindi, twice the text. 286 app tests, analyze, the generated calls; the web preview rebuilt.
