# Communication and engagement — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

**Messaging**: a bulk message (SMS, WhatsApp, e-mail) is composed for an audience, approved when large, expanded to one
row per person and channel, and handed by a worker to the gateway, which may send receipts; every other module's alerts,
OTP codes and app pushes use the same message table. **Notices**, **gallery**, **consent** (DPDP purposes, privacy
notice) and **consent forms** (trip permission, surveys; optional approval and fee) reach families per year.
The **helpdesk** keeps tickets of five desks (parents, staff, ERP provider, hostel, admission candidates) with an SLA
clock and escalation. The front office keeps **appointments**, the **visitor** register and **gate passes**; the
**clinic** keeps visits, medicine stock and health check-ups. Also: **file movement**, **CCTV requests**,
**feedback**, the families' **Help** page, **push devices** and **birthday wishes**.

## Tables

### Messaging

| Table                        | One row is                                                             | Key columns                                                                                                                                                                                                                                                                                                                                         | For reports                    |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `comms_messages`             | one message to one address on one channel (push: one per device)       | `channel` sms/whatsapp/email/push, `status` (comms_message_status), `recipient_user_id`, `recipient_address`, `template_id`, `message_request_id` (NULL = a single alert), `created_at`, `scheduled_at`, `sent_at`, `delivered_at`, `failed_at`, `read_at`, `units`, `cost`, `attempts`, `last_error`, `created_by`                                 | **main (spine of delivery)**   |
| `message_requests`           | one bulk send composed in Communication → Compose                      | `title`, `status` (message_request_status), `category` service/general, `channels` jsonb (every channel), `channel`/`template_id` (first channel only), `audience`, `targets`, `rule`, `send_to`, `requested_by`, `requested_at`, `decided_at`, `dispatched_at`, `recipients_total`, `recipients_skipped`, `needs_approval`, `workflow_instance_id` | **main (spine of bulk sends)** |
| `message_request_recipients` | one person × channel decision of a dispatched request: sent or skipped | `request_id`, `channel`, `person_type`, `person_id`, `student_id`, `user_id`, `message_id` (set when sent), `skipped_reason` (set when skipped)                                                                                                                                                                                                     | detail                         |
| `comms_delivery_events`      | one gateway receipt for a message (sent / delivered / failed / read)   | `message_id`, `provider`, `external_id`, `status`, `is_read`, `reason`, `received_at`                                                                                                                                                                                                                                                               | history                        |
| `comms_inbox_reads`          | the first time a user opened a message in the app's Messages inbox     | PK `user_id`+`message_id`, `read_at`                                                                                                                                                                                                                                                                                                                | detail                         |
| `comms_templates`            | one wording for one code and channel                                   | `code`+`channel` (unique per school), `name`, `category`, `is_alert`, `status`, `deleted_at`, `format`, `dlt_template_id`, `wa_template_name`                                                                                                                                                                                                       | master                         |
| `comms_groups`               | a named group of people (kept by hand or by a rule)                    | `code`, `name`, `kind`, `mode` static/rule, `rule` jsonb, `deleted_at`                                                                                                                                                                                                                                                                              | master                         |
| `comms_group_members`        | one person in a static group                                           | `group_id`, `person_type`, `person_id`, `user_id`                                                                                                                                                                                                                                                                                                   | master                         |
| `comms_contacts`             | an outside person (vendor, alumnus…) kept for external groups          | `name`, `mobile`, `email`, `extra` jsonb, `deleted_at`                                                                                                                                                                                                                                                                                              | master                         |
| `comms_variables`            | one school variable usable as `{{key}}` in templates                   | `key` (unique per school), `label`, `value`                                                                                                                                                                                                                                                                                                         | internal (settings)            |
| `comms_credits`              | one top-up (or negative correction) of SMS / WhatsApp / e-mail units   | `channel`, `units`, `amount` (rupees paid), `on_date`                                                                                                                                                                                                                                                                                               | main (usage ledger)            |
| `comms_providers`            | the gateway of one channel                                             | `channel` (one per school), `provider`, `config`, `secret` (encrypted), `active`                                                                                                                                                                                                                                                                    | internal (settings)            |
| `comms_settings`             | the school's messaging policy (one row)                                | PK `school_id`; `approval_threshold`, `approval_exempt_roles`, `quiet_from`/`quiet_to`, `rates` jsonb (rupees per unit), `low_balance`, `push_events`                                                                                                                                                                                               | internal (settings)            |
| `push_devices`               | one phone or browser registered for push by a user                     | `user_id`, `app` parent/teacher/mobile, `platform`, `token` (unique per school), `last_seen`, `revoked_at`                                                                                                                                                                                                                                          | internal                       |

### Notices and gallery

| Table            | One row is                                                                                          | Key columns                                                                                                                                                                              | For reports |
| ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `notices`        | one notice, circular or office order of a year                                                      | `academic_year_id`, `kind`, `title`, `audience`, `publish_from`, `publish_until`, `publish_at`, `published_at`, `is_pinned`, `ack_required`, `also_email`, `emailed_count`, `deleted_at` | **main**    |
| `notice_targets` | one class / section / pupil / employee / admission class / admission session a notice is limited to | PK `notice_id`+`target_type`+`target_id`                                                                                                                                                 | detail      |
| `notice_files`   | one file attached to a notice                                                                       | PK `notice_id`+`file_id`                                                                                                                                                                 | detail      |
| `gallery_albums` | one photo album of a year                                                                           | `academic_year_id`, `title`, `event_on`, `audience`, `status`, `deleted_at`                                                                                                              | main        |
| `gallery_items`  | one photo in an album                                                                               | `album_id`+`file_id` (unique), `caption`, `sort_order`                                                                                                                                   | detail      |

### Consent and privacy (DPDP)

| Table                      | One row is                                                                                                                            | Key columns                                                                                                                           | For reports                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `consent_purposes`         | one purpose a person can agree to (comms.sms, comms.whatsapp, comms.email, media.gallery, transport.tracking, ai.assistant, ai.model) | `code` (unique per school), `name`, `channel`, `is_required`, `version` (wording version)                                             | master                              |
| `consents`                 | one recorded choice of one user for one purpose (append-only)                                                                         | `user_id`, `purpose_code`, `status` granted/withdrawn, `version`, `source`, `student_id` (usually NULL), `recorded_at`, `recorded_by` | **main (history; latest row wins)** |
| `privacy_notices`          | one published version of the school's privacy notice                                                                                  | `version` (unique per school), `title`, `published_at`                                                                                | master                              |
| `privacy_acknowledgements` | one user's acknowledgement of one notice version                                                                                      | `user_id`+`notice_version` (unique), `acknowledged_at`, `source`, `ip`                                                                | main                                |

### Consent forms

| Table                            | One row is                                                                | Key columns                                                                                                                                                                                                                    | For reports         |
| -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `consent_forms`                  | one form (trip permission, survey…)                                       | `code` (unique per school), `title`, `academic_year_id`, `respondents` family/staff/both, `status`, `audience` jsonb, `settings` jsonb, `fields` jsonb, `fee_amount`, `misc_fee_id`, `published_at`, `closed_at`, `deleted_at` | **main**            |
| `consent_form_responses`         | one answer to a form (about a pupil, a staff member, or from an outsider) | `form_id`, `number`, `student_id`, `employee_id`, `respondent`, `status`, `answers` jsonb, `signed_at`, `fee_amount`, `misc_line_id`, `instance_id`, `decided_at`, `via_link`, `edits`                                         | **main**            |
| `consent_form_response_versions` | one earlier version of an answer that was changed                         | `response_id`, `answers`, `fee_amount`, `written_at`, `replaced_at`                                                                                                                                                            | history             |
| `consent_form_signatures`        | one signature drawn on screen for one field of an answer                  | PK `response_id`+`field_key`, `png`                                                                                                                                                                                            | detail              |
| `consent_form_shares`            | one user or role a form is shared with                                    | `form_id`, `user_id` or `role_id`, `level` viewer/editor                                                                                                                                                                       | internal            |
| `consent_otps`                   | one one-time code sent on a form's public link                            | `form_id`, `mode`, `address`, `student_id`, `expires_at`, `consumed_at`                                                                                                                                                        | internal            |
| `consent_webhooks`               | one outside URL told about a form's answers                               | `form_id`, `url`, `events`, `active`, `deleted_at`                                                                                                                                                                             | internal            |
| `consent_webhook_deliveries`     | one delivery attempt chain of one event to a webhook                      | `webhook_id`, `response_id`, `event`, `status`, `attempts`, `delivered_at`                                                                                                                                                     | internal (log)      |
| `consent_api_keys`               | one API key opening one form to another system                            | `form_id`, `prefix`, `scope`, `expires_at`, `revoked_at`, `uses`                                                                                                                                                               | internal            |
| `consent_form_sequences`         | the answer-number counter of a year                                       | PK `school_id`+`academic_year_id`, `last_serial`                                                                                                                                                                               | internal (sequence) |

