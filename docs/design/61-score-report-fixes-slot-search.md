# 61 — Score report that opens on the right session, marks by subject; search on the slot page (plan, 28 Oct 2026)

Asked:

1. `/admissions/score-report` "is not working".
2. `/admissions/schedule/143`: a filter to search for a candidate.

## What was found

- **Score report.** It opens on the newest session ("Admission form 2026- 2027"), which has no
  registrations, so it says "No registration matches". Admissions 2027-28 has them (Class I 20, Class IX
  15, Class VI). The Class list follows the Session only after Show (two rounds to reach Class IX). With
  the right session the rows, ranks, points, check lines, Excel and PDF work, and the API log has no
  errors. The test and interview marks are one **Marks** column (merit minus form points), so Class IX
  shows 50 and not its subjects; the PDF is A4 portrait and already tight with eight criteria.
- **Slot page.** The Marks tab (a grid per class) and the Allotment tab list every candidate of the slot
  with no search or filter; a slot may hold up to its capacity (30 or more).

## Benchmark

Entab, Fedena, Edunext and the DPS Result Report: reports open on the current admission session; the
pickers apply at once; the score sheet shows each subject and parameter with stage totals, form points,
the grand total and rank; list screens have a type-ahead search and quick filter chips with "showing x
of y".

## Decisions (asked 28 Oct 2026)

1. **Marks by subject**: a column per written-test subject and interview parameter of the class's
   paper, then the stage's total; a stage without a paper keeps one marks column; then form points, the
   grand total and rank. Excel and PDF the same.
2. **Slot search on the Marks and Allotment tabs**: one box, name, registration or roll no., the rows
   filter as you type; "showing 3 of 30".
3. **Quick filters**: To decide / On hold / Decided; No marks yet / Absent; Below cut-off; By class.

Decided here, change any before building:

- The score report opens on the session (and class) with registrations, like Test results; Session and
  Class act at once and the class list follows the session; Category, Status, "lines to check" and a new
  **name or registration no.** search stay in the filter row with Show, and the downloads follow them.
- The PDF turns **landscape** when the columns do not fit A4 portrait.
- The slot filters work in the page (no reload) and are kept in the address, so a refresh or a shared
  link keeps them; the Excel tab is not filtered (the sheet is the slot's).

## Parts

### Part 1 — Score report

- API: `GET admissions/score-report/options` (sessions with classes and registration counts); `q` on
  the report and its downloads; the report gives `marks` columns per stage (parts of the class's paper
  with their maximum, the stage total; one column for a stage without a paper) and each row's values.
- Page: pickers act at once (client), default session and class with registrations; the search box;
  the marks columns; downloads with the same columns, the PDF landscape when wide.
- Tests: e2e (columns per part and totals; a stage without a paper; `q`; options counts); a11y;
  browser on Class IX.

### Part 2 — Slot page search and quick filters

- A filter bar on the Marks and Allotment tabs: search, the stand chips, marks chips, below cut-off,
  class (when the slot has more than one class); the grids and lists show the matching rows with
  "showing x of y" and "Clear"; kept in the address.
- Tests: a11y with filters set; browser on slot 143 (search by name, by roll no., chips).

## Not in this plan

Saved filter sets; searching across every slot of a session (Test results does that).
