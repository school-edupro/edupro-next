# 39 — Online admission and candidate portal (plan, 23 Oct 2026, revised the same day)

Reference form: `~/Downloads/DPS_RKP_Registration_Form_Spec.md` (DPS R.K. Puram, Class IX 8-tab form and
Class XI 6-tab stream form). Field comparison with the student master:
`Admission_Form_vs_Student_Master.xlsx` (shared with the user, 23 Oct): 70 field groups — 36 match,
16 match with different options, 15 missing from the student master, 3 application-only.
Benchmark: Entab, Fedena, Teachmint, MyClassboard and NoPaperForms-style school admission portals.

**Upgrade, not a second module.** The Sprint 8 admissions module (cycles, applications, applicant OTP,
score, shortlist, draw, approvals, Admit) is upgraded. Reused: recruitment candidate sign-in, stage set-up,
corrections and emails (doc 34, `/people/recruitment`, `/candidates`, `/setup`), the consent-form field
engine and rules (doc 28), school gateways, the fee module's receipts and refunds, the communication
module (`/comms/compose`), notices (`/academics/notices`), the students-list report engine (doc 19).

**Everything works per academic year.** An admission session belongs to the academic year it admits
into (e.g. 2027-28); forms, fees, stages, numbers, reports and the class allotment are per session.

## Decisions (asked and answered, 23 Oct 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Form fields the student master lacks | **Admin chooses per field**: "copy to student master" per field; a new student-master field is created when ticked |
| 2 | Where the candidate portal lives | **School public site** `/[school]/admission`, open to the **general public** (anyone registers with a mobile or email); on Admit the family moves to the parent app |
| 3 | Registration number and fee | **After online payment** through the school's gateways; the office may record a counter payment |
| 4 | Office stages | **Document check**, **Test / interaction**, **Selection and offer**, **Admission fee then Admit**; which stages a class uses and their approval levels are set by the admin (below) |
| 5 | Fee category (General, EWS, Staff ward, Sibling, Alumni…) | **From the form's answers, confirmed at Document check**; the registration fee is worked out on submit, the admission fee follows the confirmed category |
| 6 | Cancellation | **Registration fee is kept; admission fee is refundable** through the fee module's refund with approval, less a deduction % set per session (0 = full) |
| 8 | Enquiry before registration | **Yes, as part 8**: enquiries (walk-in, phone, website, campaign source), follow-ups with next date and reminders, convert to registration with a prefilled link, source / conversion report |
| 9 | Office registers on behalf | **Yes, with counter fee**: the office fills the same form for a walk-in parent and takes the registration fee at the desk (receipt); the parent can sign in later with the mobile / email given |
| 10 | EWS / DG seats | **Same online process, category EWS**: EWS families register on the portal like everyone (fee per the EWS row, may be 0); seats per category; the school's own draw for EWS seats |
| 11 | Admission number | **Given when the admission fee is paid**: printed on the admission receipt and form; a later cancellation retires the number (never reused, still searchable) |
| 7 | Accounts | **In the fee module with own receipt series** — heads Registration fee and Admission fee, receipts `RF/<session>/000001` and `AF/<session>/000001`; they show in the Day Book, head tally, mode summary, gateway settlement and Tally export, plus Admissions → Fee collection |

Defaults taken for the spec's open points (change on request): session label, age reference date, DOB
window, pass-out year limit and pincode prefixes come from the session / form settings; emails stored in
small letters (names in capitals); Gender list gets "Transgender"; hostel choice limited by gender;
the same subject cannot be chosen twice; Basic Mathematics does not meet a Maths cut-off; single parent
hides the other parent's tab and photo; one shared validator for email, mobile, pincode, Aadhaar, APAAR;
Aadhaar / APAAR / PEN encrypted, Aadhaar masked after saving.

## The process

```
Public site → candidate registers (mobile / email + code) → picks the class → class's form
 → saves tab by tab → review → declaration → pays registration fee (class × category)
 → registration no. + receipt + form PDF (view / download in the portal, emailed)
 → office stages for that class (configured), each with approval levels:
     Document check ──observation──► "Sent to candidate" (email) → candidate corrects → back to approval
     Written test (IX–XII) → Interview → Selection / waiting list → offer
 → email "pay admission fee" → pays in the portal or at the school desk
 → admission receipt + admission form PDF in the portal
 → admission no. given on payment → Admit: allot class-section (and roll no.) → student master + parents + documents + parent login
Cancellation at any point: application cancelled (registration fee kept) or admission cancelled
 with admission-fee refund (deduction %) through refund approval.
```

## Fees

- **Registration fee** per session × class × category (General, EWS, Staff ward, Sibling, Alumni and
  any the school adds; 0 allowed). Category comes from the form's answers (decision 5).
- **Admission fee** per session × class × category, raised on the offer; may be one amount or the
  school's admission-time heads (admission fee, caution money, first instalment) — set per class.
- Both are receipted in the fee module (decision 7): own receipt series, gateway routes per fee type,
  convenience charge rule, counter payment by cash / cheque / UPI at the school desk, bounce, refund.
- The candidate sees and downloads each receipt in the portal; the office sees them on the application.

## Communication

- **Communication module** (`/comms/compose`): new audience **Candidates**, filtered by session, class,
  stage, status (registered, fee pending, test scheduled, selected, waiting, offered, admitted) or
  picked by name / registration no.; email / SMS / WhatsApp with the school's templates and the usual
  message approval and delivery log.
