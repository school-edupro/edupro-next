# Consent forms (plan, 17 Oct 2026)

A school asks families and staff for consent and information: a trip, an olympiad, photo and media
use, medical details, a staff declaration. Each form is designed by the office, sent to an audience,
answered in the parent app, the staff app, by the office on behalf of a family, or on a public link,
and read back as a register with Excel and PDF. A form may carry a fee and may need approval.

Reference: the legacy "Consent Forms Builder" (PHP, a dynamic table per form). EduPro keeps one table of
forms and one of responses (answers as JSON keyed by field), which upgrades the small Sprint 19 feature
(Engagement → Consent forms; its tables only hold test data).

## Decisions (user, 17 Oct 2026)

- **Who answers:** parents (one response per child), staff, a public link or QR (no login), and the
  office on behalf of a family (a paper form typed in).
- **Fee:** through the **misc fee ledger**. A response raises a misc fee for the pupil (fixed amount,
  or calculated from the answers), with a last date to pay. Online, counter, part payments, bounce,
  refund, approval levels and receipts are the misc fee's own.
- **Approval:** optional per form; when on, responses go through levels like other approvals.
- **Wanted from the legacy module:** show / hide / require rules and calculated fields; edit after
  submit until a date; webhooks and API tokens; analytics.
- **Notify on publish:** app push and inbox, SMS / WhatsApp, email (no automatic reminders).
- **Repeat:** set per form: once per child or staff member (default), or several, with an optional
  total cap that closes the form.
- **Option lists:** built-in school lists (classes, sections, houses, transport routes, departments).
  The legacy raw-SQL "option sources" are not carried over.
- **Design:** Mobilise design system on every screen.
- **Delivery in four parts**, each tested and shown:
  1. builder, audience, responses from the parent app, staff app and office, register with Excel/PDF,
     publish with notification;
  2. fee through misc fees, approval levels, edit after submit;
  3. public link and QR with OTP to view or edit, analytics;
  4. webhooks and API tokens.

## Part 1

### The form

- **Title, description** (shown above the fields), a **code** made from the title, a **success
  message**.
- **Who answers:** families (about a pupil), staff, or both. Later: public.
- **Audience** (families): every pupil, or classes, sections, houses, transport routes, boarders, or
  pupils by name. **Audience** (staff): every member, or departments, designations, staff by name.
- **Window:** opens on and closes on (date and time; empty = open while published).
- **Repeat:** once per pupil / staff member, or several; an optional **total cap** closes the form when
  reached.
- **Office may fill on behalf** (default on).
- **Status:** draft → published → closed (reopen allowed) → archived. Only a draft's fields can change
  freely; once answers exist, fields can be added or their wording changed, never removed or given
  another type (old answers keep their meaning).

### Fields

Types: short text, long text, number, email, phone, date, time, single choice (buttons), drop-down,
several choices (ticks), yes / no, file (PDF / image), **signature** (drawn on screen), **agree**
(a box to tick with a statement), a **section heading** (text only) and a **page break** (steps).

Each field: label, help, required, placeholder; for numbers min / max; for text a length; choices typed
in or taken from a school list. **Rules:** show, hide or require a field when ALL / ANY conditions on
other fields hold (equals, not equals, contains, greater / less, one of, empty, not empty). The server
applies the same rules: a hidden field's answer is dropped and a rule-required field is checked.

### Answering

- **Parent app → Consent forms:** forms for each child, "to answer" first with the closing date;
  answered ones show the reference and can be opened (and printed).
- **Staff app → Consent forms:** forms for the staff member.
- **Admin → the form → Fill on behalf:** pick the pupil (or staff), fill, the response says "entered by
  the office".
- Each response gets a number **CF/<session>/000001** and a PDF copy (form, answers, signature, who and
  when).

### Register and downloads

The form's page: counts (asked, answered, pending, response rate), tabs **Answered** and **Not yet
answered** with filters (class, section, search), each response opened in full, **Excel** (one column
per field) and **PDF**; a pending list to download.