### Helpdesk (parent queries, staff, provider, hostel, candidate)

| Table                    | One row is                                                                                                                                                                                 | Key columns                                                                                                                                                                                                                                                                                                                                                          | For reports                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `parent_queries`         | one ticket on one desk (also the old family leave request)                                                                                                                                 | `number` (unique per school), `desk`, `kind`, `category_code`, `academic_year_id`, `student_id`, `employee_id`, `raised_by_user_id`, `status`, `priority`, `level`, `assigned_role`, `assigned_user_id`, `opened_at`, `first_response_at`, `closed_at`, `due_at`, `escalated_at`, `breached_at`, `reopened_count`, `rating`, `decision`, `hostel_id`, `applicant_id` | **main (spine)**                                                        |
| `provider_issues` (view) | a provider ticket: a `parent_queries` row with `desk = 'provider'`, renamed for the support screens (`title`, `detail`, `severity` s1–s4 from `priority`, `status` from `provider_status`) | `number`, `module`, `severity`, `status`, `assigned_user`, `due_at`, `closed_at`                                                                                                                                                                                                                                                                                     | detail (count tickets from `parent_queries`; the view adds nothing new) |
| `query_responses`        | one reply or internal note on a ticket                                                                                                                                                     | `query_id`, `author_user_id`, `author_kind`, `is_internal`, `created_at`                                                                                                                                                                                                                                                                                             | detail                                                                  |
| `query_events`           | one step of a ticket's timeline                                                                                                                                                            | `query_id`, `at`, `kind`, `level`, `actor_user_id`, `detail`                                                                                                                                                                                                                                                                                                         | history                                                                 |
| `query_categories`       | one query head of a desk (owner and SLA)                                                                                                                                                   | `desk`+`code` (unique per school), `name`, `owner_type`, `route_to`, `owner_user_id`, `sla_hours`, `status`                                                                                                                                                                                                                                                          | master                                                                  |
| `helpdesk_levels`        | one escalation level (2–6) of a head                                                                                                                                                       | `head_id`+`level` (unique), `hours`, `assign_type`, `role_code`, `user_id`, `emails`                                                                                                                                                                                                                                                                                 | master                                                                  |
| `helpdesk_settings`      | the school's helpdesk rules (one row)                                                                                                                                                      | PK `school_id`; `working_days`, `day_start`, `day_end`, `reopen_days`, `provider_sla`                                                                                                                                                                                                                                                                                | internal (settings)                                                     |
| `query_sequences`        | the ticket-number counter of a year                                                                                                                                                        | PK `school_id`+`academic_year_id`, `last_serial`                                                                                                                                                                                                                                                                                                                     | internal (sequence)                                                     |

### Feedback, Help page, birthday wishes

| Table                   | One row is                                              | Key columns                                                                          | For reports |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- |
| `feedback_entries`      | one rating (1–5) a family or user gave in a category    | `user_id`, `student_id`, `category`, `rating`, `comment`, `created_at`               | main        |
| `family_help_headings`  | one heading of the families' or the staff's Help page   | `app` (family / staff), `title`, `position`, `standard_key`, `deleted_at`            | master      |
| `family_help_questions` | one question and answer on the Help page                | `app`, `heading_id`, `audience`, `page`, `hidden`, `answer_changed_at`, `deleted_at` | master      |
| `family_help_votes`     | one user's "Was this helpful?" vote on a question       | PK `question_id`+`user_id`, `helpful`, `voted_at`                                    | detail      |
| `staff_help_settings`   | a school's standard staff Help questions were put in    | PK `school_id`, `seeded_at`                                                          | setting     |
| `family_help_settings`  | marks that the standard questions were put in (one row) | PK `school_id`, `seeded_at`                                                          | internal    |
| `birthday_wishes`       | one wish sent to a pupil or employee on a date          | `person_kind`+`person_id`+`on_date` (unique per school), `wished_by`, `channels`     | history     |

### Appointments and visitors

| Table                    | One row is                                                         | Key columns                                                                                                                                                                                                                             | For reports         |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `appointments`           | one booked meeting (parent, outside visitor or front desk)         | `number` (unique per school), `source`, `state`, `host_id`, `with_employee_id`, `student_id`, `starts_at`, `ends_at`, `party_size`, `visitor_log_id`, `checked_in_at`, `checked_out_at`, `reschedule_count`, `decided_at`, `created_at` | **main**            |
| `appointment_events`     | one step of an appointment (requested, approved, rescheduled…)     | `appointment_id`, `at`, `kind`, `actor_user_id`, `detail`                                                                                                                                                                               | history             |
| `appointment_hosts`      | one desk or person that can be met                                 | `name` (unique per school), `kind` desk/person/class_teacher, `employee_id`, `slot_minutes`, `capacity`, `open_public`, `open_parent`, `status`                                                                                         | master              |
| `appointment_host_hours` | one visiting window of a host on a weekday                         | `host_id`, `weekday` (1 = Monday), `starts`, `ends`                                                                                                                                                                                     | master              |
| `appointment_photos`     | the visitor's photo for an appointment                             | PK `appointment_id`, `bytes`                                                                                                                                                                                                            | detail              |
| `appointment_settings`   | the school's booking and gate rules (one row)                      | PK `school_id`; `auto_approve`, `no_show_minutes`, `reminder_hours`, `purposes`, `visitor_types`, `gates`                                                                                                                               | internal (settings) |
| `appointment_counters`   | a number counter per month (appointments `YYMM`, visitors `VYYMM`) | PK `school_id`+`period`, `last`                                                                                                                                                                                                         | internal (sequence) |
| `visitor_log`            | one entry in the gate's visitor register                           | `number` (unique per school), `source`, `state`, `in_at`, `out_at`, `visitor_type`, `party_size`, `purpose`, `host_id`, `with_employee_id`, `appointment_id`, `gate`, `student_id`, `hostel_id`, `warden_decision`, `created_at`        | **main**            |
| `visitor_photos`         | the visitor's live photo                                           | PK `visitor_log_id`, `bytes`                                                                                                                                                                                                            | detail              |

### Gate passes

| Table                 | One row is                                                                                             | Key columns                                                                                                                                                                                                                                                                  | For reports         |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `gate_passes`         | one pass: a pupil leaving early or arriving late, a staff RGP/NRGP, or a boarder's home leave / outing | `kind`, `audience` student/staff, `student_id`, `employee_id`, `on_date`, `at_time`, `state`, `source`, `pass_no`, `approval_mode`, `approval_need`, `decided_at`, `handover_at`, `out_at`, `in_at`, `return_by`, `overdue_at`, `late_minutes`, `cancelled_at`, `created_at` | **main (spine)**    |
| `gate_pass_approvals` | one approval level of one pass                                                                         | `pass_id`+`seq` (unique), `label`, `approver_user_ids`, `status`, `mandatory`, `acted_by`, `acted_at`                                                                                                                                                                        | detail / history    |
| `gate_pass_items`     | one item a staff member carries out                                                                    | `pass_id`, `name`, `qty`, `returnable`, `returned_qty`, `returned_at`                                                                                                                                                                                                        | detail              |
| `gate_pass_levels`    | one approval level the school set for an audience                                                      | `audience`, `seq`, `label`, `kind`, `role_code`, `designation`, `employee_id`, `mandatory`, `active`                                                                                                                                                                         | master              |
| `gate_pass_photos`    | the live photo of the person who collected the pupil                                                   | PK `pass_id`, `bytes`, `taken_at`                                                                                                                                                                                                                                            | detail              |
| `gate_pass_settings`  | the school's approval mode and number needed per audience (one row)                                    | PK `school_id`; `student_mode`/`student_need`, `staff_mode`/`staff_need`, `hostel_home_*`, `hostel_outing_*`, `handover_otp`                                                                                                                                                 | internal (settings) |

### Clinic and health

