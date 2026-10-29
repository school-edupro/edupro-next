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

## As built (29 Oct 2026)

- **Migrations**: 0274 `admission_moves` (both schools see a row, like `school_transfers`; one open move
  per registration; snapshot of the candidate, answers as kept with ID numbers encrypted, the form's
  fields, the files, the family's login and the receipts; money columns `carried`, `to_registration`,
  `difference_due`, `credit`; `missing`), permission `admissions.application.move` (roles that may
  cancel), receipt and refund mode `transfer`, `applications.transfer_credit`, and
  `app.admission_move_close()` (SECURITY DEFINER: the first school's side inside the receiving school's
  accept). 0275 checks the money again on accept (`money_changed`). The credit is a column on the
  registration, not an `admission_credits` table.
- **API** (`moves.service.ts`, `moves.controller.ts`): `GET admissions/moves/targets`, `POST
  admissions/registrations/:id/move` (registered and later, not admitted / cancelled / withdrawn; a
  line in its history), `GET admissions/moves?box=incoming|outgoing|all` (with the waiting counts),
  `GET admissions/moves/:id`, `GET admissions/moves/:id/options` (the receiving school's sessions and
  classes with a form; the same class name suggested), `POST admissions/moves/:id/preview` (the whole
  accept run and rolled back: fee, category, carried, to the registration fee, difference, credit, the
  answers to ask), `POST .../accept`, `.../refuse`, `.../withdraw` (with a reason), `GET
  admissions/moves/export?format=xlsx|pdf` (the register of moves).
- **Accept**: the family's login by mobile (found or made); a fresh draft; the same child already
  registered there stops it; answers by the same key and type, else by what the field maps to; ID
  numbers decrypted and kept encrypted again; photos and documents copied into this school's storage;
  `core.adopt` keeps what the form accepts and returns what it needs; `core.submitMoved` (category,
  registration fee, points); a receipt of mode `transfer` ("Inter-school transfer", reference "Move N
  from <school>") for the registration fee; a higher fee: `registration_fee` becomes the difference and
  the registration waits for it (the counter / portal take it; then the number, which is copied to the
  move); else `core.register(..., { silent: true })` at once; the rest in `transfer_credit`. Then the
  first school's registration is cancelled "Moved to <school> (registration N): reason", its open
  correction closed, and each receipt closed by an `admission_refunds` line (paid, mode `transfer`,
  reference "Move N to <school>") that Fees → Refunds lists. Accept stops if that registration was
  admitted / cancelled meanwhile, or money was taken or reversed after asking.
- **Answers the copy lacks**: a correction (doc 37) once registered (`core.moveCorrection`): at once on
  accept, or when the difference is paid.
- **Credit**: used when admission is offered (`makeOffer` → `admit.applyCredit`: an admission fee
  receipt of mode `transfer`; cleared, the admission number and the fee-paid message instead of the
  offer; partly, the offer message shows the credit and what is left to pay); the online payment of the
  balance uses it too; `POST admissions/registrations/:id/use-credit` for Accounts
  (`admissions.fee.collect`); the portal asks for the balance less the credit; the counter rows carry
  `credit`.
- **Message**: one from the receiving school: registered (`admission_registered`, with the form and
  receipt PDFs) or the difference to pay (`admission_received` with the difference); rows name the
  first school, the old number, the money and any answers to complete.
- **Admin**: registration page "Move to another school" (school, reason), the waiting / moved lines,
  Withdraw, the credit and "Use the credit"; Admissions → Moves between schools (Coming here / Sent from
  here / All, Excel, PDF view / download); a move's page (what was sent, the receipts carried, Accept or
  refuse with the session, class and the preview; Withdraw for the first school).
- **Not built**: refunding credit left after the admission fee (it stays on the registration).
- Tests: admission-moves e2e 10 (targets / outsider, admitted refused, request and visibility, preview
  keeps nothing, equal fee with copy / files / login / correction / transfer-out line, higher fee paid
  at the counter, lower fee credit used at the offer, refuse and withdraw, duplicate child and money
  changed, register Excel / PDF); all admission suites + permission coverage + school transfer 133;
  db rls; a11y moves pages and registration 1404.
