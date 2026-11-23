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
