# 87 — Certificate management

Status: phases A–E (foundation; templates and all types; requests; verification; bulk, registers, awards) built 14 Nov 2026; phase F planned. Plan: `CERTIFICATE_MODULE_PLAN.md` beside
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
still let a holder of `platform.template.view` print a bonafide template ad hoc (closed on 15 Nov 2026, see "Completion
check" below); the admin screens no longer offered it.

## As built — phase B, templates and all types (14 Nov 2026)

**Gate for A.** Every item of phase A was built and tested; two were finished here: the principal's **signature
image** (A printed the signature lines) and **rights per type** (A had the module's rights only).

**Data** (migration 0383). `certificate_types` gains `description`, `fields` (the school's own: key, label, kind
text / date / number / list, required, options, hint), `variants` (other templates to choose at issue), `issuers`
(role ids; empty — everyone with `certificate.register.issue`; `certificate.setup.manage` may always issue) and
`built_in`; the rule `classes` (class codes; "XI" covers "XI-COM"). `document_templates.ready_code` remembers a
ready template's layout. `certificate_settings` (one row a school): the signatory (an employee), the title of
their box, whether their signature image prints, whether the issuer prints, a foot line; RLS and audit.
`app.certificate_types_seed` now makes 17 types — student: TC, bonafide, character, date of birth, date of birth
justification, study, caste (school record), domicile, no objection, travel NOC, visa letter, scholarship, board
registration (VIII–XII), fee paid; staff: experience (has left; one each), service, staff visa NOC — run for every
school; a school's own type or prefix is never overwritten.

**Blocks** (`packages/db/src/certificate-blocks.ts`). Templates place `{{{blocks.letterhead}}}` (logo left; school,
address, contacts, affiliation centred), `{{{blocks.signatures}}}` (Prepared by — the issuer's signature image,
name, "Emp. ID · designation", "Issued on dd-mm-yyyy hh:mm AM" in the school's time zone; Checked by — empty;
the signatory with their image when it prints), `{{{blocks.duplicate}}}` and `{{{blocks.footer}}}` (number, date,
foot line and, from phase D, the QR). The engine inserts only `blocks.*` unescaped; the blocks escape what they
hold. The signs are frozen in the certificate's data (`signs`, `footerNote`); images are stored files (a new
image is a new file), loaded by the workers for the PDF and by the API for the preview. `CERTIFICATE_BLOCK_CSS`
goes before the template's own CSS.

**Ready templates**: 18 — one per type plus "bonafide (father only)" as a variant of bonafide; all on the blocks.
Phase A's four were brought to the new layout on Alpha with **Back to the ready layout** (version 2; nothing had
been issued with them).

**What prints, added**: the student's address, the full set of words by gender (`pronoun`, `pronounObj`,
`pronounPoss`, `pronounSubjCap`, `pronounPossCap`; `pronounCap` stays the possessive the first certificates
used), attendance %, the fee paid in the year by head with the total in words (`fees.*`), and for staff
`employee.*` (name, Emp. ID, designation and department from the latest posting, joining and leaving dates, father's
name, the words); `text.*` holds the typed fields as they read (dates dd-mm-yyyy, the conduct in small letters).
Defaults: board registration takes the school's board, the student's registration no. and the year; date of birth
justification "the birth certificate"; experience "Good".

**Checks, added**: staff — the employee's state (in service / left / any), library books out (`employee` loans),
one live certificate; the class rule for students.