| Table                    | One row is                                                                                 | Key columns                                                                                                                                                                                               | For reports         |
| ------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `clinic_visits`          | one visit of a pupil or staff member to the school clinic                                  | `number`, `audience`, `student_id`, `employee_id`, `in_at`, `out_at`, `complaint`, `disease_ids`, `diagnosis`, `outcome`, `sent_home`, `referred_to`, `doctor_id`, `nurse_id`, `clinic_id`, `notified_at` | **main**            |
| `clinic_visit_medicines` | one medicine given at a visit                                                              | `visit_id`, `medicine_id`, `qty`, `dosage`                                                                                                                                                                | detail              |
| `clinic_medicines`       | one medicine the clinic keeps                                                              | `name`, `strength`, `form`, `unit`, `low_stock_at`, `status`                                                                                                                                              | master              |
| `clinic_stock`           | one batch of a medicine received                                                           | `medicine_id`, `batch_no`, `expiry_on`, `qty_in`, `qty_left` (live balance), `received_on`                                                                                                                | **main (stock)**    |
| `clinic_stock_moves`     | one stock movement (received, given, written off)                                          | `medicine_id`, `stock_id`, `kind`, `qty` (always > 0), `visit_id`, `at`, `by_user`                                                                                                                        | history             |
| `clinic_masters`         | one clinic, doctor, nurse or disease                                                       | `kind`, `name`, `employee_id`, `status`                                                                                                                                                                   | master              |
| `clinic_settings`        | the clinic's options (one row)                                                             | PK `school_id`; `checkup_hidden`, `expiry_alert_days`                                                                                                                                                     | internal (settings) |
| `health_camps`           | one health check-up drive (e.g. annual check-up, first term)                               | `academic_year_id`, `name`, `starts_on`, `ends_on`, `doctor_id`, `status`                                                                                                                                 | main                |
| `health_checkups`        | one pupil examined in one camp                                                             | `camp_id`+`student_id` (unique), `class_section_id`, `exam_date`, `height_cm`, `weight_kg`, `blood_group`, `findings` jsonb, `disease_id`, `needs_attention`, `status`, `published_at`                    | **main**            |
| `health_checkup_fields`  | one extra field the school added to the check-up form                                      | `section`, `label`, `kind`, `unit`, `options`, `status`                                                                                                                                                   | master              |
| `health_records`         | one dated health measurement of a pupil (report-card health, copy of a published check-up) | `student_id`, `recorded_on`, `exam_id`, `height_cm`, `weight_kg`, `bmi` (generated), `blood_group`, `vision_left`, `vision_right`, `dental`, `legacy_ref`                                                 | history             |

### File movement and CCTV requests

| Table              | One row is                                            | Key columns                                                                                                          | For reports |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| `file_notes`       | one approval note (a "file") raised by a staff member | `number`, `subject`, `created_by`, `status`, `round`, `submitted_at`, `closed_at`                                    | **main**    |
| `file_note_levels` | one approver of one level (1–5) in one round          | `note_id`+`round`+`level` (unique), `employee_id`, `user_id`, `status`, `acted_at`, `remark`                         | detail      |
| `file_note_events` | one action on a file (submitted, approved, returned…) | `note_id`, `round`, `action`, `level`, `by_user`, `at`                                                               | history     |
| `cctv_requests`    | one request to view CCTV footage                      | `requested_by`, `student_id`, `camera`, `from_at`, `to_at`, `reason`, `status`, `workflow_instance_id`, `created_at` | main        |

## How the tables join

**Spines.** Delivery reports start from `comms_messages` (or `mart.comms_delivery_daily` for daily trends); a bulk
send from `message_requests`; consent from `consents` (latest row) with `consent_purposes`; forms from
`consent_form_responses`; the helpdesk from `parent_queries`; the front office from `appointments`, `visitor_log` and
`gate_passes`; the clinic from `clinic_visits`, `clinic_stock` and `health_checkups`; file movement from `file_notes`.

### Messaging

```
message_request_recipients.request_id  → message_requests.id
message_request_recipients.message_id  → comms_messages.id            (NULL when skipped)
comms_messages.message_request_id      → message_requests.id          (NULL for single alerts, OTPs, helpdesk / visitor mails, pushes)
comms_delivery_events.message_id       → comms_messages.id            (many per message: sent, delivered, read)
comms_inbox_reads.message_id           → comms_messages.id;  comms_inbox_reads.user_id → users.id
comms_messages.template_id             → comms_templates.id           (NULL for mails built in SQL and own-text e-mails)
message_requests.template_id           → comms_templates.id           (first channel only; all channels in message_requests.channels[].templateId, text)
comms_messages.recipient_user_id       → users.id                     (NULL when only an address is known)
comms_messages.created_by              → users.id                     (the sender; NULL = system)
message_requests.requested_by / decided_by → users.id
message_requests.workflow_instance_id  → workflow_instances.id        (entity_type 'message_request') → workflow_steps
message_request_recipients.student_id  → students.id                  (set for every pupil-based recipient, parent or pupil)
message_request_recipients.person_type / person_id → students.id ('student') | guardians.id ('guardian') | employees.id ('employee')
                                         | comms_contacts.id ('contact') | users.id ('user') | applications.id ('candidate') | NULL ('upload')
comms_group_members.group_id           → comms_groups.id;  person_type / person_id as above (student, employee, guardian, contact, user)
push_devices.user_id                   → users.id;  a push row: comms_messages.recipient_address = push_devices.token
pupil's class at send time: message_request_recipients.student_id → enrolments.student_id
                                         (enrolments.academic_year_id = the year whose start_date..end_date holds message_requests.requested_at)
                                         → class_sections.id → classes.id
other modules pointing here: fee_reminders.message_id, payroll_records.payslip_message_id,
                             payroll_certificates.message_id, purchase_order_sends.message_id → comms_messages.id
```

### Notices and gallery

```
notice_targets.notice_id → notices.id;  notice_files.notice_id → notices.id;  notice_files.file_id → files.id
notice_targets.target_id → classes.id (target_type 'class' or 'admission_class') | class_sections.id ('class_section')
                         | students.id ('student') | employees.id ('employee') | admission_cycles.id ('admission_cycle')
notices.academic_year_id → academic_years.id
acknowledgements (academics module): academic_acks.item_type = 'notice' AND academic_acks.item_id → notices.id
                                     (academic_acks.student_id for families, academic_acks.staff_user_id for staff)
gallery_items.album_id → gallery_albums.id;  gallery_items.file_id → files.id;  gallery_albums.academic_year_id → academic_years.id
```

### Consent, privacy and consent forms

```
consents.user_id → users.id;  consents.purpose_code = consent_purposes.code (text, no FK);  consents.student_id → students.id
a parent's children: consents.user_id = guardians.user_id → student_guardians.guardian_id → student_guardians.student_id → students.id
privacy_acknowledgements.user_id → users.id;  privacy_acknowledgements.notice_version = privacy_notices.version (same school)
consent_form_responses.form_id → consent_forms.id;  .student_id → students.id;  .employee_id → employees.id
consent_form_responses.misc_line_id → misc_fee_students.id   (the fee raised and paid: misc_fee_students.amount, .paid, .status)
consent_form_responses.instance_id → workflow_instances.id   (approval of the answer)
consent_forms.academic_year_id → academic_years.id;  consent_forms.misc_fee_id → misc_fees.id
consent_form_response_versions / consent_form_signatures / consent_webhook_deliveries .response_id → consent_form_responses.id
consent_form_shares / consent_otps / consent_webhooks / consent_api_keys .form_id → consent_forms.id
consent_webhook_deliveries.webhook_id → consent_webhooks.id
```

### Helpdesk

```
query_responses.query_id → parent_queries.id;  query_events.query_id → parent_queries.id
parent_queries.(desk, category_code) = query_categories.(desk, code)     (no FK; the same code exists on several desks)
helpdesk_levels.head_id → query_categories.id
parent_queries.student_id → students.id;  parent_queries.academic_year_id → academic_years.id
pupil's class: parent_queries.student_id + academic_year_id → enrolments (student_id, academic_year_id) → class_sections → classes
parent_queries.raised_by_user_id / assigned_user_id / closed_by → users.id;  parent_queries.employee_id → employees.id (staff desk)
parent_queries.hostel_id → hostels.id;  .hostel_room_id → hostel_rooms.id;  .applicant_id → applicants.id;  .application_id → applications.id
query_responses.author_user_id → users.id;  query_events.actor_user_id → users.id
```

### Appointments and visitors

```
appointments.host_id → appointment_hosts.id;  appointment_hosts.employee_id → employees.id;  appointment_host_hours.host_id → appointment_hosts.id
appointments.with_employee_id → employees.id (the person met);  appointments.student_id → students.id
appointments.booked_by / decided_by → users.id;  appointments.requested_by → users.id (no FK; the parent's sign-in)
appointments.applicant_id → applicants.id (the outside visitor's OTP-verified identity)
appointments.visitor_log_id → visitor_log.id   and   visitor_log.appointment_id → appointments.id   (both sides are filled at check-in)
appointment_events.appointment_id, appointment_photos.appointment_id → appointments.id
visitor_log.host_id → appointment_hosts.id;  .with_employee_id → employees.id;  .student_id → students.id (hostel visit)
visitor_log.hostel_id → hostels.id;  .hostel_visitor_id → hostel_visitors.id;  .out_by → users.id
visitor_photos.visitor_log_id → visitor_log.id
```

### Gate passes

```
gate_pass_approvals.pass_id, gate_pass_items.pass_id, gate_pass_photos.pass_id → gate_passes.id
gate_pass_approvals.approver_user_ids[] → users.id (copied from gate_pass_levels when the pass was made);  .acted_by → users.id
gate_passes.student_id → students.id (audience 'student', also hostel kinds);  gate_passes.employee_id → employees.id (audience 'staff')
pupil's class: gate_passes.student_id → enrolments (year whose dates hold gate_passes.on_date) → class_sections → classes
gate_passes.requested_by / issued_by / handover_by / out_by / in_by → users.id (no FK)
gate_pass_levels.employee_id → employees.id;  gate_passes.workflow_instance_id → workflow_instances.id (v1 passes only)
```

