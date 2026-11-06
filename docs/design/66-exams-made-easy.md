# 66 — Exams made easy

Asked 30 Oct 2026: "/exams and everything under it is not user friendly: rebuild it", benchmarked on
the leading school ERPs (Entab CampusCare, Fedena, Teachmint, PowerSchool). Builds on doc 65 (the
examination module v2); nothing of its rules changes.

## What was wrong

- The exam list carried a ten-field create form under its table; after creation an exam's name,
  dates, classes and portal flag could not be changed in the admin (the API allowed it).
- An exam's page held 8 forms with their own Save buttons and 118 inputs: every subject of the school
  per class (not the class's subjects), one form per subject for its parts, and marks locked in three
  places. Saving the class locks without the unlock right failed unless every box was ticked (an
  unticked box was sent as "open").
- No progress outside the marks status page; register, analysis and promotion two clicks away; the
  exam's pages shared no navigation.
- Set-up could delete entered marks: leaving out a subject (or a class) deleted its `exam_subjects`
  row and, by cascade, its marks.

## Decisions (asked and answered 30 Oct 2026)

| Question         | Answer                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| The exam's stage | Worked out from the data; no status field to keep in step                                                      |
| A new exam       | Guided steps, and a copy of an earlier exam                                                                    |
| Saving sheets    | A Save bar that stays on screen, "Save and …" for the next step, a warning before leaving with unsaved changes |
| Date sheet       | Date, start and end time per paper; print per class or all classes; shown in the parent and teacher apps       |

## The stage

`apps/api/src/modules/exams/exam-progress.ts` works out, per class and in one query per kind for many
exams at once: students, subjects, marks (`slots` = section × subject with students taking it,
`takers`, `entered`, `submitted`, `verified`), indicators (items without children × students),
remarks by category (the categories for the class × students), students with a general remark,
exam attendance, a health record and a result, and when results were worked out.

A class is in **set-up** until it has subjects or an indicator set, in **marks entry** until every
student taking a subject has a mark or a code (a class without subjects: until its indicators are
entered), in **verification** until every section's subjects are verified, then at **results**. The
exam's stage is its least advanced class's; at results, a released report card release with the exam
makes it **cards released**. `GET /exams` carries each exam's `progress`; `GET /exams/:id/progress`
one exam's.

The next step (admin `components/exams/next-step.ts`): set-up → the Set-up subjects step; marks left →
the marks status of open subjects; marks done and indicators left → indicators; verification → the
submitted subjects; results not worked out → analysis (Compute); worked out → report cards.

## API

- Migration 0286: `exam_subjects.starts_at`, `ends_at` (TIME, end after start) and
  `exams.date_sheet_note` (≤ 1000).
- `PUT exams/:id/subjects` takes `startsAt` / `endsAt` (HH:MM; 400 `exams.paper_time` when the end
  is not after the start) and refuses to leave out a subject with marks entered (409
  `exams.subject_has_marks`, `subjectCode`, `entries`). `PATCH exams/:id` takes `dateSheetNote` and
  refuses to take out a class with marks entered (409 `exams.class_has_marks`, `classCode`,
  `entries`).
- `POST exams/:id/copy` (`exams.master.manage`): a new exam of the working year from this one — its
  classes and grade scales, subjects (marks, pass marks, weightage, electives, scales), parts and
  indicator sets, and the date sheet note; not dates, times, marks, statuses or locks. The type may
  change; 409 when the code is taken.
- `PUT exams/:id/class-locks`: "opening" is now an area locked now and asked open; a box left as it
  was opens nothing, so the exam office locks without the unlock right.

## Admin

- **Exams** (`/exams`): stage counts, a search / type / class / stage filter that applies on change,
  and a card per exam (stage, code · type · dates, classes, marks entered and verified — or
  indicators for a progress-card-only exam — portal / locked / not in use, the next step, Open, Copy).
- **New exam** (`/exams/new`, `?from=` an exam to copy): step 1 of 3. A blank code becomes
  TYPE-YEAR, then -2, -3 while taken. Then Set-up (a copy opens at the date sheet).
- Every page of an exam starts with `ExamFrame` (breadcrumbs, name, type · code, dates, stage, Date
  sheet, Copy, Lock the whole exam with a confirmation) or, on the pages rebuilt in phase 2, the same
  `ExamTabs`: Overview · Set-up · Marks · Indicators · Remarks · Attendance · Results · Reports.
- **Overview** (`/exams/:id`): stage steps, the next step, figures (students, marks entered,
  verified, results), class by class, and the entry locks as one-click switches (only the area
  clicked is sent; opening a locked one needs the unlock right; marks show "partly locked" when some
  subjects are).
- **Set-up** (`/exams/:id/setup?step=details|subjects|dates&classId=`): Details (name, dates, status,
  portal, the classes with their grade scales); Classes and subjects (class chips with ✓ and counts;
  `ExamSubjectsEditor`: the class's studied subjects ticked the first time, the rest offered, any
  subject added; one maximum / pass mark applied to every ticked row; copy from another class; parts
  inside the row; the class's set; subjects, changed parts and the set saved in one go, then the page
  reloads so new parts have their ids); Date sheet (`DateSheetEditor`: date, start, end per paper, one
  time applied to all, the note). A new exam goes class by class ("Save and go to …"), then to the
  date sheet.
- **Date sheet** (`/exams/:id/date-sheet`, `?classId=`): one class (date, day, time, subject) or all
  classes (a row per date, a column per class), the note, Print (the menu does not print).
- Words in `messages/{en,hi}.json` under `examHub`.

## Tests

`apps/api/test/exam-hub.e2e-spec.ts` (5): set-up → entry → verification → results with the counts;
the paper time and the note; a subject and a class with marks stay; a copy takes classes, subjects
and parts but not dates or times, and a taken code is refused; a role with `exams.master.manage` but
not the unlock right locks one area (and the old all-boxes body) but cannot open one. All exam suites
and sprints 14–18 pass. Accessibility: the list, new exam (blank and copy), overview, the three
set-up steps, the date sheet (all and one class) and the exam's other pages. Browser walk on a
throwaway exam (Beta, removed after): new exam with a generated code, both classes' subjects (apply,
copy from a class), parts split and renamed in place, the date sheet and its print, a lock, details,
a copy.

