# 100 — Approvals in the staff app without web pages

## The ask (23 Nov 2026)

"In the staff mobile app's Approvals, Open the full page opens a web page: do not open a web page. Ensure no
approval opens a web page; check and fix all approvals."

The app's Approvals inbox (docs/design/89 §5.4) lists 32 kinds (`apps/api/src/modules/approvals/sources.ts`); a tap
opens a sheet with the title, a line, who and when, **Open the full page** and — for 26 kinds — Approve / Reject.
Open the full page opens the staff website's page inside the app (`/web`) or, for an office kind, the admin's page
in the browser. Six kinds have no decision in the inbox at all: they are decided item by item on their own page
(goods received to inspect, condemnations, withdrawal clearances, students sent from other schools, ACRs to assess,
no-dues clearances).

## Decisions (asked, 23 Nov 2026 — the recommended options)

- **Native details for every kind.** Open the full page becomes **Details**: a screen in the app with the item's own
  record — its facts, its lines (an indent's items, a leave's days, a consent's answers …), its files (View and
  Download), the approval history — and the same decision. No kind opens a web page.
- **The six kinds are decided in the app** too, each as its own page does (inspect a receipt's lines, clear a
  withdrawal, take or refuse a transfer, assess an ACR, clear no-dues, decide a condemnation) — after the details.

## Design

- API: `GET /approvals/:kind/:id` → `ApprovalDetail` {title, subtitle, status, facts [{label, value}], notes
  [{label, text}], tables [{title, columns, rows}], files [{label, url}], history [{who, what, at, note}]}. Each source
  may name its record's route (`detail.get`, called in-process as the person, as the list and the decision are) and
  how it reads (`detail.view`); without one the item's row of the list route is read and shown as it is: its fields
  in words, its lists as tables, ids and switches left out. A kind's own route keeps deciding who may see what.
- App: the sheet's **Details** opens `ApprovalDetailScreen` (the record, then the decision as in the sheet); the
  `/web` and browser openings are gone from Approvals.

## Phases (each checked complete — plan and all tests — before the next)

- **A** the detail route with the list-row reading for every kind; curated records for the people and academics
  kinds (staff leave and its cancellation, attendance corrections, student leave, lessons, gate passes, consents,
  hostel visits, exits, registrations, staff profile changes); the app's Details screen; no web page left in
  Approvals.
- **B** curated records for the purchase kinds (indents, orders, requisitions, comparative statements, issues,
  assets, receipts, counts, rate corrections, condemnations, vendors).
- **C** curated records for the office kinds (approval steps, profile changes, fee adjustments and requests,
  withdrawals, transfers, vacancies, transport requests, file movement, ACRs, no-dues).
- **D** the six kinds decided in the app.
- **E** tests (API e2e per kind's record, app tests light / dark / Hindi / twice the text), help, the web preview.

## As built

- **A (23 Nov 2026).** API: `GET /approvals/:kind/:id` (`ApprovalsService.detail`: the kind's list route says the item
  waits for the person — else 404 `approvals.gone`; its record route, where `detail.get` names one, gives the rest;
  without one the list row is read) and `GET /approvals/:kind/:id/files/:fileId` (the record is read again and must
  name the file; then `FilesService.downloadUrl`). `approval-detail.ts` `readRecord`: fields in words (dates as 13 Nov
  2026, times in India, a person or thing by name and code), longer text and reasons as notes, lists as tables (up to
  8 columns, empty ones dropped), a form's sections of label and value as a table each, file ids and document lists
  as files; ids, rights and flags (`can`, `may…`, `myTurn`, `hasForm` …) left out; per kind `hide` and `labels`.
  Record routes now: staff leave and its cancellation (`/leave/requests/:id`), student leave
  (`/attendance/leaves/:id`), lessons (`/academics/lessons/:id`), gate passes (`/gate-passes/:id`), registrations
  (`/admissions/approvals/:id`, their form's sections and documents). Every other kind reads its list row (checked on
  Alpha: approval steps, profile changes, purchase orders, ACRs, attendance corrections). App: the sheet's **Details**
  opens `ApprovalDetailScreen` (facts, notes, tables that slide sideways, files with View in the viewer and Download,
  the decision — `DecisionPanel`, shared with the sheet); Open the full page, `/web` and the browser are gone from
  Approvals. The menu's approval pages (Leave to approve, Attendance corrections, Student leave, Consent answers, Staff
  profile changes, Registrations, Exits, No-dues) open the app's Approvals for their kinds. Tests: API
  `approvals-inbox` (the record and its decision, not another's, a file not named, gone once decided; every record
  route exists), app 305 (Details with a file and the decision, a receipt's details, the menu pages, light / dark /
  Hindi, twice the text).

