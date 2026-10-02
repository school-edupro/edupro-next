# 23 · Communication v2 (2026-10-02)

Benchmark: Entab CampusCare, Teachmint, Fedena, MyClassboard. Decisions taken with the school:
MSG91 + Meta WhatsApp Cloud + SMTP / SES, keys per school; "send to" chosen per message; monthly
usage + credits statement; configurable approval rule; rich-text + HTML-source editor; outside
contacts saved as groups; office-only sending; attachments PDF / image with an admin-set size.

## Model (migrations 0050–0052)
- `comms_groups.kind` student | employee | student_teacher | external | mixed; `mode` static | rule; `rule` JSON.
- `comms_group_members` keyed by person (`person_type`, `person_id`): student, employee, guardian, contact, user.
- `comms_contacts`: outside people with extra columns as `{{variables}}`.
- `comms_templates`: `format` (html email), `category`, WhatsApp `wa_template_name` / `wa_language` /
  `wa_params` / `wa_header`.
- `message_requests`: `channels[]`, `send_to`, `rule`, `upload`, `subject`, `body_format`,
  `attachments`, `needs_approval`; audiences `filter` and `upload` added.
- `comms_messages`: `message_request_id`, `format`, `units`, `cost`, `read_at`, `attachments`, `params`.
- `comms_providers` (keys encrypted with the field key, never returned), `comms_settings` (approval
  threshold + exempt roles, quiet hours, attachment MB, rates, low-balance), `comms_credits`.

## Flow
1. `audience.ts` resolves everyone / classes / sections / routes / rule / groups / individuals /
   upload into people, then expands students by send-to (family primary contact from the profile,
   both parents, the student's own mobile / email, or both), applies consent and duplicates.
2. `RequestsService` checks templates and attachments, decides approval, and dispatches in batches of
   500: rendered body (HTML email in the school frame; WhatsApp parameters), SMS units and cost.
3. The worker resolves the school's provider (`Msg91Adapter`, `MetaWhatsAppAdapter`, per-school SMTP),
   adds attachments (bytes for email, signed link for a WhatsApp header) and records the result.
4. Webhooks: `/comms/webhooks/msg91?token=` (shared token) and `/comms/webhooks/meta` (verify token,
   `X-Hub-Signature-256` with the school's app secret); "read" sets `read_at`.

## Screens
Dashboard `/comms`, Compose, Groups (+ detail with search, Excel dry run, rule editor), Template master
(SMS / WhatsApp / email tabs, HTML editor with variable picker and live preview), Requests (per channel,
read), Reports (usage statement, failures, delivery log; Excel / PDF), Providers and settings (keys,
test send, rules, credits).

## Part 2 (migration 0053)
- Gateways of the legacy ERP: smsbhejo.org (`submitsms.jsp`, user / key / senderid / entityid / tempid)
  and the Mobilise EMS WhatsApp bridge (bearer key, inline base64 header), next to MSG91 / Meta / SMTP.
  Keys are typed by the school in Providers and settings (encrypted); none are in the repository.
- A provider row with `active = false` switches the channel off: compose refuses it, the worker fails
  queued messages at once ("switched off") without retries.
- Variables: school variables (`comms_variables`), values asked once at send time (`askValues` from the
  preview), Excel columns, and computed per student (`computedStudentValues`: fee due by head, last
  payment, attendance this month, latest exam).
- Messages inbox in the parent / student app (`/messages`, header badge) and the teacher app: messages
  to the person's login, own mobile / email, as a parent, or the family contact of a child; read marks in
  `comms_inbox_reads`.
- The "Message templates" and "Groups" grids left Communication setup (duplicates of the Template master
  and Groups); template Excel import / export stays as a hidden master opened from the Template master.

## Part 3 (migration 0055)
- Push: Firebase (FCM) per school (`comms_providers` channel push, service account encrypted; web config +
  VAPID key served to the apps by `/comms/push/config`). Apps register device tokens (`push_devices`) from
  the Messages page; the worker's `FcmAdapter` signs in with the service account (JWT) and sends FCM v1
  webpush; dead tokens are revoked. Events the admin switches on (`comms_settings.push_events`):
  school_message, attendance, fees, transport, queries, notices, homework, approvals.
- Approval: one step, any one of the chosen roles / named employees (`any_of` resolver on the
  `message_approval` workflow), set in Communication settings.
- The message as recipients get it is stored on the request (`preview`) and shown to the approver in
  My inbox and on the request page (`GET /comms/requests/:id/preview`).
- Opted-out families get nothing on that channel (decided: no in-app copy).

## Not yet
WhatsApp → SMS fallback on failure, two-way inbox for WhatsApp replies, per-teacher sending (decided
office-only), template sync from Meta / DLT portals.

## Part 4 — Delivery log, statement and 6-month dashboard (2026-10-02)

- **Delivery log** (`/comms/messages`) reads the `comms_delivery_log` dataset a page at a time
  (`GET /comms/reports/comms_delivery_log?page=&size=` returns `total`). Opens on today; From–To
  (India time; a From date alone runs to today), channel, status, rows per page and one search box
  matching mobile, email, student / parent name and admission no. Each row shows the student
  (name, class-section, admission no.) found through `message_request_recipients.student_id`, or the
  student whose login received it.
- **Excel at once**: `GET /comms/reports/:id/xlsx` builds the workbook in the API (school, title,
  filters, then the table in India time, auto-filter, message text wrapped), so Excel no longer
  waits for the workers service. PDF still goes through the export queue (Chromium in workers).
- **Counts are downloads**: every count on the dashboard (6-month table, this month's cards) and
  the usage statement links to `/api/comms/report/comms_delivery_log?month=|from=&to=&channel=&bucket=`
  with `bucket` = all (not cancelled, no push) / delivered / failed / pending / read.
- **Usage statement**: dates bound in India time; the channel filter now applies to messages and
  credits. **Dashboard**: `trend` = six months to the chosen month × SMS / WhatsApp / email
  (count, delivered, read, failed, pending, units, ₹), shown as a stacked bar chart and a table
  with totals.
