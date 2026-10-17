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
