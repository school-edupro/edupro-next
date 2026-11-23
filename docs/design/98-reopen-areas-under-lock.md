# 98 — Reopen one section's indicators, remarks, attendance or height and weight under the exam lock

## The ask (23 Nov 2026)

"http://localhost:3000/exams/437: when the whole exam is locked, the marks entry can reopen a particular exam /
subject / class (section) for entry. The same in Indicators, Remarks and Attendance." Benchmark, plan and ask.

Today (docs/design/66, 6 Nov 2026) the school admin reopens **one marks sheet** (a section's subject) while the
exam or its class stays locked: a reason, only its subject teacher (else the class teacher) enters, and it closes
when submitted. Indicators, remarks, exam attendance and height and weight have no such way: the whole exam's lock
(`exams.marks_locked`) or the class's lock of the area (`exam_classes.<area>_locked`) refuses every section. These
areas also have no Submit step, so "closes on submit" cannot carry over.

## Benchmark

- PowerSchool keeps a reporting term locked and unlocks single sections from the teacher's schedule; its lock can
  fall a set number of days after the term with a warning before it
  ([community](https://help.powerschool.com/t5/Community-Forum/Do-you-lock-midterm-after-term/td-p/450279),
  [PowerTeacher Pro set-up](https://scribehow.com/o/EAtvq1qARDGRmQwZ-q-f1A/page/PowerTeacher_Pro_School_Set-Up__owMk9BdHT6KSGa72REW5yA)).
- NextERP locks marks entry from a date for chosen classes and sections; only admins change marks after it
  ([help](https://helpcenter.nexterp.in/helpcenter/?p=13807)).
- Edsembli: lock and unlock reporting terms as they are used, to avoid entries in the wrong term
  ([best practice](https://support.edsembli.com/en/support/solutions/articles/8000110888-reporting-terms-lock-unlock-best-practice)).

The common pattern: the lock stays; a narrow, named exception is opened; it has a clear end.

## Decisions (asked, 23 Nov 2026 — all the recommended options)

- **What opens: section × area.** e.g. VI-A Indicators (the section's whole indicator sheet), VI-A Remarks (the
  general remark and every remark category), VI-A Exam attendance, VI-A Height and weight.
- **Who enters: who normally does.** The section's class teacher (or a coordinator); for indicators also the
  teachers given areas there; for a subject's remark category its subject teacher; a Remarks assignment its
  categories; the office (exam office, admin) as always.
- **How it closes: the class teacher's Done + a closing date-time.** The admin sets the closing time in the dialog
  (two days unless changed, from a few minutes to 30 days); the class teacher's **Done — close entry** closes it
  earlier; the admin's **Close now** too; locking or unlocking the whole exam, or changing the class's lock of that
  area, closes it.
- **Height and weight is included**, the same as the three asked.
- Not asked, following the marks' reopen: the school admin opens it (`exams.lock.manage`) with a reason of 3 letters
  or more; the class's published report card is taken back (needs `exams.result.publish`), the dialog says which.

## Phases (each checked complete — plan and all tests — before the next)

- **A** database + API: migration 0414 `exam_area_entry_opens`; open / close / list routes; every save of the four
  areas (screen and By Excel, HPC entry) honours an opening; the sheets carry each area's state; the teacher's
  "To enter" list; lock changes close openings; e2e tests.
- **B** admin: **Reopen for entry** on the Indicators, Remarks, Attendance and Height & weight pages (section picked),
  the dialog (reason, closing time, the card taken back), "Open for entry until …" with **Close now**; the exam's
  Status page lists the openings.
- **C** staff website + app: the four screens show "Open for entry until …" and enter again; the class teacher's
  **Done — close entry**; the Home "To enter" line says Reopened.
- **D** tests (admin + staff accessibility lists, app tests light / dark / Hindi / twice the text), help, the web
  preview, close.

## As built

- **A (23 Nov 2026).** Migration 0414: `exam_area_entry_opens` (exam, section, area, reason, opened by/at,
  `closes_at`, closed at/by/how: `done` · `admin` · `lock` · `lapsed`, one open row per section's area). An opening
  counts while `closed_at IS NULL AND closes_at > now()` and a lock holds; a lapsed row is closed as `lapsed` when
  the area is next opened. `area-entry.ts`: `areaEntries(c, exam, section, class)` → per area `{ locked, locks:
  { exam, class }, open: { until, reason, openedAt, openedBy } | null }`; `closeAreaOpenings`. Routes (`AreaEntry
  Controller`): `GET /exams/:id/area-entry` (marks view: open first, then the last 100), `POST …/area-entry/open`
  {classSectionId, area, note, closesAt?} (lock right; 409 `exams.entry_open` when not locked or open already; 400
  for a closing time outside minutes–30 days; the card taken back; audit `exams.area.open_entry`), `POST
  …/area-entry/close` {classSectionId, area} (the class teacher / coordinator, the office unscoped, or the lock right;
  `done` or `admin`; 409 `exams.entry_not_open`; audit `exams.area.close_entry`). `ExamEntryService.assertAreaOpen`
  replaces the class-only check in indicators, remarks, attendance (also from daily attendance), health, remark
  categories and the HPC entry (so every By Excel upload too); the parents' HPC feedback stays closed. The sheets
  carry `entry` (indicators, remark items, height and weight: their area; the register: remarks, attendance, health)
  with `canClose`, and `locked` net of an opening. The "To enter" list leaves out an area locked for the section and,
  for a reopened one, lists it however full with `reopened` and `until` (exam attendance listed only when reopened).
  Closing on lock changes: Lock / Unlock the whole exam, the whole lock following the classes, PATCH of the exam's
  lock, a class's lock of an area changed. Test: `entry-by-mapping.e2e-spec` (the lock, the right and the reason,
  closing-time limits, two days by default, remarks open and attendance not, the remark categories, the To enter
  lines, indicators by the area teacher with Done by the class teacher only, Close now, a lapsed opening and a
  fresh one, unlocking the whole exam, a class lock change, the history).
- **B (23 Nov 2026).** Admin: `components/exams/AreaEntryBar.tsx` on the Indicators, Remarks, Attendance and Health pages
  (section picked): while the exam's or the class's lock holds and the person has the lock right, **Reopen for entry**
  — a `ConfirmAction` with the reason and a new optional date-time field (`when`: two days ahead, from ten minutes to
  30 days, the school's clock; the action sends it as `+05:30`), and the class's published card named; once open,
  "Open for entry until …", who reopened it and why, and **Close now**. The exam's **Marks status** page ends with
  `AreaOpeningsCard`: each opening (section, area, why, opened, until, open with Close now, or how it closed). Words
  in `examHub.reopen` (English, Hindi); help in `exams.md`; Alpha's wholly locked Term I (437) area pages joined the
  admin accessibility list. Checked on a throwaway test school (desktop and phone): the dialog, a real reopen
  closing at 10:00 the next day, the Status list; axe clean.
- **C (23 Nov 2026).** Staff website: `components/AreaEntryNote.tsx` on Indicators, Remarks, Height and weight and the
  Exam register — the area, "Open for entry until …", "Reopened by the office (who): why", and for the class teacher
  **Done — close entry** (a fold whose **Close entry** confirms; `lib/area-entry-actions.ts`), after which the page
  says the entry closed. The Exam register's Fill tab locks each part on its own (remarks, exam attendance, height
  and weight: their boxes, Save buttons and the count from daily attendance). App: `lib/staff/area_entry.dart`
  (`AreaEntryNote`, `areaLocked`) on the same four screens; Done asks once more, calls `AreaEntryController_close`,
  and refreshes the sheet. App dialogs now sit on the cards' surface (white / dark grey): on the default lilac grey a
  Cancel's cyan words were 4.0:1. Checked on the test school as its class teacher (desktop and phone): Home's line
  "(Reopened)", remarks and attendance open, height and weight locked, Done closing the remarks; axe clean.
- **D (23 Nov 2026).** Tests: API `entry-by-mapping` (above) and the exam suites (105 tests), database 151; app 292
  (the reopened register with Done, Indicators without Done for one who may not close it, light / dark / Hindi with
  the Done question, twice the text); admin and staff accessibility lists (the staff Daily work report's links in
  its meta line are now underlined — axe link-in-text-block, seen on this run); the web preview rebuilt.

