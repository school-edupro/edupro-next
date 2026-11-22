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

## Part 6: Mark a class (22 Nov 2026)

"Staff app: the Attendance section as on the staff website; a subject teacher of VI-A — how does he mark attendance?
Only the class teacher marks."

Who marks what (the API's rule, `AttendanceService.assertMayMark`, unchanged): a section's **day attendance** — its
class teacher or a coordinator with "can mark attendance"; **subject attendance** — the subject teacher for their own
subject in that section (and the class teacher or a coordinator). The section box (website and app) lists "VI-A · Day
attendance" for the first and "VI-A · Science" for the second, so a subject teacher marks his subject's register, not
the day's. To let him mark the day's, Academics → Teacher assignments makes him the section's class teacher (or a
coordinator marks it).

As built (the app's `MarkClassScreen`, as the website's register): the codes line; for a day register the month's
register as Excel or PDF (`AttendanceDeskController_classRegisterXlsx` / `_classRegisterPdf`); the day as saved —
present, absent, leave, late, marked by whom, RFID gate, late — or "Not marked yet for this date"; the marking window's
note or hours; marking off (no All present, no Save, said why) when the register is locked or the window closed; each
pupil's admission number and gate tap time, "On leave (approved)" and gate-pass flags; a remark per pupil (Remark
opens a box; one already there shows; sent with the marks). Tests: `staff_test.dart` (the saved line, the window
note, the details, the gate pass, a remark changed and sent, the PDF register; a closed window read only); 224 app
tests; the web preview rebuilt.

## Part 7: Lesson plans, and the lesson report's filters (22 Nov 2026)

"Staff app: the Lesson planner section the same as the staff website; the filters of the Lesson Report on the staff
website (`/lesson-plans?tab=report`) and the admin app (`/academics/lesson-plans?tab=report`) to follow the Mobilise
design."

**The filters (both websites, the shared `LessonReport`).** The eight fields had a 200 px minimum inside 11 rem
columns, so they touched, Status ran past the card and the date boxes stood taller than the drop-downs. Now
(`.ep-lesson__filters`): a card with the Mobilise border, radius and card shadow; the fields in even columns (four on
a desktop, three on a tablet, one on a phone; `minmax(min(100%, 13rem), 1fr)`, the fields' minimum width off); every
box 2.5 rem high; under a rule, **Search** and **Reset**, with **Excel** and **PDF** at the far end
(`.ep-lesson__downloads`). Checked on both sites at 1280, 768 and 375 wide; axe clean.

**The app** — `lib/staff/lesson_plans.dart`, `LessonPlansScreen`, opened from Classes and More
(`nativeScreen('/lesson-plans')`), no web page. Two tabs as the website's:

- **Upload Lesson**: Date; Select type — Master class (every section) or Class section (the ticks start again);
  the classes or sections the teacher has (`GET academics/lessons/options`); Topic name; Description (plain text sent
  as paragraphs); attachments up to the school's number (PDF or photo, camera too); **Submit** waits until a class is
  ticked ("Tick at least one class to submit."). Sent, the lesson opens saying it went for approval, as the website.
- **Lesson Report**: the four counts (Total, Pending, Acknowledged, Rejected) — each shows its lessons, standing in
  for the website's tiles and status tabs alike; **Filters** in a fold (Filter type, Search keyword, Date from, Date
  to, Status, Level, Record status, Show; Search applies, Reset clears); Excel and PDF (the list's own answer with
  `format` and `wrap=1`, opened in the file viewer); each lesson as a card — request number, status, topic, who
  (name, ID, department), class, request date, attachments, "Level n of m pending · approver", **Review** when it
  waits for the teacher, else **View**; pages when there are more than 50.
- **A lesson**: the topic and where it stands; **Lesson** (employee, lesson date, class, requested, the description,
  the attachments to view or save); **Approval** (where the approvers come from, each level — the approver or anyone
  with a role, Waiting / Not reached / Acknowledged / Rejected, by whom and when, the remark); when it waits for the
  teacher, a remark and **Acknowledge** / **Reject** (a remark is needed to reject); the teacher's own lesson nobody
  has acted on can be deleted (asked first; it stays in the report under Deleted).

