# 44 — Admission portal Messages by type, Payments by registration, Registrations as a list (plan, 25 Oct 2026)

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

Two more pages were asked for in the same round:

- **Payments & receipts** (`/<school>/admission/payments`) lists "Due now" and "Receipts" across all the
  family's registrations; a family with two children cannot see what belongs to which.
- **My registrations** (`/<school>/admission/registrations`) shows a card per registration; the form
  PDF cannot be taken from there.

The best portals show payments per registration (child, class, number) with its total, paid and due,
and the registrations as a list with the form downloads in the row.

## Decisions (asked and answered, 25 Oct 2026)

| #   | Question       | Decision                                                                                                                                                                    |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Grouping       | **Tabs by who sent it**: All · From the school · Automatic updates · Notices, each with its unread count; a channel badge on every item                                     |
| 2   | Answers        | **From the school**, marked "Answer to your question" (or "Reply to your enquiry") with a link to the question                                                              |
| 3   | SMS / WhatsApp | **One item with channel badges** ("Email · SMS"); an SMS-only message is its own item with the SMS text                                                                     |
| 4   | Extras (all)   | Link to the registration; filter by child; search; "Mark all as read" acts on the tab shown                                                                                 |
| 5   | Payments       | **A section per registration**: child · class · registration no.; total fee, paid, due; its dues with Pay, its receipts with View / Download; the family's total at the top |
| 6   | Registrations  | **A list (table)**; View + Download icons for the registration form once submitted and the admission form once admitted; none for a draft                                   |

Defaults taken (change on request): the tab and filters are in the address (`?tab=school&child=…&q=…`)
so Home's links and the back button keep them; the child filter shows only with two or more
registrations; search covers subject and text; a notice for every candidate shows under every child.

## Parts

**Part 1 — What each message is (API; built 25 Oct 2026, no migration needed).** As built: the variables every admission
message already keeps carry the tag (`_origin` status / answer / enquiry_reply / enquiry_invite /
enquiry_ack, `_app`, `_query`, `_nid` shared by the email and SMS copies), so no function changed and no
migration was needed. Every caller passes it: the status emails their registration and code, the helpdesk answer its query and
registration, the enquiry reply its origin. The family's inbox returns each item with `group`
(`school` | `automatic` | `notice`), `channels` (every channel the same message went by), `origin`,
the registration (`id`, candidate, class) and a `link` (the registration's tab to act on, the
question, the admit card); messages sent before 0249 are placed from their template code (compose →
school, `admission_*` → automatic) and the registration found from the address and the time. Filters
`group`, `applicationId`, `q`; unread counts per group; mark all read per group.

**Part 2 — The Messages page (portal; built 25 Oct 2026).** Tabs All · From the school · Automatic updates · Notices with
their unread counts; a channel badge row on every item ("Email · SMS · WhatsApp"); "Answer to your
question" / "Reply to your enquiry" marks with a link; each automatic update shows the child and class
and a button to the place to act (Pay, Admit card, Correct the form, Open the question); a child filter
(two or more registrations) and a search box; "Mark all as read" for the tab shown. Home's latest
messages and the header's unread badge use the same groups. Hindi throughout; a phone layout where the
tabs scroll sideways.

**Part 3 — Payments by registration (portal; built 25 Oct 2026).** At the top the family's totals (due now, paid). Then a
section per registration, latest first: the child, class, session and registration number; its fee
figures (registration fee and admission fee: amount, paid, due); its dues with Pay (or "Closed"), and
its receipts as a table with View / Download. A registration with nothing paid or due shows a line, not
an empty table. Uses `/me/dashboard` as it stands.

**Part 4 — My registrations as a list (portal; built 25 Oct 2026).** A table: child, class (and session), registration
number, status, filled (for drafts), fee due, and the actions — Continue / Open, the registration form
(View + Download) once submitted, the admission form (View + Download) once admitted, Delete for a
draft. On a phone each row stacks into a card. The existing PDF routes serve the files.
