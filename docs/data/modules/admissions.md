# Admissions — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

A family's interest is first an **enquiry** that counsellors follow up. The school opens an **admission session**
(`admission_cycles`, per joining year) with classes, seats, forms and fees. A family signs in as an **applicant**
and fills one **application** per child; the registration fee makes it a numbered **registration**. It then walks
the class's **process** (document check, test, interview, selection: decisions, slots, marks, merit, draws) to an
**offer**; the admission fee gives the admission number and **Admit** creates the student, parents and enrolment.
Cancellations, refunds, moves between group schools and a later "cancel admission" are kept too.

## Tables

| Table                          | One row is                                                              | Key columns                                                                                                                                                                                                                                                                                          | For reports                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `applications`                 | one child's application in one session (a "registration" once numbered) | `cycle_id`, `class_id` (class sought), `applicant_id`, `application_no` (registration no., unique per school), `status` application_status, `category_id`, `student_id` (set at Admit), `admission_no`, dates `submitted_at`/`registered_at`/`offered_at`/`fee_paid_at`/`admitted_at`/`cancelled_at` | **main (spine)**                               |
| `application_events`           | one status change of an application                                     | `application_id`, `from_status`, `to_status`, `note`, `actor_user_id` or `actor_applicant_id`, `created_at`                                                                                                                                                                                          | history                                        |
| `admission_cycles`             | an admission session (UI: "session")                                    | `academic_year_id` (the year the children join), `code`, `name`, `status` draft/open/closed, `opens_at`/`closes_at`, `offer_days`, `refund_deduction_pct`, `deleted_at`                                                                                                                              | master (spine of a session report)             |
| `admission_class_criteria`     | a class line of a session                                               | `cycle_id` + `class_id` (unique), `seats`, `form_id`, `dob_from`/`dob_to`/`age_as_on`, `opens_at`/`closes_at`, `status` open/closed, `own_points`, `merit_seed`                                                                                                                                      | master                                         |
| `admission_forms`              | a form made in the form builder                                         | `name`, `def` jsonb (steps, fields, settings), `status` active/archived                                                                                                                                                                                                                              | master                                         |
| `admission_fee_categories`     | a fee category decided from the form's answers (General, EWS…)          | `code` (unique per school), `conditions` jsonb, `logic` all/any, `is_default`, `status`                                                                                                                                                                                                              | master                                         |
| `admission_fees`               | registration and admission fee of a class × category in a session       | `cycle_id` + `class_id` + `category_id` (unique), `registration_fee`, `admission_fee`, `seats` (category seats; NULL = shares the class seats)                                                                                                                                                       | master                                         |
| `admission_stages`             | a stage of the school (Document check, Written test…)                   | `name`, `kind` document_check/test/interview/interaction/selection/custom, `max_marks`, `status`                                                                                                                                                                                                     | master                                         |
| `admission_processes`          | an ordered list of stages with approval levels                          | `name`, `steps` jsonb `[{stageId, levels:[{name, by, roleCode, designation, employeeIds, days}]}]`, `status` active/archived                                                                                                                                                                         | master                                         |
| `admission_process_classes`    | which process a class follows                                           | PK `school_id`+`class_id`, `process_id`                                                                                                                                                                                                                                                              | master                                         |
| `admission_stage_results`      | one decision at one stage and level                                     | `application_id`, `stage_id`, `level`, `decision` approved/rejected/hold/offered/waitlisted, `attendance`, `marks`/`max_marks`, `decided_at`, `undone_at`                                                                                                                                            | detail (history of decisions)                  |
| `admission_slots`              | a test / interview slot                                                 | `cycle_id`, `stage_id`, `class_id` (NULL = all classes), `starts_at`, `minutes`, `venue`, `capacity`                                                                                                                                                                                                 | detail                                         |
| `admission_slot_allotments`    | a candidate placed in a slot                                            | `slot_id`, `stage_id`, `application_id` (unique per stage), `roll_no`, `notified_at`                                                                                                                                                                                                                 | detail                                         |
| `admission_papers`             | the paper of a test/interview stage for a class                         | `stage_id` + `class_id` (unique), `min_percent` (cut-off flag only)                                                                                                                                                                                                                                  | master                                         |
| `admission_paper_parts`        | a part of a paper (a subject, an interview parameter)                   | `paper_id`, `name`, `max_marks`, `pass_marks`, `item_id`, `status`                                                                                                                                                                                                                                   | master                                         |
| `admission_paper_items`        | the school's list of subjects / parameters parts pick from              | `name`, `kind` test/interview/both, `max_marks`, `status`                                                                                                                                                                                                                                            | master                                         |
| `admission_part_marks`         | a candidate's marks in one part                                         | `application_id` + `part_id` (unique), `stage_id`, `part_name`, `max_marks` (copied as entered), `marks`                                                                                                                                                                                             | detail                                         |
| `admission_stage_marks`        | a candidate's total for a test/interview stage                          | `application_id` + `stage_id` (unique), `absent`, `total`, `max_total`, `remark`                                                                                                                                                                                                                     | detail                                         |
| `admission_result_releases`    | when families may see a stage's marks                                   | `cycle_id` + `class_id` + `stage_id` (unique), `release_at`, `told_at`, `told_count`                                                                                                                                                                                                                 | detail                                         |
| `admission_result_release_log` | each change to a release                                                | `cycle_id`, `class_id`, `stage_id`, `what` set/moved/taken_back/told, `was_out`, `reason`, `at`                                                                                                                                                                                                      | history                                        |
| `admission_point_rules`        | a merit-point criterion                                                 | `cycle_id`, `class_id` (NULL = the session's list), `kind` fixed/table/sibling, `conditions`, `logic`, `points`, `cap`, `spec`                                                                                                                                                                       | master                                         |
| `admission_qualifications`     | score table: a parent's qualification                                   | `name`, `father_score`/`mother_score`, `father_weight`/`mother_weight`, `status`                                                                                                                                                                                                                     | master                                         |
| `admission_localities`         | score table: a locality / distance band                                 | `name`, `class_id` (NULL = all), `band`, `area`, `score`, `status`                                                                                                                                                                                                                                   | master                                         |
| `admission_alumni_schools`     | score table: an alumni school and pass-out class                        | `name`, `passout_class`, `score`, `status`                                                                                                                                                                                                                                                           | master                                         |
| `admission_score_criteria`     | a scoring criterion of the first (Sprint 8) flow                        | `cycle_id` + `code` (unique), `points`, `auto_rule`                                                                                                                                                                                                                                                  | master (first flow)                            |
| `admission_draws`              | a computer draw of lots of the first flow                               | `cycle_id`, `class_id`, `seed`, `candidates`, `seats`, `picked` bigint[] (application ids)                                                                                                                                                                                                           | history (first flow)                           |
| `admission_hand_draws`         | a draw of lots made by hand with printed slips                          | `cycle_id`, `class_id`, `category_id`, `points` (the merit tied), `seats`, `slips` jsonb (order, ids, outcome), `offered`, `waitlisted`, `extra_seats`                                                                                                                                               | history                                        |
| `admission_draw_settings`      | how draw slips print for a session or class                             | `cycle_id`, `class_id` (NULL = session), `heading`, `fields`, `per_page`                                                                                                                                                                                                                             | internal (settings)                            |
| `admission_twin_pairs`         | two registrations found to be twins (one slip)                          | `app_a` < `app_b` (unique), `cycle_id`, `class_id`, `state` paired/split                                                                                                                                                                                                                             | detail                                         |
| `admission_offers`             | an offer of the first flow (with a payment intent)                      | `application_id` (unique), `expires_at`, `admission_fee`, `intent_id`, `status` offer_status                                                                                                                                                                                                         | detail (first flow)                            |
| `admission_corrections`        | a "send back for correction" to the family                              | `application_id`, `stage_id`, `level`, `fields` text[], `remark`, `due_on`, `status` open/resubmitted/cancelled                                                                                                                                                                                      | detail                                         |
| `application_answer_changes`   | one answer the office corrected before Admit                            | `application_id`, `field_key`, `label`, `old_value`, `new_value`, `reason`, `changed_at`                                                                                                                                                                                                             | history                                        |
| `admission_refunds`            | a refund of money paid on a registration                                | `application_id`, `receipt_id` → misc_receipts, `paid_amount`, `deduction_pct`, `deduction`, `amount` (to return), `status` requested/approved/rejected/paid, `mode`, `paid_on`, `workflow_instance_id`                                                                                              | main (money out)                               |
| `admission_moves`              | a registration moved to another school of the group                     | `from_school_id`, `to_school_id`, `from_application_id`, `to_application_id`, `status` requested/accepted/refused/withdrawn, `carried`, `to_registration`, `difference_due`, `credit`                                                                                                                | history (no `school_id`: seen by both schools) |
| `admission_cancellations`      | a request to cancel an admitted student's admission                     | `student_id`, `academic_year_id`, `settlement` refund/retain, `status` pending/applied/rejected/withdrawn, `withdrawal_id`, `workflow_instance_id`                                                                                                                                                   | main (student side)                            |
| `admission_no_changes`         | one change of a student's admission number                              | `student_id`, `old_no`, `new_no`, `reason`, `changed_at`                                                                                                                                                                                                                                             | history                                        |
| `admission_passcodes`          | a late-entry passcode for one family and class                          | `cycle_id`, `class_id`, `email`, `mobile`, `valid_until`, `status` active/revoked, `used_by` → applicants, `used_at`                                                                                                                                                                                 | detail                                         |
| `applicants`                   | a family's portal login (one per mobile)                                | `mobile` (unique per school), `email`, `name`, `last_login_at`                                                                                                                                                                                                                                       | master (people)                                |
| `applicant_inbox_reads`        | a notice / message / query a family opened                              | PK `applicant_id`+`kind`+`item_id`, `read_at`                                                                                                                                                                                                                                                        | internal                                       |
| `admission_enquiries`          | one enquiry (lead)                                                      | `cycle_id`, `class_id`, `source_id`, `status`, `stage_id`, `score`, `counsellor_user_id`, `next_follow_up_on`, `first_contact_at`, `application_id`, `converted_at`, `level`, `created_at`                                                                                                           | **main (spine of enquiry reports)**            |
| `admission_enquiry_followups`  | one contact or note on an enquiry                                       | `enquiry_id`, `mode`, `outcome`, `next_on`, `status_after`, `by_user_id`, `at`                                                                                                                                                                                                                       | detail / history                               |
| `admission_enquiry_sources`    | a source of enquiries (Website, Newspaper…)                             | `name`, `sort_order`, `status`                                                                                                                                                                                                                                                                       | master                                         |
| `admission_enquiry_stages`     | a lead stage of the school                                              | `code` (unique per school), `name`, `kind` open/started/registered/admitted/lost, `sort_order`, `status`                                                                                                                                                                                             | master                                         |
| `admission_enquiry_rules`      | an assignment / escalation rule for leads                               | `class_ids`, `source_ids`, `pool`, `pool_roles`, `first_contact_hours`, `level2_user_id`/`level2_role`, `is_default`, `status`                                                                                                                                                                       | master                                         |
| `admission_settings`           | the school's admission settings (one row)                               | PK `school_id`; `signin_channels`, receipt prefixes, `otp_on_screen`, enquiry switches                                                                                                                                                                                                               | internal (settings)                            |
| `admission_number_series`      | a registration or admission number series                               | `kind` registration/admission, `cycle_id`, `class_id`, `conditions`, `prefix`, `next_no`, `digits`, `given`, `last_given`                                                                                                                                                                            | internal (sequence)                            |
| `admission_sequences`          | the school-wide fallback admission number counter                       | PK `school_id`; `prefix`, `last_serial`                                                                                                                                                                                                                                                              | internal (sequence)                            |
| `application_sequences`        | the per-session fallback registration number counter                    | PK `cycle_id`; `last_serial`                                                                                                                                                                                                                                                                         | internal (sequence)                            |
| `admission_receipt_sequences`  | registration / admission receipt numbering                              | PK `school_id`+`prefix`+`session_code`; `last_serial`                                                                                                                                                                                                                                                | internal (sequence)                            |
| `admission_level_digests`      | the morning "waiting for you" email sent to one user                    | PK `school_id`+`user_id`+`day`; `items`, `sent_at`                                                                                                                                                                                                                                                   | internal (log)                                 |
| `public_otps`                  | a sign-in code sent to a family                                         | `mobile`, `purpose`, `code_hash`, `expires_at`, `attempts`, `consumed_at`, `ip`, `shown_on_screen`                                                                                                                                                                                                   | internal (log)                                 |
| `application_stage_results`    | **not admissions**: a stage result of a _job_ application (recruitment) | `application_id` → job_applications, `stage_id` → recruitment_stages, `result` pass/fail/hold/skipped                                                                                                                                                                                                | see the HR guide                               |

## How the tables join

Spine: **`applications`** for everything about registrations; **`admission_enquiries`** for leads; a session report
starts from `admission_cycles` (and `admission_class_criteria` for the class lines).

Session, class and seats

- `applications.cycle_id → admission_cycles.id`; `admission_cycles.academic_year_id → academic_years.id`
- `applications.class_id → classes.id` (the class sought; there is no section until Admit)
- `admission_class_criteria.(cycle_id, class_id)` = `applications.(cycle_id, class_id)` (seats, window, form)
- `admission_fees.(cycle_id, class_id, category_id)` = `applications.(cycle_id, class_id, category_id)`;
  `applications.category_id → admission_fee_categories.id`
- `applications.form_id → admission_forms.id` (`applications.form_snapshot` = the form as it was filled)

Family and history

- `applications.applicant_id → applicants.id` (several children per applicant)
- `application_events.application_id → applications.id` (status history)
- `application_answer_changes.application_id`, `admission_corrections.application_id → applications.id`
- `applications.possible_duplicate_of → applications.id`; `admission_twin_pairs.app_a / app_b → applications.id`

Process, stages and marks

- `applications.process_id → admission_processes.id`; the step waiting is
  `(applications.process_steps -> applications.stage_no ->> 'stageId')::bigint → admission_stages.id`, level = `level_no`
- `admission_process_classes.class_id → classes.id`, `.process_id → admission_processes.id`
- `admission_stage_results.(application_id, stage_id) → applications.id, admission_stages.id`
- `admission_slot_allotments.slot_id → admission_slots.id`; `.application_id → applications.id`
- `admission_papers.(stage_id, class_id)`; `admission_paper_parts.paper_id → admission_papers.id`;
  `admission_paper_parts.item_id → admission_paper_items.id`
- `admission_part_marks.part_id → admission_paper_parts.id`; `admission_part_marks.(application_id, stage_id)` =
  `admission_stage_marks.(application_id, stage_id)`
- `admission_result_releases` / `admission_result_release_log` by `(cycle_id, class_id, stage_id)`
- A view `admission_waiting` (not a table, not in the digest) lists registrations waiting at a level with `due_at`.

Money (out to the fees module)

- `applications.registration_receipt_id`, `applications.admission_receipt_id → misc_receipts.id`
- every receipt of a registration: `misc_receipts.application_id → applications.id`, head by
  `misc_receipts.head_id → fee_heads.id` with `fee_heads.code` `ADMREG` (registration) or `ADMFEE` (admission)
- `admission_refunds.application_id → applications.id`; `admission_refunds.receipt_id → misc_receipts.id`
- `admission_offers.intent_id → payment_intents.id` (first flow only)

Enquiries

- `admission_enquiries.source_id → admission_enquiry_sources.id`; `.stage_id → admission_enquiry_stages.id`;
  `.rule_id → admission_enquiry_rules.id`; `.counsellor_user_id → users.id`
- `admission_enquiries.application_id → applications.id` (set when the family registers) and back
  `applications.enquiry_id → admission_enquiries.id`
- `admission_enquiry_followups.enquiry_id → admission_enquiries.id`

Out to the backbone (after Admit)

- `applications.student_id → students.id`; the class-section given:
  `enrolments.student_id = applications.student_id AND enrolments.academic_year_id = admission_cycles.academic_year_id`
  → `class_sections` → `classes`
- `admission_cancellations.student_id → students.id`; `.withdrawal_id → student_withdrawals.id`
- `admission_no_changes.student_id → students.id`
- decided / entered by: `decided_by`, `entered_by`, `created_by`, `by_user_id`, `counsellor_user_id` → `users.id`

## Life-cycles and statuses

**`applications.status` (application_status).** Two flows share the table. The online admission flow (docs 39–64,
the one in use; rows have `form_id` set) and the first Sprint 8/9 flow (`form_id` NULL, uses `shortlisted`,
`selected` and `admission_offers`).

| Value                      | Meaning                                                                                | Count as                                      |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `draft`                    | form started, not submitted                                                            | only "forms started"; exclude everywhere else |
| `submitted`                | form submitted, registration fee due (first flow: submitted for review)                | "fee due", not registered                     |
| `registered`               | registration fee paid or none due: `application_no` given, enters the process          | registered, in process                        |
| `under_review`             | in the approval process (after a decision or a correction)                             | registered, in process                        |
| `sent_back`                | sent to the family for correction (`admission_corrections` open)                       | registered, in process                        |
| `shortlisted` / `selected` | first flow only                                                                        | in process / selected                         |
| `waitlisted`               | on the waiting list (`wait_rank`)                                                      | registered, selected list                     |
| `offered`                  | seat offered: `admission_fee`, `offered_at`, `offer_expires_at`; may be part-paid      | selected list                                 |
| `fee_paid`                 | admission fee fully paid (or covered by credit): `admission_no` given, waits for Admit | **admitted** (app reports)                    |
| `admitted`                 | Admit done: student, parents, enrolment created; `student_id`, `admitted_at`           | **admitted**                                  |
| `rejected`                 | not selected at a stage ("Not selected")                                               | closed                                        |
| `withdrawn`                | the family withdrew, or the offer lapsed unpaid (the lapse sets this)                  | closed                                        |
| `cancelled`                | cancelled by the office, moved to another school, or the admission cancelled later     | closed                                        |

Which count as "admitted": the app's reports (ready reports, enquiry report) count `status IN ('fee_paid',
'admitted')`. In the student master: `status = 'admitted'`. Ever admitted, including those cancelled later:
`student_id IS NOT NULL`. The first flow sets `admitted` without `admitted_at`; use `student_id`, not
`admitted_at`, to find admissions of both flows. Registered = `application_no IS NOT NULL`.

The path: `draft → submitted → registered → (under_review ⇄ sent_back) → offered | waitlisted | rejected →
fee_paid → admitted`; `waitlisted → offered` when a seat frees; `offered → withdrawn` on lapse; any open status →
`cancelled` or `withdrawn`; `admitted → cancelled` through `admission_cancellations`. Every change writes a row in
`application_events` (from, to, note, who). An undone decision moves the registration back to `under_review`.

**`admission_stage_results.decision`**: approved, rejected, hold, offered, waitlisted; `attendance` present/absent.
`undone_at IS NOT NULL` = undone; leave it out. The live decision of a (stage, level) is the latest not undone.
A step is passed when every level's live decision is `approved` or `offered`.

**Other status columns**

- `admission_cycles.status` admission_cycle_status: draft (being set up), open, closed. `deleted_at` = removed.
- `admission_class_criteria.status` open/closed (a class can close before the session).
- `admission_corrections.status`: open → resubmitted (family corrected) or cancelled.
- `admission_offers.status` offer_status (first flow): offered, accepted, declined, expired, withdrawn.
- `admission_refunds.status`: requested → approved → paid, or rejected. `mode` cash/bank/cheque/gateway/transfer
  (`transfer` = money carried to another school by a move, no cash left the school).
- `admission_moves.status`: requested → accepted (old registration `cancelled`, new one made in the other school)
  or refused / withdrawn.
- `admission_cancellations.status`: pending → applied (done) or rejected / withdrawn; `apply_error` = approved but
  could not be written.
- `admission_passcodes.status` active/revoked; `admission_twin_pairs.state` paired/split.
- `admission_result_release_log.what`: set, moved, taken_back, told.
- Master `status` columns (`active`/`inactive` or `active`/`archived`): filter to active only for set-up lists.

**Enquiries.** `admission_enquiries.status`: new, follow_up, interested (open); converted (the family registered:
`application_id`, `converted_at`); not_interested, closed (lost). `stage_id` is the school's own board stage; a
trigger keeps status and stage in step (stage kinds open/started/registered/admitted/lost). A registration moves its
enquiry to "started" (draft) and "admitted"; conversion happens at registration. `score` hot/warm/cold; `level` 2 =
escalated to the second person (`escalated_at`). Follow-up `mode`: call, visit, email, sms, whatsapp, note, invite,
system, reply; the first call/visit/message/reply/invite sets `first_contact_at`.

## Amounts, dates and counting rules

- **Fees set vs money taken.** `admission_fees` holds the fee per class × category; `applications.registration_fee`
  and `applications.admission_fee` are what this registration was asked (copied when the form is submitted and when the offer is made).
  The money actually received is in the fees module: `misc_receipts` with `application_id`, `status = 'posted'`,
  heads `ADMREG` / `ADMFEE` (one admission fee may be paid in several parts). `misc_receipts.convenience_charge` is
  extra to `amount`. Money returned is `admission_refunds.amount` with `status = 'paid'` (`amount = paid_amount −