- **Notices / circulars** (`/academics/notices`): new audience **Candidates** with the same filters.
- **Candidate portal** shows both: a Messages inbox and Notices, newest first, with attachments.
- **Automatic emails** (designed cards, as recruitment): received (form PDF), registration receipt,
  observation sent back, corrected and resubmitted, test / interview schedule with admit card, result,
  offer with last date and amount, admission receipt, admitted (parent login), cancelled / refund.

## Approval process (configured by the admin, with confirmation)

- **Admission set-up** (like `/people/recruitment/setup`): the school's stage list (Document check,
  Written test, Interview, Selection, Admission fee, Admit — the school may add its own); a **process**
  = ordered stages with approval levels per stage (named employees, everyone with a designation, a
  role, the class teacher / coordinator of the class sought); processes are **assigned to classes**,
  e.g. "Primary" (Nursery–V: Document check → Interaction → Selection) and "Senior" (IX–XII: Document
  check → Written test → Interview → Selection).
- Changing a process shows what changes for applications already in progress and needs a
  **confirmation**; stages already approved stay approved.
- **Observation / send back** (like recruitment corrections): the approver marks the fields or
  documents with observations + remark + due date; the application shows "Sent to candidate" and an
  email goes out; the candidate edits only those parts and resubmits; it returns to the same approval
  level; reminder a day before the due date; history kept.
- **Test / interview**: slots with date, time, venue and capacity; candidates allotted (auto or by
  hand); admit card PDF in the portal; attendance; marks or grade and remarks per stage.
- **Selection**: merit list (by marks / score) or draw; seats per class and category; offer with a
  last date; waiting list moves up when an offer lapses or is declined.
- Undo of the last decision and moving stages back with a reason, configured like recruitment.

## Cancellation and refund

- **Before Admit**: candidate withdraws or the office cancels (reason); registration fee kept.
- **After the admission fee**: cancel with a reason → refund request in the fee module (deduction %
  per session) → refund approval → paid; the offer seat is freed and the waiting list moves up.
- **After Admit**: the student-side cancellation of doc 37 part 4 (same settlement rules).

## Reports

- **Registrations / admissions list** built on the students-list report engine (`/people/students`
  style): columns chosen by the user from every form field and status, quick filters (session, class,
  category, stage, status, fee paid, dates), More filters on any field, saved views per user, export
  of what is seen to Excel / PDF with the letterhead; report builder dataset "Admissions" for saved
  and shared reports.
- **Fee reports — where they show (decision 7):**
  - Admissions → **Fee collection**: registration and admission fees by date, class, category, mode,
    gateway, with refunds; Excel / PDF.
  - Fees → **Day Book**, **Head-wise tally**, **Mode summary**, **Gateway settlements**, **Tally
    export**: the two heads appear with their own receipt series, like school fees.
  - Admissions dashboard: figures first (registrations, fee collected, in test, selected, offered,
    admitted, cancelled), then tables, then small charts; funnel per class.

## Moving to the student master

- **Allot class-section**: for each admitted candidate (or in bulk for a class) the office picks the
  section — the screen suggests the section with the most free seats and shows the boy / girl count —
  and the roll number; admission number from the school's series.
- Review screen of the mapped values (form → student master per the builder's mapping), then Admit:
  student, father / mother / guardian (a sibling's existing parent record linked), documents and
  photos, enrolment in the session's academic year, fee profile (category / concession), transport /
  hostel request if asked, parent portal login and welcome email. The application keeps a link to
  the student.

## Parts (build only on "go part N")

1. **Masters, fields and form builder**: new lists (languages, professions, nationalities, localities
   with pincode prefixes, group schools, streams → subjects, special needs, achievements, school
   recognition, medium, fee categories); Gender "Transgender"; new document kinds; form builder with
   tabs, all field types, repeat blocks, sibling lookup, stream → subject cascade, marks with cut-offs,
   age-as-on, show / hide / require rules, options from masters, mapping / "copy to student master";
   the two ready forms (Class IX, Class XI).
2. **Admission session and fees**: session per academic year, classes with form, seats, dates,
   eligibility; registration and admission fee per class × category; heads and receipt series in the
   fee module; public page, link, QR, poster.
3. **Candidate portal**: open registration (mobile / email + code by the admin's channels; later
   sign-in also by registration no.), several children, the form tab by tab, review, declaration,
   online payment, registration no., receipt and form PDF, status page, Messages and Notices.
4. **Approval process**: admission set-up (stages, processes, levels, assignment to classes, with
   confirmation), applications list and application page, Document check with observations sent to
   the candidate and resubmission, test / interview slots, admit card, marks, selection, offer,
   waiting list, undo / stage back.
5. **Communication**: Candidates audience in Compose and Notices, candidate inbox, automatic emails.
6. **Admission fee, Admit and cancellation**: admission fee in the portal or at the desk with
   receipt, admission form PDF; allot class-section (single and bulk), review and Admit to the student
   master; cancellation and refund flow.
7. **Reports and dashboard**: admissions list on the report engine with saved views and report
   builder dataset, fee collection report, admissions dashboard, fee heads in the fee reports.
8. **Enquiry**: enquiry desk (walk-in, phone, website form, campaign / source), follow-ups with next
   date and reminders, counsellor assignment, convert to registration (prefilled link by email / SMS),
   enquiry → registration → admission conversion report by source and class.

Placement of decisions 9-11: office registration on behalf in part 3 (same form, desk receipt);
EWS category in parts 2 and 4 (fee row, seats per category, draw per category); admission number on
admission-fee payment in part 6 (Admit then only allots section and roll no.).