## Phase 2 — the entry pages (30 Oct 2026)

Every entry page now starts with `ExamFrame` (Marks and Attendance carry a `SubNav`: Enter marks ·
Marks status; Exam attendance · Health), and its section, subject or child picker applies on change
(`AutoSubmit`; a button only without JavaScript).

- **Marks** (`/exams/:id/marks`, `?section=&subject=` or the old `?pick=`): a Section and a Subject
  picker (a subject in parts: one entry per part), Previous / Next through every section's subjects,
  and `MarksSheet`: the count entered as it is typed, a mark above the maximum shown at once (and not
  sent), Enter to the next student, **Save** and **Save and submit** (the submit is refused while a
  student who takes the subject has no mark or code) in the bar at the foot; only changed rows are
  sent. A subject in parts keeps the Submit button beside its status (the submit is for the whole
  subject). Verify, send back and reopen stay beside the status.
- **Marks status**: the class and status filters apply on change.
- **Indicators** (`IndicatorSheet`): every area of the section is a tab with "n of m" filled; what is
  chosen in one area stays while another is open; one **Save every area** sends the changed cells (an
  emptied cell is taken off; 3000 rows a request). The open area is kept in the address. The child's
  words keep their own form with the Save bar.
- **Remarks**: the class teacher's **general remark** is the first column (the general list as
  suggestions; the remark entry right and the remarks lock), then the categories; one Save
  (`saveRemarksSheet`: the changed general remarks to `PUT exams/:id/remarks`, the category cells to
  `PUT exams/:id/remark-items`).
- **Exam attendance**: % worked out as typed (`LiveCalc`), the Save bar; the class's lock read from
  the section's class (no longer guessed from the section's name).
