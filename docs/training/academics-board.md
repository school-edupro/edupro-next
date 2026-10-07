# Academics: publish time, acknowledgement, class documents, directory, notices and office orders

## Rules that apply to everything here
- **By academic year.** Homework, documents and notices belong to the session they were posted in. A student who is promoted sees the new class in the new session; the earlier session's items show only when that session is chosen on the portal's home page.
- **Only your own classes.** A teacher posts for the classes and subjects assigned to them (Academics → Teacher assignments). The office posts for any class.
- **Publish date and time.** Every upload has "Publish on": now by default. Parents and students see the item from that time; the teacher sees it at once, marked *Scheduled*.
- **Acknowledgement.** Tick "Ask the parent / student to acknowledge" on an item. The family sees an Acknowledge button; the teacher opens "view" to see who has and who has not, with the time.

## Teacher app
- **Daily work**: class work, homework and assignments, subject-wise, with attachments.
- **Session plan, curriculum, date sheet**: title, remark, attachments, classes, subject.
- **Office orders**: orders and circulars issued for staff; acknowledge where asked.

## Admin portal
- **Academics → Session plans, date sheets, magazine**: upload for any class, or leave Classes empty for the whole school (school magazine, almanac booklet).
- **Academics → Academics setup → School directory**: the list families see (heading, name, designation, phone, e-mail, timings). Excel upload works.
- **Holidays and almanac**: as before, shown on the family's Calendar page.
- **Notices and office orders**: write your own subject and formatted text, attach files, choose who it is for (everyone / students / employees, classes, sections, or named employees), ask for an acknowledgement, tick "Also send by e-mail". Notices show in the parent and student portal; an *Office order* shows to employees in the teacher app. **Report**: what was published, reach, acknowledgements, e-mails; Excel and PDF.

## Parent and student portal
- Homework (with publish time and Acknowledge), **Session plan and date sheets**, Notices (Acknowledge), Calendar, **School directory**.

## Academics setup: rules of the fields (October 2026)

- **Every field is checked** on the form and in an Excel upload. Codes are letters and digits without spaces (`-` `/` `.` `_` allowed); names start with a letter or a digit; a section is letters and digits (A, B, A1); a period must end after it starts.
- **Campus is not asked** on Sections, Timetable periods and Holidays. What is entered applies to the whole school.
- **Holidays**: the name and the From date can be corrected on the edit form. To cannot be before From; for one day keep both the same.
- **Subjects**: "Part of (subject)" and the Subject of the class-subject mapping show the full name, as `English (ENG)`. The Excel template has the same list as a drop-down; an upload also accepts the name alone or the code alone. A subject cannot be part of itself.

## Parent portal: Calendar

Three tabs. **Calendar** is the month grid (holidays green, vacations blue, exams red, declared working days amber, events outlined); Previous / Today / Next change the month and a tap on a day lists what falls on it. **Holiday list** has the holidays of the session with the number of days. **Events** has the almanac.

## Daily work sheet, assignments and settings (October 2026)

**Posting (teacher app → Daily work, or admin → Academics → Daily work).** Pick the date, tick one or more classes and press *Show subjects*. There is one row per subject with a box for Homework and one for Classwork, each with its own attachment. Fill only the subjects you want; *Save and publish* posts the same entry to every ticked class. Opening the same date again shows what is already posted; changing the text updates it, an empty box changes nothing. *Assignments* is the same sheet with a due date.

- A **class teacher** (and co-class teacher) sees every subject mapped to the class in *Class and subject mapping*. A **subject teacher** sees only the class and subject given in *Teacher assignments*. Admin and coordinator see all.
- **Publish on** is one date and time for the sheet. Parents and students see the work only from that time. It starts with the school's usual publish time.
- **Report** lists what was posted between two dates: homework beside classwork for each class and subject, with the publish time and who posted it.

**Parent / student portal.** *Homework* opens on today: each subject with its homework and classwork, Previous / Today / Next and quick links to the recent days that have work. *Assignments* lists the pending ones by due date; overdue ones are marked. *My teachers* shows the class teacher and each subject teacher with photo, mobile and e-mail.

**Academics → Settings** (admin):
- Usual publish time for daily work.
- Teacher mobile and e-mail in the portal: masked (98XXXXXX10, an***@school.in), shown in full, or not shown.
- Largest file (1–25 MB) for homework/classwork, assignments, class documents, notices and gallery.

**Teacher assignments** can be filtered by class and by teacher, and downloaded as Excel or PDF.

## Changes of 7 October 2026 (second round)

- **Who posts what.** A teacher, the class teacher too, posts daily work and assignments only for the class and subject given in *Teacher assignments*. Coordinators and the office see every subject. A class teacher may still post a general note without a subject from the API (legacy single post).
- **Class, then sections.** On the daily work sheet, assignments and class documents you pick the class; every section of it you may post for comes ticked, and one can be unticked.
- **Attachments** show as View and Download icons on the sheet (once posted) and in the report.
- **Report** has a filter *Daily work / Assignments / both*, and Excel and PDF downloads with the school header.
- **Class documents** (session plan, curriculum, date sheet, magazine): no subject; the remark is written in the formatted-text editor; up to 5 files.
- **Parent portal → Homework**: a date box on the day view; *Given from / To* on Assignments.
- **Notices and office orders** are under **Communication** in the left menu (the address `/academics/notices` is unchanged).

## Changes of 7 October 2026 (third round)

- **Attachments open** from the admin report and sheet (the admin file link now knows daily work).
- **Attach file** is a button with an upload icon under each Homework / Classwork / Assignment box; the chosen file names show beside it.
- **Class documents report**: filter by what, class and published from / to; download as Excel or PDF (admin and teacher app).
- **School magazine and almanac** are uploaded by the office only; teachers still see the published ones.
- **Holidays** and **Timetable periods** are entered only in Academics → Setup. Calendar and Timetable show them read-only with a *Manage in Setup* link; Calendar still adds almanac events.

## Notices: audience, attachments, report (8 October 2026)

- **Who is it for.** Students: classes, sections, *only these students* (type a name or admission number), or an **Excel list of admission numbers**. Employees: *only these departments*, *only these employees*, or an **Excel list of employee codes**. "Download the format" gives the one-column sheet.
- **Attachments on a notice**: as many as the school allows in Academics → Settings (1–10, default 5).
- **Notices and office orders** in the menu opens the report. The tiles (all, notices, circulars, office orders) list that kind; a title opens the notice in full. People without the office permission land on their own notices.
- An employee sees only the notices, circulars and office orders that are for them; a parent or student only theirs.
- **Parent portal → Notices**: filters (type, from, to, words), a card per notice with its date; *Details* opens it with attachments and the acknowledgement.
