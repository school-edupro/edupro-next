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

## Corrections that keep the number (16 Nov 2026)

Some schools do not change a certificate's number on a correction. Chosen (all recommended): the school decides in
set-up; revisions with a change log; a small "Revised" line on the paper.

- **Data** (migration 0392): `certificate_settings.corrections_keep_number` (default off), `certificates.revision`
  (1 as issued) and `revised_at`, `certificate_revisions` (the paper of each revision — data, version, purpose, date,
  its PDF — and how it came: reason, `changes` [{label, from, to}], by, at; revision 1 is written at the first
  correction from the certificate as issued; RLS, audit).
- **API**: `POST /certificates/:id/correct` (`ReissueDto`: reason and what is corrected) — refused when the setting
  is off (409 `certificate.corrections_new_number`), for a duplicate (400), a cancelled one (409) or one with no
  template version (old system, achievement module: re-issue). In one transaction it builds the paper as an issue
  would (`reissueOf` sets it aside for the one-a-person check; the checks are shown, not a bar; a missing or wrong
  detail refuses), keeps the number, book, Sl. No. and QR, stamps `cert.revision` / `cert.revisedOn`, writes the
  revision with its changes (`changesOf`: purpose, date, layout, each typed detail, the person's printed details,
  who signs, the foot line), updates the certificate and queues its PDF (kept for good; the revision row takes it).
  The detail carries `revisions` and `correctionsKeepNumber`; the row `revision` / `revisedAt`. The foot block
  prints "Revision n · corrected on …" for n > 1. The public check returns `revision` / `correctedOn` and a search
  by number matches the date of any revision.
