# 60 — Slot details on Test results downloads; draw of lots slips (plan, 28 Oct 2026)

Asked:

1. Test results (`/admissions/results`): the Excel and PDF downloads need a header with the slot
   details.
2. Nursery: the school prints **draw slips**. Points are finalised at level 1, the school picks a
   points total, prints the slips for those candidates, and the slip's content is set by the school.

## What was found

- **Downloads.** The class download has the title (stage · class), the session and "out of N" only;
  no slot date, time, venue or duration, even with one slot chosen. The rows carry no slot either.
- **Legacy draw slips** (`Admin/AdmissionManagement/DrawOfLots.php`, `DrawOfLotsTwin.php`,
  `DrawOfLotsBlank.php`, reached from `ClassForDraw.php`): for a class and one points total, every
  candidate with that total (twins apart), two slips side by side: logo, "GENERAL CATEGORY DRAW SLIP -
  PRE SCHOOL (N Points)", session, draw date, Name, Father's name, S.No, Reg. No, and "*Admission
  subject to verification of documents of successful candidates". Twins get one slip (same mobile,
  mother and father); a blank-slip print exists. Heading, date and note are written in the code.
- **EduPro today.** Points are worked out from the form (`form_points`, `points_breakdown`) and
  confirmed at Document check (`points_confirmed_at`, doc 40). Selection has a replayable computer
  draw among everyone at Selection (seed recorded, doc 56), not limited to a points tie, and nothing
  to print for a hand draw.

## Benchmark

Delhi nursery practice and the ERPs used for it (Entab CampusCare, Edunext, MyClassboard): candidates
ranked on points; where the seats run out inside one points total, a draw of lots is held in front of
parents (often video-recorded) using printed slips, twins on one slip; the drawn order is entered in
the system, the first seats offered and the rest wait-listed in drawn order, and the result is put up.
Result sheets carry the test's date, time and venue, a section per sitting.

## Decisions (asked 28 Oct 2026)

1. **Downloads, every slot chosen: a section per slot**, each with its heading (date and time,
   duration, venue, note, candidates); the PDF starts each slot on a new page, the Excel has a sheet
   per slot. One slot chosen: that slot's heading only.
2. **Slips for a points total the office chooses**: session, class, category and one total (the page
   shows how many candidates share each total); only candidates whose points are confirmed at level 1.
3. **Twins: one shared slip**, found by the same date of birth and the same family mobile in the same
   class and session; the office confirms or splits a pair.
4. **A slip settings form** per session (a class may have its own): heading, details to show, draw
   date and venue, footer note, slips per A4 page; the PDF is made at once (no workers).
5. **The hand draw is recorded**: the office enters (or scans) the registration numbers in the order
   the slips were drawn; the first N take the seats and are offered, the rest wait-listed in that
   order; who and when kept; a draw result PDF.

Decided here, change any before building:

- Candidates without a slot are their own section ("No slot") at the end. The **session** download
  (every class and stage) gets a **Slot** column (date, time, venue) rather than sections, so it stays
  one list per class and stage.
- Slip details to choose from: photo, candidate's name, father's name, mother's name, date of birth,
  registration no., S.No. (within the printed group), points, category, session, draw date and venue.
  The heading and footer may use `{points}`, `{class}`, `{category}`, `{session}`. Defaults copy the
  legacy slip. Each slip also carries the registration no. as a barcode, so the drawn slips can be
  scanned in step 5.
- Candidates counted for a slip: points confirmed, not rejected, cancelled or withdrawn, not yet
  offered or admitted. Those still unconfirmed in that total are named on the page (not printed).
- A twin slip drawn within the seats offers **both** twins, even if that is one seat more than planned
  (usual nursery practice); it is shown before recording.
- The draw is recorded only for candidates at the Selection stage; the page names any who are not.
- A page **Draw of lots** under Admissions (`/admissions/draw`): Slips | Settings | Record the draw.

## Parts

### Part 1 — Slot details on Test results downloads

- API: the class export groups rows by slot (starts_at order, "No slot" last); each section's heading
  says "Slot: Wed 14 Nov 2026, 9:00 am · 60 minutes · Hall B · <note> · 24 candidates". PDF: each
  section a new page on the letterhead (merged); Excel: one sheet per slot (named by date and time),
  heading rows on top; one slot chosen: one section. The slot page's Excel tab downloads the same way.
  Session download: a Slot column.
- Tests: e2e (two slots + one without: three sections / sheets with the right headings; one slot
  chosen: one); browser.

### Part 2 — Draw slips: settings and print

- Migration 0270: `admission_draw_settings` (session, class or none, heading, fields, draw date and
  time, venue, footer, slips per page 2 / 4 / 6 / 8, show logo) and `admission_twin_pairs` (session,
  class, the two registrations, confirmed / split, by, at).
- API: points summary for a session, class and category (each total: confirmed, unconfirmed);
  candidates of a total with twins found; pair confirm / split; settings get / save; slips PDF
  (pdf-lib on the letterhead style: a grid of slips with cut lines, barcode).
- Page: Draw of lots → Slips (pickers, points totals, the group with twins marked, Print slips) and
  Settings (the form with a sample slip).
- Tests: e2e (only confirmed candidates of the total; twins one slip; split; settings per class over
  the session's; PDF pages by slips per page); a11y; browser.

### Part 3 — Record the hand draw

- Migration 0271: `admission_hand_draws` (session, class, category, points, seats, order, offered,
  wait-listed, by, at).
- API: check (every number in the group, none twice, all at Selection; who would be offered and who
  waits, twins together) then record: offers to the first seats (the offer email as on Selection,
  previewed), the rest wait-listed in drawn order; the result PDF.
- Page: Draw of lots → Record the draw (seats to fill, numbers one per line or scanned, Check,
  Record), the past draws with their PDF.
- Tests: e2e (order kept; twins both offered; a number outside the group refused; wait-list ranks in
  drawn order); a11y; browser.

## Not in this plan

Video of the draw; EWS / DG government lottery integration; parents viewing the draw result in the
portal (the offer email tells the offered ones).
