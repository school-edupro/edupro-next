# 59 — Results to families changed after going live; slots given automatically (plan, 28 Oct 2026)

Asked:

1. Test results (`/admissions/results?cycleId=4&classId=172&stageId=12`): the office must be able to
   change the **Results to families** date and time after the results have gone live.
2. Tests and interviews, slot 159: "level 1 done, 2 more approvals but this page does not show them;
   check whether it works automatically".

## What was found

- **Release after live.** `PUT admissions/results/release` and `POST …/release/withdraw` refuse once
  `release_at` has passed ("already out to the families"); the page then shows only "Out" and Tell.
  The candidate portal shows the marks while `release_at <= now()`, so a later time hides them again
  by itself.
- **Slot 159** (Admissions 2027-28, Interview, Class VI, capacity 30). Kabir Sethi passed Document check
  at 11:25 and was allotted when the slot was made at 11:29. Ishaan Mehta and Ayaan Saxena passed
  Document check at 11:33, after that. Allotment is manual (Allot the next N on the Allotment tab), so
  they wait for Interview without a slot: the page's "2 more waiting for Interview". Their later
  approvals (Interview by Arjun Bhat, Selection by Kavita) are in their process as set.

## Benchmark

Entab, Fedena, Edunext: results publishing can be unpublished or rescheduled by the exam/admission
office, with the change logged; entrance-test scheduling puts new eligible candidates into the next
batch with room (auto-batching), the admit card follows, and the schedule message is sent by the
office (or with the batch).

## Decisions (asked 28 Oct 2026)

1. **After live**: the release time may be **moved** (earlier or later) or the release **taken back**,
   each with a reason. A later time hides the marks from families again until then. Every change is
   kept in a history shown under Results to families. Families are told again only when the office
   presses Tell (no automatic message).
2. **Who**: the same right that sets the release (Tests and interviews), always with a reason.
3. **Slots automatically**: a candidate who comes to a Written test or Interview stage goes into the
   **earliest slot of their class (or for every class) that is today or later and has room**, with the
   next roll number. None with room: they wait, and the slot page lists them by name with Allot.
4. **No schedule message on an automatic slot**: the Allotment tab shows who has not been sent the
   schedule, with **Mail the schedule** for them.

Decided here, change any before building:

- "Today or later" is by the India date, so a slot already under way today still takes candidates
  (Ishaan and Ayaan would have gone into slot 159). Among slots at the same time, the class's own slot
  comes before an every-class slot.
- The registration's history says "Interview: 28 Oct, 11:29 am at … (roll no. 2) · given
  automatically".
- Candidates already waiting today (Ishaan, Ayaan) are not moved by the change itself: Allot the next 2
  on slot 159 (or I do it once on your word).
- A candidate sent back or undone keeps the slot, as with a manual allotment; Remove takes it away.

## Parts

### Part 1 — Results to families after live

- Migration 0269: `admission_result_release_log` (session, class, stage, what: set / moved / taken
  back / told, from, to, reason, by, at); forced RLS, audited.
- API: `PUT release` after the time has passed needs `reason` (3+ characters) and logs "moved";
  `POST release/withdraw` after it passed needs `reason` and logs "taken back"; set and Tell log too;
  the release in `GET admissions/results` carries the history. Moving to a later time clears "told"
  so Tell comes back once the new time passes (the history keeps the earlier Tell).
- Page: when Out, "Change the time" (date and time + reason) and "Take back" (reason); the history list
  (when, who, what, from → to, reason).
- Tests: e2e (move after live hides the marks in the portal until the new time; take back; reason
  required; history); a11y.

### Part 2 — Slots given automatically

- API: when a candidate's place moves to a Written test or Interview stage (any decision, undo, Excel
  decision sheet, or the process starting at such a stage), and they have no slot for it, the earliest
  slot as above with room takes them (slot row locked), roll number, history line; no message.
- Slot page: Allotment tab lists "Schedule not mailed" candidates with **Mail the schedule (N)**
  (`POST admissions/slots/:id/notify`); candidates waiting without a slot listed by name with Allot
  (one or the next N). Marks tab notes when candidates wait without a slot.
- Tests: e2e (a decision at Document check puts the candidate into the next slot with room, today's
  included; full slots skipped; none with room leaves them waiting; no message queued; Mail the
  schedule queues one per candidate once); a11y; browser on slot 159.

## Not in this plan

Moving candidates between slots automatically; a waiting list per slot; automatic messages when a
release is moved.