- **Health** (`/exams/:id/health`, new): height, weight (BMI as typed), blood group, shown from the
  last record ("Last measured …"), the measuring date; the changed rows go to `PUT exams/:id/health`.
  Shown with `exams.health.view` (the register's `healthVisible`), written with `exams.health.enter`;
  the health lock closes it.
- `FormSaveBar`: the Save bar for a sheet saved as a form: "You have unsaved changes" once anything
  is typed, and the browser asks before the page is left (another section chosen included).

API: `PUT exams/:id/remarks` keeps "took part in" and "promoted to" when a row leaves them out (the
teacher app sends both; the admin sheet the remark only), and an empty remark takes the general
remark off (the row goes when nothing else is on it). Test: `exam-hub.e2e-spec.ts` (6).

Tests: the exam suites, sprints 14–18, compat and permission coverage (99); accessibility on marks,
status, indicators, remarks, attendance and health. Browser walk on a throwaway copy of the Class I
exam (removed after, with its entries and the health record): two areas' levels saved together, a
general remark and a category remark, attendance % and BMI as typed, both saved, and the leave
warning (the handler blocks the unload; the in-app browser shows no dialog). Marks typing was not
walked in the browser: the admin's demo user holds the unlock right, not marks entry.

## Phase 3 — results, reports, languages, the apps' date sheet (30 Oct 2026)

- **Results tab**: Analysis · Mark register · Promotion under one tab (`ResultsHead`: the sub-pages,
  when the results were worked out, **Work out results** for `exams.master.manage`). The class and
  section pickers apply on change; the register's sections come from the exam's entry sections (no
  longer parsed from labels) and the register comes as **Excel** and **PDF** (View / Download):
  `GET exams/:id/register-sheet?classSectionId=&format=xlsx|pdf` (`registerSheetFile`: roll,
  admission no, student, a column per subject with its maximum, total, %, grade, rank, result; the
  PDF through `tablePdf`), admin route `/api/exam-register-sheet/<exam>/<section>/<xlsx|pdf>`.
  Recording promotion decisions (`recordExamPromotions`) keeps the page on the exam's promotion,
  says how many were recorded and links to People → Promotions, where they are applied.
- **Reports**: the exam's header; the report, class and section apply on change (the sections are
  the chosen class's); the figures of toppers and ranges with Show.
- **English / Hindi** on every page of an exam (overview, set-up, marks and status, indicators,
  remarks, attendance, health, results, reports, the date sheet) and the parts they share (status
  badges and actions, Excel upload, portfolio photos, report tables): `messages/{en,hi}.json` under
  `examHub` (status, esa, att, ind, upload, misc, results, reports). Report titles and table headings
  made by the API stay English. The set-up screens of Exams setup (types and scales, indicator sets,
  areas and level scales, remark categories), mark schemes, report cards, board results and subject
  choices are not in this pass.
- **Date sheet in the apps**: `GET exams/date-sheets` (`exams.marks.view`): the working year's exams
  with dated papers of the classes the caller may read marks of; `GET exams/mine/date-sheets`
  (`exams.family.view`): per child, the exams shown on the portal with the child's papers (a subject
  the child does not take is left out) and the note. Parent app **Exam date sheet** (`/date-sheet`,
  menu My child): the next paper, the coming exams (date, day, time, subject, the note), earlier ones
  folded away; Hindi through the app's dictionary. Teacher app **Exam date sheet** (`/date-sheet`,
  menu Marks): the exam (applies on change; the coming one first), a row per date and a column per
  class.

Tests: `exam-hub.e2e-spec.ts` (7: the register file in both formats, staff date sheets, a family's
appearing once the exam is on the portal, a family refused the staff list); the exam suites, sprints
14–18, compat and permission coverage (100); accessibility on the exam's pages (analysis, register,
promotion, reports included) and the parent (parent and student logins) and teacher apps at 1280 and
375 wide, with `/date-sheet` in both. The register PDF read back (school, exam · section, the subject
columns, totals, grades, ranks, results).

## After phase 3 (30 Oct 2026): master filters, Discipline, the exam office

Asked: filters on Class and subject mapping; Discipline showed no drop-down on PT1's indicators;
marks could not be entered on the admin marks page. Answers: filters on **every** master list;
Discipline a level of its set; a ready-made **Exam office** role.

