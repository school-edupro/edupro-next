# 41 — One registration per child per year, and sign-in codes that arrive (plan, 24 Oct 2026)

Two gaps on the admission portal (`/[school]/admission`):

1. **Duplicates** — a family can start any number of registrations for the same class and session; the
   only check is a "possible duplicate" flag on the same Aadhaar, which does not stop anything.
2. **Sign-in code by email not received** — the code is a formatted email (`app.admission_mail`,
   `admission_otp`) put in `comms_messages`; the message worker delivers it. The worker had not run since
   22 Oct, so codes waited (with 11,700+ test-school messages) and would have arrived after they expired.
   The school's SMTP, SMS and WhatsApp providers are real: the worker is started only by the user, from
   their Terminal (`pnpm --filter @edupro/workers dev`).

Benchmark (Entab CampusCare, Edunext, MyClassboard): one live registration per child per academic year,
checked on the child (name + date of birth, Aadhaar), so twins and siblings still register; a family is
taken back to its unfinished draft instead of a new one; sign-in codes are transactional (sent first,
never late), with a resend timer and a test switch to show the code on screen.

## Decisions (asked and answered, 24 Oct 2026)

| #   | Question               | Decision                                                                                                                                                           |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | What is a duplicate    | **Same child, same academic year**: first name + date of birth, or the same Aadhaar, in any class; other children of the family may register                       |
| 2   | A draft already exists | **Open the existing draft**; "Register another child" starts a new one on purpose                                                                                  |
| 3   | Sign-in codes          | **All four**: codes jump the queue; a code not sent within its validity is not sent late; resend with a timer; an admin switch to show the code on screen (logged) |
| 4   | The waiting messages   | **Cleared** on 24 Oct: 11,746 cancelled (all test-school messages, Alpha/Beta older than 24 h); 15 of Alpha's from that day kept                                   |

Defaults taken (change on request): "live" means submitted and not cancelled, withdrawn or rejected (a
rejected child may apply again); the check runs on submit, in the portal and at the office desk; an admin
(Admission set-up) may let a second registration through at the desk with a reason, recorded; the
existing Aadhaar "possible duplicate" flag stays for near matches (name spelt differently).

## Parts

**Part 1 — One live registration per child per year.** On submit (portal, desk, a corrected form) the
child is matched against the session's academic year: the same first name (ignoring case and spaces) and
date of birth, or the same Aadhaar. A match stops the submit with "ASHA VERMA already has registration
APP/ADM-2027-28/00013 for Class I this year", naming the class and status. At the desk an admin may
continue with a reason (history and audit).

**Part 2 — Back to the unfinished draft.** "Register for Class I" opens the family's draft for that class
and session when there is one; the portal says so. "Register another child" starts a new draft on
purpose. My registrations lists drafts first with Continue and Delete.

**Part 3 — Sign-in codes that arrive.** Codes are queued ahead of other messages; each code message
carries its expiry, and the worker marks it expired instead of sending it late. The portal shows where
the code went and "Resend in 30 s" (at most 5 an hour per mobile / email, as today's lock). Admission
set-up gets "Also show the sign-in code on screen (testing)"; each code shown is recorded, and the
portal shows a notice while it is on.
