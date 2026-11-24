# 24 — Helpdesk: parent queries, staff queries, ERP provider tickets (2026-10-02)

## Decisions (asked and answered)

- Escalation by **SLA hours per query head**; on escalation the ticket is **reassigned + mailed + app push**;
  the earlier owner keeps seeing it.
- The SLA clock counts **school working days and hours** (Helpdesk set-up), skipping holidays / vacations
  in the school calendar (a `working_day` entry makes a holiday working).
- **Assignee closes** with a resolution; the person who raised it may **reopen within N days** (default 7),
  which restarts the clock at the current level. Raiser rates the handling.
- Leave requests are **not** part of the helpdesk (their own module; `kind = 'leave'`, no SLA).
- The **ERP provider is set up per school** by the admin: name, support email, senior person and email,
  hours per priority; provider staff get a login with the role `erp_support` and answer in EduPro.
- Hypercare issues and the old employee queries are **merged** into the provider / staff desks.

## Model (0056–0058)

- `parent_queries` is the ticket table for three desks (`desk` = parent | staff | provider) with `level`,
  `due_at`, `escalated_at`, `breached_at`, `priority`, `module`, `provider_status`, `resolution`,
  `reopened_count`; `query_responses` the conversation (files on every message, internal notes);
  `query_events` the timeline (created, assigned, replied, note, escalated, breached, closed, reopened,
  rated, status).
- `query_categories` are the **query heads** per desk: owner = class teacher (parent desk) / role /
  named employee / provider, `sla_hours`; `helpdesk_levels` the matrix (level 2–6, hours at the level,
  role / employee / email only, extra emails). `helpdesk_settings` per school.
- Triggers route a new ticket to its owner (class teacher found through `teacher_assignments`) and set
  `due_at = app.helpdesk_add_hours(opened_at, hours)`; a family's reply after an answer restarts the clock.
- `app.helpdesk_escalate_due()` moves every unresolved ticket past `due_at` to the next level (or, on the
  provider desk with no matrix, mails the senior person) and marks the last level's miss `breached_at`;
  mails and pushes go through `comms_messages` + the outbox. Workers run it every 5 minutes
  (`helpdesk.escalate`); admins can run it now from set-up.
- `provider_issues` (view) keeps the hypercare screens and digest working on the provider desk.

## Visibility

viewall (admins) → everything; provider support → the provider desk; others → raised by me, assigned to
me or a role I hold, owned earlier, or parent queries of my sections (engagement.query.view scope);
families → their children's queries.

## Screens

Admin: Parent engagement → Helpdesk dashboard (6 months per desk, every count an Excel), Parent queries,
Staff queries, ERP provider tickets, Helpdesk set-up, Leave requests. Teacher app: Queries (to answer,
leave requests, my requests) + raise staff query / ticket to the provider. Parent app: attachments on
raise and reply, attachment links, resolution, reopen.

## Help for families (0406, 21 Nov 2026)

The parents' and students' **Help** page (website `/help`, app Help) is the school's own, kept on **Helpdesk set-up
→ Help for families** (the helpdesk set-up right, `helpdesk.settings.manage`). The user's decisions: on Helpdesk
set-up (no new menu entry); every school starts with the standard questions as its own, editable; each question is
for parents, students or both; headings, a search box, "Was this helpful?" and a button to the screen an answer is
about.

- **Model** (`family_help_headings`, `family_help_questions`, `family_help_votes`, `family_help_settings`): headings
  and questions in the school's order, English with Hindi optional (the English shows where no Hindi), audience
  `both | parent | student`, `page` (a family screen of `@edupro/menus`, not Home or Help), hidden, soft-deleted;
  `standard_key` marks the standard ones. A school's first use of Help (the office or a family) puts in the six
  standard headings and ten questions (`family_help_settings` once); **Restore the standard questions** puts back
  any deleted (each last in its place). Deleting a heading moves its questions to **Other questions** (no heading,
  last).
- **Families** (`GET engagement/help?for=parent|student`; without `for`, a login whose memberships here are all
  student reads the students'): shown questions for them, without those about a screen they cannot open (the same
  rights as the menu, `familyScreens`), empty headings dropped; each with the person's own vote. A vote
  (`POST engagement/help/:id/vote`, `{helpful}`) is once per person per question, a second vote replaces the first;
  hidden questions take none.
- **The office** (`helpdesk/family-help`: list with `pages` and `standardMissing`; headings and questions add /
  change / delete / move up or down; `restore`): the Yes / No counts are the votes since the answer (English or
  Hindi) last changed — a new answer starts them again. Every change is in the audit trail
  (`helpdesk.family_help.*`).
- Tests: `apps/api/test/family-help.e2e-spec.ts`.

## Help for staff (0422, 24 Nov 2026)

The staff's **Help** (staff website `/help`, staff app Help) is the school's own too, kept on **Helpdesk set-up → Help
for staff** beside Help for families (the same right). The user's ask: the staff app's Help a screen of its own (no web
page), managed from Helpdesk set-up like the families' questions. Before, the staff website's Help was a fixed list in
the page.

- **Model**: the same tables with `app` (`family` | `staff`) on headings and questions; a staff question's heading is a
  staff heading and its `page` a screen of the staff menu (`STAFF_MENU`, plain paths, not Home or Help); `audience`
  stays `both` (every staff member). `staff_help_settings` marks a school's first use: the four standard staff headings
  and nine questions (the old fixed list, with Hindi; "Something is broken" now points to a ticket to the ERP provider
  under Queries, and the language answer covers the app) go in once; **Restore** puts back deleted ones.
- **Staff** (`GET engagement/staff-help`, staff only — a membership here as an employee; a parent, who may raise
  queries too, gets 403 and reads the families' Help): the shown staff questions without those about a staff screen
  their rights do not open (`staffScreens`; a screen opened when work waits counts as open), under headings; votes as
  the families' (`POST engagement/help/:id/vote`).
- **The office**: `helpdesk/staff-help` (list with `pages`, `standardMissing`), `helpdesk/staff-help/headings`,
  `helpdesk/staff-help/questions`, `helpdesk/staff-help/restore`; a staff heading or question is changed, moved and
  deleted by the routes by id under `helpdesk/family-help/...` (the service reads its `app` from the row). The admin
  editor is one component for both (`HelpEditor`, `app` in every form); the staff one has no "For" choice. Audit
  actions `helpdesk.staff_help.*`.
- Staff website `/help` and the staff app's Help (`HelpScreen` with a staff profile) read it: headings that fold, a
  search, **Open <screen>** (the app's own screen), "Was this helpful?"; the next step for anything else is a staff
  query.
- Tests: `apps/api/test/staff-help.e2e-spec.ts`; app `test/assistant_help_test.dart` (staff Help).