**API** (`/certificates/setup`, `certificate.setup.manage`): `GET` (figures, what to look at, types, templates,
settings), `GET|PUT types/:code`, `POST types` (the school's own, with a copy of a template or a plain one),
`GET templates/:id` (with its versions, the types using it and the field list for a chosen type), `PUT
templates/:id` (a new version), `POST templates/:id/reset`, `POST templates/:id/restore/:version`, `POST templates`
(a copy), `POST templates/preview` (the body and styles as typed, with a sample student or employee, each typed
field shown as [its label]), `GET|PUT settings`. Issue and preview take `employeeId` for a staff type and `variant`
(one of the type's layouts); `GET /certificates/employees?q=`. A template holding a script, frame, form, event
handler, `javascript:`, a style import or an address on the network is refused (`certificate-safety.ts`): the
workers render templates in a browser.

**Screens** (admin). **Certificates → Certificate set-up**: six figures, To look at, three numbered sections —
**Signatory and print** (find the employee; title; print the image; print the issuer; foot line), **Certificate
types** (the list with checks, layouts, issued, on / off, some roles, school's own; **Add a type of the school's
own**) and a type's page (name and number; layouts; checks; who may issue it; the fields, with an add / remove
row editor), **Templates** (the list; **Copy a template**) and the **template editor** (name, page size, the body
and styles; the field list grouped — blocks, certificate, school, student, parents, admission and class,
attendance and fees, words, the type's fields — inserting at the cursor; the live preview a moment after each
change, scaled to its frame; Save as version n; Versions with "use again"; Back to the ready layout). The issue
screen takes staff types (employee search) and asks for the layout when a type has more than one; the register
and a certificate's page link a staff certificate to the employee.

Tests: `certificates-setup.e2e-spec.ts` (7: the set-up and its right; the signatory and the boxes, with the image
id frozen and the preview showing them; staff certificates and their checks, one experience certificate, the
travel dates; the class rule and the board defaults; layouts; a type's own fields, who may issue it, prefix
clash, a type of the school's own; the template editor — refusals, preview, versions, restore, reset, copy);
`packages/db/test/certificate-templates.test.ts` (blocks escape and place images; only `blocks.*` raw; all 18
ready templates render with nothing unfilled); the phase A suites updated (17 types).

## As built — phase C, requests (14 Nov 2026)

**Gate for B.** Every item of phase B was built and tested (the QR block's place is in the footer; the QR itself is
phase D's, as planned).

**Data** (migration 0384). `certificate_requests`: type, student or employee, requested by, channel (parent,
student, staff, office), purpose, copies (1–10), note, status (submitted → approved → issued; rejected, withdrawn),
the workflow instance, the fee (amount, the misc fee raised, a waiver's reason), the certificates that answered it,
the type's checks as they stood when it was asked, decision fields; RLS and audit; `certificates.request_id`. The
type's `request` settings: `open` (parent / student / staff), `purposes`, `maxCopies`, `fee` (a copy), `levels`
(office, class teacher, the signatory, a role, a user). Ready settings: the everyday student types open to parents
and students, two copies, the office in one step; TC and character open to parents, the office then the signatory;
staff types open to staff, the office. The certificate office gets `workflow.inbox.act`. Four app (push only)
message templates a school — approved, the fee to pay, not approved, ready — so nothing goes by e-mail or SMS.
Schools added later get the settings and the templates on first use.

**Approval** runs on the workflow engine: one definition a type (`certificate_request_<code>`, entity type
`certificate_request`) made equal to the type's levels each time a request starts or the settings are saved; the
office is `any_of` the certificate office and school admin roles, the class teacher the engine's own (the student's
section in the payload), the signatory the employee set in the certificate settings (else the school admin), a role
by its code. One completion handler: approved → the fee raised (head CERTFEE "Certificate fee", a misc fee with the
student's line, due in 15 days) or ready; rejected → closed with the last note; a cancelled instance (withdrawn) is
left to the withdraw. Approvers act in the Approvals inbox or on the request (`POST /certificate-requests/:id/decide`,
the caller must be an assignee of the pending level).

**Issue against a request**: `requestId` on the issue — the request must be approved, for the same type and person,
its fee paid (the misc fee line `paid`) or waived; the certificate is linked, the request marked issued and the
requester told. A hook set by the requests service keeps one issue path without a module cycle.

**API** (`/certificate-requests`): `mine` (what I may ask for, my people — a parent's children, the student
themself, the employee themself — my requests and the certificates issued to us), `POST mine` (ask: the type open to
my channel, the person mine, copies within the type's, the purpose one of the type's when it lists some, one open
request a type and person; the checks kept), `POST mine/:id/withdraw` (cancels the approval and an unpaid fee),
`POST mine/certificates/:id/pdf` and `GET mine/exports/:id` (an export the asker owns); for the office (`view`): the
queue with figures — waiting, waiting with me, waiting for the fee, ready, issued this month, the oldest open — and
filters; `GET :id` (the office or an approver of it), `decide`, `waive-fee` and `refuse` (`issue`). Setup: `PUT
/certificates/setup/types/:code/requests` (a staff type is asked by staff only, a student type by parents or
students; open needs a level; roles and people of the school).

**Screens.** Admin: **Requests** (from the register's header): six figures, filters, each request's stage, who it
waits with, its age and fee; a request's page: the request, the checks when asked, the levels (fold), Approve /
Reject (with a reason), Take the fee off, Turn it down, **Issue it** (the issue screen for that student and type,
carrying the request). A type's page: **Requests online** (who may ask, copies, fee, purposes, the levels with an
up / down / remove editor). Parent app, Certificates: **Ask for a certificate** for the chosen child (the types open
to parents, or to a student signed in), **Your requests** (stage, the fee to pay, withdraw), **Issued by the school**
(PDF), then the awards as before. Staff app, Office → **My certificates**: ask, my requests, issued to me (PDF).

Tests: `certificate-requests.e2e-spec.ts` (5: what parents, a student and staff may ask for; a parent's bonafide
through the office and issued against the request, the parent's PDF, not another family's, a request answered once;
the TC through the office then the principal, the issue still checking; the fee — settings refused when wrong,
purposes, copies × fee, not issued unpaid, paid, waived; reject with a reason, withdraw cancelling the approval,
closed types).

## As built — phase D, verification (14 Nov 2026)

**Gate for C.** Every item of phase C was built and tested (requests from the three apps, the levels per type on the
workflow engine, the fee through Fees, app notices, downloads, the office queue).

**The QR.** Each certificate's link is `<PUBLIC_APP_URL>/<school code>/verify/<verify_token>` (the token random, 36
hex characters, unique — made by 0381). At issue the link and its QR (SVG, `qrcode`) are frozen in the certificate's
data (`data.qr`); a duplicate gets its own (the original's is not copied); a certificate made before phase D gets it
when its PDF is made again. `{{{blocks.footer}}}` prints the QR beside the number and date; the previews show a QR of
the school's check page.

**The check** (`certificate-verify.service.ts`, `PublicCertificatesController`, no sign-in, the public throttle per
address): `GET /public/certificates/:school/verify/:token` (30 a minute) and `GET /public/certificates/:school/verify`
(the page; with `number` and `date`, the search — 10 a minute; the number in any case, the date exact, originals
only). The school comes from its code (`app.public_school_id`), so a token is good only at its own school. The answer:
valid / cancelled / not found, the school, the type, number (and duplicate n), the date of issue, the holder's name
masked (first and last letter of each word), student or staff, the cancel date, how many duplicates. Every check is
logged in `certificate_verifications` (migration 0385; school, certificate, method, result, the number tried, a
hash of the address with the school code, the browser cut to 160 characters; RLS) — never the address.

**Screens.** The public site: `/<school>/verify` (number and date, the answer under the form) and
`/<school>/verify/<token>` (the answer), in English and Hindi. Admin, a certificate's page: its check link, and
**Public checks** (fold): when, by QR or number, the answer, the same device again.

Tests: `certificate-verify.e2e-spec.ts` (7: the QR frozen at issue and in the preview; the QR check without a sign-in,
the masked name, a bogus token, another school's token, an unknown school; the search with both number and date, a
wrong date, a bad date; a duplicate's own link; cancelled; the log with a hash only; a QR added on the next PDF; the
search limit).

## As built — phase E, bulk, registers, awards (14 Nov 2026)

**Gate for D.** Every item of phase D was built and tested (the QR on every certificate, the public check, the
limits, the log).

**Data** (migrations 0386, 0387). `certificate_batches` (type, title, scope — a section, chosen students, the
leavers or allotments — the certificates in print order, who was left out and why, the principal's reason, the
batch PDF; RLS, audit); `certificates.batch_id`. `certificate_awards` (name, the type it is printed on, active,
order) and `certificate_award_allotments` (award, student, event, place, date, remarks, the certificate issued).
Four more built-in types — ACHIEVEMENT (ACH), MERIT (MRT), PARTICIPATION (PRT), AWARD (AWD) — with landscape ready
layouts (a border, the name large; fields: for, event, place, date, a line more), closed to requests. The
engagement module's achievement certificates came into the register under their own numbers
(`legacy_ref achievement:<id>`, their PDF the batch's).

**Bulk** (`certificate-bulk.service.ts`): the scope's students in roll order (a section's on the rolls; chosen
students by class and roll; the leavers — a withdrawal cleared or complete, not an admission cancellation, no TC yet
— at most 300); `assess` runs each one's checks without issuing (preview: clear, not clear, already holds it). The
issue makes the batch, then issues each in its own transaction with `batchId` (no PDF of its own), a failure left out
with its message, then queues `certificate_batch_doc` — a worker renderer printing each certificate's frozen data
through its version, a page each, in order, with the logo, signatures and its QR. The principal's reason applies to
those whose checks fail; "already holds" stays out.

**Awards** (`certificate-awards.service.ts`): the master (set-up right; the type must be a student type switched on;
names unique); allotments one by one or from a CSV (admission_no, award, event, position, date dd-mm-yyyy or
yyyy-mm-dd, remarks; quoted fields; a heading row skipped; every line checked, nothing saved with an error, a check
only when asked); issue: the chosen allotments not yet issued, a batch a type, each with its award's fields; the
allotment keeps its certificate (removed only before).

**The achievement module moved in**: `POST /engagement/certificates` numbers each by
`app.next_certificate_no('ACHIEVEMENT', …)` (it was a count of the year's rows, which could repeat) and writes its
register row; reprinting one gives its batch PDF.

**Registers and reports** (`certificate-reports.service.ts`): the TC book register (book, Sl. No., TC no., date,
student, last class, reason, copies, status; filters book, status, dates, text; pages; Excel / PDF with the
letterhead); the reports of a period (the school year so far by default): by type, by month, by issuer, issued past a
check, requests with the days to issue, the public checks — each as Excel / PDF.

**API**: `POST /certificates/bulk/preview`, `POST /certificates/bulk/issue`, `GET /certificates/batches[/:id]`, `GET
/certificates/awards`, `POST|PUT /certificates/awards[/:id]`, `GET|POST /certificates/allotments`, `POST
/certificates/allotments/import`, `POST /certificates/allotments/issue`, `POST /certificates/allotments/:id/remove`,
`GET /certificates/tc-book[/file]`, `GET /certificates/reports[/file]`.

**Screens** (from the register's header): **Bulk issue** (type, a section or the leavers, purpose, the type's
fields for all; the preview with six figures and each student's checks; Issue; earlier batches), a batch's page
(figures, the batch PDF, issued in order, left out with the reason), **Awards** (who received them with filters,
tick and issue; add one; from a CSV; the awards and a new one), **TC book**, **Reports** (dates, six figures, five
tables each with Download).

Tests: `certificates-office.e2e-spec.ts` (6: the preview in roll order with one holding it; the batch — issued in
order, the holder left out, one PDF, no PDF of their own; the principal's reason in bulk and the office refused; the
awards, a CSV with errors then clean, issue by type, numbers, no second issue, no removal after; the achievement
module's numbers and register rows and its batch PDF; the TC book and the reports with every file).

## As built — phase F, from the old system (14 Nov 2026)

**Gate for E.** Every item of phase E was built and tested (bulk issue, the batch PDF, awards, the achievement
module moved in, the TC book register and the reports).

**Data** (migration 0388). `certificate_cutover` (one row a school: when a read was asked, started and finished, its
error, the counts, the old TC book's last Sl. No., the map of old names to types, when and by whom the certificates
were brought and the counts; RLS, audit); `certificate_legacy_rows` (the old register's rows as read, by `srno`; RLS);
a unique index on `certificates (school_id, legacy_ref)` where set, so a certificate is brought once — a duplicate
keeps it on the original only. A standalone template `cert_legacy` ("from the old system": the holder, the type, the
number, the date, the old fields as label and value, a line saying where it comes from) is pushed to each school and
not offered as a type's layout.

**The read** (workers, `processors/legacy-certificates.ts`, maintenance job `certificate.legacy_read`): the
connection comes from the server's environment only — `LEGACY_CERT_DB_URL` (or `_<SCHOOL CODE>`), else the leave
cut-over's `LEGACY_LEAVE_DB_URL`, as payroll does; without one, the page says to ask IT. Reads `certificate_master`
in pages by `srno` and the old TC book setting, read only; replaces the school's holding rows; the log carries counts,
never a name.

**The bring** (`certificate-legacy.service.ts`): the rows grouped by name (a staff row's name marked "(staff)") with a
guessed type (TC, bonafide, character, DOB, study, fee paid, caste, domicile, NOC, visa, experience, service, the
award types …) and the
school's own map; the person by admission no. or employee code; a dry run counts without saving. Each certificate comes
with its old number, date, year (from the financial year), serial (the number's last digits), book and Sl. No.,
`legacy`, `legacy_ref 'legacy:<srno>'`, the `cert_legacy` version and the old fields as `legacyFields`; one the old
system deleted comes cancelled ("Deleted in the old system"); one already here is left. Then
`certificate_series` takes the greater of its own and the old last number per type and year, and
`certificate_book_series` the greater of its own, the old setting and the highest Sl. No. read. The count check: read
= brought + left out with no type or no person.

**API** (set-up right): `GET /certificates/setup/legacy`, `POST /certificates/setup/legacy/read`, `PUT
/certificates/setup/legacy/map`, `POST /certificates/setup/legacy/bring` (`dryRun`, default true).

**Screens**: set-up section **4. From the old system** → a page with six figures and five steps: read (last read,
the error, Read the old register), each old name with its rows, deleted, person found and a searchable type
(Not brought), the check run and Bring (asks first), the numbers that carry on (type, year, old last, next here) and
the TC book, the count check. The register marks them "Old system"; the public check says it comes from the old
system.

Tests: `certificate-legacy.e2e-spec.ts` (5: the groups with guessed types and the right; the dry run, a bad type
refused, a mapped name; the bring — old numbers, book and Sl. No., a deleted one cancelled, a staff one, the old
fields, a duplicate, never twice, the next TC, bonafide and book number after the old ones; the reprint from the old
record and the public check; the count check and a read asked); workers `legacy-certificates.test.ts` (2: the
connection from the environment with the leave fallback; nothing read without it, and why).

## Completion check (15 Nov 2026)

Every phase checked against the plan, item by item. Two loose ends closed:

- **No loose certificate prints.** `POST /platform/templates/:id/render` refuses (409 `template.certificate`) a TC or
  bonafide template, any `cert_*` layout and any template a certificate type prints with: a certificate is issued,
  numbered and checked in the register (decision 1). The editor's preview stays; letters and receipts still print.
  `daily-academics.e2e-spec.ts` now expects the refusal and prints a letter instead.
- **The asker's notices are tested.** `certificate-requests.e2e-spec.ts` checks that the parent is told in the app
  (push) when the request is approved and when the certificate is ready.

## Certificate types, rebuilt (16 Nov 2026)

The user found the types list and a type's page confusing: one long table with a template column repeating the
name and checks in shorthand; a type's page of six open cards with two saves, every template as a tick-box,
all 36 roles as possible issuers (parents, students, wardens), classes typed as codes and placeholders in the
help. Chosen (both recommended): a grouped list, and a type's page as a summary with folds.

- **API**: `GET /certificates/setup` gives each type its next number this year (`nextNumber`, as
  `app.next_certificate_no` makes it), issued this year, requests waiting and its request settings, and the figures
  `online`, `withFee`, `issued`, `issuedYear`, `toFix` with the year's code. `GET /certificates/setup/types/:code`
  adds the same figures, the classes of the school (students' types) and, on each role, `issues` — whether it holds
  `certificate.register.issue`.
- **The list**: six figures; search and filters (for, status); student and staff certificates in two tables
  (certificate with its next number, checked before issue and asked for online in words, issued this year and in
  all, status with "no layout", "n waiting", "some roles", "school's own", an Edit button); **Add a type** in a
  dialog — the code is made from the name (kept apart from the codes used).
- **A type's page**: six figures; **Basics** open; folded with a one-line summary: Layout (the layout, See and edit,
  the other layouts kept by a tick, one added from a list; a school's copy is marked), Checks before issue (radios
  for the state and how many, the clearances, all classes or ticked ones), Who may issue it (everyone who issues, or
  only some of the roles that issue — the others are not offered), Asked for online (as before; the level rows are
  searchable with arrow and bin icons), Details asked at issue, More (note, place in lists, the fixed code). One
  sticky **Save changes** posts both parts (the type, then its request settings). A part closed over a field the
  browser stops at opens itself (`OpenOnInvalid`).

Tests: `certificates-setup.e2e-spec.ts` (unchanged, 7); a browser pass at 1440 and 375 px with axe on both pages and
the dialog, the filters, Edit, the issuing roles only, and Save's posted fields caught and stopped (DOB, board
registration with its classes, bonafide with its other layout, the TC's checks and two levels) — nothing saved.

## Certificate templates, rebuilt (16 Nov 2026)

The user found the templates list and a template's page confusing: one table of 26 with "Ready layout" on 23 rows
and three older copies named like ready layouts; technical columns; no way to see a layout without opening it; the
copy form always open. The page led with raw HTML, a "Show the fields and a sample of … Show" form, a preview that
started empty in a narrow column and a field list of code tokens. Chosen (both recommended): a grouped table with
See, and a template's page with the paper first.

- **API**: each template in `GET /certificates/setup` carries its `pageWidth` and `pageHeight`.
- **Admin route** `GET /api/certificates-template-preview?id=` renders a saved layout with a sample of the type it is
  for (the template's `forType`), for See.
- **The list**: six figures (layouts, used by a type, used by none, changed by the school, EduPro's ready, the
  school's copies); a search; "Used by a certificate type" and "Used by no type" (a line: copies and spares, give one
  to a type under Layout); each row: the layout with where it comes from, used by, paper, certificates made, changed
  on, and See (a dialog, `TemplateSample`, fetched when opened), Edit, Copy (a dialog, the name prefilled "… (copy)");
  Make a copy in the header with a pick of any layout.
- **A template's page**: used-by chips linking to the types; Make a copy and Back to the ready layout in the header;
  the editor (`TemplateEditor`, rebuilt): the paper ("How it prints", a sample of the chosen type, sticky on a wide
  screen, first on a narrow one, the frame in the paper's shape) and the edit panel — name, paper, the wording with
  Insert a detail (a searchable list by plain name, the token small), EduPro's blocks and bold / new paragraph / line
  break as buttons; styles under Advanced; one sticky Save that says what it does ("Saving makes version n";
  "Nothing changed yet"); leaving with unsaved changes asks first; the first picture comes at once. Versions folded
  below.

Tests: a browser pass at 1440 and 375 px with axe on both pages and the dialogs: the groups and the search; See shows
the paper; Copy prefills the name; Insert a detail by "father" at the cursor, a block and bold; Save enabled only
after a change and says the version — nothing saved.

## A certificate's PDF opens straight away (16 Nov 2026)

The register's eye went to the export's download, and a certificate PDF older than the exports' seven days had been
cleared, so the user landed on the export's page instead of the PDF. A certificate is a record, not a report export:

- **Kept for good**: a certificate's PDF (`queue`, the PDF call) and a bulk batch's print get `expires_at` 100 years
  ahead; migration 0389 keeps those not cleared yet.
- **`POST /certificates/:id/pdf`** (certificate view right): the kept PDF (`ready`), the one being made, or — cleared,
  failed or never made — made again from the frozen paper. A certificate moved in from the achievement module gets a
  page of its own (renderer `certificate`, its achievement record) rather than the batch's file: a batch prints only
  the certificates linked to its file, so a remade batch file came out blank. `POST /reports/exports/:id/again` on a
  `certificate_batch` file moves the batch's certificates to the new file.
- **Workers**: a finished file keeps the later of its own `expires_at` and the usual days (it used to reset to seven
  days, undoing "kept for good").
- **Admin** `GET /certificates/:id/pdf` (`?save=1` to save): straight to the PDF when ready; otherwise
  `/certificates/:id/opening`, which waits and replaces itself with the PDF (`OpenWhenReady`). The register and a
  certificate's page (its PDF and its copies) link there; "Make the PDF" links are gone. The page's **Make it again**
  button went too (16 Nov): it remade the same frozen paper, so nothing changed and it read as broken; opening the PDF
  makes it when it is missing, and once more for one made before the QR. Its words change only by a re-issue with
  today's settings.

Tests: `certificates.e2e-spec.ts` (the PDF kept 100 years; cleared, made again once and the register pointing to it;
ready, it opens; another school's: not found); a browser pass on the links and the opening step (nothing made on
Alpha).

## Re-issue with today's settings (16 Nov 2026)

A certificate freezes its paper at issue, so a signatory set two minutes later did not show on BON/2026-27/00001; the
user asked for a button to make it again with the current settings.

- **Data** (migration 0390): `certificates.reissue_of` (unique where set: one re-issue each).
- **`POST /certificates/:id/reissue`** (issue right; `reason`): the original only (400 on a duplicate), once (409
  `certificate.already_reissued`); an issued one needs the cancel right too. It issues a new certificate — the same
  type, person, purpose, layout (a variant still offered) and fields — through `issue` with `beforeIssue` (the cancel,
  "Re-issued with today's settings: …", inside the issue's own transaction, so the "one a person" check sees it gone)
  and `reissueOf`. A failed check or a missing field rolls both back. One issued past a failed check carries its
  override reason: if the check still fails, the override right and a fresh sign-in are asked as at issue.
- **The row** carries `reissueOf` and `reissuedAs` (`{id, number}`).
- **Admin**: on a certificate's page, "Duplicate, re-issue or cancel" has **Re-issue with today's settings** (a reason;
  the dialog says what happens); a cancelled original not re-issued has **Issue again with today's settings**; the
  details show "Re-issue of" / "Re-issued as"; the register marks **Re-issue** / **Re-issued**; a fresh sign-in, when
  asked, comes back to the certificate.

Tests: `certificates.e2e-spec.ts` (refused without the issue right; a new number with the new signatory title and foot
line; the earlier one cancelled, pointing to it, its paper unchanged; once only; not a duplicate; one past a failed
check: refused to the office with nothing changed, re-issued by the principal with the reason carried).

## Bulk issue to several classes and sections, or departments (16 Nov 2026)

Asked: issue class and section wise with several picked at once, for students or employees. Chosen (all recommended):
one tick list, one PDF per section (Download all as a ZIP), unticking students in the preview; staff by a departments
tick list (in service or who have left).

- **Data** (migration 0391): `certificate_batches.run_id` (UUID): the batches of one run.
- **API**: `GET /certificates/bulk/sections` (classes of the selected year with their sections and the students on the
  rolls in each), `GET /certificates/bulk/departments` (each department, "" for none, with employees in service and
  who have left). The bulk scope takes `sectionIds` (class, section, roll order; each row knows its section) or, for a
  staff type, `departments` + `staffState`; a staff type takes only departments and a student type never
  (`assertAudience`). `POST /certificates/bulk/run` (`only`: the ticked; the principal's `overrideReason` for ticked
  ones not clear): a batch per section or department (the leavers or chosen students: one), each through `run` (own
  numbers, own transactions, its PDF kept for good), sharing a run id. `GET /certificates/runs/:runId` (the batches,
  their PDFs, figures) and `GET /certificates/runs/:runId/zip` (every batch PDF, named by its title; 409 while one is
  being made). At most 600 (`BULK_MAX`) at a time.
- **Admin**: the bulk page — `BulkScopePicker` (the certificate; students: classes and sections or the leavers;
  staff: departments, in service or left; search; All; counts; the chosen total), the preview's `BulkPreviewTicks`
  (ticks; tick all clear / untick all; the principal's reason when a ticked one is not clear; "Issue to n ticked") —
  and `/certificates/runs/:runId` (figures; each batch with View / Download as its PDF is made, refreshing until all
  are; Download all (ZIP)).

Tests: `certificates-office.e2e-spec.ts` (the tick list's counts; a preview of two sections in class, section and
roll order; a staff type refused for sections and a student type for departments; a run with one unticked — a batch
per section, only the ticked; the run's page; the ZIP refused while a PDF is being made, then a file per section;
staff: departments with in service / left, a batch per department, those who have left). A browser pass at 1440 and
375 px on the pickers, the preview ticks, the run page (a throwaway run), the issue's posted ticks caught and
stopped — nothing issued on Alpha.

## Issue: the person from a dropdown that follows the certificate (16 Nov 2026)

The issue page asked "Find the student" with a Find button and a reload, and still said "student" for a staff type;
the user asked for the person to be a dropdown according to the certificate.

- **API**: `GET /certificates/students` and `/certificates/employees` take an empty `q` (the first 50: students on
  the rolls in class, section and roll order; employees in service) and an optional `type`: those its rule wants come
  first (`state: leaving` — a TC, an experience certificate — those who have left or whose withdrawal is cleared or
  complete). Students also match a class ("VI-A", "Class VI – A"); employees a designation or department.
- **Admin**: `IssuePicker` (step 1): the certificate (student types, then staff) and a combobox labelled Student or
  Employee — opens on click, filters as you type through `GET /api/certificates-people`, arrow keys and Enter, each
  row with its number and class (designation · department) and **Left**; choosing one loads the checks and the paper.
  The picker starts afresh when the certificate changes (`key` = the type).

Tests: `certificates.e2e-spec.ts` (an empty list with those on the rolls first; by class; a TC wants the one who has
left first; employees listed; one letter allowed). A browser pass at 1440 and 375 px: the dropdown follows the
certificate, filters by class, keyboard choice loads the preview, a staff type lists employees (not the students of
before) — nothing issued.

## Re-issue with changes (16 Nov 2026)

A re-issue copied the purpose and the typed details, so a mistake there meant cancel and issue again; the user asked
for a re-issue with changes.

- **API**: `POST /certificates/:id/reissue` (`ReissueDto`) also takes `purpose` ("" prints none), `fields` (all of
  them), `issuedOn`, `variant` and a new `overrideReason`; what is not sent stays as on the certificate. The preview
  and issue take `reissueOf`: the "one a person / a year" check (`exceptId`) does not count the certificate being
  replaced. A refused value (a detail not in its list …) leaves both as they were.
- **Admin**: on a certificate's page **Re-issue with changes** (a cancelled original not re-issued: **Issue again with
  changes**) opens the Issue page with `reissue=<id>`, the type, the person, the purpose, its layout and the typed
  details: the title and a note say what happens; the certificate and person are fixed; the checks, fields and paper
  as for an issue; a required reason; **Re-issue with these changes** posts to the re-issue (`changes=1`), and a
  refusal or a fresh sign-in comes back to the same page. The detail carries its template's id for the layout.

Tests: `certificates.e2e-spec.ts` (a one-a-person type: the preview holds without `reissueOf` and not with it; a value
outside the list refused with nothing changed; purpose, a typed detail and the date corrected; the old cancelled and
linked). A browser pass at 1440 and 375 px from the button to the filled page and the posted changes (stopped).