deduction`); leave out `mode = 'transfer'` when you mean cash refunds. `applications.transfer_credit` = money
  carried in from another school not used yet. All amounts are rupees, positive.
- **Merit.** `applications.form_points` = points from the form's answers (`points_breakdown`); `merit` = form points +
  the live stage marks (cached on the row, refreshed by the API). Ties: older child first (`child_dob`), then the
  class's draw (`admission_class_criteria.merit_seed`). The first flow used `score` / `score_breakdown`.
- **Marks.** Part marks keep `part_name` and `max_marks` as entered; the stage total is `admission_stage_marks.total`
  (NULL when absent or nothing entered); the decision copies it into `admission_stage_results.marks`.
- **Dates.** Group registrations by `registered_at`, forms by `submitted_at`, offers by `offered_at`, admissions by
  `fee_paid_at` (admission number given) or `admitted_at`, cancellations by `cancelled_at`, enquiries by `created_at`.
  All are timestamptz: convert with `AT TIME ZONE 'Asia/Kolkata'` before `::date`. A session belongs to the
  academic year the children join (`admission_cycles.academic_year_id`), usually the next year, not the current one.
- **One row per what.** One application per child per session (the same child may apply twice; see Traps).
  `admission_offers` one per application; `admission_stage_marks` one per application and stage;
  `admission_part_marks` one per application and part; `admission_slot_allotments` one per application and stage;
  `admission_fees` one per session, class and category; `admission_class_criteria` one per session and class.
- **Numbers.** `application_no` (registration number) comes from `admission_number_series` (kind registration) or
  `app.next_application_no` (`APP/<code>/00001`); renumbered rows keep `previous_numbers`. `admission_no` comes from
  the admission series and is never given again, even when cancelled.

## Answering report questions

**1. How is each class of this session doing (seats, registered, in process, admitted, closed)?**

```sql
SELECT k.display_order, k.name AS class_name,
       acc.seats,
       count(a.id) FILTER (WHERE a.status <> 'draft')                                             AS forms_submitted,
       count(a.id) FILTER (WHERE a.application_no IS NOT NULL)                                    AS registered,
       count(a.id) FILTER (WHERE a.status IN ('registered', 'under_review', 'sent_back', 'shortlisted')) AS in_process,
       count(a.id) FILTER (WHERE a.status IN ('selected', 'waitlisted', 'offered'))               AS selected_or_waiting,
       count(a.id) FILTER (WHERE a.status = 'fee_paid')                                           AS fee_paid_not_admitted,
       count(a.id) FILTER (WHERE a.status = 'admitted')                                           AS admitted,
       count(a.id) FILTER (WHERE a.status IN ('rejected', 'withdrawn', 'cancelled'))              AS closed
  FROM admission_cycles cy
  JOIN admission_class_criteria acc ON acc.cycle_id = cy.id
  JOIN classes k ON k.id = acc.class_id
  LEFT JOIN applications a ON a.cycle_id = cy.id AND a.class_id = acc.class_id
 WHERE cy.code = '2027-28' AND cy.deleted_at IS NULL
 GROUP BY k.display_order, k.name, acc.seats
 ORDER BY k.display_order