- **Admin**: the set-up switch (Signatory and print); on a certificate, with the switch on, **Correct this
  certificate** (the Issue page with `correct=<id>`: title, note, fixed person, the checks not a bar, a reason, "Save
  as revision n"); the details' **Revision** line; a **Changes** fold — each revision with when, who, why, what
  changed and its PDF; **Rev n** in the register; the public check's "Corrected on … · revision n". A refused
  correction or re-issue link shows its reason and no issue form.

Tests: `certificates.e2e-spec.ts` (refused while the setting is off; revisions 2 and 3 keep the number with the
purpose and the date corrected; the log 3, 2, 1 with its changes; the paper's revision; the public check corrected and
the first date still matching; a duplicate after it carries the correction; a duplicate is not corrected); the db
blocks test (the foot line). A browser pass on the switch and a refused correction link (the "on" pages were not
looked at on Alpha: switching it on there was not done).

## The parent app's Certificates page, rebuilt (17 Nov 2026)

The page was a request form on top, then three lists (requests, "Issued by the school", "Awards and achievements") with
a PDF button that reloaded the page with a notice. Chosen (all recommended): ready first, then requests, then ask; the
ask list with fee and who decides; one list with awards marked.

- **API** (`certificate-requests.service.ts`): `GET /certificate-requests/mine` — each type carries `decidedBy` (its
  levels in words: the office, the class teacher, the principal, a role's name); each certificate `purpose`,
  `revision`, `award` (ACHIEVEMENT / MERIT / PARTICIPATION / AWARD), `awardText` (award · event · position) and
  `achievementId`; the list now takes the achievement module's certificates moved into the register (no template
  version, `legacy_ref achievement:<id>`). `POST …/mine/certificates/:id/pdf` returns `{exportId, ready}`: the
  certificate's kept PDF when it is its own file (`certificate_doc` / `certificate`, no other certificate on it) and
  ready, queued or running; otherwise a new one — an achievement-module certificate gets its own page (`certificate`
  renderer, its achievement record). `GET …/mine/exports/:id` opens the asker's own exports and a kept certificate
  PDF of their child (or their own) only when no other person's certificate shares the file: a class batch's PDF is
  never handed to a parent.
- **Parent app**: `/api/certificate-pdf?id=&kind=&save=` — straight to the PDF (View) or its save link (Download)
  when ready, else to `/certificates/opening` (`OpenCertificate` polls `/api/certificate-export` and opens or saves it
  in place; a minute's wait says the school is still making it; a failure links back). The page: three figures
  (ready, in progress, to pay); **Your certificates** — register and achievement records merged (an achievement
  record already in the register is not listed twice), newest first, an **Award** badge, `FileLinks` (`inPlace`:
  Download is a plain link, since it may pass through the opening step); **Requests** — open ones with a step line
  (`ep-pcert-track`; Fee only when there is one) and Pay the fee (amount × copies) / Withdraw, closed ones in
  **Earlier requests**; **Ask for a certificate** — one bordered list of `<details>`: name, who decides, up to three
  purposes, the fee (Free / ₹x a copy); the form (purpose, copies, note, fee line, Send) opens under the tapped one
  (`?ask=<code>` opens it after a refused send); `AskSearch` past five. The old `?export=` / `?cexport=` links go to
  the opening step; `registerCertificatePdf` is gone. Hindi for every new string. Styles `ep-pcert-*` in app.css.

Tests: `certificate-requests.e2e-spec.ts` (decidedBy; the certificate's purpose, revision, award; the kept PDF reused
on every open; an achievement batch to a class lists only the parent's child, once, marked; the batch PDF refused to
the parent; their own page made from the achievement record; another child's refused). A browser pass on Alpha as the
demo parent at 1440 and 375 (axe clean; no sideways scroll; View and Download redirect to the kept PDF; another
family's id goes back with a message; the ask search; a step line drawn on the page only — the demo family has no
open request, and none was made on Alpha).

## "Used by no type" says what is still in use (17 Nov 2026)

The user asked what separates "Used by a certificate type" from "Used by no type". A layout used by no type is never
picked when a certificate is issued, but some are still in use elsewhere and looked spare. Chosen: say so on the row.

- **API**: each layout in `GET /certificates/setup` and `GET /certificates/setup/templates/:id` carries `screenMade`
  (certificates the achievement certificates screen printed with it — it picks a layout itself) and `tcMade` (TCs
  that print with it: a TC with this template and no register certificate with a template version, i.e. issued
  before the register).
- **Admin**, the list's Used by: **Old-system reprints** (`cert_legacy`: no type may use it, keep it); **Achievement
  certificates screen** (n printed, a link to Parent engagement → Achievement certificates, keep it); **TCs from before
  the register** (n, a link to People → Transfer certificates, keep it); otherwise **No type**. A layout a type uses
  adds "Also …" for either count. Certificates made counts all three. The earlier default layouts (`tc_default`,
  `bonafide_default`) read "The layout used before the certificate register". The group's line says some are still in
  use. A layout's page shows the same as chips. Links inside the note are underlined (axe link-in-text-block).

Tests: `certificates-setup.e2e-spec.ts` (a TC from before the register: `tcMade` 1 in the list and on the layout's
page), `certificates-office.e2e-spec.ts` (an achievement batch of three: `screenMade` 3, `made` 0, no type). A browser
pass at 1440 and 375 px, axe clean (Alpha: the reprint layout, Merit certificate — 8 from the achievement screen, the
earlier TC layout — 3 TCs; read only).

## Use for a type, from the templates list (17 Nov 2026)

The user asked why "Tesrt" and "Achievement certificate 2026" were not in the Issue page's list: that list is of
certificate types, and a layout reaches it only through a type (its layout, or one of its variants); both were used by
no type. Chosen: a **Use for a type** button on those rows; and, on Alpha, the user's go-ahead to offer "Achievement
certificate 2026" for the Achievement certificate type as a choice (done through the button: the type keeps its layout,
the copy is its one variant).

- **API**: `POST /certificates/setup/templates/:id/use` (`UseTemplateDto`: `typeCode`, `as` main | choice, optional
  `label`; set-up right). In one transaction, the type row locked: the template must be a certificate layout of the
  school and not the reprint layout (400, `assertTemplates`); an unknown type 404; already its layout, or already a
  choice, 409 `certificate.layout_in_use`; ten choices at most (400). `main` sets `template_id` and drops it from the
  variants; `choice` appends `{templateId, label}` (the layout's name). Audit `certificate.type.layout`. Returns the
  type's and the layout's names.
- **Admin**: on each row used by no type (not the reprint layout), **Use for a type** opens a dialog — the type (a
  searchable list; the type whose name is inside the layout's name chosen for you; staff and not-in-use types marked),
  How (a choice at issue, the default / every certificate of the type), a line to give a layout to its own kind —
  and Use it, back to the list with what changed. The "Used by no type" line says why issuing does not offer these.

Tests: `certificates-setup.e2e-spec.ts` (a copy offered as a choice — the type keeps its layout, the issue preview
offers both, twice refused; then made the main layout — it leaves the choices and the earlier layout is used by no
type; the reprint layout 400, an unknown type 404, the office 403; set back). A browser pass at 1440 and 375 px with
axe on the dialog (the type guessed, choice first), then the change on Alpha and the Issue page's Layout list with both.

## The person's printed details, typed at issue (17 Nov 2026)

The user asked for the TC's points 1–8 (name, parents, nationality, SC/ST/OBC, first admission, date of birth, class
last studied) in "What it prints", filled from the student's data and all changeable. Chosen (both recommended): a
change goes on **this certificate only** (the record untouched; the certificate keeps both), and the boxes are **what
the layout prints**, for every type, students and staff alike.

- **API** (`certificate-person.ts`): `PERSON_DETAILS` — each printable detail by where a layout reads it
  (`student.*`, `tc.lastClass` / `lastClassWords`, `employee.*`) with a label and text/date; the admission number and
  employee code stay as in the record, the pronouns follow the record's gender. `printedDetails(body, audience)` reads
  the chosen layout's wording for them, in the order it prints them, the name first and the ID numbers (PEN, APAAR,
  SRN, board registration) last; the date of birth goes with its words. `applyPerson` puts the boxes' values on copies
  of the record's data: a value that differs from the record is printed and kept in `printed` {label, record,
  printed}; a changed date of birth changes its words unless they were typed; a date as yyyy-mm-dd or dd-mm-yyyy
  ("…: a date" otherwise); the name not empty; the guardian asked only when there is no father's name (the layouts
  print "father, else guardian"). `build()` applies it for both audiences (the checks and `b.person` stay on the
  record); `PreviewBase.person` / `ReissueSchema.person` (path → value); the preview returns `personDetails` (path,
  label, kind, value, record, changed); the issue keeps `data.printed` and logs it in the audit's `after.printed`;
  a re-issue (with today's settings or with changes) and a correction carry the printed changes unless new ones are
  given; the change log labels the person's details by the catalogue and adds the TC's class last studied.
- **Admin**: Issue → What it prints: **From the student's record** (or employee's) — a line on what it is, then a box
  each (`per_<path>`, travelling in the address with Update the preview and posted with Issue / Re-issue / Correct);
  a changed box amber with "Changed for this certificate · the record: …"; then "<type>: the details for this
  certificate" and the type's fields. Picking another person starts a fresh address (nothing typed carries over). A
  certificate's page: **Changed from the record** (detail, printed, the record) when any; Re-issue / Correct links
  carry them.

