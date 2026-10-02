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