```

Base tables, always live. Replace the session code. `fee_paid` is counted apart so you can add it to admitted.

**2. The same funnel, fast, for a dashboard.**

```sql
SELECT f.class_code,
       sum(f.applications) FILTER (WHERE f.status <> 'draft')       AS submitted,
       sum(f.applications) FILTER (WHERE f.status IN ('fee_paid', 'admitted')) AS admitted,
       sum(f.applications) FILTER (WHERE f.status = 'cancelled')    AS cancelled,
       sum(f.applications)                                          AS all_rows
  FROM mart.admissions_funnel f
 WHERE f.cycle_code = '2027-28'
 GROUP BY f.class_code
 ORDER BY f.class_code
```

`mart.admissions_funnel` is one row per session, class and status, refreshed every 15 minutes; it counts drafts and
both flows, and does not drop deleted sessions.

**3. Registration and admission money by class, after refunds (crosses into fees).**

```sql
WITH paid AS (
  SELECT a.class_id,
         sum(m.amount) FILTER (WHERE h.code = 'ADMREG') AS registration_fees,
         sum(m.amount) FILTER (WHERE h.code = 'ADMFEE') AS admission_fees
    FROM misc_receipts m
    JOIN fee_heads h ON h.id = m.head_id
    JOIN applications a ON a.id = m.application_id
    JOIN admission_cycles cy ON cy.id = a.cycle_id
   WHERE cy.code = '2027-28' AND m.status = 'posted'
   GROUP BY a.class_id
), refunded AS (
  SELECT a.class_id, sum(r.amount) AS refunds_paid
    FROM admission_refunds r
    JOIN applications a ON a.id = r.application_id
    JOIN admission_cycles cy ON cy.id = a.cycle_id
   WHERE cy.code = '2027-28' AND r.status = 'paid'
   GROUP BY a.class_id
)
SELECT k.name AS class_name, COALESCE(p.registration_fees, 0) AS registration_fees,
       COALESCE(p.admission_fees, 0) AS admission_fees, COALESCE(r.refunds_paid, 0) AS refunds_paid,
       COALESCE(p.registration_fees, 0) + COALESCE(p.admission_fees, 0) - COALESCE(r.refunds_paid, 0) AS net
  FROM classes k
  LEFT JOIN paid p ON p.class_id = k.id
  LEFT JOIN refunded r ON r.class_id = k.id
 WHERE p.class_id IS NOT NULL OR r.class_id IS NOT NULL
 ORDER BY k.display_order
