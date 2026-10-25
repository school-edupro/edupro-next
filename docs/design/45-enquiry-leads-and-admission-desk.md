# 45 — Enquiries as lead management, assignment rules, the admission desk (plan, 25 Oct 2026)

Three admission office screens, benchmarked against LeadSquared, NoPaperForms / Meritto and Entab CRM:

1. **Admission desk** (`/admissions/desk`): the office picks a class and types the whole registration
   form for a walk-in parent, then takes the fee. Families now fill the same form from the public link,
   so typing it at the counter is the slow path; the desk cannot find a registration to help with.
2. **Enquiries** (`/admissions/enquiries`): a list with filters and five fixed statuses (new, follow-up,
   interested, converted, not interested / closed); an enquiry page with follow-ups, invite and reply.
3. **Enquiry desk set-up** (Admission set-up): one switch and one list of counsellors for every class
   and source, unlike the approval processes beside it (named processes for classes, steps, levels).

What the best do: a lead pipeline (board and list) of the school's own stages, an owner and the next
follow-up on every lead, hot / warm / cold, a timeline of every call and message, bulk assign / message
/ move, import and duplicates; assignment rules by class and source with a counsellor pool, a time for
the first contact and escalation to a supervisor; a walk-in desk that starts the registration for the
parent (the link to their phone, or the office fills it) and finds any registration by mobile or number.

## Decisions (asked and answered, 25 Oct 2026)

| #   | Question   | Decision                                                                                                                                                                                                                                                                   |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Desk       | **Start for the parent + find**: class, child, mobile / email → the form link to the parent (filled with that), or the office fills it now; search by mobile / number to help, correct or take the fee                                                                     |
| 2   | Leads view | **Board + list**: a column per stage with cards (child, class, owner, next follow-up, hot / warm / cold); a list with filters and bulk actions; today's / overdue / new-today figures on top                                                                               |
| 3   | Stages     | **The school's own, with defaults**: New, Contacted, Interested, Campus visit, Registration started, Registered, Admitted, Lost; rename, reorder, add; registered / admitted move by themselves                                                                            |
| 4   | Set-up     | **Assignment rules with escalation**, laid out like approval processes: named rules for classes (and sources); level 1 counsellor pool round-robin; first contact within N working hours; then level 2 (a person or role) is told and takes over; acknowledgement per rule |

Defaults taken (change on request): a lead's score is set by the counsellor (hot / warm / cold), not
worked out; "first contact" is the first call, visit, reply or invitation logged; the working hours
are the helpdesk's (school days and hours, holidays skipped); an enquiry no rule covers goes to the
counsellors of the rule marked "everything else", else to nobody (as now when the switch is off);
"Lost" asks for a reason from a short list (fees, distance, another school, no seat, other).

## Parts

**Part 1 — Stages and the lead's facts (built 25 Oct 2026, migration 0251).** `admission_enquiry_stages` (the
school's own, sort order, kind `open` / `registered` / `admitted` / `lost`, colour from the tokens),
seeded with the eight defaults; `admission_enquiries.stage_id`, `score` (hot / warm / cold),
`lost_reason`, `first_contact_at` (`rule_id`, `level` come with part 3); the old status kept in step for the reports. A
registration moves its enquiry to Registration started / Registered / Admitted by itself. List API by
stage with counts, today's / overdue / new figures, bulk assign / move / score.

**Part 2 — The board and the list (admin).** `/admissions/enquiries`: figures on top (new today,
follow-ups today, overdue, converted this month); Board | List switch. The board: a column per stage,
cards with child, class, source, owner, next follow-up (red when overdue), score; move with a stage
menu on the card (and drag where the browser allows). The list: filters (stage, owner, class, source,
score, due), select rows → assign, move, message, export. The enquiry page gains the stage path at the
top, the score, Lost with its reason, and one timeline of calls, messages, invitations and changes.
Import from Excel (the columns of the enquiry form) with duplicates by mobile / email marked.

**Part 3 — Assignment rules with escalation (set-up, migration 0252).** `admission_enquiry_rules`
(name, classes, sources, counsellor pool, first-contact hours, level 2 person or role, acknowledge, the
"everything else" rule, active). Admission set-up → Enquiry desk becomes a list of rules with their
flow ("Pool: A, B, C → first contact in 4 h → Head of admissions"), edited like an approval process.
On arrival a website (or desk) enquiry finds its rule, goes round-robin in the pool, and, when no
first contact is logged in time, `app.enquiry_escalate_due()` (run by the workers with the helpdesk's
every five minutes) gives it to level 2 and tells them by email / app. The old single switch becomes
the first rule.

**Part 4 — The admission desk (admin).** Two halves. **Start for the parent**: class (open ones),
child's name, date of birth, mobile and / or email → the registration is started for the family (its
draft, the parent's sign-in on that mobile / email) and the parent gets the link (SMS / email) to fill
it; or "Fill it now" opens the office's form on the same draft. **Find**: by mobile, email,
registration number or child's name → the family's registrations with status, fee due, Open, take the
fee (counter receipt), the form PDF; an enquiry with that mobile is shown and linked.
