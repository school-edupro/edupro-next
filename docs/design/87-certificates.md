# 87 — Certificate management

Status: phase A (foundation) built 14 Nov 2026; phases B–F planned. Plan: `CERTIFICATE_MODULE_PLAN.md` beside
the legacy code (outside this repository).

## Source and approach

The school's certificate module (PHP, kept read-only in `new folder/Certificate`) was read for its **process**
only — the program files, never the designer uploads, images, status files, generated PDFs or any connection
file; no student or staff data and no school name is carried over. It issued about fifteen student types from
per-school generators and staff experience / visa letters; one wide row per certificate; a number
`<2 letters>-<year>-<5 digits>` taken as MAX + 1 without a lock (two types sharing letters shared a series);
the TC book and Sl. No. (100 to a book); eligibility "student closed", hard-coded per school; no requests,
approvals, fees, verification or register. Defects not carried over: the generic TC printed blank parents and
subjects and swapped the application and issue dates; "admin" was six employee ids in the code; templates were
re-made every year; bulk print lost its order.

EduPro before this module: the TC (`transfer_certificates`, `TC/<year>/<0001>` never resetting, 12 fields, a fee
gate only on the withdrawal route, reprints following the current template), bonafide only as an ad-hoc print
with no record, achievement certificates numbered by a count, staff exit letters, payroll certificates.

Benchmark (school ERPs): bulk issue with a serial and a QR each; a public page showing Valid / Revoked; per-type
templates and signatories; requests, approval and an optional fee.

## Decisions (14 Nov 2026)

1. **One module for every certificate** — one register, numbering, templates and verification; the TC keeps its
   link to the student withdrawal.
2. **Office issues; parents, students and staff request online** (purpose, copies), approved by the office, an
   optional fee through Fees, downloaded in the app.
3. **Ready board-correct templates per type + an editor** (the full CBSE TC, bonafide, character …; letterhead,
   logo, signature, QR; a field list); not tied to a year.
4. **QR + a public check page**: Valid or Cancelled, type, number, date, a masked name; no login; rate-limited.
5. **Eligibility rules per type**. TC: the withdrawal complete; fees, library, hostel and transport cleared.
   Bonafide, character …: an active or past student. The principal may override a failed check with a reason.
6. **Numbering per type and academic year**, never reused (`TC/2026-27/00001`, `BON/2026-27/00001` …); the TC
   also keeps the book number and Sl. No. series (100 to a book), continuing from the old system.
7. **Approval of requests set per type** on EduPro's approver levels.
8. **Old data: history + numbering** — the old system's certificates as read-only history; each series continues
   from the last number used.

Phases: **A** foundation → **B** templates editor and all types → **C** requests → **D** verification → **E**
bulk, registers, awards → **F** from the old system. Each starts when the one before is complete with its tests.

## As built — phase A, the foundation (14 Nov 2026)

**Data** (migrations 0381, 0382).

- `document_template_versions`: every insert and every change of a `document_templates` row writes a version
  (triggers); the existing templates were backfilled as version 1. A certificate keeps the version it was made
  with.
- `certificate_types` (per school): code, name, audience (STUDENT / STAFF), prefix, template, `rules` (state
  `active` / `leaving` / `any`; `fees`, `library`, `hostel`, `transport`), `multiple` (ONE ever / YEAR / ANY),
  `uses_book`, `request` (phase C), active, order. `app.certificate_types_seed(school)` makes TC (leaving, all
  four clearances, ONE, the book), BONAFIDE (active), CHARACTER and DOB (any); run for every school by 0381 and
  again on first use for a school added later.
- `certificate_series` (school × type × year, `last_serial`) and `app.next_certificate_no(type, prefix, year)`:
  an `INSERT … ON CONFLICT DO UPDATE … RETURNING` takes the row lock, so two issues never get one number;
  `PREFIX/YEAR/00001`. 0382 starts each school's TC series of a year after the TCs already issued in it (the old
  `TC/2026-27/0004` is followed by `TC/2026-27/00005`); `app.next_tc_no` is retired.
- `certificate_book_series` and `app.next_certificate_sl()`: the next Sl. No. and its book (`(sl − 1) / 100 + 1`).
- `certificates`: type, number, serial, year, `copy_no` (0 the original; 1, 2 … a duplicate with the same
  number, `original_id`), student or employee, status issued / cancelled, issued on / by, purpose, `data` (every
  printed field, frozen), `template_version_id`, `checks` (as they stood), `override_reason` / `override_by`,
  `verify_token` (random; phase D prints it as a QR), book / Sl. No., `export_id`, `transfer_certificate_id`,
  legacy fields, cancel fields; `UNIQUE (school, number, copy_no)`; RLS and the audit trigger. The 401 TCs
  already issued were brought in under their own numbers.
- Rights: `certificate.register.view`, `.issue`, `.cancel`, `.override` (needs a fresh MFA sign-in, never under
  impersonation), `certificate.setup.manage`. A **Certificate office** system role (view, issue, cancel); school
  and group admins hold all five; the academic coordinator and the auditor view.

