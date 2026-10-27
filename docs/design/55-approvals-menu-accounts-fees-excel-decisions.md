# 55 — Approvals in the Admissions menu; fees taken by Accounts only; decisions by Excel; Registrations list removed (plan, 27 Oct 2026)

Asked:

1. Put `/admissions/approvals` in the Admissions side menu. Admission admins see every registration
   there; others see it only when they are named in an approval level.
2. On the registration page (and the desk) no role takes fees; only Accounts do.
3. Admins decide in bulk by Excel, with the sheet shaped by the approval set-up.
4. Remove `/admissions/registrations` and its code.

## What is there today

- **Approvals:**
  - `/admissions/approvals` (docs/design/50-51) is reached only from the header's approvals group.
  - It lists what waits at the levels the user is named in (`admissionWaitingFor`). A set-up manager
    may decide a registration that is waiting, but the list does not show them the others' queues.
- **Fees:**
  - `admissions.fee.collect` is held by the Accountant, School Admin and Group Admin (0226).
  - The fee is taken at the Admission desk (the registration fee of a walk-in), on the registration page
    (the admission fee), and at Fees → Cashier → Admission fees (docs/design/52-53).
- **Bulk decide:** it exists only on the Registrations list (docs/design/47): tick rows at one stage and
  level, then one decision for them all.
- **Registrations list:**
  - `/admissions/registrations` (the grid with "Waiting for me") and `/registrations/board` duplicate
    the Admissions list and Approvals.
  - The registration page `/admissions/registrations/<id>` is what every screen opens.
  - The admissions dashboard and the morning email (0256, `admissions.level_digest`) link to
    `/admissions/registrations?tab=mine`.

What the best do (Entab, NoPaperForms, Edunext):

- The approval queue is a menu item for those who approve. The admission head sees every queue and can
  act for an absent approver, with "on behalf" kept.
- Money is taken only at the fee counter, by the accounts role, with segregation of duties.
- Shortlists and test marks are imported from a sheet the system made for that round: its keys are
  fixed, its decision cells are drop-downs, and the upload is previewed with row errors before it is
  applied.

## Decisions (asked and answered, 27 Oct 2026)

| #   | Question            | Decision                                                                                                                                                                                                                                                                  |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admins on Approvals | **Every level, may act**: every registration waiting at any level (filter by stage, level, person); a decision there is kept as "by <admin> for <level>". Others see the menu item only when named in a level, with only theirs                                           |
| 2   | Fee taking          | **Accounts only, at Fees → Cashier**: no fee taken on the registration page or the desk; their fee box shows what is due and "collected by Accounts at Fees → Cashier". The collect right stays with the Accountant role only (removed from School Admin and Group Admin) |
| 3   | Excel decisions     | **One sheet per stage and level**: pick the session, class, stage and level; the sheet lists every registration waiting there with the columns that level needs. Upload, preview with errors, apply. For admins (any level) and for level people (their own levels)       |
| 4   | Remove              | **The list and the board go; the registration page stays.** Their links go to the Admissions list or Approvals                                                                                                                                                            |

Defaults taken (change on request):

- **The menu item:** "Approvals (n)" under Admissions, with n = what waits for me (for an admin, n =
  everything waiting). It is shown to `admissions.setup.manage` and to anyone named in an active
  process level. The staff app keeps its item as now.
- **Acting on behalf:** an admin deciding at a level they are not named in sees "Deciding for Level 1
  · Approval (Anita Deshmukh)". The remark is kept with "by Dev Admin for Approval". The level's people
  are told by the existing event.
- **A zero fee:** confirming an admission with no fee due (a category with fee 0) stays with the
  admission office; no money changes hands.
- **The desk:** a walk-in's form is submitted at the desk, and the family is sent to the counter with the
  registration form printout. The registration then shows at Fees → Cashier → Admission fees as
  "registration fee due".
- **Roles:** existing schools lose the right on their copies of School Admin and Group Admin too (the
  migration). A school that wants an admin to take money gives the right back on Access → Roles.
- **The Excel sheet:**
  - The first rows say the session, class, stage and level and the date made; then a table.
  - The columns are: Registration no. (the key, locked), Candidate, Class, Category, Points, Waiting
    since, the previous levels' decisions, **Marks (of N)** when the stage has marks, **Decision** (a
    drop-down: Approve, Hold, Reject; Send back for a document check), and **Remark** (needed).
  - Rows with no decision are skipped.
  - The upload checks that each row still waits at that level, the remark, and the marks range. The
    preview shows done, skipped and error rows; Apply decides the good rows, as if each was decided on
    the page, with the same events and messages.
  - The sheet expires when the level's queue changes: a row decided meanwhile is skipped and named.
- **Upload size:** up to 2,000 rows and 5 MB. The bytes go as the request body (not JSON), as other
  imports do.

## Parts

**Part 1 — Approvals for admins and the menu (API, admin) — built 27 Oct 2026.**

- `GET admissions/approvals` for a set-up manager lists every registration waiting at any level. It
  gains the filter `person` (who holds it) and a column "Waiting with". An admin's decision at a level
  not theirs is recorded as on behalf.