### Notify on publish

On publish (and on demand with **Notify again** for those not yet answered), the office picks the
channels: app push and inbox (always available), SMS / WhatsApp / email through the school's message
templates and the usual message approval.

## Data (migration 0166)

`consent_forms` gains: `respondents` (family / staff / both), `audience` (the rule), `settings`
(window, repeat, cap, office fill, success message), `published_at`, `closed_at`, `version`; status
draft / published / closed / archived. `consent_form_responses` gains: `number`, `employee_id`,
`respondent` (family / staff / office / public), `entered_by`, `files`, `status`, `updated_at`; the
one-per-pupil rule moves to the service (several allowed when the form says so).

## Part 2 (17 Oct 2026, migration 0168)

Decisions (user): the fee is raised after approval when the form needs approval, else on submit;
approval levels are set per form, the pupil's class teacher being a new kind of approver; an answer may
be changed until the form's edit date and only before it is decided, a change of fee refused once
something is paid, every edit kept; publish and reminders may also send SMS / WhatsApp / email with the
school's templates.

- **Fee** (builder section 5): none, fixed, or worked out from the answers (a base, a rate per unit of a
  number question, a price per option of a choice or yes / no). Raised on the pupil as a misc fee: one
  misc fee per form (head "Consent forms", code CONSENT, last date: the form's own, else the closing day,
  else two weeks), one line per pupil carrying the sum of the pupil's live answers' fees. Paid online
  (parent app: Pay on the form) or at the misc counter; receipts, bounce and refund are the misc fee's.
  Staff answers never carry a fee.
- **Approval** (builder section 6): off, or up to five levels: the pupil's class teacher (new workflow
  resolver `class_teacher`, from `teacher_assignments`; the school admin when the section has none), a
  role, or a named staff member. Each form has two workflow definitions (`consent_form_<id>` for answers
  about a pupil, `consent_form_<id>_staff` without class-teacher levels; none left = staff answers need
  no approval), kept in step with the form and hidden from Approval set-up. Approvers act in the staff
  app (Answers to approve), on the response page in admin, or in My approvals. The last level approves
  or rejects: approved raises the fee; the family is told in the app with the note.
- **Change an answer** (section 4, "Answers may be changed until"): in the parent and staff apps while
  the form is published, before the date and before the answer is decided. A signature and files stay
  unless replaced. The fee is worked out again; if anything is paid on the pupil's line a different fee
  is refused. Every earlier version is kept (`consent_form_response_versions`) and shown on the
  response page.
- **Channels**: Publish and "Remind those not yet answered" take a template per channel (SMS,
  WhatsApp, email); one message request goes to the parents of each pupil and to the staff not yet
  answered, through the usual message approval. A refusal (channel off, template unusable) is reported
  and never stops the publish.
- **Register**: approval status (waiting with whom / approved / not approved) and fee / paid columns,
  a filter by approval, the same in Excel / PDF.
- API: `PUT /engagement/mine/consent-forms/responses/:rid`, `GET /engagement/mine/consent-approvals`,
  `POST /engagement/mine/consent-approvals/:stepId {decision, note}`, `POST
/engagement/consent-forms/:id/notify {channels}`, status with `channels`.

## Part 3 (17 Oct 2026, migration 0169)

Decisions (user): the link serves outsiders (name, mobile or email, a one-time code before the answer
is accepted) and families without the app (admission number, the code to the mobile the school has on
file); fees on the link only for families (misc fee, paid online); outsiders pay no fee for now.

- **Builder section 7**: Public link and QR, for families and / or outsiders. The link is
  `<public site>/<school>/consent/<secret>`; **Make a new link** stops the old link and QR.
