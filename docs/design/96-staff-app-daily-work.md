# 96 — Staff app: Daily work as on the staff website

## The ask (22 Nov 2026)

"Staff mobile app: the Daily work section the same as http://localhost:3002/daily-work."

The staff website's Daily work has three tabs: **Homework and classwork** (the day's sheet: a date, a class with its
sections ticked, a row per subject with a Homework and a Classwork box and their files, Publish on, Ask to
acknowledge, Save and publish), **Assignments** (the same sheet: an Assignment box, its files and a Due on date) and
**Report** (From, To, Class, Show; what was posted by date, class and subject; Excel and PDF). The app has one form
that posts one entry at a time ("Post homework": section, subject, kind, title, details, due date, files).

## Decisions (made without asking: the ask is "the same as the website")

- The app's Daily work becomes the website's three tabs, laid out for a phone: the sheet's subjects as cards (the
  boxes under the subject) instead of a table; the date, class and sections reload the sheet at once (no Show
  subjects button). It replaces the one-entry form; its entry is **Daily work** (in Classes, More and the tab lists).
- Same API as the website: `GET/POST academics/daily-work/sheet`, `GET academics/daily-work`, the report file `GET
academics/daily-work/report` (Excel or PDF, opened in the app's file viewer). Files: PDF or photo (camera too), up
  to the school's size; a saved file's View opens it.
- Saving needs the network (the sheet is read and saved whole); a failure says so and keeps what was typed.

## Phases (each checked complete — plan and all tests — before the next)

- **A** the app's calls (sheet, save, report file) generated; the screen's data.
- **B** the Homework and classwork and Assignments tabs.
- **C** the Report tab (filters, grouped entries, files, acknowledged count, Excel and PDF).
- **D** the entries (Classes, More, tab lists), tests (light, dark, Hindi, 2× text), the web preview, close.

## As built (22 Nov 2026)

- **A.** `api-operations.txt` gains `DailyWorkController_sheet`, `_saveSheet` and `_reportFile !file`;
  `endpoints.g.dart` regenerated (`dailyWorkSheet`, `dailyWorkSaveSheet` with `SaveSheetDto`,
  `dailyWorkReportFile`). No API change.
- **B.** `lib/staff/daily_work.dart` — `DailyWorkScreen`: three tabs sharing the width (Homework and classwork,
  Assignments, Report; a long name wraps). `WorkSheetTab` (daily / assignment): the date, the class (its sections as
  chips, ticked; changing any reloads the sheet), a card per subject — the boxes (Homework and Classwork, or
  Assignment with its Due date), Add a file (PDF or photo, the school's size limit) and Take a photo, what was posted
  (for which sections, its files to view) — then Publish on (date and time, the school's usual time said), Ask the
  parent / student to acknowledge, the help line and Save and publish (files uploaded, the whole sheet sent; "Saved:
  N new, M updated."; the sheet reloads). `WorkReportTab`: From, To, Class (All my classes), Show; entries grouped by
  date, class and subject as on the website (homework and classwork, then assignments) with files, published or
  publishes, who posted, due date, how many acknowledged; Excel and PDF open in the file viewer.
- **C/D.** Classes, More and tab lists open it as **Daily work** (`nativeScreen('/daily-work')`); the one-entry
  "Post homework" form is gone. Tests: `staff_test.dart` (the sheet saved for both sections with the right rows,
  a section left out reloads, assignments with due dates, the report and its PDF; light, dark, Hindi, 2× text);
  218 app tests and analyze pass; the web preview is rebuilt. Not checked in the web preview on Alpha (a sign-in
  there sends a live code).