- **Column filters on every master list** (`/masters/<group>`): a drop-down per lookup, fixed-list and
  yes/no column (Class, Subject, Elective on Class and subject mapping; route, vehicle, category …
  elsewhere), shown above the list and applied as picked (`by_<column>` in the address); the search
  keeps Apply. API `GET masters/:id/rows` and `/export` take `filter=column:value` (repeated); only
  those column kinds, a lookup by its id, yes / no as true / false; anything else is ignored. Excel /
  PDF keep the filters ("filtered" in the PDF's subtitle); bulk update works on the ticked rows of
  the filtered list. Test: `masters.e2e-spec.ts`.
- **Discipline** (Alpha, set COSCH): the item had been switched to "a written note" after its 8 grades
  were entered (the set editor now refuses that, 85fa532); it takes a level of the set again (A–D) and
  the grades show.
- **Exam office** (migration 0287): a built-in role with `exams.master.view`, `exams.marks.view` and
  `exams.marks.enter`, no section limits: it enters marks and codes (and the Excel upload) for every
  section and submits them; it never reopens (`exams.marks.unlock` stays with the school admin and
  the coordinator, the sod rule keeps the two apart). On Alpha the demo office login dev-clerk holds
  it. Test: `exam-hub.e2e-spec.ts` (enters without a teacher assignment, submits, reopening refused).
- **Marks page, read only**: a login that may not enter (or a closed sheet) sees the marks as text,
  with the reason at the top, instead of boxes it cannot type in.

## What an exam takes; indicator sets mapped to classes (31 Oct 2026)

Asked: set per exam type what applies (marks, indicators, attendance, remarks) and show only that; map
indicator sets to classes so an exam shows the class's indicators. Answers: the exam type ticks its
areas, an exam may change them; an area that is off is hidden and refused everywhere; each set lists
its classes and an exam uses the class's set (Set-up may pick another); existing exams keep everything
and their chosen sets.

- Migration 0288: `exam_types.areas` and `exams.areas` (TEXT[] of marks, indicators, remarks,
  attendance, health; at least one; default all, so existing types and exams take everything);
  `indicator_set_classes` (set, class; a class has one set), filled once from the sets classes used
  in exams (a class with one set across its exams).
- API: types and exams carry `areas` (`POST/PATCH exams/types`, `POST exams`, `PATCH exams/:id`,
  `POST exams/:id/copy`; a new exam takes its type's, a copy its source's). Entry of an area the exam
  does not take is refused (409 `exams.area_off`, `area`): marks and part marks through
  `assertEntryOpen`, the rest through `assertTypeOpen` (each entry kind names its area), so the
  Excel upload, attendance from daily, the progress card's words and photos and remarks by category
  follow. `GET exams/indicator-sets` lists each set's `classIds`; `PUT
exams/indicator-sets/:id/classes` (`exams.master.manage`) sets them (a class ticked moves from its
  old set). A new exam, a copy, a class added or indicators turned on gives each class its mapped
  set where the exam has none (`fillSets`). Progress and the stage count only the areas taken.
- Admin: Exams setup → Types has "What the exam takes" ticks and a Takes column; an exam's Set-up →
  Details has the same ticks. Tabs of areas not taken go (Results and Reports go with marks); an old
  link to one says so. Overview shows only those columns, figures and locks; Attendance / Health
  sub-pages follow. The exam list shows "Takes: …" when not everything. Indicators and HPC has a
  **Class mapping** card (a set per class, saved together) and each set lists its classes. Teacher
  app: Marks, Indicators, Remarks and Exam register list only the exams that take them.
- Test: `exam-hub.e2e-spec.ts` (a type's areas, the mapping, a new exam with the class's set, the
  marks-only exam refusing indicators and remarks and starting in set-up, indicators turned on
  bringing the set). Browser: a throwaway copy of PT1 set to marks only (tabs, overview, the old
  indicators link), the mapping saved, the types form; removed after.

## Marks status as a grid (31 Oct)

Exam → Marks → Marks status is a grid, a block per class (or one class picked): a row per section, a column per
subject in the class's order (`entry-status` rows carry `classId`). Each tile shows the marks entered out of the
students who take the subject and its stage, by colour: not started, in progress, entered (not submitted),
submitted, verified (✓); "—" when nobody in the section takes it. A row ends with the subjects verified, the
foot of a column with the marks entered. Picking a tile opens a card above the grid: entered of takers, who
submitted / verified and when, the remark, the actions (submit, verify or send back, reopen with a reason) and
"Open the marks sheet". The figures stay on top (total, open, missing, waiting, verified).

- **Later (6 Nov 2026), asked**: the exam's **Results** and **Reports** tabs are gone — the mark
  registers' Run reports cover them (docs/design/68, 76-80). **Work out results** (with when it last
  ran) is on the Overview (`WorkOutResults`, `#results`); when it is the next step, the Overview shows
  the button itself and the exams list's next step links to `/exams/:id#results`. The Analysis, Mark
  register, Promotion and Reports pages are kept at their addresses (old links still open them).
- **Later (6 Nov 2026), asked**: locking and unlocking (the whole exam, a class's entry locks) is the
  school admin's alone — a new right `exams.lock.manage` (0310) for `school_admin` and `group_admin`;
  `POST /exams/:id/subjects/lock` and `PUT /exams/:id/class-locks` need it, and `PATCH /exams/:id` with
  `marksLocked` too. The whole-exam lock is `PUT /exams/:id/lock {locked, reason?}`
  (`ExamStatusService.lockWhole`): locking locks every subject; unlocking opens them and reopens every
  submitted and verified sheet (each logged "Reopened with the exam: <reason>"; a reason of 3 letters
  or more when any is reopened, else 400), then works the results out again — except a class published
  in a released card (named in the answer `kept`). The admin's dialog says how many sheets reopen and
  asks the reason; the page then says how many were reopened and which classes were kept. Teachers'
  submit / verify / send back / single reopen stay as they were. Tests: exam-promotion-remarks (403 for
  a teacher, the lock refusing entry, the reason asked, the verified sheet reopened and enterable),
  exam-hub (the exam office refused), sprint14/15 (the coordinator refused, the admin allowed).
- **Later (6 Nov 2026), found on PT1**: after Lock the whole exam, opening Class VIII left `exams.marks_locked`
  on, and that flag kept VIII's teachers out. The flag now means "every subject is locked": opening or
  locking a class (`class-locks` marks, `subjects/lock`) sets it from the subjects
  (`ExamsService.wholeLockFollows`, `bool_and(entry_locked)`); 0311 cleared it on exams with an open
  subject (Alpha's PT1). Test: exam-promotion-remarks (the whole exam locked, the class opened: the flag
  off and entry allowed; the class locked: the flag on again).
- **Later (6 Nov 2026), asked again (PT1, Class VI)**: opening a class must let its teachers enter, as
  the whole-exam unlock does, and a published class is taken back from its card (decided). One step,
  `exam-reopen.ts`: `reopenImpact` (per class: the submitted / verified sheets, the released cards that
  carry the exam) and `reopenExamMarks` (the card class withdrawn with the reason — the release
  withdrawn when no class is left, no message sent — the sheets reopened and logged "Reopened with VI: …"
  / "Reopened with the exam: …", the results worked out again). Used by `PUT /exams/:id/lock` (unlock)
  and `PUT /exams/:id/class-locks` (marks false on a locked class, or with a reason on an open one —
  "Reopen marks"); a reason is asked when anything reopens ("Opening VI reopens VI: 19 sheets, the card
  "Periodic Test 1": give the reason", 400), taking a card back needs `exams.result.publish` too;
  `GET /exams/:id/lock-impact` feeds the dialogs. The Overview: a locked class with something to reopen
  opens through a dialog with the reason; an open class with verified sheets or a published card shows
  Reopen marks. Tests: exam-promotion-remarks (the locked class with a verified sheet and a published
  card: the reason asked, the card withdrawn, the sheet reopened, entry allowed; an open class reopened
  with a reason).
- **Later (6 Nov 2026), asked (Term 1, VI-A English)**: reopen **one sheet** (a section's subject) for
  entry while the exam or its class stays locked, so only that teacher enters. Decided: that section
  and subject only; its subject teacher enters, else the section's class teacher when no subject
  teacher is mapped (the exam office, unscoped, as before); it closes when the teacher submits it.
  Migration 0312: `exam_entry_status.entry_open`; `app.enter_marks` lets a row through the exam / subject
  lock when its student's section's sheet is open for entry (and open). `POST
/exams/:id/entry-status/open-entry` {classSectionId, subjectId, note} (`exams.lock.manage`, the
  reason 3 letters or more): 409 `exams.entry_open` when the sheet is open and unlocked or opened
  already; a submitted or verified sheet is moved to open ("Reopened for entry: …"); the class's
  published card taken back (`takeBackCards`, needs `exams.result.publish`); logged "Opened for entry:
  …"; audit `exams.marks.open_entry`. Entry (`assertOpenedSheetTeacher`, in putMarks and putPartMarks,
  so the Excel upload too): 403 "This sheet was reopened for its subject teacher only" / "… for the
  class teacher only (no subject teacher is mapped)". It closes on submit (`move` keeps it only while
  open), on Lock / Unlock the whole exam, and on any change of the class's marks lock. The sheet reads
  open for its teacher (`exam.marksLocked`, `examSubject.entryLocked` net of it; `locks` the locks
  themselves; `status.entryOpen`); the entry-status rows carry `entryOpen`. Admin: **Reopen for entry**
  on the marks page (Marks → Enter marks, the sheet picked) for the lock right while the sheet is
  locked — a dialog with the reason, what reopens and the card taken back; the status badge shows
  "Open for entry (closes when submitted)" there and in Marks status. Tests: exam-promotion-remarks
  (the right and the reason, the subject teacher in and the class teacher out, Mathematics with no
  subject teacher, the rest still locked, submit closes it, a verified sheet with a published card,
  the class lock closing it).
