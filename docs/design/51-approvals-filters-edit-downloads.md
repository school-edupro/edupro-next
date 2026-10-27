# 51 — Admission approvals: filters and export; approvers edit the form, points and category follow; downloads (plan, 27 Oct 2026)

Following docs/design/50 (approvers named in a level), on `/admissions/approvals` and its review:

1. The approvals list has two tabs and no filter, no export.
2. On the review an approver cannot correct a wrong answer (the office can, on the registration page,
   with a reason — docs/design/37, case 1b); the points have "Check or award differently"; the fee
   category is a drop-down the approver may change by hand; the registration form PDF and the payment
   receipts cannot be downloaded.
3. The sample registrations (docs/design/49) name one existing file for every photo and document; it is
   not an upload of those registrations, so the family's portal refuses to save ("An attached file is
   not an upload of this form").

What the best do (Entab, Edunext, NoPaperForms): the approver's queue filters like the office list
and exports what it shows; the verifier corrects the form in place with the change logged, and the
score and category follow the answers (rules, not hand edits); the form PDF and receipts are a click
away on the review.

## Decisions (asked and answered, 27 Oct 2026)

| #   | Question | Decision                                                                                                                                                                         |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Filters  | **All**: session and class; stage and level; category and status; search (name, registration no., mobile) and dates (waiting since / decided between), overdue only              |
| 2   | Edit     | **Answers, with a reason**: every answer editable on the review, tab by tab; one reason; each change kept with old and new value and who; documents and photos stay the family's |
| 3   | Points   | **Auto only for approvers**: worked out again on every edit; no "Check or award differently" for approvers; the office keeps it on the registration page                         |
| 4   | Category | **Follows the answers**: no drop-down for approvers; worked out again after an edit, General when no rule matches                                                                |

Defaults taken (change on request): Excel and PDF export what the list shows (its tab and filters) with
the levels' remark columns, the PDF on the letterhead; the registration fee already paid stays as paid
when the category changes (the new category counts for the admission fee), and the history says so;
an edit is refused once the registration is past the approver's level; the filters are kept in the
address (`?class=…&stage=…`) so the back button keeps them.

## Parts

**Part 1 — Filters and export (API, admin, staff app) — built 27 Oct 2026.** `GET admissions/approvals` takes
`cycleId`, `classId`, `stage`, `level`, `categoryId`, `status`, `q`, `from`, `to`, `overdue`; the
answer gains the choices for each filter. `GET admissions/approvals/export.xlsx|.pdf` with the same
filters. Both apps: a filter row (searchable drop-downs, dates, Overdue only, Clear) and Export Excel /
Export PDF buttons.

**Part 2 — Edit the form on the review (API, packages/ui) — built 27 Oct 2026.** `POST admissions/approvals/:id/correct`
(answers + reason) through the office's correction (`officeCorrect`: checked against the form, each
change kept), allowed while the registration waits at the approver's level. The review's "The form"
section gets **Edit answers**: the tab's questions as inputs (the form's own types: text, date,
select from its list, yes / no, number), one reason, Save; the change list ("Mother education:
Graduate → Post Graduate, by Anita, 27 Oct") under the form.

**Part 3 — Points and category follow the answers (API, packages/ui) — built 27 Oct 2026.** After an approver's edit the
points are worked out again (an approver's edit clears a confirmation, so they follow) and the fee
category is matched again from the answers (General when none); the history records "Fee category
changed to General after a correction". The review drops "Check or award differently" and the
category drop-down for approvers; the approve call no longer sends a category. The office's
registration page keeps both.

**Part 4 — Downloads and the sample files — built 27 Oct 2026.** On the review: **Registration form** (View / Download,
the same PDF as the office's) and each **payment receipt** (View / Download), through
`admissions/approvals/:id/form.pdf` and `…/receipts/:receiptId/pdf`, checked like the documents.
The sample seed (`scripts/seed-admission-merit.mjs`) makes a small placeholder image and PDF per
registration as its own uploads (owner = the registration), so the portal and the review show real
files; the existing 50 are given theirs without reseeding.

As built (27 Oct 2026): filters are worked on the tab's rows (the choices come back as `options`);
`GET admissions/approvals/export?format=xlsx|pdf`; `POST …/:id/correct` (the approvals points route is
gone: approvers do not award differently); `…/:id/form.pdf`, `…/:id/receipts/:receiptId/pdf`; the apps
proxy all of a registration's files through one route (`/api/admission-approvals/<id>/files|form|
receipts/…`). The seed script's `--files` gave the 50 sample registrations their own placeholder
uploads (the seed makes them for new ones). Checked: Anita changed a mother's qualification, the
points went 41 → 49 with the change logged, then set back.

**Follow-up (27 Oct 2026, asked on the screens):**

- Export Excel / PDF failed with 404 because the running API was older than the export route. It works after the restart, in both apps.
- The filter row now uses the Mobilise filter layout (`ep-lead-filter`, as on Enquiries), the same as the other lists. "Overdue only" became a **Due** drop-down (All / Overdue only), so it lines up with the other fields.
- **Approvers may replace a document or photo**, which changes decision 2 (documents were the family's only). On the review, each document has **Replace** (or **Upload** when none was given):
  - The approver gives a file and a reason. A photo field takes a JPEG or PNG; other fields take a PDF, JPEG or PNG, at most 5 MB.
  - The flow is `POST admissions/approvals/:id/documents/:key/slot` (an upload owned by the registration), then the bytes, then `POST …/documents/:key {fileId, reason}`.
  - The API checks the file by its first bytes. The answer then points to the new file, and the change is kept in the change list with the reason and who made it. The old file stays in storage, and the points are worked out again.
  - This is allowed only while the registration waits at the approver's level.