```

Money comes from `misc_receipts`, not from `applications.registration_fee` (that is only what was asked).

**4. Which enquiry sources bring admissions?**

```sql
SELECT COALESCE(s.name, 'Not given')                                                  AS source,
       count(*)                                                                       AS enquiries,
       count(*) FILTER (WHERE e.status IN ('new', 'follow_up', 'interested'))         AS still_open,
       count(*) FILTER (WHERE a.application_no IS NOT NULL)                           AS registered,
       count(*) FILTER (WHERE a.status IN ('fee_paid', 'admitted'))                   AS admitted,
       count(*) FILTER (WHERE e.status IN ('not_interested', 'closed'))               AS lost
  FROM admission_enquiries e
  LEFT JOIN admission_enquiry_sources s ON s.id = e.source_id
  LEFT JOIN applications a ON a.id = e.application_id
 WHERE (e.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN DATE '2026-10-01' AND DATE '2027-03-31'
 GROUP BY 1
 ORDER BY 2 DESC
```

The same rule as the app's enquiry report: admitted = `fee_paid` or `admitted`.

**5. The merit list of a class.**

```sql
SELECT row_number() OVER (ORDER BY a.merit DESC NULLS LAST, a.child_dob ASC NULLS LAST, a.id) AS merit_no,
       a.application_no, a.candidate_name, fc.name AS fee_category,
       a.form_points, a.merit, a.status, a.wait_rank
  FROM applications a
  JOIN admission_cycles cy ON cy.id = a.cycle_id
  JOIN classes k ON k.id = a.class_id
  LEFT JOIN admission_fee_categories fc ON fc.id = a.category_id
 WHERE cy.code = '2027-28' AND k.code = 'NUR'
   AND a.application_no IS NOT NULL
   AND a.status IN ('registered', 'under_review', 'sent_back', 'waitlisted')
```

Ties beyond date of birth are broken by the class draw seed in the app; this sketch uses the row id instead.

**6. Written test results by subject.**

```sql
SELECT st.name AS stage, pm.part_name, pm.max_marks,
       count(pm.marks)                 AS marked,
       round(avg(pm.marks), 2)         AS average,
       max(pm.marks)                   AS highest,
       count(DISTINCT pm.application_id) FILTER (WHERE sm.absent) AS absent
  FROM admission_part_marks pm
  JOIN admission_stages st ON st.id = pm.stage_id
  JOIN applications a ON a.id = pm.application_id
  JOIN admission_cycles cy ON cy.id = a.cycle_id
  LEFT JOIN admission_stage_marks sm ON sm.application_id = pm.application_id AND sm.stage_id = pm.stage_id
 WHERE cy.code = '2027-28' AND st.kind = 'test' AND a.status <> 'cancelled'
 GROUP BY st.name, pm.part_name, pm.max_marks
 ORDER BY st.name, pm.part_name
```

`part_name` and `max_marks` are as entered, so a renamed part still groups under its old name.

**7. Where are registrations waiting, and for how long?**

```sql
SELECT k.name AS class_name, st.name AS waiting_at, a.level_no,
       count(*)                                                         AS waiting,
       max(now() - COALESCE(a.level_since, a.registered_at))            AS longest_wait
  FROM applications a
  JOIN classes k ON k.id = a.class_id
  JOIN admission_cycles cy ON cy.id = a.cycle_id
  LEFT JOIN admission_stages st ON st.id = (a.process_steps -> a.stage_no ->> 'stageId')::bigint
 WHERE cy.status = 'open' AND a.status IN ('registered', 'under_review')
   AND a.process_steps IS NOT NULL AND a.stage_no < jsonb_array_length(a.process_steps)
 GROUP BY k.display_order, k.name, st.name, a.level_no
 ORDER BY k.display_order, st.name, a.level_no
```

Mirrors the `admission_waiting` view: only `registered` / `under_review` rows wait at a level.

**8. Offers that lapse in the next three days and are not paid.**

```sql
SELECT a.application_no, a.candidate_name, k.name AS class_name, a.admission_fee, a.transfer_credit,
       (a.offer_expires_at AT TIME ZONE 'Asia/Kolkata') AS pay_by,
       COALESCE((SELECT sum(m.amount) FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                  WHERE m.application_id = a.id AND h.code = 'ADMFEE' AND m.status = 'posted'), 0) AS paid_so_far
  FROM applications a
  JOIN classes k ON k.id = a.class_id
 WHERE a.status = 'offered' AND a.offer_expires_at BETWEEN now() AND now() + interval '3 days'
 ORDER BY a.offer_expires_at
```

Part payments keep the row `offered`; it becomes `fee_paid` only when the whole fee is in.

**9. Refunds of admission money by status.**

```sql
SELECT r.status, count(*) AS refunds, sum(r.paid_amount) AS paid_in, sum(r.deduction) AS kept_back,
       sum(r.amount) AS to_return, count(*) FILTER (WHERE r.mode = 'transfer') AS moved_to_other_school
  FROM admission_refunds r
  JOIN applications a ON a.id = r.application_id
  JOIN admission_cycles cy ON cy.id = a.cycle_id
 WHERE cy.code = '2027-28'
 GROUP BY r.status
 ORDER BY r.status
```

`to_return` of `paid` rows is money out, except `mode = 'transfer'` (moved to another school).

**10. Where are the children admitted through this session now (crosses into people)?**

```sql
SELECT a.admission_no, a.candidate_name, k.name AS class_sought,
       c2.code || '-' || cs.name AS section_now, e.status AS enrolment_status, s.status AS student_status,
       (a.admitted_at AT TIME ZONE 'Asia/Kolkata')::date AS admitted_on
  FROM applications a
  JOIN admission_cycles cy ON cy.id = a.cycle_id
  JOIN classes k ON k.id = a.class_id
  JOIN students s ON s.id = a.student_id
  LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = cy.academic_year_id
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes c2 ON c2.id = cs.class_id
 WHERE cy.code = '2027-28' AND a.student_id IS NOT NULL
 ORDER BY k.display_order, a.admission_no
```

Uses `student_id`, so both flows and later cancellations show; `enrolment_status = 'cancelled'` = admission cancelled.

**11. Counsellor workload on open enquiries.**

```sql
SELECT u.display_name AS counsellor,
       count(*)                                                                     AS open_enquiries,
       count(*) FILTER (WHERE e.next_follow_up_on < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS follow_up_overdue,
       count(*) FILTER (WHERE e.first_contact_at IS NULL AND e.contact_due_at < now())          AS first_contact_late,
       count(*) FILTER (WHERE e.level = 2)                                          AS escalated,
       count(*) FILTER (WHERE e.score = 'hot')                                      AS hot
  FROM admission_enquiries e
  LEFT JOIN users u ON u.id = e.counsellor_user_id
 WHERE e.status IN ('new', 'follow_up', 'interested')
 GROUP BY u.display_name
 ORDER BY 2 DESC
```

Dates of follow-ups are India dates; `contact_due_at` is set by the assignment rule.

**12. Seats per fee category against offers and admissions.**

```sql
SELECT k.name AS class_name, fc.name AS category, af.seats AS category_seats,
       af.registration_fee, af.admission_fee,
       count(a.id) FILTER (WHERE a.status = 'offered')                AS offered_open,
       count(a.id) FILTER (WHERE a.status IN ('fee_paid', 'admitted')) AS taken
  FROM admission_fees af
  JOIN admission_cycles cy ON cy.id = af.cycle_id
  JOIN classes k ON k.id = af.class_id
  JOIN admission_fee_categories fc ON fc.id = af.category_id
  LEFT JOIN applications a ON a.cycle_id = af.cycle_id AND a.class_id = af.class_id AND a.category_id = af.category_id
 WHERE cy.code = '2027-28'
 GROUP BY k.display_order, k.name, fc.sort_order, fc.name, af.seats, af.registration_fee, af.admission_fee
 ORDER BY k.display_order, fc.sort_order
```

`admission_fees.seats` NULL means the category shares the class's seats in `admission_class_criteria.seats`.

## Traps

- **Two flows in one table.** Rows with `form_id` NULL come from the first flow (statuses `shortlisted`/`selected`,
  offers in `admission_offers`, no `admitted_at`). The app's admissions list and ready reports show only
  `form_id IS NOT NULL`; the mart counts both. Say which you want.
- **Drafts inflate everything.** Always filter `status <> 'draft'` unless you report forms started.
- **"Admitted" has three meanings** (see the status table). `fee_paid` rows have an admission number but no student.
- **Cancelled after admission.** An admitted child whose admission is cancelled shows `status = 'cancelled'` with
  `student_id` set; the enrolment becomes `cancelled` and the student `inactive`.
- **Moves between schools.** An accepted move cancels the registration here and creates a new one in the other
  school; group-wide totals count the child twice unless `cancelled` is left out. `admission_moves` has no
  `school_id`: both schools see the row.
- **Duplicates.** The same child may be registered twice (`possible_duplicate_of`); the app only flags it.
- **Undone decisions.** Filter `admission_stage_results.undone_at IS NULL`, and take the latest per stage and level.
- **Lapsed offers look withdrawn.** `withdrawn` covers both a family's withdrawal and an offer that ran out.
- **Cached columns.** `merit`, `form_points`, `stage_no`, `level_no`, `wait_rank`, `progress` are kept by the API;
  `admission_number_series.given` and the sequence tables are counters, not counts of records.
- **Encrypted answers.** In `applications.data` the ID answers (Aadhaar, APAAR, PEN) are stored as `enc:` ciphertext;
  other answers are plain jsonb keyed by the form's field keys (see `form_snapshot`).
- **The session's year is the joining year.** Do not join `admission_cycles.academic_year_id` to "this year" when
  you mean the year the registrations happened.
- **Time zones.** Every `*_at` is timestamptz; group by the India date.
- **`application_stage_results` is recruitment**, not admissions; admissions decisions are `admission_stage_results`.

## Personal and sensitive data

Mask or keep away from an AI model:

- `applications`: `child_first_name`, `child_last_name`, `candidate_name`, `child_dob`, `child_gender`,
  `contact_mobile`, `contact_email`, `data` (all the form's answers: parents' names, mobiles, e-mails, addresses,
  income, occupation, siblings, previous school, health and special needs; ID numbers as ciphertext), `remarks`,
  `cancel_reason`, `passcode_used`, files `pdf_file_id`, `admission_form_file_id`.
- `applicants`: `name`, `mobile`, `email`. `public_otps`: `mobile`, `ip`, `code_hash`.
- `admission_enquiries`: `parent_name`, `child_name`, `child_dob`, `mobile`, `email`, `locality`,
  `previous_school`, `notes`, `lost_reason`; `admission_enquiry_followups.outcome` (free text about the family).
- `admission_passcodes`: `email`, `mobile`, `child_name`, `code_hash`.
- `application_answer_changes`: `old_value`, `new_value`, `reason`. `admission_corrections.remark`.
- Remarks and names of people: `admission_stage_results.remarks`, `decided_by_name`; `admission_stage_marks.remark`;
  `admission_moves.snapshot` (a copy of the form with the family's details), `requested_by_name`, `decided_by_name`,
  `reason`; `admission_hand_draws.slips` (names); `admission_cancellations.reason`, `preview`, `result`;
  `admission_refunds.reason`, `reference`, `voucher_file_id`; `admission_no_changes.reason`.
- Children's merit and marks (`merit`, `form_points`, `points_breakdown`, part and stage marks) are personal too:
  report them in aggregate or by registration number, not by name, outside the school office.
