# 43 — Form photos, families' queries, candidate notices, category check (plan, 25 Oct 2026)

Four gaps found in the admission portal and the office screens, benchmarked against Entab CampusCare,
Edunext, MyClassboard and admission CRMs (LeadSquared, NoPaperForms):

1. **Form PDF** — the 2026-27 form requires Student, Father and Mother photos, but the registration /
   admission form PDF prints only the student's; the parents' show as "Attached" in the documents list.
2. **Help → Send an enquiry** — lands on Admissions → Enquiries (lead desk, "from website") with no
   counsellor; follow-ups are office notes only, nothing goes back to the family and the family never
   sees its question. A *registered* family asking about a fee or a document is treated as a new lead.
3. **Notice → Candidates** — only a class choice across all open sessions; no session, no status. A
   notice for "Class I" reaches Class I families of every open session (the match checks the class only).
4. **Fee category** — chosen from form answers (EWS, staff child, siblings, alumni). Form 216
   ("Admission form 2026- 2027") has none of those questions, and no form has `ews`: every family is
   charged as General, silently.

What the best ERPs do: the printed form carries a labelled photo strip; new-family enquiries and
registered families' queries are separate flows (lead desk with auto-assignment, logged replies and an
acknowledgement; a query ticket under a head with an owner, an answer-by time, escalation and the
conversation in the family's portal); candidate notices pick session, class and status like messages;
set-up warns when a rule depends on a question the form does not ask.

## Decisions (asked and answered, 25 Oct 2026)

| #   | Question            | Decision                                                                                                          |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | PDF photos          | **Photo strip at the top**: Student, Father, Mother (Guardian when given), labelled; empty labelled box if missing |
| 2   | Queries             | **Two flows**: signed out → Enquiry desk; signed in → "Ask the school" ticket in the Helpdesk, thread in portal    |
| 3   | Assignment          | **Owner per query head** (Fee / payment, Documents, Form / technical, Test / interview, Other), answer-by hours    |
| 4   | Category check      | **Included**: warn where a category's condition names a question the session's forms do not have                  |

Defaults taken (change on request): a candidate notice matches the family's registrations **live** (a
notice to "Registration fee due" stops showing once the fee is paid); the session is required for a
candidate notice; the enquiry desk's auto-assignment goes to the counsellor with the fewest open
enquiries (ties: the longest since last assigned); the acknowledgement goes by the channels of the
admission sign-in set-up.

## Parts

**Part 1 — Photo strip on the form PDFs.** `formPdf` finds the photo fields by `docKind`
(`photo`, `father_photo`, `mother_photo`, `guardian_photo`; else `student|father|mother|guardian` in the
key) and `applicationPdf` draws a strip of up to four labelled boxes under the heading (the single
top-right photo goes). Missing photo: an empty box with its label. Same on the admission form PDF and the
office's copy. No migration.

**Part 2 — Notice → Candidates like Compose.** On `/academics/notices/new` (and edit): Admission session
(required, searchable), Classes sought (none = every class), Status chips with Filter and "Tick all
shown", the reach count live. Stored as targets `admission_cycle` + `admission_class` + a status list on
the notice (migration 0246). The portal's notice match checks session, class and status; old notices
with only classes keep matching by class. Fixes the cross-session leak.

**Part 3 — Enquiry desk: assign, reply, acknowledge.** A website enquiry is assigned on arrival
(Enquiry set-up: on / off, which counsellors). "Reply to family" on the enquiry (email and / or SMS
from templates, through the outbox), logged as a follow-up with the text. The family gets an
acknowledgement with the enquiry number. The Help page shows "Send an enquiry" only when signed out.

**Part 4 — "Ask the school" for registered families.** A `candidate` desk in the Helpdesk (migration
0247): query heads Fee / payment, Documents, Form / technical, Test / interview, Other, each with an owner
(person or role) and hours; the existing levels, SLA clock and escalation apply. Signed in, Help shows
"Ask the school" (head, registration, question, a file) and **My queries** (status, the conversation,
reply, reopen within the set days, rate). An answer shows unread in Messages and goes by email. The
office answers in Helpdesk; the registration page lists its queries.

**Part 5 — Category check.** On the session's Fee tab and in Admission set-up: each category whose
condition names a question missing from a form the session's classes use is flagged ("EWS / DG: the
form 'IBP registration form 2027-28' has no question `ews` — every family will be charged as General").
Publishing a session with such a gap asks to confirm. The fix itself (adding the questions) stays with
the school in the form builder.
