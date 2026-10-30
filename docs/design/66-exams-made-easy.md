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

## Phases still to come

- **Phase 2 — entry pages**: pickers that apply on change, previous / next subject, Save and "Save
  and submit" together on marks, the Save bar and leave warning on every sheet, all indicator areas
  saved at once, attendance % as typed, admin pages for the general remark and health.
- **Phase 3 — results and reports**: one Results tab (compute, analysis, register with Excel / PDF,
  promotion that stays in the exam), Hindi / English on every exam page, the date sheet in the parent
  and teacher apps.