### Clinic and health

```
clinic_visits.student_id → students.id (audience 'student');  clinic_visits.employee_id → employees.id (audience 'staff')
clinic_visits.clinic_id / doctor_id / nurse_id → clinic_masters.id;  unnest(clinic_visits.disease_ids) → clinic_masters.id (kind 'disease')
clinic_visit_medicines.visit_id → clinic_visits.id;  clinic_visit_medicines.medicine_id → clinic_medicines.id
clinic_stock.medicine_id → clinic_medicines.id
clinic_stock_moves.medicine_id → clinic_medicines.id;  .stock_id → clinic_stock.id;  .visit_id → clinic_visits.id (no FK)
health_checkups.camp_id → health_camps.id;  .student_id → students.id;  .class_section_id → class_sections.id (section at the check-up)
health_checkups.doctor_id / disease_id → clinic_masters.id;  health_camps.doctor_id → clinic_masters.id;  health_camps.academic_year_id → academic_years.id
health_checkups.findings ->> ('x' || health_checkup_fields.id)   (the school's own fields; built-in keys: vision_left, tooth_cavity…)
health_records.student_id → students.id;  health_records.exam_id → exams.id
```

### File movement, CCTV, feedback, Help, birthdays

```
file_note_levels.note_id → file_notes.id;  file_note_levels.employee_id → employees.id;  file_note_levels.user_id → users.id
file_note_events.note_id → file_notes.id;  file_note_events.by_user → users.id;  file_notes.created_by → users.id
file_notes.file_ids (jsonb array of ids) → files.id
cctv_requests.student_id → students.id;  cctv_requests.workflow_instance_id → workflow_instances.id;  .requested_by → users.id (no FK)
feedback_entries.user_id → users.id;  feedback_entries.student_id → students.id
family_help_questions.heading_id → family_help_headings.id;  family_help_votes.question_id → family_help_questions.id;  .user_id → users.id
birthday_wishes.person_id → students.id (person_kind 'student') | employees.id (person_kind 'employee');  .wished_by → users.id
```

## Life-cycles and statuses

### Messaging

- **`message_requests.status`** (message_request_status): `pending_approval` (waiting on the `message_approval`
  workflow) → `sent`, or `rejected`; `cancelled` (only from pending_approval/approved). `approved` and `sending` exist
  only for a moment inside the approving transaction; `draft` is an enum value the current code never writes. A request
  needs approval when its recipients exceed `comms_settings.approval_threshold` (0 = always) and the sender holds no
  role in `approval_exempt_roles` (`needs_approval` records the decision); a consent form's publish sends pre-approved.
  **`sent` means dispatched** (the messages were created and queued), not delivered. The approval history is in
  `workflow_instances` / `workflow_steps`.
- **`comms_messages.status`** (comms_message_status): `queued` → `sending` → `sent` | `delivered` | `failed`;
  `cancelled`. `sent` = the gateway accepted it. `delivered` = a delivery receipt confirmed it — today only MSG91 SMS and
  Meta WhatsApp send receipts (a generic receipt endpoint exists for others; the test console marks delivered at once);
  SMTP e-mail, smsbhejo SMS, EMS WhatsApp and app push stay `sent` for ever. A WhatsApp "read" receipt sets `read_at` (and delivered). `failed` = the last retry failed,
  or a failure receipt came (a failure never overrides `delivered`). A send error puts the row back to `queued` with
  `attempts` + 1 until the last attempt. `cancelled` = cancelled while queued, the school is not active, or a sign-in code
  passed `expires_at` before it went. **Count "went out" as `sent` + `delivered`; "delivery confirmed" as `delivered`;
  exclude `cancelled`.** Every receipt is kept in `comms_delivery_events` (`status` sent/delivered/failed, `is_read` true
  for a read).
- **`message_request_recipients.skipped_reason`**: `no_address` (no mobile / e-mail for that channel),
  `consent_withdrawn` (general messages only), `duplicate` (the same address on the same channel already in the list).