- `GET admissions/approvals/menu` returns `{ show, count }`.
- The Admissions side menu gets **Approvals**, shown by that answer.
- The dashboard's "Waiting for me" links and the morning email (a migration replacing
  `admissions.level_digest`'s link) point to `/admissions/approvals`.

**Part 2 — Fees by Accounts only (API, admin, migration) — built 27 Oct 2026.**

- A migration removes `admissions.fee.collect` from School Admin and Group Admin (the template roles
  and the schools' copies).
- The registration page's admission fee box and the desk's registration fee box become information:
  what is due, and "collected by Accounts at Fees → Cashier". The zero-fee "Confirm the admission"
  stays.
- The API routes `…/registration-fee` and `…/admission-fee` stay, for the counter and the tests, behind
  `admissions.fee.collect`.

**Part 3 — Decisions by Excel (API, admin) — built 27 Oct 2026.**

- `GET admissions/approvals/sheet?cycleId&classId&stageId&level` makes the xlsx: drop-downs, a locked
  key column, and the level's columns.
- `POST admissions/approvals/sheet` takes the xlsx bytes, with `?apply=1` to decide; without it, it
  previews. It returns rows with status `ok`, `skipped` or `error` and the reason.
- Approvals gets **Excel decisions**: pick, Download the sheet, Upload, the preview table, Apply.

**Part 4 — Remove the Registrations list and board; tests — built 27 Oct 2026.**

- Delete `/admissions/registrations` (page), `/admissions/registrations/board`, their components and
  actions (registrations load / export / ready / save view / bulk decide), and the menu item.
- The Admissions list keeps the grid; the registration page stays at `/admissions/registrations/<id>`.
- The API's `bulk-decide` route is kept (the sheet applies through it); the `registrations` grid scope
  is kept for the ready-made reports.
- e2e:
  - an admin sees and decides another's level (on behalf kept); a teacher still sees only theirs;
  - the menu answer;
  - School Admin can no longer take a fee, and Accounts can;
  - the sheet round trip: download, fill, preview with an error row, apply.
- a11y for Approvals with the sheet panel; the removed pages give 404; a browser check.

## As built (27 Oct 2026)

**Approvals for admins and the menu (part 1):**

- `GET admissions/approvals` for `admissions.setup.manage` lists every row of `admission_waiting`. It
  answers `all`, `mine`, and per row `waitingWith` (`levelDeciders`) and `namedMe`; the filters
  `person` and `mine=1` are new.
- An admin's decision at a level they are not named in gets " (by <name> for <level>)" added to the
  remark. A send-back is not marked, because its remark goes to the family. The review shows "Deciding
  for <level> (<people>)" (`onBehalf`).
- `GET admissions/approvals/menu` answers `{show, count, mine, all}`. Shell grants the item
  `menu:admission-approvals` when it shows; the label is "Approvals".
- The dashboard's links go to `/admissions/list?…` (the list now takes `tab`, `session` and `status`
  in the address) and to `/admissions/approvals`.

**Fees by Accounts only (part 2):**

- Migration 0263 removes `admissions.fee.collect` from `school_admin` and `group_admin` (only the
  accountant template has it), and the morning email links to `/admissions/approvals`.
- The desk and the registration page show the fee due as information.
- A zero fee is confirmed through `POST admissions/registrations/:id/confirm`
  (`admissions.application.admit`).
- The permission cache keeps the old rights until the API restarts.

**Decisions by Excel (part 3):**

- `approvals-sheet.service.ts` has `GET admissions/approvals/sheet/options`, `GET …/sheet`
  (base64 xlsx) and `POST …/sheet[?apply=1]` (xlsx as the body).
- The sheet:
  - The key is in A3 (`EPAPPR:cycle:class:stage:level`), with headers on row 5.
  - The sheet is protected except the Decision, Remark and Marks cells.
  - The Decision drop-down is Approve / Hold / Reject (a selection stage: Offer / Waiting list / Hold
    / Reject), and Marks (of N) is there when the stage has a maximum.
- Rows are applied through `AdmissionApprovalsService.decide`, so access, on behalf, events and
  messages are as on the page.
- Not built: Send back by sheet, since it needs the answers to correct; it stays on the page.
- On the admin's Approvals page the "Excel decisions" panel opens on click. It is not in the staff app
  yet.

**Removed (part 4):**

- The pages `/admissions/registrations` and `/registrations/board`.
- `registrationsConfig` and the bulk-decide bar in `AdmissionList`, the `registrations*` actions,
  `DEFAULT_REGISTRATIONS_VIEW` and `REGISTRATION_QUICK_FILTERS`, the menu label and their a11y lines.
- The registration page `/admissions/registrations/<id>` stays; its back link goes to the Admissions
  list.

**Checked:**

- Admission and cancellation e2e: 64 + 3 pass. They cover the admin seeing every level; the menu;
  Accounts taking fees and the School Admin refused (403); the sheet with an error row, then fixed,
  checked and applied (the remark kept); a sheet not made here refused; the email link.
- Withdrawals, reports, misc fees, RLS and access: 76 pass. API unit: 4 pass.
- a11y: admissions, approvals (with the panel), the list, desk and registration pass.
- Browser: Approvals sits in the Admissions menu, the admin sees 43 waiting with who holds each, and
  the sheet downloads.
