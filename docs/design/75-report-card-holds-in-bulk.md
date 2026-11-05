# 75 · Holding report cards back from families, many at once

Status: built 5 Nov 2026 (no migration; **As built** at the end). Asked by the school: on a release's
**Publish** tab (`/exams/report-cards/:id?tab=publish`), keep some students' cards from the parent and
student portal — by uploading an Excel of admission numbers, or by ticking them in a window filtered by
class and section.

## What EduPro does today

- **Holds exist** (migration 0277, `report_card_holds`: one card × one student, a reason of 3–300
  characters, who and when; audited). A hold is placed **one student at a time**: Cards tab → the eye →
  the side panel → **Hold** with a reason. Right: `exams.report_card.manage` (principal and school admin
  for every class; a coordinator for the classes they coordinate, through `CardScope`).
- **What the family sees**: the card is listed as held ("The school has held this report card: please
  contact the class teacher or the office"), without its exam summary; the PDF and the page are refused.
  Publishing a class does not send the "report card published" message to held families.
- **The fee rule** (Set-up tab, per card): withhold while fee dues pass a minimum; it lifts by itself
  when the dues are paid.
- **Gaps**: no way to hold many students at once; no list of who is held (only the tile count "Held" at
  the top, and each card's preview); nothing on the Publish tab, where the decision is taken; no Excel;
  lifting a hold after the class is published tells the family nothing.

## The old system

"Report Card Hide/Show Management": Class → Section → Exam type → Show; a table Sr, Admission no, Name and
a tick per student (with a tick-all) — ticked = hidden; each tick saves at once. No reason, no Excel, no
list across classes, no history.

## Benchmark

- **PowerSchool** (as schools describe it to parents): a _report card hold_ on a student's account
  blocks the card in the portal; the usual causes are overdue fees, library books and textbooks not
  returned; parents are told by an automatic email.
- **Entab CampusCare**: the exam module blocks report card access automatically for pending fees.
- **Veracross schools**: report cards held for unmet financial obligations (school policy, applied in
  the portal).
- EduPro already has the automatic fee rule. What the leading systems add, and EduPro lacks, is the
  office's **manual hold in bulk with a cause**, a **held list** to work from, and a **message when the
  card is released**.

## Decisions (user, 5 Nov 2026)

| Question                             | Answer                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How far a hold reaches               | **This card only** (as today and the old system); the window may also hold the same students in the year's other published cards (a tick, off by default) |
| The reason                           | **Free text** as today (3–300 characters), one reason for the students held together; no fixed list                                                       |
| Lifting after the class is published | **The family gets the "report card published" message** at once (the school's channels)                                                                   |
| What a parent sees for a held card   | **As today**: listed as held, "contact the class teacher or the office", no reason and no marks summary                                                   |

## Plan

### A. Publish tab: the held cards

- The class table gets a **Held** column (the number; a click filters the list below).
- Under it, **Held cards (n)**: filters Class, Section, a search (name, admission no or the reason's words); a table
  Admission no · Student · Class-section · Reason · Held by · On · **Show again**; tick rows → **Show
  again** for all ticked; **Download** the list (Excel, PDF). Fee-rule cards are listed apart ("Withheld
  for fees: n", read only — the fee rule decides them).
- A button **Hold cards…** opens the window (B).

### B. The "Hold cards" window, two ways in

1. **Pick students** (the old page, improved): Class (only this card's classes) → Section (one, or all)
   → the students in roll order: Sr · Roll · Admission no · Name · state (Shown / Held: reason / Fee
   due) with a tick each and a tick-all. Type the **reason**, tick **also in the other published
   cards** if wanted, then **Hold 12 cards**.
   Students already held come ticked, with **Show again**.
2. **Upload Excel**: **Download the template** (Admission no, Reason) → upload → a **check before saving**: matched (name, class-section), not found, not in
   this card's classes, outside the person's classes, already held, the same row twice. The rows with no
   reason take the one picked in the window. **Hold n cards** saves only the good rows; the rest can be
   downloaded as an Excel of errors.

Both use one API call (`POST /exams/report-cards/releases/:id/holds/bulk`), up to 500 students a time,
in one transaction, one audit entry listing them.

### C. Reasons

Free text as today (`report_card_holds.reason`, 3–300 characters): the window's reason for the ticked
students, or each Excel row's own. No migration.

### D. Lifting a hold

**Show again** (one, ticked, or by Excel with a "Show" column): the card appears in the portal at once if
the class is published, and the family gets the "report card published" message (the same template
and channels as publishing the class; families who opted out of messages are skipped; a card withheld by
the fee rule sends nothing until the dues are paid).

### E. Who

As today: `exams.report_card.manage` holds and lifts (principal and school admin everywhere, a
coordinator in their classes). A class teacher sees the held state of their own section in the Cards
tab, read only. Every change audited (who, when, reason, the students).

### F. Built where

- **API** (`ReportCardsService`): `GET releases/:id/holds` (filters, paged), `POST releases/:id/holds/bulk`
  (`{ studentIds | admissionNos, held, reason, alsoReleaseIds? }` → held, already, refused with
  why; lifting on a published class queues the families' message),
  `GET releases/:id/holds/template` (xlsx), `POST releases/:id/holds/check` (the uploaded sheet → the
  check list, nothing saved), `GET releases/:id/holds/file` (xlsx / pdf). The single-student
  `PUT releases/:id/holds` stays (the preview panel).
- **Admin**: the Publish tab (A), the window (B) as a side panel like the preview; help in
  `apps/admin/content/help/exams.md`.
- **Tests**: e2e hold / lift in bulk, the Excel check (not found, other class, a coordinator outside
  their classes refused), the family list and PDF refused while held, the message on lifting; a11y of
  the tab and the window.

## Questions for the school

Answered 5 Nov 2026 (Decisions above).

## As built (5 Nov 2026)

- **API** (`ReportCardsService`, `ReportCardsController`, `report-cards.dto.ts`):
  `GET releases/:id/holds` (`classId`, `classSectionId`, `q`; the person's sections only; `feeWithheld`
  = the fee rule's count today, null without the rule), `GET releases/:id/holds/file` (xlsx, or an A4
  PDF through `tablePdf`), `POST releases/:id/holds/bulk` (`studentIds` and / or `admissionNos`, up to
  500; `held`, `reason`, `alsoReleaseIds` → `held`, `alsoHeld`, `lifted`, `notified`, `unchanged`,
  `refused` with the cause), `GET releases/:id/holds/template`, `POST releases/:id/holds/upload` (`file`,
  `apply`, `reason` for rows without one, `alsoReleaseIds`; the marks-upload shape `rows`, `ready`,
  `errors`, `applied`). One shared check (`holdCandidates`): an active pupil of this year, in one of the
  card's classes, in the person's sections; a student held already is left as he is (`unchanged`).
  "Also hold in" takes only this year's released cards in sight, and holds there only where the
  student's class has that card. Each call is one transaction with one audit entry (`hold_bulk`,
  `unhold_bulk`, `hold_upload`) besides the table's own row audit.
- **The message on lifting**: `tellShownAgain` → `tellFamilies` with `only` (those students; a card
  the fee rule withholds today sends nothing); the class's and the release's message counts grow. The
  preview panel's single **Show again** (`PUT releases/:id/holds`) does the same.
- `GET releases/:id/cards` also gives `feeDue` (the window's "Fee due" state).
- **Admin**: the Publish tab's **Held** column (a link to the list on that class) and **Held cards**
  (`components/exams/rc/HeldCards.tsx`: filters, list, Show again with a confirmation, Excel and the
  PDF's View / Download); **Hold cards…** (`HoldWindow.tsx`, a side panel: Pick students / Upload Excel,
  the reason, Also hold in). Server actions `releaseHolds`, `bulkHold`, `uploadHolds`
  (`lib/report-card-actions.ts`); files through `/api/report-card-holds` (`kind=template`, or
  `format=xlsx|pdf` with the filters; the PDF opens inline unless `save=1`). `ExcelUpload` gained
  `partial` (save the good rows, the others listed and left out), `saveLabel`, `savedText`, `onSaved`;
  `ViewDownload` adds `save=1` to a link that already has a query. Words in English and Hindi
  (`rcHolds`, `rcRelease.heldOf`, `examHub.upload.withErrorsLeftOut`); help in
  `content/help/exams.md` (Publish → Held cards).
- **Differences from the plan**: the Excel only holds (lifting is done from the list, one or ticked);
  rows with a problem are listed on screen (no separate Excel of errors); the template has a "Student
  name" column that is not read (for the office's own check).
- **Tests**: `apps/api/test/report-card-holds.e2e-spec.ts` (4: bulk with also-in-another-card and the
  refusals, the list by class / section / words and a class teacher's section, the message on lifting
  in bulk and from the panel, the Excel check then save); `exams-v2` (17) still passes; a11y: the
  Publish tab and **the Hold cards window (pick and Excel)** in `e2e/a11y.spec.ts`. Checked on Alpha's
  release 1 in the browser: hold a VII-A card from the window, see it in Held cards, Show again (VII
  not published: no message), data left as it was.
