# 64 — Moving a registration to the other school (fees carried over) (plan, 29 Oct 2026)

Asked: the system holds two schools (Alpha and Beta). A family registers (or is offered admission) in
one school by mistake: how does the candidate move to the other? The user's view: the old registration
/ admission is cancelled and a new one made, the difference in the amount kept on account.

## What was found

- **Admitted students** already move: People → Transfers between schools (`lifecycle/transfers.service.ts`).
  The first school withdraws the student (dues settled), sends the record, the other accepts; profile,
  photos, documents and logins are copied; no money moves.
- **Registrations not yet admitted** cannot move. Today: cancel in the first school (registration fee
  kept, admission fee parts refunded through the refund approval, doc 54) and register again in the
  other, paying again.
- Money: the registration fee and admission fee parts are `misc_receipts` of the school (heads REGFEE /
  ADMFEE; modes online, cash, cheque, dd, upi, bank, card); a family's portal login (`applicants`) is per
  school (mobile unique per school); numbers come from each school's series (doc 63).

## Benchmark

Entab CampusCare (multi-branch), Edunext, Fedena (branch transfer of applicants): the first branch
raises a transfer with a reason, the other accepts; the application is copied and numbered by the
receiving branch; money paid is carried as an inter-branch transfer (out in one book, in the other,
no cash), the family pays a higher fee's difference or keeps the extra as credit; the old application
is closed as "Transferred".

## Decisions (asked 29 Oct 2026)

1. **Who moves**: registrations from registered up to admission fee paid (not yet admitted). Admitted
   students keep using Transfers between schools.
2. **Money carried over as credit**: the first school records it as transferred out (no cash), the other
   as received from the first school against the new registration. A higher fee there: the family pays
   the difference; a lower one: the extra stays as credit there (used in later fees, or refunded there).
3. **Request and accept**: the first school requests with a reason, the other accepts or refuses; a
   group admin may do both.
4. **A fresh record there**: form answers, documents, photos and the family's portal login copied; that
   school's registration number; points worked out by its rules; its approval process from the first
   step. The old record is cancelled "Moved to <school>".

Decided here, change any before building:

- The receiving school chooses the session and class when accepting (the same class name is suggested);
  its form's answers are copied by the same field (key or what it maps to); a required answer it lacks
  sends the family a correction request (doc 37) right after accepting.
- Money: the registration fee paid goes to the new registration's registration fee; the admission fee
  paid becomes credit there, used when that school offers and the admission fee is collected; any
  remainder after both stays as the family's credit (the Accounts counter shows it, refundable through
  the refund approval). If the new registration fee is higher, the new registration waits for the
  difference (registration number given once paid).
- Accounting: the first school gets a **Transfer out** voucher per move (Fees → Refunds shows it, with
  the other school named); the other school gets receipts in mode **Inter-school transfer** (no cash)
  quoting that voucher; a register of moves in both schools (Excel / PDF).
- An offer in the first school lapses with the move; its seat frees. Messages: the family is told once
  the move is accepted (new registration number, any difference to pay).
- Only within one school group (schools a group admin sees); the request lists the group's other schools.

## Parts

### Part 1 — Request, accept, the fresh registration

- Migration 0274: `admission_moves` (from / to school, from / to registration, status requested /
  accepted / refused / withdrawn, reason, chosen session and class, money snapshot, by / at).
- API: request (first school, reason), list incoming / outgoing, accept (other school: session, class;
  copies answers, documents, photos, the family's login; numbers; points; process starts; the old one
  cancelled "Moved to …"), refuse / withdraw with a reason.
- Admin: on the registration page "Move to another school"; Admissions → Moves between schools (incoming,
  outgoing, history); group admin sees both.
- Tests: e2e (request, accept, copied answers / documents / login, numbers, cancelled old record,
  refuse, withdraw, admitted refused); a11y; browser.

### Part 2 — Money carried over

- Migration 0275: receipt mode `transfer`; `admission_credits` (registration, amount, source move,
  used / left).
- API: on accept, the first school's Transfer out voucher, the other school's Inter-school transfer
  receipts (registration fee), credit for the rest; credit applied at admission fee collection
  (counter and portal); the difference due when the new registration fee is higher; the register of
  moves (Excel / PDF) in both schools.
- Admin: amounts on the request and accept screens (paid, carried, difference or credit); the counter
  shows and applies credit; Fees → Refunds lists Transfer out vouchers.
- Tests: e2e (equal fee, higher fee with difference due, lower fee leaving credit, admission fee parts
  carried and applied at the new admission fee); a11y; browser.

## Not in this plan

Moves to schools outside the group; admitted students (the existing transfer); moving several
candidates at once.
