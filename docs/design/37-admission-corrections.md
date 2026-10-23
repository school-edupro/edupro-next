# 37 — Correcting a wrong admission, mid-session (plan, 23 Oct 2026)

## The principle
Every record (fees, receipts, attendance, marks, library, documents, transport, hostel, messages) is
tied to the student's **internal system id**, never to the admission number, name or class. So a
correction changes the student's details and every history follows; nothing is re-keyed. An admission
number once given is never reused: when it changes, the old one is retired and still finds the pupil.

## The five cases and the decisions (asked and answered)

| # | Case | Handling | Status |
|---|---|---|---|
| 1 | Wrong details (name, date of birth, gender, parents) | Office asks for the change; **Principal / admin approves**; old and new kept; other fields saved directly (audited) | Part 1 |
| 1b | Wrong details in a submitted application (before Admit) | Office corrects the application, every change logged with old and new values | Part 1 |
| 2 | Wrong admission number | Already built: change with a reason, history kept (`POST students/:id/admission-no`) | Done |
| 3 | Wrong class / section (e.g. VII instead of VI) | **Move the enrolment from the admission date** (marks and attendance follow); unpaid demands **re-made at the new class's rates**; money already paid kept as **credit** (excess refundable on request) | Part 2 |
| 4 | Same child admitted twice | **Merge into one record, with approval**: fees, receipts, attendance, marks, library, documents, guardians, transport, hostel moved to the record kept; the other admission number retired and searchable; cannot be undone | Part 3 |
| 5 | Admitted by mistake | **Cancel the admission with settlement, with approval**: unpaid demands cancelled; paid fees to refund (or kept as the school decides); attendance and marks kept but left out of reports; student and parent logins stopped; record shown "Admission cancelled" | Part 4 |

## Parts
1. **Detail corrections**: approval set-up (levels on the workflow engine: role / designation / named
   employee, like vacancy approval); "Correct details" on the student page (fields: name parts, date of
   birth, gender, father / mother / guardian names); request → approve → applied, with a correction
   history; the office's direct edit of other fields stays audited. Application edit before Admit for
   staff with admissions review rights.
2. **Wrong class**: "Correct class" with the new class-section and the date it applies from (the
   admission date by default); preview of the fee difference (demands to cancel, to raise, credit);
   approval; enrolment moved, attendance / marks kept on the student, fee demands re-made.
3. **Merge duplicates**: pick the two records and the one to keep; preview of what moves and the clashes
   (two receipts are fine; two attendance marks on one day keep the kept record's); approval; merge in
   one transaction; the duplicate becomes "merged into ‹admission no.›".
4. **Cancel admission**: reason, the settlement preview (unpaid demands, paid amount, refund or retain);
   approval; demands cancelled, refund request raised, enrolment ended "admission cancelled", logins
   stopped, excluded from strength / attendance / result reports; the admission number retired.

Every step is audited; every approval uses the school's own levels (set-up page per process).
