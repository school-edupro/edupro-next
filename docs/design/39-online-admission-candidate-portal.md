# 39 — Online admission and candidate portal (plan, 23 Oct 2026)

Reference form: `~/Downloads/DPS_RKP_Registration_Form_Spec.md` (DPS R.K. Puram, Class IX 8-tab form and
Class XI 6-tab stream form). Field comparison with the student master:
`Admission_Form_vs_Student_Master.xlsx` (shared with the user, 23 Oct): 70 field groups — 36 match,
16 match with different options, 15 missing from the student master, 3 application-only.
Benchmark: Entab, Fedena, Teachmint, MyClassboard, NoPaperForms-style school admission portals.

**Upgrade, not a second module.** The Sprint 8 admissions module (cycles, applications, applicant OTP,
score, shortlist, draw, approvals, Admit) is upgraded. Reused: recruitment candidate sign-in and emails
(doc 34), the consent-form field engine and rules (doc 28), school gateways and misc-fee payments, the
workflow / approval-level set-up pattern, the student-master catalogue (doc 19).

## Decisions (asked and answered, 23 Oct 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Form fields the student master lacks | **Admin chooses per field**: the builder has "copy to student master" per field; a new student-master field is created when ticked |
| 2 | Where the candidate portal lives | **School public site** `/[school]/admission` (like careers); on Admit the family moves to the parent app |
| 3 | Registration number and fee | **After online payment** through the school's gateways (fee per class, may be 0); the office may record a counter payment |
| 4 | Office stages (each with approval levels set by the admin) | **Document check**, **Test / interaction**, **Selection and offer**, **Admission fee then Admit** |

Defaults taken for the spec's open points (change on request): session label, age reference date, DOB
window, pass-out year limit and pincode prefixes come from the session / form settings; emails stored in
small letters (names in capitals); Gender list gets "Transgender"; hostel choice limited by gender
(Boys Hostel only for boys); the same subject cannot be chosen twice; Basic Mathematics does not meet a
Maths cut-off; single parent hides the other parent's tab and photo; one shared validator for email,
mobile, pincode, Aadhaar, APAAR; Aadhaar / APAAR / PEN encrypted, Aadhaar masked after saving.

## Parts (build only on "go part N")

1. **Form builder**: forms with tabs (steps); field types of the consent engine plus tabs, repeat
   blocks (siblings 1–3), lookup (sibling by admission no.), stream → subject cascade, marks table with
   cut-off rules, age-as-on, address with "same as"; show / hide / require rules; options from school
   lists and masters (never typed in the form); each field mapped to a student-master field or "copy
   to student master" (decision 1); preview; two ready forms from the spec (Class IX general, Class XI
   stream).
2. **Announce**: admission session (academic year) → classes, each with its form, registration fee,
   open / close date-time (India time), seats, eligibility (age band or DOB window, marks cut-offs);
   public page, link, QR, A4 poster, WhatsApp share; instructions text.
3. **Candidate portal** (public site): sign-in with mobile, email or registration no.; six-digit code by
   email / SMS / WhatsApp — channels chosen by the admin in admission set-up; several children under one
   sign-in; form saved on every Next; progress bar; tab marks (done / error); review page; declaration
   with I agree; pay the registration fee; registration number issued on payment; application PDF;
   status page (stage, schedule, admit card, result, offer, corrections asked).
4. **Office and approvals**: applications list (Columns chooser, More filters, Excel / PDF of what is
   seen); application page (hero + stage stepper + tabs, like recruitment); admission set-up holds the
   four stages and the approval levels per stage (named employees, designation, role, class teacher of
   the class sought); send back for correction (fields to correct, remark, due date, reminder); test /
   interaction schedule (slot, venue), admit card PDF, attendance and marks; merit list or draw; offer
   with last date and waiting list.
5. **Communication**: designed HTML emails for received (PDF attached), payment receipt, correction
   asked, schedule and admit card, result, offer, admitted (parent login); SMS / WhatsApp where an
   approved template exists; history on the application.
6. **Move to the student master**: admission fee through the fee module; Admit = review screen (mapped
   values, class-section, admission no., documents, photos) → student, father / mother / guardian
   (sibling's existing parent record linked), documents, enrolment, fee profile, parent portal login;
   the application keeps a link to the student.
7. **Masters and new fields**: lists for languages (22), professions (merged), nationalities (33),
   localities with pincode prefixes, group schools (staff / alumni), streams → subjects, special needs,
   achievement level and area, school recognition, medium; Gender "Transgender"; new document kinds
   (alumni proof, sibling proof); load the spec's option values.
