# 38 — Employee exit and full and final settlement (plan, 23 Oct 2026)

## Decisions (asked and answered)
- **Who starts it**: the employee applies for **resignation in the staff app**, or the **office creates
  it on behalf**; the office may also record **termination, retirement or contract end**.
- **Approvals**: levels set up like vacancy approval, **per employee type** (teaching / non-teaching …):
  HOD or reporting manager, Principal, a role, a designation or a named employee; any level may send
  back with a remark.
- **FNF**: a **manual full and final statement** (there is no payroll yet): accounts enters the
  earnings and deductions; library and asset dues are filled in from the system.

## The process
1. **Request** — exit type, reason, letter (file), date of the request, proposed last working day; the
   notice period from set-up (per employee type) gives the expected last day and any shortfall. An
   employee may withdraw a resignation until it is accepted.
2. **Approval** — the levels in order; each approves (may set the accepted last working day and waive
   notice), sends back, or rejects with a reason. The employee sees the stage in the staff app.
3. **No-dues clearance** — departments from set-up (Library, Accounts, IT / assets, Admin / ID card,
   HOD for hand-over, Transport, Hostel …) each clear or note dues with an amount; library books on loan
   and unpaid library charges are shown automatically.
4. **FNF statement** — earnings (salary for days worked, leave encashment, gratuity, bonus, other) and
   deductions (notice shortfall, advances, unreturned assets, dues from clearance, TDS, other); net
   payable or recoverable; approved by the set-up approver; printed; marked paid with mode and
   reference.
5. **Close** — on the last working day (or when closed after it): the employee becomes inactive with
   `left_on`, logins stopped, class teacher / subject assignments ended (listed for re-assignment);
   letters printed: acceptance of resignation, relieving letter, experience certificate.

## Parts
5. **Set-up and request**: exit types, notice period per employee type, approval levels per employee
   type, clearance departments; resignation in the staff app; office creates on behalf (any exit type);
   approvals in the admin inbox and the staff app; withdraw / send back / reject.
6. **No-dues**: the clearance board per exit, departments clear with dues; library and assets automatic.
7. **FNF and close**: the statement, its approval and payment, the letters (PDF), the close (inactive,
   logins stopped, assignments listed), the exit register and Excel.

## Part 5 as built (24 Oct 2026)
- Migration 0237: `employee_exit_types` (staff may ask in the app; notice counts), `employee_exit_settings`
  (notice days per employee type), `exit_clearance_departments` (for part 6; library / assets fill in
  from the system), `employee_exits` (one in progress per employee) and `employee_exit_events` (the
  timeline); rights `people.exit.view` and `people.exit.manage` (admins).
- A school starts with: Resignation (staff may ask, notice counts), Termination, Retirement, Contract
  end; notice 90 / 30 / 30 / 0 days (teaching / non-teaching / contract / visiting); departments Library,
  Accounts, IT and assets, Admin and ID card, HOD (hand-over), Transport, Hostel. All editable under
  Employee management → Exit set-up.
- Approval levels per employee type on the workflow engine (`employee_exit_<type>`, entity
  `employee_exit`), set like vacancy approval with the same editor (now shared): named employees, a
  designation, the HOD of the employee's department, the **reporting manager** of the employee (new
  engine choice: the posting of the working year), or a role. A school starts with HOD, then Principal. A
  level nobody holds is skipped; the raiser's own level and a level of someone who already approved count
  as approved; saving moves the exits waiting to the new people.
- The request: the employee in the staff app (**My resignation**: type, proposed last day, reason, letter)
  or the office on their behalf for any type (**Record an exit**). The notice of the employee's type
  gives the expected last day and the shortfall.
- Decisions: in the admin (the exit page, also linked from My inbox) and the staff app (**Exits to
  approve**, shown when something waits): approve (may set the accepted last working day and waive the
  notice shortfall), send back with a remark (the employee or the office changes it and sends it again;
  the levels start over), or reject with the reason. The employee or the office withdraws it until it is
  accepted. The letter opens for the office, the employee and the approvers (View / Download).
- Engine: `WorkflowService.cancelIn` (cancel in the caller's transaction after the module's own check),
  used so the employee can withdraw a request the office raised.
- API: `GET|PUT people/exits/setup`, `GET|PUT people/exits/setup/approval/:type`, `GET|POST people/exits`,
  `GET people/exits/to-approve`, `GET people/exits/:id`, `GET people/exits/:id/letter`,
  `POST people/exits/:id/approve|send-back|reject|withdraw|resubmit`, `GET|POST me/exits`. Tests:
  `employee-exits.e2e-spec.ts` (5).

## Part 6 as built (24 Oct 2026)
- Migration 0238: who clears each department (`exit_clearance_departments.approvers`: the office, the
  HOD of the employee's department, a role, named users; Library starts with the librarian, Accounts with
  the accountant, HOD hand-over with the HOD, all with the office) and `exit_clearances` (one row per
  department in use, made when the exit is accepted).
- Each department clears the exit or notes dues with an amount and a note; what the system shows is kept
  with it. Library: books not returned, unpaid fines and unpaid library charges of the employee (the
  same counts the student withdrawal uses). Assets: EduPro keeps no asset register yet, so the department
  notes anything not returned by hand. A department whose system check shows something owed clears only
  with the dues or a note. The office may open a department's clearance again. When every department has
  cleared, the timeline says so.
- Where: **No-dues clearance** (the board of accepted exits, Employee management), the exit page
  (clear or open again), the staff app **No-dues to clear** (shown when a department waits for the
  person: an HOD, the librarian) and the employee's **My resignation** (progress and dues).
- The dues are summed for the full and final statement (part 7).
- API: `GET people/exits/clearance`, `GET people/exits/clearance/mine`,
  `POST people/exits/:id/clearance/:department`, `POST …/reopen`; set-up carries the departments'
  approvers. Tests: 4 more cases in `employee-exits.e2e-spec.ts`.
