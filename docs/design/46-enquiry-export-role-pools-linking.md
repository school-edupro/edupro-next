# 46 — Enquiry export, counsellor pools by role, the invitation link and early matching (plan, 25 Oct 2026)

Three gaps found on the enquiry desk after docs/design/45, benchmarked against LeadSquared and
NoPaperForms / Meritto:

1. **No export** of the enquiry list (Excel / PDF), as the helpdesk and the registrations have.
2. **Counsellor pools are people only**: a school assigns by role (front office, admission counsellor)
   and wants a new counsellor to start taking leads without editing every rule.
3. **A lead cannot reach "Registration started"** unless the family opens the invitation sent by email /
   SMS: the office cannot copy the link to send by WhatsApp or read out, and a family that starts the
   form on its own is matched only when its registration number is given (straight to Registered).

## Decisions (asked and answered, 25 Oct 2026)

| #   | Question  | Decision                                                                                                                                         |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Export    | **Every lead of the filters** (up to 5000), Excel at once, PDF prepared in the background like the helpdesk's                                    |
| 2   | Role pool | **Its holders at the time**: a rule's pool names roles and people; a lead goes in turn among everyone in it when it arrives                      |
| 3   | Copy link | **Yes, on the enquiry**: after an invitation, the link with Copy (and WhatsApp share on a phone); a new invitation makes a new link              |
| 4   | Matching  | **When the form starts**: the same mobile or email as an open enquiry of the last year links the draft, so the lead shows "Registration started" |

## Parts

**Part 1 — Export the list.** On `/admissions/enquiries` (list and board) Excel and PDF of the leads
matching the filters: ENQ no., received, parent, child, class, source, stage, score, counsellor, mobile,
email, next follow-up, first contact, registration no.; the PDF on the school's letterhead, queued and
offered when ready (the helpdesk's way); the filters printed on top.

**Part 2 — Counsellor pools by role (migration 0254).** `admission_enquiry_rules.pool_roles TEXT[]`;
the rule editor offers roles (those that take enquiries) and people; on arrival the pool is the holders
today of its roles plus its people (none of either: everyone who takes enquiries), shared in turn as now.
The rule's flow reads "In turn: Front office, Admission counsellor, Meena Iyer".

**Part 3 — The invitation link and early matching.** The invitation's link is kept with the enquiry
(only its hash stays in the database; the link is shown once, right after the invitation, and again by
inviting again): "Copy link" and, on a phone, "Share on WhatsApp". When a family starts a form (portal,
link or desk), a draft without an enquiry is linked to the open enquiry of the last year with the same
mobile or email (the same class first), so the lead moves to Registration started; the registration
then moves it on as now.