Calls added (`api-operations.txt`): `LessonUploadsController_options`, `_create`, `_list`, `_get`, `_file !file`,
`_decide`, `_remove`. No API change. Tests: `staff_test.dart` — the upload (the ticks, the topic asked for, the body
sent: section, date, the description's paragraphs escaped), the report (Review and View, a count's lessons, Search and
Reset with the query sent), acknowledge (a reject without a remark refused), the next level, delete, the PDF with
`format` and `wrap`; light, dark, Hindi; twice the text. 229 app tests, analyze and the generated calls pass; the web
preview rebuilt.

## Part 8: Lesson approvers in the staff app (22 Nov 2026)

"Staff mobile app: the approvers set-up the same as the admin app's, and not opening any web page."

As built: the app's Lesson plans gains a third tab, **Approvers**, for those with the lesson set-up right
(`academics.lesson_plan.setup` — by default the school admin, group admin and academic coordinator), as the admin
app shows its Approvers tab only to them. The app learns it from `GET academics/lessons/approvers` (a 403: no tab).

- **Who approves whose lessons**: the help line (the teacher's own rule, else the class's, else the department's,
  else the school default; with none, the principal / school admin); each rule — School default, Department, Class or
  Employee, whose lessons, Level 1, 2 and 3 (a person, or "Role: …"), **Remove** (asked first); "No rule yet: add
  the school default first."
- **Add or replace a rule**: Rule for (school default, a department, a class, an employee) and only the box it needs;
  Level 1 approver (needed), Level 2 and 3 (or "No one"); the lists of staff type to search; **Save rule** (saving a
  rule that exists replaces its levels), "The rule is saved.", the list again and the form empty.

Calls added: `LessonUploadsController_rules`, `_saveRule`, `_removeRule`. No API change. Tests: `staff_test.dart` — a
teacher has no Approvers tab; the rules shown, level 1 and the class asked for, a class rule with a role and a person
found by typing (the body sent), remove; light, dark, Hindi, twice the text. 230 app tests, analyze and the generated
calls pass; the web preview rebuilt.

## Part 9: My syllabus (22 Nov 2026)

"Staff app: My syllabus opens a web page; do not open a web page, and a subject should not open a web page either."

As built: `lib/staff/syllabus.dart` — `MySyllabusScreen` (`nativeScreen('/syllabus')`, from Classes and More) as the
staff website's My syllabus: each class and subject the teacher teaches (`GET academics/syllabus/mine`) — the
section, the subject, **n behind** or **On track**, a coverage bar, "d of t topics done (+p partly) · x% covered" —
and Lesson plans; with none, the website's line (the coordinator enters the syllabus under Academics → Syllabus). A
subject opens `SyllabusSubjectScreen` in the app (`GET academics/syllabus/tree` with the class, subject and section):
"x% covered: d of t topics done · n behind the plan"; each chapter (number, name, term, the month planned) and its
topics — number, name, periods, Done / Partly done / Not done with the day, or Pending, the remark — each with
**Taught on** (today or earlier), a remark (needed for Not done) and **Done**, **Partly**, **Not done**
(`POST academics/syllabus/mark`); saved, the topic and the coverage read again. Calls added: `SyllabusController_mine`,
`_tree`, `_mark`. No API change. Tests: `staff_test.dart` (the list, behind and on track, the subject's chapters and
topics, Not done refused without a remark, Partly with the day and remark sent, Done; light, dark, Hindi, twice the
text); 235 app tests, analyze and the generated calls pass; the web preview rebuilt.

## Part 10: Marks (22 Nov 2026)

"Staff app: the Marks section the same as the staff website."

The app had three steps (the exams with sheets waiting, an exam's sections and subjects, a sheet with a box and an
Absent tick a pupil); a subject entered in parts sent the teacher to the web page. The website is one page: the exam
(every exam of the year that takes marks), the section · subject (a part, for a subject entered in parts, when the
teacher enters it), how codes work, and the sheet.

