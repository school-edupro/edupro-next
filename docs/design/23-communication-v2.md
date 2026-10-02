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

## Not yet
WhatsApp → SMS fallback on failure, two-way inbox for WhatsApp replies, per-teacher sending (decided
office-only), template sync from Meta / DLT portals.
