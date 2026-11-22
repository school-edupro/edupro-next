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

## Part 2: families (22 Nov 2026)

"Student app: rename Homework to Daily work, and Homework due does not show."

Decided (asked): **Daily work** on the app and the parent website alike; the Home card becomes **Daily work** —
homework for today or tomorrow and assignments due then.

The cause: the day sheet (staff website and app) posts homework for a day with no due date, and both Homes counted
only items with a due date (the app: due today or tomorrow, loading up to today; the website: due tomorrow). Now the
day a piece of work is for is an assignment's due date, homework's due date else the day it was set, and classwork
none (`workDay` in the app's `homework.dart` and the parent website's `HomeDashboard.tsx`); the app's Home loads
tomorrow too.

As built: `packages/menus` — the family screen `/homework` is named **Daily work** (menu, tabs, shortcuts,
Academics list) and the card `homework_due` **Daily work** / दैनिक कार्य; the app — the tab and shortcut name, the
Academics list, the screen's title, Home's figure and card ("Nothing for today or tomorrow."); the parent website —
the Home tiles and start-up tour, the Academics page, the Daily work page's title, Home's card. Tests:
`family_test.dart` (a day-sheet homework with no due date now counts on Home: 2), 218 app tests; the API's
family-layout and mobile-family suites. Checked on the parent website with the demo parent (Home: Daily work 2 —
VI-A's homework for today and tomorrow; menu and page say Daily work; axe clean). The web preview is rebuilt.

## Part 3: Session plan, curriculum, date sheet (22 Nov 2026)

"Staff app: Session plan, curriculum, date sheet opens a web page; do not open a web page."

As built: `lib/staff/documents.dart` — `StaffDocumentsScreen`, opened from the staff menu, Classes and More
(`nativeScreen('/documents')` for staff), as the staff website's page in two tabs. **Upload**: What (session plan,
curriculum / syllabus, date sheet, other), For the classes (the teacher's sections), Title, Remark (plain text sent
as paragraphs), up to 5 PDFs or photos (camera too), Publish on, Ask the parent / student to acknowledge, Upload (a
class, a title and a file asked for; the list reloads). **Uploaded**: What (all kinds, the school's magazine and
almanac too), Class, Published from / To (Clear), Excel and PDF (the file viewer); each document with its kind,
Scheduled, class and subject, title, remark, files, published or publishes, who posted; **who acknowledged** (every
pupil of the class, acknowledged when and by whom, or not yet) and **Remove** (asked first) for the class ones. Calls
added: `DocumentsController_create`, `_remove`, `_documentsReport !file`, `_ackStatus`. Tests: `staff_test.dart`
(the upload's checks, the list, who acknowledged, remove, the PDF; light, dark, Hindi, 2× text); 219 app tests,
analyze, the generated calls; the web preview rebuilt. (The website's Upload on this page used the Daily work file
upload, fixed in fd7a216d.)

## Part 4: Holidays and almanac for staff (22 Nov 2026)

"Admin's Academics → Calendar (Holidays and almanac): show it in the staff website and app."

Decided (asked): **all staff** see it (not only roles with the calendar right); it sits in **Leave & attendance**;
**view only** (adding and removing stays in the admin app).

As built: API `GET academics/calendar/staff` (`CalendarService.staffCalendar`, signed-in only): any staff member of
the school (an employee or external membership, or an employee record) reads the working year's holidays and almanac
for everyone and for staff — not those for students and parents; families get 403; `from` / `to` narrow it as the
calendar's read does (the shared `read`). `packages/menus`: **Holidays and almanac** (`/holidays`, every staff
member) in Leave & attendance, its icon. Staff website `/holidays`: Coming up (the next three), then Holidays and
Almanac (from, name or title with its note, what, applies to) — Hindi words added. App: `nativeScreen('/holidays')`
opens the families' Calendar screen (month, holidays, events) reading the staff calendar
(`sessionCalendarProvider` by profile kind); `CalendarController_staffRead` added. Tests:
`staff-calendar.e2e-spec.ts` (3: a staff member without the right reads it, dates narrow it, a parent is refused),
the calendar's existing suites, permission coverage; `staff_test.dart` (More → the calendar, the staff read, the
lists); 221 app tests; the staff website checked in a browser on Alpha as a teacher and an accounts user (desktop,
phone; axe clean); the staff accessibility list gains `/holidays`; the web preview rebuilt.

## Part 5: My timetable (22 Nov 2026)

"Staff app: the Timetable section the same as http://localhost:3002/timetable."

As built: `lib/staff/timetable.dart` — `StaffTimetable` as the website's "Sections and timetable": the lessons today
("No lessons on Sunday"), **My sections** (the section, the role as a badge that wraps under it, the subject, Can:
attendance, homework), **Substitutions this week** (the day, period, section and subject — who covers for whom and
why) and **My week**: Week (a grid, a row per period with its time, Monday to Saturday, today's column marked; a
lesson's section, subject code and room; "free"; a break or assembly by its kind; it slides sideways) or Day (each
period of the chosen day: the lesson, free, or the break). Same data as before (`myWeekProvider`,
`assignmentsProvider`); the old day-only list in `classes.dart` is gone. Tests: `staff_test.dart` (sections, the
substitution, the grid's six days with the lesson, the break and the free period, the day view; light, dark, Hindi;
2× text — the role badge first crowded the line, now it wraps); 222 app tests; the web preview rebuilt.