Tests: `certificates.e2e-spec.ts` (a TC's boxes: the paths, the name first, ID numbers last, no guardian with a father,
the date as yyyy-mm-dd with the record's dd-mm-yyyy; a date of birth certificate with the father's name and the date
changed — the paper, `data.printed` with the words following, the audit, the record unchanged, a re-issue carrying
them; an empty name and a wrong date refused); `certificates-setup.e2e-spec.ts` (a service certificate: the employee's
designation and joining date changed on the paper only). A browser pass on Alpha at 1440 and 375 px (axe clean; the TC
boxes for a student; a change marked and printed after Update the preview; Issue caught before it reached the server —
nothing issued).

## A check not clear keeps the paper back (17 Nov 2026)

The user found "3. What it prints" and the preview shown for a TC whose withdrawal was not complete. Chosen
(recommended): hide them until the checks are clear for whoever may not issue past a check; the principal (override
right) still sees them with "Why it is issued anyway".

- **API**: the preview carries `withdrawal` {id, leavingOn} (the student's latest open or done withdrawal) or null.
- **Admin** (Issue): when a check fails (or the person already holds it) and the user may not override — `blocked`,
  not for a correction — section 3 and the preview are not shown; under the checks a "Not clear yet" note says they
  show once the checks are clear or the principal issues it with a reason, and for a TC the next step: **open the
  withdrawal** (`/people/withdrawals/:id`, whose departments clear fees, library, hostel and transport) or **start
  the withdrawal on the student's page** (`/people/students/:id?tab=status`).

Tests: `certificates.e2e-spec.ts` (the TC preview's `withdrawal` null with none). A browser pass at 1440 and 375 px,
axe clean: a test school's certificate office (no override; its school switched on for the run and off after) sees the
note and the start link, no section 3 and no preview; dev-admin on Alpha (override) still sees both for student 12247.
None of Alpha's demo logins issues without the override right.

Follow-up (17 Nov 2026): the user, as Dev Admin (school admin, who may issue past a check), still saw section 3 for
a TC not clear. Chosen (recommended): keep them back **for everyone** while a check is not clear (or the person holds
it); whoever may issue past a check gets **Issue it anyway, with a reason** (`?anyway=1#what-it-prints`, kept by
Update the preview and after a refused issue), which opens section 3, the preview and the reason box, and **Keep it
back until the checks are clear** to close them. `anyway` counts only with the override right and no "already
holds it" (typed by hand it opens nothing for others; the API still asks the right and a fresh sign-in). A browser
pass: dev-admin on Alpha (Navya Iyer's TC) — held back, opened, kept open by Update the preview, closed; a clear
bonafide shows at once; a test school's certificate office — no button, `anyway=1` opens nothing; axe clean at 1440
and 375 px.

## Certificates from Excel (17 Nov 2026)

The user: after the Class XII result, the school issues the TCs in bulk from an Excel sheet with every detail; the same
for the other certificates; a sample sheet made for the chosen certificate; upload, generate, verify. Benchmark (the
leading school ERPs): a template per certificate, filled with the class list and what the records know, drop-downs for
list answers, a check before anything is committed with a row-level report and an errors file to fix and upload
again, the clean rows committed in order (register numbers, a PDF per class, a ZIP), an upload history. Bulk issue
before this gave everyone the same typed details. Chosen (all recommended): a sheet filled with the class list; TC
rows without a withdrawal start withdrawals from the upload; issue the clean rows and fix the rest; every type, the
sheet built per type.

- **Data** (migration 0393): `certificate_imports` — type, title, scope, the last file's name, uploads, the sheet's
  columns, the rows (JSONB: the cells by heading, the person found, the section or department, state ready /
  attention / issuing / issued, what to fix, whether a withdrawal may be started, what it issues with, the
  certificate and number), the runs made from it. Tenant RLS; no row-change audit (up to 600 rows a write) — the
  events are audited: `certificate.import.upload`, `certificate.import.issue`.
- **API** (`certificate-imports.service.ts`, `CertificateImportsController` at `/certificates/imports`, the issue
  right): `POST sheet` (a bulk scope → the .xlsx as base64): columns — the key (Admission no. / Employee code), name
  and class or department (not read), Date of issue, Purpose (not a TC), Layout (a type with variants: a drop-down),
  the type's fields (`fieldsOf`: required red, list drop-downs, dates and whole numbers formatted), the person details
  every layout of the type prints (`printedDetails`; a heading like a field's gets "(as printed)"); rows filled from
  `CertificatesService.sheetData` (the builder in `noChecks` mode) — dates as dates; a How to fill sheet. `POST`
  (upload: type, title, scope, file) → read (`readSheet`; dates yyyy-mm-dd / dd-mm-yyyy / dd/mm/yyyy; whole numbers;
  list answers matched; an empty cell left to the record) → checked: the person by key, a second row of them, then
  `assess` with the row's fields and person details (problems + checks not clear); a TC row (`rules.state` leaving)
  whose state check fails and has no withdrawal → `startWithdrawal`. `POST :id/upload` (a corrected sheet: its rows
  replace the same people's rows not issued, others kept, all re-checked), `POST :id/verify`, `GET :id/errors` (the
  rows needing attention with "What to fix", the same columns, to upload again), `POST :id/issue` (the ready rows
  marked `issuing` under a row lock — a second press finds none — then `CertificateBulkService.issueInGroups`, a batch
  a section or department in one run, each with its own fields and person details; a row refused at issue goes back
  with why), `GET` (the last 50 uploads with figures), `GET :id`. Bulk issue's run refactored onto `issueInGroups`;
  `targets` public; the builder's `noChecks`; `layoutsOf`.
- **Admin**: Bulk issue → **From Excel — each with their own details** (`/certificates/imports`): 1. Download the
  sheet (`BulkScopePicker mode="sheet"` → `/certificates/imports/sheet`, a route streaming the file), 2. Upload the
  filled sheet (certificate, name, file → `uploadCertificateSheet`, files up to 700 KB — the API body is 1 MB), Earlier
  uploads. An upload's page (`/certificates/imports/:id`): six figures; What to do — Issue the N ready (confirm),
  Download what to fix, Upload a corrected sheet (dialog), Check again, and for TC rows without a withdrawal **Start
  the withdrawals for N** (leaving date, reason → `POST /people/withdrawals/bulk` with those students, then a re-check;
  with the withdrawal right, else a note); the runs (their PDFs and ZIP); the rows with tabs (Need attention, Ready,
  Issued, All): row, person, state, what to fix or the certificate, **See the paper** (the Issue page filled with the
  row's details).

Tests: `certificate-imports.e2e-spec.ts` — the TC sheet (headings, filled from the record, the conduct drop-down, no
purpose, How to fill), a bonafide's purpose, a staff sheet by employee code, a student type refused departments, the
issue right; an upload of six rows (a missing reason, a wrong date, a typed mother's name, Bina twice, an unknown
admission no.) — nothing issued, each row's problems, four withdrawals to start; withdrawals started and cleared,
checked again (a reason left empty now the withdrawal's); the errors file; a corrected sheet into the same upload; the
four ready issued in one run (TC/2026-27/00001–4, one batch, the typed mother's name printed); nothing to issue twice;
the list. Sizes on Alpha: 150 students → a 43 KB sheet in under half a second. A browser pass: Alpha (dev-admin) —
From Excel from Bulk issue, a TC sheet downloaded, axe clean at 1440 and 375 px, nothing saved; a throwaway test
school (switched on for the run, off after) — a bonafide sheet downloaded, uploaded (two ready, one who left), the
upload's page axe clean, the two issued with the run linked.

## The public check for people only (17 Nov 2026)

The user: the open check page (`<public>/alpha/verify`) should be used by people, not bots or AI agents; it is rate
limited; suggested a CAPTCHA. Found: the page called the API from the public app's server, so every visitor came with
that server's address — the "10 a minute per address" was 10 a minute for everyone together (one bot could lock out
all, and no bot was singled out); the same for the public admission, consent and careers forms. Benchmark: Cloudflare
Turnstile (strongest against scripts and automated browsers, no ad tracking), Google reCAPTCHA (familiar; Google
tracks the visitor — consent under DPDP), self-hosted proof-of-work (no third party; a speed bump); no CAPTCHA stops
every modern AI agent driving a browser, so the leaders layer a human check, per-visitor limits, locks on wrong
guesses, small answers, no indexing and refusing declared AI crawlers. Chosen by the user: **Google reCAPTCHA** (v2
checkbox), the check on the **QR too**, and (recommended) **per-visitor limits with locks on wrong guesses**.

- **API**: `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET` (env; the secret in Key Vault in production; both or neither).
  `HumanCheckService` (certificates module, with its own `PowService`): `config()` → reCAPTCHA with the site key, or
  EduPro's proof-of-work; `verify(answer, ip)` → Google's siteverify (secret, answer, the visitor's address; 5 s; a
  failure 400 `human-check.failed`, Google unreachable 503 `human-check.unavailable`) or the challenge consumed once;
  `assertNotLocked` / `missed`: a visitor 5 not-found checks in 15 minutes → 429 `verify.locked` for 15 minutes; a
  certificate number 5 not-found searches in an hour (from anyone, whether or not it exists — no oracle) → 429
  `verify.number_locked`. Routes: `GET :school/verify` and `GET :school/verify/:token` give only `{school, check}`;
  `POST :school/verify` (number, date, the answer; 10 a minute a visitor) and `POST :school/verify/:token` (the
  answer; 30) give the result after the lock and the check. The test app trusts one proxy hop as `main.ts` does.
- **Public app**: `lib/visitor.ts` — the visitor's address (the last X-Forwarded-For entry the ingress added, or
  X-Real-IP) passed on as X-Forwarded-For by `call()` and by the route handlers of the OTP, admission, careers,
  consent and challenge calls; `lib/words.ts` (t / Lang, safe in the browser; `lib/api` re-exports them).
  `components/VerifyCheck.tsx` (client): the number and date (or, for a QR, nothing more), Google's box (loaded with
  the page's nonce; reset after each check) or the proof-of-work on Check, `POST /api/certificate-check` (a route
  passing the answer and the address on), the result shown on the page — nothing in the address. Both verify pages
  are `noindex`; `middleware.ts` refuses declared AI agents (GPTBot, ClaudeBot, PerplexityBot, CCBot, Bytespider …)
  on the verify pages and the check call with 403 and sends `X-Robots-Tag: noindex` there; `app/robots.ts` disallows
  `/*/verify` and `/api/`; the page CSP allows Google's reCAPTCHA frame (`frame-src`), route handlers none.

Tests: `certificate-verify.e2e-spec.ts` (the pages give no answer; no check / a check used twice refused; QR and search
after the check; the old address with the number answers nothing; a visitor locked after five misses while another is
not; a number rested after five wrong dates from five visitors; a visitor's minute limit), the register and legacy
suites' public checks, `human-check.service.spec.ts` (reCAPTCHA with keys — Google asked with the secret, the answer
and the address; no answer, a failed one, Google unreachable; proof-of-work without keys; the locks). Browser: the
search and the QR page on Alpha with EduPro's check at 1440 and 375 px (axe clean; nothing in the address; Hindi);
with Google's published test keys on a temporary API run, the box shows and Check without the tick is refused (the box
was not ticked); from outside: GPTBot / ClaudeBot 403, `X-Robots-Tag`, robots.txt. Alpha runs EduPro's check until
the school's keys are set.

## The Board exam registration form, and layouts for students or staff (17 Nov 2026)

The user shared a school's Class XII Board-exam registration circular (a real document: its structure and wording
only were used; no name, number or school name copied) to add to Templates, and asked how a certificate for students
differs from one for staff. Chosen (all recommended): a new built-in student type with its ready layout; Aadhaar
only masked to the last four digits; fill what the record holds and leave the rest as lines; mark and filter each
layout for students or staff.

- **Data** (migration 0394): `app.certificate_types_seed` gains **BOARD_FORM** "Board exam registration form" —
  STUDENT, prefix BEF, rules `{state: active, classes: [X, XII]}`, one a year, sort 86 — seeded for every school.
  Not asked for in the apps (the office prints it for a class).
- **Student data** (`studentData`): `sex` (M / F), `mobile` (the primary guardian's, else the profile's SMS or
  WhatsApp number), `email` (the profile's, else the guardian's), `familyIncome` (₹ with Indian grouping),
  `cwsn` (Yes — kind / No), `singleChild` (when recorded), `minority` (from the religion: the six notified
  minorities → "Yes — <religion>", else No), `aadhaar` / `fatherAadhaar` / `motherAadhaar` (decrypted only to mask:
  `maskValue(…, 'digits12')` → XXXX-XXXX-1234; the full number is never in a certificate's data), `subject1`…`5` and
  `additionalSubject` (the student's subjects of the year, else the class's compulsory ones). The person-detail
  catalogue lists them all (a typed Aadhaar is masked by `applyPerson`); detail paths may hold digits
  (`student.subject1`); the name is always the first box. The editor's Insert a detail adds "Contact and family" and
  "Subjects of the year".
- **Fields** (TYPE_FIELDS.BOARD_FORM): year of the Board examination (default: the academic year's end, 2026-27 →
  2027), last date to return the form, examination fee (printed as written), note.
- **Layout** `cert_board_form` (A4): letterhead; Ref / CIRCULAR / Dated; the intro box; "Candidate's details" and
  "Subjects offered" as four-column tables under a bar; blanks (`.bf-line`) where the record holds nothing; the
  parents' signature lines and date; the note; EduPro's signature boxes and QR.
- **For students or staff**: `audienceOf(types' sides, body)` — the side of the types using a layout, else what it
  prints (`student.*` / `tc.*` → students, `employee.*` → staff, neither or both → null); the templates list and a
  layout's page carry `audience`; a layout's page offers sample types (and Insert a detail) of its side only. Admin:
  a For students / For staff / Either badge on each layout, All / For students / For staff tabs, Use for a type
  offers only that side's types, the layout's page shows "For: Students / Staff".

Tests: `certificates-setup.e2e-spec.ts` (22 types, 24 ready layouts; the form for a Class XII student — filled from
the record, Aadhaar of the child and father masked and never in full, minority "Yes — Sikh", income ₹4,50,000, the
guardian's mobile; a typed mother's Aadhaar masked; a Class VI student refused by the class check; layouts marked for
students / staff and a staff layout's page offering staff types only), the register count, the db templates test (24).
A browser pass on Alpha: the tabs (30: 26 for students, 3 for staff), the staff filter, axe clean at 1440 and 375 px;
the form previewed for a Class X student (not issued). Alpha's new layout was brought to the latest ready version with
Back to the ready layout (version 2; version 1 in its history).

## A paper that is not valid says so; the TC card opens the certificate (17 Nov 2026)

The user's ask: a certificate cancelled, rejected or pending prints a watermark saying so. Decided (buttons, the
recommended each time): a word by state; the clean PDF made before a cancel is replaced everywhere; the word shows on
screen and on paper.

- **The word.** `packages/db` `certificate-blocks.ts`: `certificateMarkHtml(mark, note)` and `CERTIFICATE_MARK_CSS`
  (rotated, faint red, boxed; `position: fixed` so a two-page paper has it on each page; inside `.eb-mark-host` — one
  page of a batch PDF — it stays on that page; appended after the template's CSS with `!important` so a layout cannot
  hide it). Words: CANCELLED (+ "Cancelled on dd-mm-yyyy"), PENDING, REJECTED, NOT ISSUED.
- **Renderers (workers).** `certificate-doc` (the register's), `certificate-batch-doc` (a run's section, per page),
  `certificate` (achievement certificates, by their register row `achievement:<id>`; the class file per pupil) and
  `document` (an old TC from its template, by `transfer_certificates.status`) print CANCELLED with the day.
- **Previews (API).** `paperHtml(..., mark)`; `preview()` reads the request (`requestId` now on the preview DTO, the
  admin Issue page passes it): submitted/approved → PENDING, rejected/withdrawn → REJECTED, else NOT ISSUED; the
  layout preview → NOT ISSUED. The preview returns `mark`.
- **Cancel retires the clean PDFs.** `cancelRows` → `retirePdfs`: the certificate's own finished PDFs (each revision's,
  the TC's) get `expires_at = now()` — no longer handed out, swept by the expiry job — and `export_id` is cleared, so
  View / Download makes it again, marked. A run's section PDF or an achievement class file holding it is made again at
  once (`ReportsService.remakeIn`, in the same transaction: new export, links moved, the old retired); the run's ZIP
  takes the new file. A PDF still being made needs nothing (the workers read the cancel). An old TC never in the
  register: its clean PDF is retired on cancel too (`TcService.cancel`). Reports: an export `ready` but past its
  `expires_at` reads `expired` (no download; Make again allowed).
- **Catch-up (0395).** Certificates cancelled before today: their clean PDFs (and old cancelled TCs') retired, a run's
  section PDF holding one made again (exports + `jobs_outbox` rows). On Alpha: 372 PDFs retired, 3 section PDFs made
  again (2 on Alpha, 1 on a test school) — checked: the cancelled page carries CANCELLED, the next page clean.
- **The student's TC card (Status tab).** The TC number opens its certificate; the PDF column is View / Download of the
  certificate itself (`/certificates/:id/pdf`; the export's own download when the register right is missing); the
  "Generate PDF" (document template) form is gone. TC rows carry `certificateId` (the original's register row). The
  TC list (People → Transfer certificates) does the same.

Tests: worker `certificate-marks.test.ts` (each renderer, issued vs cancelled, a batch's own page, CSS after the
template's); db mark unit tests; e2e — the preview's NOT ISSUED, PENDING while a request waits (and once approved),
REJECTED for a rejected or withdrawn one; a TC cancel retires its PDFs (export `expired`, no download, a fresh PDF on
open); a run's section PDF made again on a cancel (the other section untouched, the ZIP waits); an achievement class
file made again with the others following; the TC row's `certificateId`.