- **`send_to`**: `primary` (the family's SMS number or the primary guardian, recorded as person_type 'student'),
  `parents` (father and mother), `student` (the pupil's own), `student_parents`.
- **`category`** (message_category, on requests and templates): `service` (fees, attendance, safety: sent regardless of
  consent and quiet hours) vs `general` (skips withdrawn consent; held until quiet hours end).
- **`audience`** (message_audience): everyone, students, employees, class, class_section, route, group, individuals,
  filter (rule), upload (Excel list), candidates (admission applicants).
- **Templates**: `status` row_status + `deleted_at`; `is_alert` templates are throttled per address (default 6 an hour).
  **Groups**: `mode` static (members in `comms_group_members`) or rule (`rule` jsonb, resolved at send time — no member
  rows). **Push devices**: live while `revoked_at IS NULL` (revoked on sign-out or when the gateway reports a dead token).

### Notices and gallery

- **Draft** = `published_at IS NULL`. **Live today** = `published_at IS NOT NULL AND publish_from <= today AND
(publish_until IS NULL OR publish_until >= today) AND (publish_at IS NULL OR publish_at <= now())` and `deleted_at IS
NULL`. `kind` (notice_kind): notice, circular, office_order (office orders are for employees). `audience`
  (audience_kind): everyone, students, employees, candidates. No `notice_targets` rows = the whole audience.
  `ack_required` notices are acknowledged in `academic_acks`.
- Gallery albums: `status` row_status, `deleted_at`, `audience` like notices.

### Consent and privacy

- **`consents.status`** (consent_status): `granted` / `withdrawn`. Rows are never updated: **the current status of a
  user for a purpose is the latest row by `recorded_at DESC, id DESC`** (the same rule as `app.consent_status(user,
purpose)`, which ignores `student_id`). No row = never chose: for `comms.*` purposes the message still goes (only a
  withdrawal skips it); for `ai.assistant` and `ai.model` the feature needs a `granted`. `version` is the purpose's
  wording version at the time; `consent_purposes.version` goes up when the wording changes. `source`: parent_app,
  office, import, seed. `is_required` purposes cannot be withdrawn in the app. An `ai.model` choice older than the date
  the AI operator changed is treated as not chosen by the app.
- **Privacy notice**: the current notice is the highest `privacy_notices.version` with `published_at` set; a user has
  acknowledged it when `privacy_acknowledgements` has that version. Data-subject requests and the breach log live in
  the platform module (`data_subject_requests`, `breach_log`).

### Consent forms

- **`consent_forms.status`**: draft → published → closed (by hand, or the cap in `settings.cap` reached) → archived;
  `deleted_at` = deleted. `settings` jsonb: `opensAt`, `closesAt`, `repeat` once/many, `cap`, `editUntil`, `approval`
  {on, levels}, `fee`. `audience` jsonb: `pupils` all/filter/pupils with `classIds`, `sectionIds`, `studentIds`
  (ids as text), and `staff` all/filter/people.
- **`consent_form_responses.status`**: `submitted` → `approved` / `rejected` (only when the form's approval is on;
  otherwise `submitted` is final), `withdrawn`. **Answered = `status <> 'withdrawn'`.** Waiting for approval =
  `submitted` with its `instance_id` workflow still `pending`. `respondent`: family, staff, office (filled on behalf),
  public (outsider on the public link); `via_link` = answered on the public link. Edits bump `edits` / `edited_at` and
  keep the old text in `consent_form_response_versions`.
- `consent_webhook_deliveries.status`: pending → delivered | failed. `consent_otps`: used when `consumed_at` is set.

### Helpdesk

- **`desk`**: parent, staff, provider (tickets to the ERP provider), hostel (hostel complaints), candidate (admission
  portal questions). **`kind`** (query_kind): query, complaint, leave. `leave` rows are the old family leave request:
  no SLA, no timeline, closed with `decision` 'approved' / 'rejected' (new leave is `student_leaves`, attendance module).
- **`status`** (query_status): `open` → `in_progress` (assigned or escalated) → `answered` (a handler replied) → back
  to `open` when the raiser writes again (the SLA clock restarts) → `closed` (`resolution`, `closed_at`, `closed_by`).
  The raiser may reopen within `helpdesk_settings.reopen_days`: back to `open`, `reopened_count` + 1, `breached_at`
  cleared. `answered` is not resolved.
- **`level`** 1–6: level 1 is the head's owner (`query_categories.owner_type`: class_teacher, role, employee,
  provider). A job moves an unresolved ticket past `due_at` to the next `helpdesk_levels` row (`escalated_at`, new
  assignee, new `due_at` in working hours); when the last level runs out `breached_at` is set once. `due_at` counts the
  school's working days and hours and skips holidays.
- **`provider_status`** (provider desk): open → triaged (first reply) → in_progress → fixed (closed) → verified →
  closed (set on the support screens); reopen → open. `priority` low/normal/high/urgent sets the provider SLA.
- **`query_events.kind`**: created, assigned, replied, note, escalated, breached, closed, reopened, rated (written by
  triggers). **`query_responses.author_kind`** (author_kind): guardian, student, staff, provider, candidate;
  `is_internal` = a staff note the family never sees.

### Appointments and visitors

- **`appointments.state`**: requested → approved (by the front desk, or at once with `auto_approve`) → checked_in (at
  the gate; a `visitor_log` row is made) → completed (checked out) | no_show (still approved `no_show_minutes` after
  `starts_at`, set by a job, or marked by hand); or rejected / cancelled (a request nobody decided before its time is
  cancelled by the job with `cancel_reason` 'Not confirmed before the requested time'). A reschedule keeps it approved,
  adds 1 to `reschedule_count` and keeps `previous_starts_at`.
  `status` (workflow_status) is the v1 column, copied only for approved / rejected / cancelled — **use `state`**.
  `source`: parent, public, front_desk. History in `appointment_events.kind`: requested, approved, rejected,
  rescheduled, cancelled, checked_in, checked_out, no_show, reminded.
- **`visitor_log.state`**: waiting (registered on their own phone, not let in yet; `in_at` NULL) → inside (`in_at`) →
  left (`out_at`); cancelled (refused, or never let in — closed the next morning). `source`: gate, self, appointment.
  Hostel visits carry `warden_decision` allowed/refused.

### Gate passes

- **`kind`**: early_leave, late_arrival (pupil); rgp (returnable, comes back), nrgp (non-returnable) (staff);
  hostel_home, hostel_outing (boarder; audience 'student').
- **`gate_passes.state`**: pending → approved (`pass_no` and `pass_code` issued, `decided_at`) → handed_over (front
  desk hands the pupil over; early_leave and hostel_home only) → out (at the gate) → returned (rgp, hostel_home,
  hostel_outing come back; `in_at`). Final states: `returned`; `out` for early_leave, late_arrival and nrgp; `rejected`;
  `cancelled` (from pending or approved). `status` (workflow_status) copies only pending/approved/rejected/cancelled —
  **use `state`**. "Approved" in a report = state IN ('approved', 'handed_over', 'out', 'returned').
- **Approval**: one `gate_pass_approvals` row per level, made when the pass is asked: `waiting` (its turn has not come)
  → `pending` (may act now) → `approved` / `rejected`; `skipped` (nobody holds the level, the requester is the approver,
  enough others approved, or the pass was cancelled). `approval_mode` sequence (every level in order) or any (any
  `approval_need` levels; every `mandatory` level must approve, and a mandatory rejection ends it).
- Hostel late return: `overdue_at` (flagged once), `escalated_at` (principal told), `late_minutes` (on return, beyond
  the grace).

### Clinic and health

- **`clinic_visits.outcome`**: back_to_class, rest (still resting: `out_at` NULL until they leave), sent_home, referred.
  `sent_home` (boolean) mirrors outcome 'sent_home'. `audience`: student, staff. `notified_at` = family told.
- **`clinic_stock_moves.kind`**: received (+), given (−, at a visit, from the earliest-expiring batch first),
  written_off (−). `qty` is always positive; the sign comes from `kind`. `clinic_stock.qty_left` is the live balance of
  a batch.
- `health_camps.status` open/closed; **`health_checkups.status`** draft → published (parents see published only; on
  publish a copy goes into `health_records`). Masters: `status` row_status.

### File movement and CCTV

- **`file_notes.status`**: pending (with an approver) → approved (all levels approved) | returned (sent back; the
  creator corrects it and resubmits as `round` + 1, starting again at level 1) | rejected (final) | withdrawn (by the
  creator, from pending or returned).
- **`file_note_levels.status`**: waiting → pending → approved / returned / rejected; `void` when the round ended before
  it got there. `file_note_events.action`: submitted, resubmitted, approved, returned, rejected, withdrawn.
- **`cctv_requests.status`** (workflow_status): pending, approved, rejected, cancelled (through the workflow engine when
  a `cctv_request` workflow is defined).

## Amounts, dates and counting rules

- **Money.** `comms_messages.cost` (numeric(10,4), rupees) = `units` × the channel rate at dispatch — **set only on
  bulk-request messages**; single alerts keep `units` 1 and `cost` NULL. Rates: `comms_settings.rates` jsonb (rupees per
  unit, e.g. `rates ->> 'sms'`). `comms_credits.units` is positive for a top-up and negative for a correction;
  `amount` is the rupees paid. **Balance per channel = sum(`comms_credits.units`) − sum(`comms_messages.units`) of
  messages with `sent_at` set.** SMS units: 160 / 153 characters a part (GSM), 70 / 67 when any Unicode character
  (Hindi) is used; WhatsApp and e-mail are 1. Consent forms: `consent_forms.fee_amount` and the answer's
  `consent_form_responses.fee_amount`; the fee raised and paid is on `misc_fee_students` (`amount`, `paid`, `status`
  open/paid/cancelled) via `misc_line_id`. `consent_form_responses.paid_at` / `payment_intent_id` are Sprint 19 columns
  the current code does not write. No other money here.
- **Which date.** Messages: `created_at` (when made; the mart's day), `sent_at` (handed over), `scheduled_at` (not
  before). Requests: `requested_at`, `dispatched_at`. Notices: `publish_from` (date). Tickets: `opened_at`,
  `closed_at`. Appointments: `starts_at` (meeting time) vs `created_at` (booking). Visitors: `in_at` (NULL while
  waiting). Gate passes: `on_date` (date of leaving) + `at_time`. Clinic: `in_at`. Consents: `recorded_at`. All
  timestamps are `timestamptz`: group by the school day `(x AT TIME ZONE 'Asia/Kolkata')::date`.
- **Academic year.** `notices`, `gallery_albums`, `parent_queries`, `consent_forms`, `health_camps` carry
  `academic_year_id` (health camps may leave it NULL). The other tables have no year: take the year whose
  `start_date`..`end_date` holds the event date. No financial year here.
- **One row per what.** `comms_messages`: one per address and channel (push: one per device). `message_request_recipients`:
  one per person and channel, sent or skipped. `comms_delivery_events`: unique index on (provider, external_id, status,
  is_read). `comms_inbox_reads`: one per user and message. `comms_templates`: one per (code, channel).
  `comms_group_members`: unique index on (group_id, person_type, person_id). `query_categories`: one per (desk, code).
  `health_checkups`: one per (camp, pupil). `health_records`: unique index on (student_id, recorded_on, exam_id or 0).
  `birthday_wishes`: one per person per day. `family_help_votes`: one per user per question (changed in place).
  `privacy_acknowledgements`: one per (user, version). `consent_form_responses`: one live answer per pupil when
  `settings.repeat` is 'once', several when 'many'.
- **Numbers.** Tickets `Q/<year code>/0001` (per year; migrated staff queries `S/EQ/0001`), appointments
  `APT-YYMM-0001`, visitors `V-YYMM-0001`, clinic visits `CV-YYMM-<id>`, files `FM-YYMM-<id>`, gate passes
  `GP/<yyyy>/00001` (pupils and boarders) or `RGP/…`, `NRGP/…` (staff), form answers `CF/<year code>/000001`.
- **Cached counts that can drift.** `message_requests.recipients_total` / `recipients_skipped` are an estimate at
  compose time and are reset when it is dispatched (the audience is worked out again); `notices.emailed_count`;
  `parent_queries.reopened_count`; `appointments.reschedule_count`; `consent_api_keys.uses`. Prefer counting the
  detail rows.
- **The mart.** `mart.comms_delivery_daily` (school_id, `on_date` = IST day of `created_at`, `channel` incl. push,
  `status` = the message's status now, `messages`) covers the **last 120 days**, rebuilt every 15 minutes, cancelled
  included. Use it for daily or monthly delivery trends; use `comms_messages` for older periods, per request, per
  template, per person, and for units and cost.

## Answering report questions

**1. How did our messages fare in the last 30 days, by channel?** (mart)

```sql
SELECT d.channel,
       sum(d.messages) FILTER (WHERE d.status <> 'cancelled')               AS messages,
       sum(d.messages) FILTER (WHERE d.status IN ('sent', 'delivered'))     AS went_out,
       sum(d.messages) FILTER (WHERE d.status = 'delivered')                AS delivery_confirmed,
       sum(d.messages) FILTER (WHERE d.status = 'failed')                   AS failed,
       sum(d.messages) FILTER (WHERE d.status IN ('queued', 'sending'))     AS still_queued
  FROM mart.comms_delivery_daily d
 WHERE d.on_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 29
 GROUP BY d.channel
 ORDER BY d.channel
```

Note: e-mail and push never reach `delivered`; judge them by `went_out` and `failed`. Add `AND d.channel <> 'push'` to
match the app's dashboard.

**2. What happened to each bulk message sent this month?**

```sql
SELECT r.id, r.title, r.status, r.requested_at, r.recipients_total, r.recipients_skipped,
       count(x.id) FILTER (WHERE x.skipped_reason = 'no_address')        AS skipped_no_address,
       count(x.id) FILTER (WHERE x.skipped_reason = 'consent_withdrawn') AS skipped_consent,
       count(x.id) FILTER (WHERE x.skipped_reason = 'duplicate')         AS skipped_duplicate,
       count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered'))     AS went_out,
       count(m.id) FILTER (WHERE m.status = 'delivered')                AS delivery_confirmed,
       count(m.id) FILTER (WHERE m.status = 'failed')                   AS failed,
       count(m.id) FILTER (WHERE m.status IN ('queued', 'sending'))     AS still_queued,
       count(m.id) FILTER (WHERE m.read_at IS NOT NULL)                 AS read_on_whatsapp
  FROM message_requests r
  LEFT JOIN message_request_recipients x ON x.request_id = r.id
  LEFT JOIN comms_messages m ON m.id = x.message_id
 WHERE r.requested_at >= now() - interval '30 days'
   AND r.status NOT IN ('draft', 'cancelled', 'rejected')
 GROUP BY r.id
 ORDER BY r.requested_at DESC
```

Note: a request still `pending_approval` has no recipient rows yet; each person counts once per channel.

**3. How many SMS / WhatsApp units did we use each month, and what did they cost?**

```sql
SELECT to_char(date_trunc('month', m.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
       m.channel,
       count(*)      AS messages,
       sum(m.units)  AS units,
       round(sum(m.units * COALESCE((s.rates ->> m.channel::text)::numeric, 0)), 2) AS cost_at_todays_rates,
       round(sum(COALESCE(m.cost, 0)), 2)                                          AS cost_recorded_on_rows
  FROM comms_messages m
  LEFT JOIN comms_settings s ON s.school_id = m.school_id
 WHERE m.channel IN ('sms', 'whatsapp', 'email')
   AND m.sent_at IS NOT NULL
   AND m.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months') AT TIME ZONE 'Asia/Kolkata'
 GROUP BY 1, 2
 ORDER BY 1, 2
```

Note: `cost` is filled only for bulk requests, so the recorded cost is lower than the real one; `sent_at IS NOT NULL`
is the same rule the credit balance uses.

**4. Which classes did one circular reach?** (crosses into enrolments / classes)

```sql
SELECT k.name AS class, cs.name AS section, x.channel,
       count(*) FILTER (WHERE x.message_id IS NOT NULL)            AS sent,
       count(*) FILTER (WHERE x.skipped_reason IS NOT NULL)        AS skipped,
       count(*) FILTER (WHERE m.status IN ('sent', 'delivered'))   AS went_out,
       count(*) FILTER (WHERE m.status = 'failed')                 AS failed
  FROM message_request_recipients x
  JOIN message_requests r ON r.id = x.request_id
  LEFT JOIN comms_messages m ON m.id = x.message_id
  JOIN academic_years y ON (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN y.start_date AND y.end_date
  JOIN enrolments e ON e.student_id = x.student_id AND e.academic_year_id = y.id AND e.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE x.request_id = 123          -- the request
 GROUP BY k.display_order, k.name, cs.name, x.channel
 ORDER BY k.display_order, cs.name, x.channel
```

Note: rows are per person and channel; use `count(DISTINCT x.student_id)` for "pupils reached". Staff and contacts
have no `student_id` and drop out of this join.

**5. How many families have granted or withdrawn each consent purpose today?**

```sql
WITH latest AS (
  SELECT DISTINCT ON (c.user_id, c.purpose_code) c.user_id, c.purpose_code, c.status, c.version
    FROM consents c
   ORDER BY c.user_id, c.purpose_code, c.recorded_at DESC, c.id DESC
)
SELECT p.code, p.name, p.is_required, p.version AS wording_version,
       count(l.user_id) FILTER (WHERE l.status = 'granted')                        AS granted,
       count(l.user_id) FILTER (WHERE l.status = 'withdrawn')                      AS withdrawn,
       count(l.user_id) FILTER (WHERE l.status = 'granted' AND l.version < p.version) AS granted_on_old_wording
  FROM consent_purposes p
  LEFT JOIN latest l ON l.purpose_code = p.code
 GROUP BY p.id
 ORDER BY p.sort_order, p.code
```

Note: the latest row per user and purpose is the status; users with no row never chose (for comms.* they still get
messages). For a status on a past date add `c.recorded_at < <date>` inside `latest`.

**6. How fast does each helpdesk desk answer and close tickets, month by month?**

```sql
SELECT to_char(date_trunc('month', q.opened_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
       q.desk,
       count(*)                                                              AS raised,
       count(*) FILTER (WHERE q.status = 'closed')                           AS closed,
       count(*) FILTER (WHERE q.status <> 'closed')                          AS not_closed,
       count(*) FILTER (WHERE q.level > 1 OR q.escalated_at IS NOT NULL)     AS escalated,
       count(*) FILTER (WHERE q.breached_at IS NOT NULL)                     AS breached,
       round((avg(extract(epoch FROM q.first_response_at - q.opened_at) / 3600))::numeric, 1) AS avg_hours_to_first_answer,
       round((avg(extract(epoch FROM q.closed_at - q.opened_at) / 3600) FILTER (WHERE q.status = 'closed'))::numeric, 1) AS avg_hours_to_close,
       round(avg(q.rating)::numeric, 1)                                       AS avg_rating
  FROM parent_queries q
 WHERE q.kind <> 'leave'
   AND q.opened_at >= now() - interval '6 months'
 GROUP BY 1, 2
 ORDER BY 1, 2
```

Note: hours are clock hours (the SLA itself counts working hours). The app's "within SLA" = closed at level 1 with
no `escalated_at` and no `breached_at`.

**7. Which classes raise the most parent queries and complaints this year, and about what?** (crosses into classes)

```sql
SELECT k.name AS class, COALESCE(h.name, q.category_code) AS head,
       count(*)                                          AS tickets,
       count(*) FILTER (WHERE q.kind = 'complaint')      AS complaints,
       count(*) FILTER (WHERE q.status <> 'closed')      AS not_closed,
       count(*) FILTER (WHERE q.status IN ('open', 'in_progress') AND q.due_at < now()) AS overdue_now
  FROM parent_queries q
  JOIN academic_years y ON y.id = q.academic_year_id AND y.status = 'active'
  LEFT JOIN query_categories h ON h.desk = q.desk AND h.code = q.category_code
  JOIN enrolments e ON e.student_id = q.student_id AND e.academic_year_id = q.academic_year_id AND e.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE q.desk = 'parent' AND q.kind <> 'leave'
 GROUP BY k.display_order, k.name, COALESCE(h.name, q.category_code)
 ORDER BY k.display_order, tickets DESC
```

Note: join heads on desk **and** code; "overdue" is the app's rule (open or in progress past `due_at`).

**8. Early leaves and late arrivals by class this month, and how quickly they were decided** (crosses into classes)

```sql
SELECT k.name AS class, p.kind,
       count(*)                                                                   AS asked,
       count(*) FILTER (WHERE p.state IN ('approved', 'handed_over', 'out', 'returned')) AS approved,
       count(*) FILTER (WHERE p.state = 'rejected')                               AS rejected,
       count(*) FILTER (WHERE p.state = 'cancelled')                              AS cancelled,
       count(*) FILTER (WHERE p.state IN ('out', 'returned'))                     AS through_the_gate,
       round((avg(extract(epoch FROM p.decided_at - p.created_at) / 60)
              FILTER (WHERE p.state NOT IN ('pending', 'cancelled')))::numeric, 0) AS avg_minutes_to_decide
  FROM gate_passes p
  JOIN academic_years y ON p.on_date BETWEEN y.start_date AND y.end_date
  JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = y.id AND e.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE p.audience = 'student'
   AND p.on_date >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY k.display_order, k.name, p.kind
 ORDER BY k.display_order, p.kind
```

Note: hostel leave (`hostel_home`, `hostel_outing`) is also audience 'student'; filter `p.kind` if you want day
scholars only. Use `state`, never `status`.

**9. Clinic visits by class this year: how many pupils were sent home or referred?** (crosses into classes)

```sql
SELECT k.name AS class,
       count(*)                                         AS visits,
       count(DISTINCT v.student_id)                     AS pupils,
       count(*) FILTER (WHERE v.outcome = 'sent_home')  AS sent_home,
       count(*) FILTER (WHERE v.outcome = 'referred')   AS referred,
       count(*) FILTER (WHERE v.outcome = 'rest' AND v.out_at IS NULL) AS in_clinic_now,
       count(DISTINCT v.id) FILTER (WHERE EXISTS (SELECT 1 FROM clinic_visit_medicines vm WHERE vm.visit_id = v.id)) AS given_medicine
  FROM clinic_visits v
  JOIN academic_years y ON y.status = 'active'
       AND (v.in_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN y.start_date AND y.end_date
  JOIN enrolments e ON e.student_id = v.student_id AND e.academic_year_id = y.id AND e.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE v.audience = 'student'
 GROUP BY k.display_order, k.name
 ORDER BY k.display_order
```

Note: health data — report counts, never names, to anyone outside the clinic roles. Diseases are an array:

```sql
SELECT d.name AS disease, count(*) AS visits
  FROM clinic_visits v
  CROSS JOIN LATERAL unnest(v.disease_ids) AS x(disease_id)
  JOIN clinic_masters d ON d.id = x.disease_id AND d.kind = 'disease'
 WHERE v.in_at >= now() - interval '90 days'
 GROUP BY d.name
 ORDER BY visits DESC
```

**10. Medicine stock: what is left, what has expired, and what was used in the last 30 days?**

```sql
SELECT m.name, m.strength, m.unit, m.low_stock_at,
       COALESCE(sum(k.qty_left) FILTER (WHERE k.expiry_on IS NULL OR k.expiry_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS usable_left,
       COALESCE(sum(k.qty_left) FILTER (WHERE k.expiry_on < (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)                         AS expired_left,
       min(k.expiry_on) FILTER (WHERE k.qty_left > 0 AND k.expiry_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date)               AS next_expiry,
       (SELECT COALESCE(sum(mv.qty), 0) FROM clinic_stock_moves mv
         WHERE mv.medicine_id = m.id AND mv.kind = 'given' AND mv.at >= now() - interval '30 days')                              AS given_last_30_days,
       (SELECT COALESCE(sum(mv.qty), 0) FROM clinic_stock_moves mv
         WHERE mv.medicine_id = m.id AND mv.kind = 'written_off' AND mv.at >= now() - interval '30 days')                        AS written_off_last_30_days
  FROM clinic_medicines m
  LEFT JOIN clinic_stock k ON k.medicine_id = m.id
 WHERE m.status = 'active'
 GROUP BY m.id
 ORDER BY m.name, m.strength
```

Note: low stock = `usable_left <= low_stock_at` (the app's rule); expired batches still hold `qty_left` until written
off. Quantities are in the medicine's `unit`.

**11. Visitors at the gate per day in the last 30 days**

```sql
SELECT (v.in_at AT TIME ZONE 'Asia/Kolkata')::date                            AS day,
       count(*)                                                               AS entries,
       sum(v.party_size)                                                      AS people,
       count(*) FILTER (WHERE v.source = 'appointment')                       AS by_appointment,
       count(*) FILTER (WHERE v.state = 'inside')                             AS still_inside,
       round((avg(extract(epoch FROM v.out_at - v.in_at) / 60) FILTER (WHERE v.state = 'left'))::numeric, 0) AS avg_minutes_inside
  FROM visitor_log v
 WHERE v.state IN ('inside', 'left')
   AND v.in_at >= now() - interval '30 days'
 GROUP BY 1
 ORDER BY 1
```

Note: an appointment visitor is also a `visitor_log` row (`source` 'appointment'); do not add appointments and
visitors together. Appointments by host:

```sql
SELECT h.name AS host,
       count(*) FILTER (WHERE a.state IN ('approved', 'checked_in', 'completed', 'no_show')) AS confirmed,
       count(*) FILTER (WHERE a.state = 'completed') AS met,
       count(*) FILTER (WHERE a.state = 'no_show')   AS no_show,
       count(*) FILTER (WHERE a.state = 'rejected')  AS rejected,
       count(*) FILTER (WHERE a.state = 'cancelled') AS cancelled
  FROM appointments a
  JOIN appointment_hosts h ON h.id = a.host_id
 WHERE a.starts_at >= now() - interval '30 days' AND a.starts_at < now()
 GROUP BY h.name
 ORDER BY h.name
```

**12. Who has not answered the trip consent form yet, section by section, and is the fee paid?** (crosses into
enrolments and the misc fee)

```sql
WITH f AS (
  SELECT id, academic_year_id, audience FROM consent_forms
   WHERE code = 'TRIP-26' AND deleted_at IS NULL            -- the form
), pupils AS (
  SELECT e.student_id, cs.id AS section_id, cs.name AS section, k.name AS class, k.display_order
    FROM f
    JOIN enrolments e ON e.academic_year_id = f.academic_year_id AND e.status = 'active'
    JOIN class_sections cs ON cs.id = e.class_section_id
    JOIN classes k ON k.id = cs.class_id
   WHERE COALESCE(f.audience ->> 'pupils', 'all') = 'all'
      OR (f.audience ->> 'pupils' = 'filter'
          AND (COALESCE(jsonb_array_length(f.audience -> 'classIds'), 0) = 0 OR f.audience -> 'classIds' ? cs.class_id::text)
          AND (COALESCE(jsonb_array_length(f.audience -> 'sectionIds'), 0) = 0 OR f.audience -> 'sectionIds' ? cs.id::text))
      OR (f.audience ->> 'pupils' = 'pupils' AND f.audience -> 'studentIds' ? e.student_id::text)
), answers AS (
  SELECT DISTINCT ON (r.student_id) r.student_id, r.status, r.misc_line_id
    FROM consent_form_responses r JOIN f ON r.form_id = f.id
   WHERE r.status <> 'withdrawn' AND r.student_id IS NOT NULL
   ORDER BY r.student_id, r.signed_at DESC, r.id DESC
)
SELECT p.class, p.section,
       count(*)                                              AS pupils,
       count(a.student_id)                                   AS answered,
       count(*) - count(a.student_id)                        AS not_answered,
       count(a.student_id) FILTER (WHERE a.status = 'approved') AS approved,
       count(a.student_id) FILTER (WHERE a.status = 'rejected') AS not_approved,
       COALESCE(sum(l.amount), 0)                            AS fee_raised,
       COALESCE(sum(l.paid), 0)                              AS fee_paid
  FROM pupils p
  LEFT JOIN answers a ON a.student_id = p.student_id
  LEFT JOIN misc_fee_students l ON l.id = a.misc_line_id AND l.status <> 'cancelled'
 GROUP BY p.display_order, p.class, p.section
 ORDER BY p.display_order, p.section
```

Note: the audience filter also allows houses, routes and boarders (not handled here); ids in `audience` are text.

**More checked sketches** — pending approvals and acknowledgements:

```sql
-- gate passes waiting, by approval level
SELECT a.label, count(*) AS passes_waiting, min(p.created_at) AS oldest
  FROM gate_pass_approvals a
  JOIN gate_passes p ON p.id = a.pass_id AND p.state = 'pending'
 WHERE a.status = 'pending'
 GROUP BY a.label
```

```sql
-- files waiting, by approver
SELECT e.display_name AS approver, count(*) AS files_waiting, min(n.submitted_at) AS oldest_since
  FROM file_note_levels l
  JOIN file_notes n ON n.id = l.note_id AND n.round = l.round AND n.status = 'pending'
  JOIN employees e ON e.id = l.employee_id
 WHERE l.status = 'pending'
 GROUP BY e.display_name
 ORDER BY files_waiting DESC
```

```sql
-- notices asking for acknowledgement, and how many acknowledged (academic_acks is the academics module's)
SELECT n.id, n.title, n.kind, count(DISTINCT a.student_id) AS pupils_acknowledged, count(DISTINCT a.staff_user_id) AS staff_acknowledged
  FROM notices n
  LEFT JOIN academic_acks a ON a.item_type = 'notice' AND a.item_id = n.id
 WHERE n.ack_required AND n.published_at IS NOT NULL AND n.deleted_at IS NULL
 GROUP BY n.id, n.title, n.kind
```

## Traps

- **"Sent" is not "delivered".** `message_requests.status = 'sent'` only means dispatched; `comms_messages.status =
'sent'` means the gateway took it. E-mail, push, smsbhejo SMS and EMS WhatsApp never become `delivered`, so a
  "delivery rate" on `delivered` alone looks terrible for them. Report went-out (`sent` + `delivered`), confirmed
  (`delivered`), failed, and leave out `cancelled`. The app itself is not consistent here (the request list counts
  sent + delivered as delivered; the dashboard counts `sent` as pending).
- **`comms_messages` holds every outgoing message of the ERP**, not only Compose: attendance / fee / transport alerts,
  sign-in codes (with `expires_at`), helpdesk escalation and visitor e-mails (no `template_id`; source in `variables`,
  e.g. `variables ? 'helpdesk_query'`), fee reminders, payslips, purchase-order mails, test e-mails, app pushes. Filter
  by `message_request_id`, `template_id` / `comms_templates.code`, or `channel` for the question asked.
- **Push rows are per device.** `channel = 'push'` makes one row per registered phone or browser; `recipient_address`
  is the device token. Count `DISTINCT recipient_user_id` for people. The app's comms dashboard leaves push out
  (`channel <> 'push'`); the mart keeps it.
- **One person, several rows.** A request makes one `message_request_recipients` row per person **per channel**, and
  `send_to = 'student_parents'` adds both parents and the pupil. Count `DISTINCT student_id` for pupils reached.
  Recipient rows exist only after dispatch; before that `recipients_total` is an estimate.
  `message_requests.channel` / `template_id` hold only the first channel — use `channels` or the per-row `channel`.
- **`cost` is NULL for single alerts.** Recompute `units` × `comms_settings.rates` for a usage bill; `sum(cost)`
  undercounts.
- **Two kinds of "read".** `comms_messages.read_at` is WhatsApp's read receipt (Meta gateway only);
  `comms_inbox_reads` is the first open in the school app's inbox. They are unrelated.
- **Consents are a history.** Never count all `consents` rows (the built-in "consent coverage" report does, which
  counts every change of mind). Take the latest row per (`user_id`, `purpose_code`). `student_id` is usually NULL (one
  choice for all children) and the status rule ignores it. Users with no row are "not chosen", not "withdrawn".
  `media.gallery` consent is recorded but the gallery does not filter on it.
- **`privacy_acknowledgements` is unique on (`user_id`, `notice_version`) without the school.** A parent with children
  in two schools who acknowledged version 1 in one school cannot get a version-1 row in the other: "not acknowledged"
  in the second school may be wrong when versions coincide.
- **`parent_queries` is five desks and the old leave requests in one table.** Always filter `desk` and
  `kind <> 'leave'` for helpdesk numbers. Approved family leave = `kind = 'leave' AND decision = 'approved'` (plus
  `student_leaves` in the attendance module). `query_categories.code` repeats across desks (every desk has 'other'):
  join on desk and code. `answered` is not resolved. `first_response_at` is also set when a ticket is closed without a
  reply. Migrated hypercare and staff tickets (`legacy_hypercare_id`, `legacy_ref` set) were not routed by the trigger:
  their `due_at` came from the old system (staff ones have none), and a migrated hypercare ticket carries two
  'created' rows in `query_events` — count tickets from `parent_queries`, never from 'created' events.
- **`state` vs `status`.** `appointments` and `gate_passes` carry both; `status` is the v1 workflow column copied only
  for a few states (a checked-in appointment still says 'approved'). Use `state`. A pupil's early leave ends at `out`,
  not `returned`.
- **Visitors.** `visitor_log.in_at` is NULL for waiting and cancelled self-registrations: group by `in_at` and keep
  state IN ('inside', 'left'). Use `party_size` for people. `applicant_id` on appointments and visitors is the outside
  visitor's mobile-verified identity (from the admission sign-in), not an admission applicant.
- **Clinic.** `outcome = 'rest'` with `out_at` NULL is someone still in the clinic. `disease_ids` is an array (unnest
  it). `clinic_stock_moves.qty` is always positive — apply the sign from `kind`; the batch balance is
  `clinic_stock.qty_left` (`qty_in − qty_left` should equal its given + written_off moves). A visit's
  `clinic_visit_medicines` row can be split over several batches in `clinic_stock_moves`. **`health_records` repeats
  published check-ups** (copied on publish) next to the exam-time entries of the report card (`exam_id` set): count
  check-up results from `health_checkups` (status 'published'), not from both.
- **Gate pass approvals are a snapshot.** `gate_pass_approvals.approver_user_ids` are the people holding the level when
  the pass was made; later changes to `gate_pass_levels` do not touch old passes.
- **Soft deletes**: `comms_templates`, `comms_groups`, `comms_contacts`, `notices`, `gallery_albums`, `consent_forms`,
  `consent_webhooks`, `family_help_headings`, `family_help_questions` (`deleted_at IS NULL`). Notices also need
  `published_at IS NOT NULL` to be more than a draft.
- **Merged students.** A pupil merge moves these rows (queries, passes, clinic visits, consents, form answers,
  recipients, appointments, visitors…) to the kept pupil, so `student_id` normally points at the kept record; still
  exclude `students.deleted_at IS NOT NULL` for lists of current pupils.
- **Class of a pupil.** Most tables have no section: join `enrolments` for the year of the event date, with
  `e.status <> 'cancelled'` for past years (promoted pupils are not 'active' any more). `health_checkups.class_section_id`
  is the section at check-up time.
- **Time zone.** Group by `(x AT TIME ZONE 'Asia/Kolkata')::date`; a message at 00:30 IST is the previous day in UTC.
- **The mart is a 120-day snapshot of the current status.** A message made on a day that later fails moves from 'sent'
  to 'failed' for that day at the next refresh; older days drop out.
- **Rule groups have no members.** `comms_group_members` lists only static groups; a rule group is worked out at send
  time from `comms_groups.rule`.
- **`birthday_wishes` lists wishes sent**, not birthdays; a birthday with no row was simply not wished. `channels`
  holds 'app' and/or 'sms/whatsapp'.
- **Help-page votes** count from `family_help_questions.answer_changed_at`: older votes were about an earlier answer.

## Personal and sensitive data

Mask these, or never send them to an AI model:

- **Health (sensitive, clinic roles only)**: `clinic_visits` (`complaint`, `diagnosis`, `treatment`, `prescription`,
  `remark`, `referred_to`, `temperature_c`, `pulse`, `bp`, `spo2`, `weight_kg`, `disease_ids`, `outcome`,
  `sent_home`); `clinic_visit_medicines` (`medicine_id`, `qty`, `dosage`); `clinic_stock_moves.visit_id` (links a
  medicine to a person); `health_checkups` (`height_cm`, `weight_kg`, `blood_group`, `findings`, `disease_id`,
  `description`, `remarks`, `needs_attention`); `health_records` (`height_cm`, `weight_kg`, `bmi`, `blood_group`,
  `vision_left`, `vision_right`, `dental`, `notes`). Answers of consent forms can hold medical details too.
- **Names, mobiles, e-mails, addresses**: `comms_contacts` (`name`, `mobile`, `email`, `extra`);
  `comms_messages.recipient_address`; `message_request_recipients` (`name`, `address`); `message_requests.upload`
  (an uploaded list of names, mobiles, e-mails) and `preview`; `appointments` (`visitor_name`, `visitor_mobile`,
  `visitor_email`, `visitor_org`); `visitor_log` (`visitor_name`, `mobile`, `email`, `organisation`, `vehicle_no`);
  `gate_passes` (`escort_name`, `escort_relation`, `escort_mobile`, `destination`); `consent_form_responses`
  (`signed_name`, `public_name`, `public_mobile`, `public_email`); `consent_otps.address`; `clinic_masters.mobile`,
  `reg_no`; `helpdesk_settings` provider names and e-mails; `helpdesk_levels.emails`.
- **Identity proofs and codes**: `appointments.id_proof_kind` / `id_proof_last4`, `visitor_log.id_proof_kind` /
  `id_proof_last4` (never the full number); `pass_code` on appointments, visitors and gate passes;
  `gate_passes.otp_hash`; `consent_otps.code_hash`; message bodies of sign-in codes.
- **Photos and signatures**: `appointment_photos.bytes`, `visitor_photos.bytes`, `gate_pass_photos.bytes`,
  `consent_form_signatures.png`; gallery photos of children (`gallery_items.file_id`, `gallery_albums.cover_file_id`).
- **Free text about people**: `comms_messages.body` / `subject` / `variables` / `params` (personalised: child's name,
  fee due, OTP); `comms_delivery_events.payload` / `reason` (gateway data with the phone number);
  `parent_queries` (`subject`, `body`, `resolution`, `workaround`, `rating_comment`, `decision`), `query_responses.body`,
  `query_events.detail`; `feedback_entries.comment`; `consent_form_responses.answers` / `files` and
  `consent_form_response_versions.answers`; `consents.note`; `gate_passes` (`reason`, `decision_note`,
  `handover_remark`, `gate_note`, `cancel_reason`); `appointments` (`purpose`, `decision_note`, `cancel_reason`),
  `appointment_events.detail`; `visitor_log` (`purpose`, `equipment`, `exit_note`, `warden_note`); `cctv_requests`
  (`reason`, `camera`, `from_at`, `to_at` — footage of children); `file_notes` (`subject`, `body_html`, `file_ids`),
  `file_note_levels.remark`, `file_note_events.remark`; `notices.body` and pupil / employee `notice_targets`.
- **Personal choices and traces**: `consents` (each person's DPDP choices), `privacy_acknowledgements.ip`,
  `push_devices` (`token`, `user_agent`), `comms_inbox_reads`, `family_help_votes`; `birthday_wishes.on_date` reveals a
  date of birth.
- **Secrets (never read)**: `comms_providers.secret` (encrypted gateway keys) and `config`, `consent_webhooks.secret`,
  `consent_api_keys.key_hash`.
