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

## Phase still to come

- **Phase 3 — results and reports**: one Results tab (compute, analysis, register with Excel / PDF,
  promotion that stays in the exam) with pickers that apply on change, Hindi / English on every exam
  page, the date sheet in the parent and teacher apps.
