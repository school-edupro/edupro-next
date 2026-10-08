# Lesson planner: syllabus, weekly plan, coverage

## 1. Syllabus (coordinator) — Academics → Syllabus
- The list shows every class and subject (from *Class and subject mapping*) and whether its syllabus is entered.
- Open one to add **chapters** (number, name, term, planned month) and under each its **topics** (number, name, periods).
- **Upload from Excel**: one row per topic (class code, subject code, chapter no, chapter name, term, planned month, topic no, topic name, periods). Uploading again updates names; nothing is removed.
- A chapter or topic a teacher has already marked cannot be removed.

## 2. Weekly plan (teacher) — teacher app → Lesson plans
- As before: one plan per class, subject and week, saved as draft or submitted for approval.
- After the plan is created, each day has a **Syllabus topic** drop-down from the chapters above; the topic text is filled from it when left empty.

## 3. Marking what is taught (teacher) — teacher app → My syllabus
- The classes and subjects you teach, with topics done, % covered and whether you are behind the plan.
- Open one: every topic has *Done*, *Partly* and *Not done* (a remark is needed for Not done) and the date taught.

## 4. Coverage dashboard (coordinator, principal) — Academics → Syllabus coverage
- Tiles: syllabus covered, lines behind the plan, plans waiting for approval, plans not submitted this week.
- Charts: covered by class, by subject, by teacher (lowest first).
- **Behind** = topics of chapters whose planned month is over and which are not done. A chapter with no planned month never counts as behind.
- Tables: most behind; teachers who have not submitted this week's plan (Excel, PDF).
- **Coverage report** with class, subject and teacher filters (Excel, PDF) and a topic-wise status sheet per class and subject.

Parents and students do not see the syllabus (kept internal for now).

## Where to find it (8 October 2026)
- Admin left menu → Academics: **Lesson plans**, **Syllabus (chapters and topics)**, **Syllabus coverage** (also on the Academics tab bar).
- Teacher app home: **My syllabus** and **Lesson plans**.


## Lesson setup: Upload Lesson and Lesson Report (8 October 2026)

The weekly day-by-day plan form is replaced by the school's own flow. The syllabus and the coverage dashboard stay.

**Upload Lesson** (teacher app → Lesson plans; admin → Academics → Lesson plans → Upload Lesson)
- Date, *Select type* (Master class = every section of the class, or Class section), the classes, Topic name, Description (formatted text) and up to 2 attachments. No subject.
- A teacher sees only the classes assigned to them. *Submit* sends it to the approvers.

**Approvers** (admin → Lesson plans → Approvers; permission `academics.lesson_plan.setup`)
- A rule is for an **employee**, a **class**, a **department**, or the **school default**, with up to three levels. Each level is an employee or a role (anyone holding the role may act).
- When a lesson is uploaded the first rule that fits decides: the teacher's own rule, else the class's, else the teacher's department's, else the default. With no rule at all it goes to the principal / school admin.
- The levels are copied onto the lesson when it is uploaded; changing a rule later does not change lessons already uploaded.

**Lesson Report**
- Tiles: Total requests, Pending, Acknowledged, Rejected (click to filter). Filters: filter type (employee ID, name, class, topic) with a keyword, date from / to, status, level, record status (active / deleted), and *Waiting for me* / *Uploaded by me*. Excel and PDF.
- Columns: request ID, employee, class, topic, request date, status, current approver ("Level 1 of 2 pending" and who).
- A teacher sees their own lessons and those they approve; the office sees all.
- Open a lesson to read it, see every level, and (when it waits for you) **Acknowledge** or **Reject** (a remark is needed to reject). The last level's acknowledgement makes it Acknowledged; a rejection at any level ends it.
- The teacher can delete their own lesson while nobody has acted; the office can delete any. Deleted ones stay under Record status → Deleted.
- Lessons waiting for you also count in the header approvals icon.

**Dashboard** (admin → Lesson plans → Dashboard)
- Tiles for the dates chosen; lessons uploaded day by day; pending by level and by approver (with the oldest request); by department, class and employee; teachers who uploaded no lesson.
- The Syllabus coverage dashboard's two lesson tiles now count these lessons (waiting for approval; teachers with no lesson this week).

Not included: a message to the approver or the teacher when a lesson moves; editing a lesson after upload (delete and upload again).
