# 99 — Leave & attendance for staff: the admin's Employee Leave / Attendance page on the staff website and app

## The ask (23 Nov 2026)

"Leave and attendance section in the staff app and the staff mobile app the same as http://localhost:3000/leave."

The admin's `/leave` (docs/design/85) is one page, **Employee Leave / Attendance**: the person's leave balance as
cards (available and availed, or the most one application may take) with **Leave Details**, **Download Leave**,
**Download Attendance** and **＋ Apply Leave**; then four tabs — **My Attendance** (every day of a month: the code
and words, late / early, in and out, **Regularise** on each past day, the corrections asked), **My Leave** (the
leave year's leave with withdraw / ask to cancel), **Reporties Leave** (the leave of the staff reporting to me,
opening on Waiting with me, Approve / Reject in the list) and **Reporties Attendance** (their days); the header links
to Leave waiting for me, Corrections waiting, Reports and the Leave register.

The staff website spreads this over separate pages (My leave, My attendance, My team's attendance) and the app has
two screens (My leave, My attendance).

## Decisions (asked, 23 Nov 2026 — all the recommended options)

- **Website: one page as the admin's.** The staff website's My leave becomes the admin's page: the cards and their
  buttons, the four tabs. The menu's **My leave**, **My attendance** and **My team's attendance** open its tabs;
  **Leave to approve**, **Attendance corrections to approve** and **Leave & attendance reports** stay their own pages
  (as in the admin).
- **App: one screen, four tabs** — the same, native: balance cards with Leave details, Download leave / attendance
  (in the file viewer) and Apply leave; tabs My Attendance · My Leave · Reporties Leave · Reporties Attendance.
- **Reporties Leave: approve in the list**, as the admin: Waiting with me first; **Approve**, or **Reject** with a
  reason, on each row (a cancellation asked too); others show View.
- **Regularise from the day row**, as the admin: each past day (not locked, within the correction window) has
  Regularise, which opens that day with the correction form; the corrections asked are listed under the month.

## Phases (each checked complete — plan and all tests — before the next)

- **A** the admin page's parts move to the shared UI package (`@edupro/ui`): the leave types and helpers, the tabs
  (My Leave, Reporties Leave, Reporties Attendance and its grid), the list bar and pages, the dialog button, the
  leave cells and the Apply Leave form, with the links and actions given by each website; the admin uses them, as
  before.
- **B** the staff website: My leave as the admin's page (cards, dialogs, tabs, downloads through the staff website's
  own routes at the admin's paths, withdraw / cancel / decide / apply / regularise with its own actions); the menu's
  three entries open its tabs; the old My attendance and My team's attendance addresses open the tabs; checked in a
  browser as a teacher with reportees.
- **C** the app: one Leave & attendance screen with the cards and the four tabs, native.
- **D** tests (the staff accessibility list, app tests light / dark / Hindi / twice the text), help, the web preview.

## As built

- **A (23 Nov 2026).** `@edupro/ui`: `leave-views.ts` (the leave types and `LEAVE_STATUS`, `dmy`, `leaveDates`,
  `correctionPeople`; the admin's and the staff website's `lib/leave.ts` re-export them — the staff copy had fallen
  behind), `LeaveListBar` (records per page, showing, Excel / PDF, pages), `LeaveDialogButton`, `LeaveCells`,
  `LeaveTabs` (`MyLeaveTab`, `TeamLeaveTab`, `TeamAttendanceTab`, `TeamAttendanceGrid`: `paths` {base, request, day}
  with the admin's by default, `actions` as each website's server actions, `fileLink`), `LeavePageParts`
  (`LeaveBalanceSection`, `LeaveTabsNav` with an optional `hrefOf`, `MyAttendanceTab` with `regularise`). The admin's
  files are re-exports (My Leave and Reporties Leave bind the admin's actions and file links); `/leave` is the same
  page in 280 lines. Checked: the admin's accessibility walk of the four tabs and both dialogs, and the page as a
  teacher.
- **B (23 Nov 2026).** Staff website: `app/(app)/my-leave/LeavePage.tsx` (`StaffLeavePage`) — the admin's page with
  the staff paths (a leave `/my-leave/<id>`, a reportee's day `/my-team/<emp>?month=`, Regularise
  `/my-attendance/<day>`) and actions (apply, withdraw, ask to cancel, decide, decide a cancellation — these now go
  back to the list they came from, `back`); `/my-leave` (My Leave; `?tab=team-leave`), `/my-attendance` (My
  Attendance) and `/my-team` (Reporties Attendance) render it, so the menu item stays lit; the tabs link to those
  pages; My team's Punches stays at `/my-team?tab=punches` (`TeamPunches.tsx`), linked from the tab. Downloads at the
  admin's paths: `app/api/leave/[file]/route.ts` (my leave, my month, reporties' leave and attendance) with
  `lib/file-proxy.ts`. Header: Leave waiting for me, Corrections waiting, Reports (when the leave office gave me
  some). Checked read-only on Alpha as the demo coordinator (9 report to them; one leave waiting): every tab, the one
  person view, Punches, both dialogs, desktop and phone; axe clean.
- **C (23 Nov 2026).** App: `lib/staff/leave_page.dart` `LeaveAttendanceScreen` — the balance (who, Leave details,
  Download leave / attendance in the file viewer, Apply leave, a card a type with its coloured edge) scrolls away above
  the four tabs, which pin; My Attendance (the month a day each: the code and words, in / out, late / early, a
  correction's state; Regularise on a day that may be corrected opens the correction form on that day; the
  corrections asked, withdraw one waiting), My Leave (From / To, the leave year by default; a card a leave; Withdraw /
  Ask to cancel with a reason; pages; Excel / PDF), Reporties Leave (Status — Waiting with me first —, employee, type,
  dates; Approve, or Reject with a reason of 3 letters or more, in the card; a cancellation too), Reporties Attendance
  (everyone a column a day that slides sideways, or one person's days). `/my-leave`, `/my-attendance`, `/my-team` and
  Home's My leave open it on their tab. Calls added: `StaffLeaveController_menu`, `_decide`, `_decideCancel`,
  `LeaveSelfController_team`, `_leaveFile`, `_attendanceFile`, `StaffAttendanceController_team`; the leave module's
  request class `DecideDto` is now `StaffLeaveDecideDto` (two other modules had the name, and student attendance
  already had `LeaveDecideDto`). The old My leave and My attendance screens are gone (their apply and correction forms
  stay); `CorrectionForm` takes the day.
- **D (23 Nov 2026).** Tests: app 298 (the balance, details, download, apply, My Leave withdraw; My Attendance with
  Regularise from today's row; Reporties Leave approve and reject; Reporties Attendance grid and one person; light /
  dark / Hindi on each tab; twice the text, where the tab row is reached by scrolling and a tab wider than the phone
  is tapped at its start); API leave suites (61) and permission coverage; the admin's leave accessibility walk; help
  (`leave.md`); the web preview rebuilt.
- **Leave details in the app (23 Nov 2026, asked after D).** "In this page required a detail of leave": the app's
  leave cards (My Leave and Reporties Leave) have **View**, and a tap on the card, opening `LeaveDetailScreen`
  (`lib/staff/leave_detail.dart`) — the website's leave page, native: the figures (days, applied on, From, To), where
  it waits, the actions the record allows (`can`: withdraw, ask to cancel, decide, decide a cancellation), the facts
  (type, entered by, reason, counted, loss of pay, decision) and the document in the app's viewer; folded, open while
  they matter: the days counted, who approves, the cancellation, the changes. API: `GET /leave/requests/:id/document`
  (`LeaveService.document`: the leave's own check — the employee, the approvers, the reporting manager, the leave
  office — then the download address; before, only one's own upload or the files right opened it). Tests: API
  `leave-gaps` (the employee and the office open it, another teacher gets 404); app (the details, the document, a
  withdrawal and an approval from there; light / dark / Hindi; twice the text) — 326 app tests. Help: `leave.md`.
