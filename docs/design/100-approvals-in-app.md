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
- **B, C (23 Nov 2026).** Record routes for the purchase kinds — indents, orders, requisitions and comparative
  statements (`/purchase/requisitions/:id`), receipts, issues, counts, condemnations, vendors (the vendor's record,
  from its row: the item's id is `vendor-<approval>`) — and the office kinds: approval steps (the step's instance,
  `/workflow/instances/:id`, from its row), withdrawals, school transfers, transport requests, file movement, exits.
  `DetailConfig` gains `row` (the item's row where its id is not the row's: vendors, assets handed over) and `get`
  takes the row. Kinds without a record route keep their list row: profile and staff profile changes, fee
  adjustments and requests, rate corrections, vacancies, ACRs, no-dues, consents, hostel visits, assets handed to
  you, attendance corrections. Checked on Alpha: an approval step (the request, its purpose, its steps) and a purchase
  order (line items, GST summary, sourcing, revisions, payment terms, steps, history).
- **D (23 Nov 2026).** The six kinds decided item by item are decided in the app. API: `POST /approvals/:kind/:id/act`
  {step, body} (`ApprovalsService.act`: the kind must have the step — else 404; the kind's list says the item waits
  for the person — else 404 `approvals.gone`; the step builds the kind's own call, as the person, and its refusals
  come back as they are; the audit is the route's). `ApprovalSource.actions` per kind: receipts `inspect`
  (`/purchase/receipts/:id/inspect`), condemnations `sign` and `decide`, withdrawals `clear` (the department's
  clearance, `PUT …/clearances/:dept`) and `bypass`, transfers `accept` and `reject`, ACRs `save`, `submit`,
  `send_back` and `file` (a file registered on the ACR, then sent), no-dues `clear` (`/people/exits/:id/clearance/:dept`).
  `DetailConfig.form` gives the record as it is with the Details (the form reads it), `options` what the form offers
  (a transfer: the sections to admit into and the next admission number). App: `lib/staff/approval_forms.dart`
  `ApprovalForm` under the Details — a receipt's lines (accepted and rejected adding up to what came, why, the
  rejected serials, a note; Accept as marked or Reject it all), a condemnation's Sign or Approve / Reject / Send back,
  a withdrawal's clearance for my department (dues, a charge where the department has one, remarks, documents —
  needed where the department says so —, Hold or Clear, Bypass), a transfer's Admit (a section searched by typing,
  the admission number filled in, a roll number) or Refuse, an ACR level (the scale as words, text, yes or no, files;
  for a review the grade, why it differs, agreement, remarks and — at the last level — the standard remark lines of
  the grade; Save draft, Submit, Send back), no-dues for my departments (dues, a note, Clear). A step done closes the
  Details; a draft saved or a file added keeps it open; a refusal says why and keeps the form.
- **E (23 Nov 2026).** Tests: API `approvals-inbox` (a step only a kind has, written right, only while the item waits;
  every step's route exists and takes the body the app sends), `school-transfer` (admitted and refused from the app's
  Approvals: the record and its options, not the sending school's, the admission number and roll, gone once decided,
  a second refusal refused); app `approval_forms_test` (15: each form's body, the checks before sending, a refusal;
  light / dark / Hindi; twice the text) — 320 app tests in all. Help: `purchase.md` (inspect and condemn on the
  phone). Hindi's Accept as marked wrapped in a half-width button and failed the contrast check: the receipt's two
  buttons stand one under the other.
