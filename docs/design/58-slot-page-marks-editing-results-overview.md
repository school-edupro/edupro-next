# 58 — Slot page rebuilt, marks editable after upload, Test results overview (plan, 28 Oct 2026)

Asked:

1. The slot page of Tests and interviews (`/admissions/schedule/143`) is not user friendly; rebuild it.
   After the Excel upload the data cannot be changed: the office must be able to change one candidate,
   and many candidates again by Excel.
2. Test results (`/admissions/results`) does not show Class IX; Excel and PDF exports are needed.

## What was found

- **Slot 143** (Admissions 2027-28, Written test, Class IX, 3 candidates). The sheet was uploaded: Myra
  Selected (50), Ayaan Held (38), Vivaan Held (absent). The slot page locks a candidate as soon as any
  decision exists, Hold included, so Ayaan and Vivaan cannot be changed there; the sheet leaves out
  decided candidates, so Myra cannot be changed by Excel. The five subject boxes stack in one narrow
  column with no total or %.
- **Test results** opens on the newest session, "Admission form 2026-2027", which has only Class I; the
  Class IX candidates are in "Admissions 2027-28". The Class list follows the session only after Show,
  so Class IX needs two rounds. Exports appear only once a class with a paper is open. The data itself
  is right (the API returns the three candidates).

## Benchmark

Entab, Fedena, Edunext and the DPS Result Report: the marks grid shows every subject of a candidate in
one row with the total as typed; marks stay editable until the result is final, and a change after a
decision is kept with a reason; a sheet uploaded again changes only the cells that differ; a session
overview shows how far each class's marks entry has got; results export per class and per session.

## Decisions (asked 28 Oct 2026)

1. **Slot page in tabs**: a summary strip (date and time, venue, class, allotted, marked, decided)
   and tabs **Marks**, **Excel**, **Allotment and admit cards**, **Slot details**.
2. **A decided candidate (Selected or Not selected)**: the office may change the marks *and* the
   decision (e.g. Selected → Hold), each with a reason; merit follows. Held candidates stay freely
   editable.
3. **Excel again**: the sheet lists every candidate (decided ones too) with a **Reason for change**
   column; only cells that differ are applied, and a decided candidate's change needs the reason.
4. **Test results opens on an overview**: the session with candidates first; every class and stage
   with candidates, marked, waiting, below cut-off, and Open; pickers act at once (no Show); Export
   Excel and PDF at the top, for one class or the whole session (a sheet per class).

Decided here, change any before building:

- The Decision choices become **Select / Hold / Not selected** everywhere (grid, sheet, slot), as the
  slot page already offered Not selected. Not selected sends the family the school's result message as
  a decision does today.
- Changing a decision undoes the stage's last decision with the reason (the registration's history
  shows both) and records the new one. If the candidate has already been decided at a later stage, it is
  refused: "decided at <stage>: undo it there first".
- A candidate whose class has no paper keeps one marks figure (the old table), editable the same way.

## Parts

### Part 1 — change after upload (one candidate, or many by Excel)

- Test results grid: every row editable; Decision shows the current decision and offers Select /
  Hold / Not selected; changing a decided candidate's marks or decision asks for the reason (one box).
- API: a decision change (undo with the reason, then the new decision) in the same save; refused when a
  later stage has decided.
- Sheet: every candidate who reached the stage (or is in the slot), decided ones included, with their
  marks and decision filled in and a **Reason for change** column; Check shows per row "No change",
  "Marks changed", "Decision Selected → Hold" or the error; Save applies only the differences.
- Tests: e2e (change one held, one selected candidate's marks and decision; a re-uploaded sheet with
  mixed rows; a later stage refusing), a11y.

### Part 2 — the slot page rebuilt

- Summary strip and tabs (`?tab=marks|excel|allot|details`).
- **Marks**: the Test results grid for the slot's candidates (each class with a paper: its subjects in
  the row, total, %, absent, decision, remark, reason when needed); classes without a paper: one marks
  figure per row, the same editing rules.
- **Excel**: the slot's sheet (part 1 rules), Check, Save, exports.
- **Allotment and admit cards**: allot the next candidates, mail the schedule, remove, admit cards.
- **Slot details**: the slot's form as today.
- Tests: e2e for the slot's grid data; a11y per tab; browser on slot 143.

### Part 3 — Test results overview and exports

- Opens on the session with candidates at a test or interview (else the newest); session, class and
  stage pickers apply at once; the class list follows the session.
- **Overview** (no class chosen): every class and stage of the session with candidates reached,
  marked, waiting, decided, below cut-off, the paper (out of N, or "no paper"), the release state, and
  Open.
- Exports at the top: the class (Excel, PDF) and the whole session (Excel: a sheet per class and
  stage; PDF: a section per class and stage).
- Tests: e2e for the overview and the session export; a11y; browser.

## Not in this plan

Changing a decision at a later stage from here; locking a session's results as final; marks entry by
subject teachers.