As built: `lib/staff/marks.dart` — `MarksHome` as the website's page (from Classes, More and Home's "Marks to
enter"): **Exam** (`GET exams`, those taking marks), **Section · subject** (type to find; "VI-A · Mathematics · 2
entered", "(locked)", "VI-A · Science · Theory (60)" for the parts the teacher enters), the codes help, then the
sheet — section · subject (· part), **Locked** or the number of pupils, "out of 80 (pass 27) · n of m entered" (or
"graded"), the parts line ("Theory 60 + Practical 20 = 80 …"); each pupil (roll, name, admission number) with the
marks box (or the grade, for a subject on a grade scale) and the school's **Code** (AB, ML, EX …; a part takes AB
only); "Does not take the subject" with no boxes; for a part, the total and the other parts. **Save marks** sends
what is written (`PUT exams/:id/marks` — marks, a code or a grade; a part: `PUT exams/:id/part-marks`, an empty box
clears it), "Marks saved (n new, m changed)."; over the maximum is refused first; the API's refusals in words. Then
**Open / Submitted / Verified** with the remark, and **Submit for verification** only once every pupil has marks or a
code ("Submit once every pupil has marks or a code."); a locked or submitted sheet is read only ("the coordinator can
reopen it"). Calls added: `ExamsController_list`, `ExamEntryController_putPartMarks`. No API change. Tests:
`staff_test.dart` (the exams that take marks, the sheet, not taken, over the maximum, a code, saved, submit and the
read-only sheet with its remark; a part with its total and AB only; a grade; an exam with nothing given); light, dark,
Hindi, twice the text; 239 app tests; the web preview rebuilt.

## Part 11: Verify marks (22 Nov 2026)

"Staff app: the Verify marks section the same as the staff website."

The app opened the website's page. As built: `lib/staff/verify_marks.dart` — `VerifyMarksScreen`
(`nativeScreen('/verify-marks')`, from Classes and More) as the website's page: the line on what it is for; each sheet
the teachers of the person's sections submitted (`GET exams/entry-status/waiting`) — section · subject, the exam's
code, "n of m entered · submitted by …, when" — with **Open the sheet** (the Marks sheet in the app, read only while
it is submitted, with its status and remark), **Verify** (`POST exams/:id/entry-status/verify`; "Verified and
locked.") and **What to correct** + **Send back** (`…/send-back` with the note, at least 3 letters; "Sent back to the
teacher."); the list reads again after each; "Nothing waits for you to verify." Calls added:
`ExamStatusController_waiting`, `_verify`, `_sendBack`. No API change. Tests: `staff_test.dart` (the list, the sheet
read only, send back refused without a note then sent, verify; light, dark, Hindi, twice the text); 244 app tests;
the web preview rebuilt.

## Part 12: Indicators and progress card (22 Nov 2026)

"Staff app: the Indicators and progress card section the same as the staff website."

The app opened the website's page. As built: `lib/staff/indicators.dart` — `IndicatorsScreen`
(`nativeScreen('/indicators')`, from Classes and More), as the website's page laid out for a phone:

- **Exam** (those taking indicators) and **Section** (those the person rates: the class teacher's, or a teacher
  given areas in Teacher assignments; "You rate no section in this exam …" otherwise); the set's name.
- **Areas** as chips with what is entered ("Language (1/4)": the person's indicators × pupils); "Also entered by …"
  for the class teacher, or "Only the indicators given to you are shown …" for a teacher given areas.
- **Each pupil** of the area as a card: a goal's name over its indicators; a level from the set (or the
  indicator's own levels), shown with its words ("P (Proficient)"), or written words for a written item; **Save**
  sends every box of the area (`PUT exams/:id/indicators`; an empty box clears it). Locked: read only.
- **By Excel** (`lib/staff/sheet_excel.dart`, `SheetByExcel` — for Remarks and Height and weight too): **Download the
  sheet** (filled with what is entered; the file viewer) and, while open, **Upload the filled sheet (.xlsx)** (up to
  1.4 MB): checked first ("n rows read · m ready to save · k with a problem", each problem row and why), then **Save
  the rows** only when none has a problem (`POST …/indicators/upload` with `apply`).
- **Holistic Progress Card** (the class teacher): **Pupil** (with photo counts); "All about me (the child's
  words)", "The parent's feedback" (read only when the parent wrote it in the parent app), "My observations";
  **Save the words** (`PUT exams/:id/hpc-feedback`); **Portfolio** — each photo (caption, what it shows) to view or
  remove (asked first), and a new one: Choose a photo or take one (PNG or JPEG, up to 1 MB), Caption, Shows
  (optional), **Add the photo** (`POST exams/:id/portfolio`).

Calls added: `ExamEntryController_indicators`, `_putIndicators`, `_indicatorsExcel !file`, `_indicatorsUpload`,
`HpcController_feedback`, `_portfolio`, `_addPhoto`, `_removePhoto`, `_photo !file`. No API change. The pickers (an
.xlsx, a photo) sit behind providers so tests put their own in place. Tests: `staff_test.dart` (areas and counts,
a goal over its indicators, levels with words, Save's rows, an indicator's own levels, the sheet downloaded, an upload
with a problem then saved, the parent's words kept, the words saved, a photo removed, a photo asked for then added, a
teacher given areas; light, dark, Hindi, twice the text); 249 app tests; the web preview rebuilt.

## Part 13: Remarks; the Excel upload on Indicators (22 Nov 2026)

"Staff app: the Remarks section the same as the staff website; on Indicators and progress card the Excel upload
option does not show."

**The upload on Indicators.** Nothing on Alpha is locked (every section of both exams that take indicators reads
`locked: false`), so the upload was offered — but **By Excel** stood after every pupil's card, and Alpha's progress
card has 72 indicators: a very long way down. It now comes first, under the set's name. The web preview's server now
sends `cache-control: no-cache`, so a reload always takes the newest build (a phone app built earlier shows today's
changes only once built again).

**Remarks** — `lib/staff/remarks.dart`, `RemarksScreen` (`nativeScreen('/remarks')`, from Classes and More), as the
website's page: the line ("One remark per pupil and category; the report card prints them."), **Exam** (those taking
remarks), **Section** (those the person writes remarks in); **By Excel** first (`SheetByExcel`: the remarks sheet,
upload checked then saved); "Written by others here: English remarks (…)"; each pupil a card with a box a category
the person writes — free words, with **Choose a remark** (the school's remarks of the category, put in the box to
keep or change), or a list-only category's drop-down; **Save** sends every box (`PUT exams/:id/remark-items`; an
empty box clears it); the API's refusals in words; a section with nothing to write says why. Calls added:
`ExamRemarksController_items`, `_putItems`, `_itemsExcel !file`, `_itemsUpload`. No API change. Tests:
`staff_test.dart` (By Excel first on both screens, others' categories, a remark from the list, a list-only remark,
Save's rows, the sheet and an upload, a section with nothing to write; light, dark, Hindi, twice the text); 254 app
tests; the web preview rebuilt.

## Part 14: Height and weight (22 Nov 2026)

"Staff app: the Height and weight section the same as the staff website, and the Excel upload option there."

As built: `lib/staff/health.dart` — `StaffHealthScreen` (`nativeScreen('/health')` for staff; the families' Health
screen keeps its name), as the website's page: the line ("The class teacher enters …"), **Exam** (those taking
height and weight), **Section** (the class teacher's: "You are not the class teacher of a section in this exam."
otherwise), "VI-A · n of m entered"; **By Excel** first (`SheetByExcel`: the sheet with each pupil's last reading;
upload checked then saved — offered while the class teacher may enter and the exam is open); each pupil a card — the
admission number, **Last reading** ("116 cm · 21 kg · BMI 15.6 (Term 1, 10 Apr 2026)"), **Height cm**, **Weight
kg**, **Blood group** (this one's, else the last), BMI (worked out on saving); **Save height and weight** sends only
what changed, an emptied box as null so the API clears it (the generated row drops nulls, so the save writes its own
row); "Nothing changed." when nothing did; heights 40–250 cm and weights 3–200 kg checked first; locked: read only,
"The exam is locked …"; not the class teacher: "Only the class teacher …". Calls added:
`ExamEntryController_health`, `_putHealth`, `_healthExcel !file`, `_healthUpload`. No API change. Tests:
`staff_test.dart` (By Excel first with its upload, the last reading, nothing changed, out of range, the changed rows
with a cleared weight, the sheet; light, dark, Hindi, twice the text); 259 app tests; the web preview rebuilt and
checked to serve the new build (Upload the filled sheet, Save height and weight, Choose a remark).