- **The link page** (public site, no login): the form's text, then sign-in: a parent gives the admission
  number (the code goes to up to two family mobiles on file; a pupil not asked by the form is refused);
  an outsider gives a name and a mobile or email (the code goes there). A proof of work before each code,
  three live codes, five attempts, ten minutes; the pass is a two-hour HttpOnly cookie for this form
  only. Signed in: the answers with their status, Print / PDF, Change my answer (until the edit date,
  before decided), Pay (a family's fee, through the misc ledger's gateway), and the form when one more
  answer is allowed. Files are uploaded to slots tied to the form; signatures are drawn.
- Answers on the link are marked "Link" in the register (an outsider by name and mobile / email); a
  decision is told by SMS / WhatsApp / email (template `consent_decision`); the code goes out with
  `consent_otp` (both seeded for every school, editable under Communication > Templates).
- **Analytics** (form → Analytics): asked / answered / pending / responses / fee raised and paid;
  answers per day; how they answered (parent app, link, staff app, office, outsiders); approval;
  response rate by section; each choice question counted, numbers totalled (total, average, least,
  most).
- API: `public/consent-forms/:school/:token` (info, `otp`, `otp/verify`, `me`, `responses`,
  `responses/:rid` (PUT), `responses/:rid/pdf`, `responses/:rid/pay`, `uploads`);
  `engagement/consent-forms/:id/qr`, `/public-link`, `/analytics`.

## Part 4 (17 Oct 2026, migrations 0170-0171)

Decisions (user): a webhook sends submitted, changed, approved, not approved and fee paid; API keys per
form, read or read+approve, optional end date, shown once and kept hashed, 60 calls a minute; only the
answers go out (number, the pupil's name / admission no. / class, a staff member's name / code, an
outsider's name with the contact masked; answers, status, fee; files and signatures as names only); set
up by the school admin only (new permission `engagement.consent_form.integrate`).

- **Connect** (form page → Connect; school admin): webhooks (address, events, on / off, Send a test,
  New signing secret, Remove), the last 50 messages with their status and Send again, and API keys
  (who uses it, read or read and approve, valid until; Revoke). A secret or key is shown once, through a
  one-minute HttpOnly cookie (never in the address).
- **Webhook messages** are queued in `consent_webhook_deliveries` when the event happens (same
  transaction) and delivered by the workers every minute (`consent.webhooks`, only schools with
  messages due): POST JSON with `X-EduPro-Event`, `X-EduPro-Delivery`, `X-EduPro-Timestamp`,
  `X-EduPro-Signature: sha256=HMAC(secret, timestamp + "." + body)`; a 2xx within ten seconds
  delivers; else again after 1, 5, 30 and 120 minutes, then failed. Production calls only https
  addresses on the internet. The signing secret is kept encrypted (field crypto). "Fee paid" is sent for
  fees paid online.
- **API** (`/api/v1/consent-api/v1`, `Authorization: Bearer cfk_…`): `GET responses?since&page&size`,
  `GET responses/<number or id>`, `POST responses/<ref>/decision {decision, note}` (read_approve: the
  waiting levels are decided at once in the key's name, the note says "by API key …", then the fee,
  the family message and the webhook follow as in the school). Keys are looked up by hash through
  `app.consent_api_key_lookup`; every call counts on the key (last used, calls).

## Follow-up (18 Oct 2026, migration 0172)

- Message templates `consent_form_new` and `consent_form_reminder` on SMS, WhatsApp and email for every
  school (variables school, form_title, closes_on, link: the public link when on, else the parent app).
  Publish and Remind choose them by default, so publishing tells families on every channel; each channel
  goes as its own message request (one channel switched off does not stop the others) and the notice
  says what became of each. One-time-code and decision templates are not offered in the picker.
- Fix: answering on the public link with a file failed (the file's owner id is text).
- Parent app Consent forms rebuilt: per child, a summary (to answer, waiting for the school, fee to pay,
  answered), tabs To answer / Answered / Closed, a card per form with closing badge (red within two
  days), fee and approval marks, the school's text folded, each answer with status, Pay, Change and the
  PDF copy.
