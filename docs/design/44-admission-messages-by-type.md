# 44 — Admission portal Messages by type (plan, 25 Oct 2026)

The admission portal's Messages page (`/<school>/admission/messages`) shows three kinds of thing in one
list, told apart only by a small "Notice / Email / Message" tag:

- **notices** for candidates (Communication → Notices);
- **messages written by the school** (Communication → Compose to candidates; one entry per message, the
  email copy preferred over SMS / WhatsApp);
- **automatic emails** of the admission (form received, registered, fee paid, schedule / admit card,
  offer, admitted, correction asked, late-entry passcode) — and, sent the same way, the office's
  **replies to enquiries** and **answers to Ask the school** (docs/design/43, parts 3 and 4).

The automatic emails do not say which registration they are about, and answers cannot be told from
other automatic emails (all go through `app.admission_notify` with the `admission_message` template).

What the best ERPs do (Entab, Edunext, MyClassboard, Teachmint): tabs with unread counts — all, from
the school, automatic status alerts, notices; a badge for the channel; a child filter for families with
more than one; search; each status alert names the child and links to the place to act; answers link
back to the question.

## Decisions (asked and answered, 25 Oct 2026)

| #   | Question       | Decision                                                                                                                                |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Grouping       | **Tabs by who sent it**: All · From the school · Automatic updates · Notices, each with its unread count; a channel badge on every item |
| 2   | Answers        | **From the school**, marked "Answer to your question" (or "Reply to your enquiry") with a link to the question                          |
| 3   | SMS / WhatsApp | **One item with channel badges** ("Email · SMS"); an SMS-only message is its own item with the SMS text                                 |
| 4   | Extras (all)   | Link to the registration; filter by child; search; "Mark all as read" acts on the tab shown                                             |

Defaults taken (change on request): the tab and filters are in the address (`?tab=school&child=…&q=…`)
so Home's links and the back button keep them; the child filter shows only with two or more
registrations; search covers subject and text; a notice for every candidate shows under every child.

## Parts

**Part 1 — What each message is (API, migration 0249).** `app.admission_notify` (and
`app.admission_mail`) take an optional `p_meta JSONB` kept in `comms_messages.variables`:
`{ "origin": "status" | "answer" | "enquiry_reply", "applicationId", "queryId", "code" }`. Every caller
passes it: the status emails their registration and code, the helpdesk answer its query and
registration, the enquiry reply its origin. The family's inbox returns each item with `group`
(`school` | `automatic` | `notice`), `channels` (every channel the same message went by), `origin`,
the registration (`id`, candidate, class) and a `link` (the registration's tab to act on, the
question, the admit card); messages sent before 0249 are placed from their template code (compose →
school, `admission_*` → automatic) and the registration found from the address and the time. Filters
`group`, `applicationId`, `q`; unread counts per group; mark all read per group.

**Part 2 — The Messages page (portal).** Tabs All · From the school · Automatic updates · Notices with
their unread counts; a channel badge row on every item ("Email · SMS · WhatsApp"); "Answer to your
question" / "Reply to your enquiry" marks with a link; each automatic update shows the child and class
and a button to the place to act (Pay, Admit card, Correct the form, Open the question); a child filter
(two or more registrations) and a search box; "Mark all as read" for the tab shown. Home's latest
messages and the header's unread badge use the same groups. Hindi throughout; a phone layout where the
tabs scroll sideways.