**Ready templates** (`packages/db/src/certificate-templates.ts`): the CBSE TC with its 24 items, the ids line (TC,
book and Sl. No., admission no., PEN, APAAR, registration no.), bonafide, character and date of birth; each on
the school's letterhead (the logo when the school has one), DUPLICATE (copy n) on a duplicate, and the Prepared /
Checked / Principal lines. They are made for a school, and linked to its types, on first use.

**What a certificate prints** (`certificate-data.ts`): the school (name, address, contacts, affiliation no.,
board, school no.); the student (name, gender, DOB in figures and words, nationality, religion, category, caste,
mother tongue, place of birth, PEN, APAAR, SRN, registration no., father, mother, guardian, house, admission
date and class, class and section with the class in words, roll no., year, the pronouns); the year's day
attendance (working days, days present up to the leaving date); the subjects (the student's choices, else the
class's compulsory subjects); the month every fee is paid to and any concession. Aadhaar is never printed. The
typed fields per type (`certificate-fields.ts`): the TC's reason, application and struck-off dates, exam result,
failed, subjects, promotion, dues month, concession, working days, days present, NCC, activities, conduct,
remarks — filled from the record and editable; character: the conduct and a line more.

**Checks** (`certificate-checks.ts`): state (active / leaving — left, a withdrawal cleared or completed, or issued
from the withdrawal / any); fees (the ledger's balance and late fee due up to the leaving date or today); library
(books out, unpaid fines and charges); hostel (a bed held past the date); transport (an active service past the
month); one live certificate (ONE / YEAR). From a withdrawal, a department cleared or bypassed there answers its
check ("cleared in the withdrawal"). "Already holds" is never overridden; any other failed check stops the issue
(409 `certificate.checks_failed`, the checks listed) unless the principal sends a reason of 10–300 characters.

**API** (`/certificates`): `GET types` (with the fields each asks for and the caller's rights), `POST preview`
(checks, fields, the paper as HTML; nothing saved), `POST issue`, `GET` (filters type, status, copy, override,
year, dates, text; pages; figures), `GET file?format=xlsx|pdf`, `GET students?q=` (on the rolls or past),
`GET student/:id`, `GET :id` (with copies and the frozen data), `POST :id/duplicate`, `POST :id/cancel`,
`POST :id/render`. Issue takes an advisory lock per type and student (two clicks never make two), numbers,
freezes, inserts and audits in one transaction, then queues the PDF (`certificate_doc` renderer in the workers:
the frozen data through its template version, with the logo). A duplicate locks the original and takes the next
copy number. Cancel takes the duplicates (and the TC's row) with it.

**The TC moved in.** `TcService.issue` now issues through the register on every route — the profile
(`POST /people/students/:id/tc`), the withdrawal (single and bulk; the withdrawal, its leaving date and its
cleared departments go with it) and the register — so the checks, numbering, book Sl. No., frozen data and PDF
are the same everywhere. The TC row stays for the withdrawal and the TC list (`last_class` as before, e.g.
`VIII-A`). Cancelling a TC from its own screen cancels its register row; a TC issued before the register reprints
from the TC template of the time.

**Screens** (admin). Side menu **Certificates → Certificate register** (the section rides on the People module
switch; the old achievement-certificates entry is now "Achievement certificates"):

- **Register** (`/certificates`): six figures, filters (type, status, copy, checks, year, dates, text, per
  page), Download (Excel / PDF as filtered), the table with View / Download icons, pages.
- **Issue** (`/certificates/issue`): type and student search; the checks with what is wrong; the fields
  (filled, editable); the override reason only for the principal and only when a check fails; Issue; Update the
  preview; the paper in a sandboxed frame.
- **Certificate** (`/certificates/:id`): figures (status, copy, date, book / Sl. No., copies, checks not clear),
  the essentials and the PDF (or its progress), then folds: checks at issue, original and duplicates, what it
  printed, duplicate or cancel (dialogs with a reason).
- The student's profile (**Status** tab): a Certificates card and **Issue the TC** (to the issue screen); the
  ad-hoc template print no longer lists bonafide or the register's templates. The TC list links to the register.

Tests: `certificates.e2e-spec.ts` (types on first use; preview; numbering per type and year under eight
concurrent issues and never reused after a cancel; checks and override — the office refused, a stale MFA refused,
a short reason refused, the reason recorded; the TC from the register with its book Sl. No. and the student off
the rolls; the TC from the profile; duplicates; the paper unchanged by a template and a name change; cancel with
duplicates and the TC row; filters, figures, pages, Excel and PDF; another school sees nothing);
`withdrawal-flow` (the TC in the register with its checks answered by the withdrawal); `daily-academics` (the
profile route stopped by the checks, then issued by the principal with a reason, `TC/2026-27/00001`).

Not in phase A (as planned): the principal's signature image and the QR (phases B and D), staff types (B), the
template editor for the certificate kinds (B; the existing editor edits the HTML), requests (C), the public check
(D), bulk issue and the TC book register (E), the old system's certificates (F). The template render endpoint
still lets a holder of `platform.template.view` print a bonafide template ad hoc; the admin screens no longer
offer it.
