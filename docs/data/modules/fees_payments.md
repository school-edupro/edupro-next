# Fees and payments — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

Set-up (heads, twelve fee months a year, class structures and calendars, discounts) plus each pupil's fee profile
make the **bill lines** (`fee_demands`, school or hostel ledger). **Receipts** (`fee_payments`) come from the counter,
Excel or a gateway (`payment_intents`); each is allocated to the oldest unpaid instalment (`fee_payment_allocations`),
takes any late fee (`fee_late_fee_postings`) and keeps the rest as advance. Approvals waive lines, cancel or bounce
receipts, refund, move or re-date them; banks and gateway payouts are matched back; months are closed with a lock and
year-end dues are carried forward. Misc fees and other income use `misc_fees` → `misc_fee_students` → `misc_receipts`.

## Tables

| Table                         | One row is                                                                                                                                         | Key columns                                                                                                                                                                                                                                                                                                               | For reports                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `fee_demands`                 | one bill line: pupil × academic year × fee month × head                                                                                            | `student_id`, `academic_year_id`, `period_id`, `head_id`, `ledger` school/hostel, `gross`, `discount`, `net`, `paid`, `status`, `due_on`, `source`, `run_id`                                                                                                                                                              | **main (spine for dues)**                           |
| `fee_payments`                | one fee receipt (school or hostel ledger)                                                                                                          | `receipt_no`, `student_id`, `academic_year_id`, `financial_year_id`, `ledger`, `amount`, `late_fee`, `refunded`, `convenience_charge`, `received_on`, `mode`, `mode_label`, `status`, `intent_id`, `cleared_on`, `deposit_slip_id`, `settlement_line_id`                                                                  | **main (spine for collections)**                    |
| `fee_payment_allocations`     | the part of one receipt set against one bill line                                                                                                  | `payment_id`, `demand_id`, `amount` (> 0)                                                                                                                                                                                                                                                                                 | detail (links money to bills; head-wise collection) |
| `fee_late_fee_postings`       | late fee actually collected on a receipt for one instalment                                                                                        | `payment_id`, `student_id`, `academic_year_id`, `ledger`, `due_on`, `period_id`, `amount`, `mode` daywise/slab/override, `days`                                                                                                                                                                                           | detail                                              |
| `fee_refunds`                 | one refund: of a receipt, or of last year's advance                                                                                                | `kind` receipt/opening_advance, `payment_id`, `student_id`, `academic_year_id`, `amount`, `lines` jsonb, `fee_action` due/cancel, `status`, `mode`, `paid_on`, `voucher_no`, `batch_id`, `withdrawal_id`, `hostel_withdrawal_id`                                                                                          | main (refund reports)                               |
| `fee_adjustments`             | one waiver of a bill line, or cancellation / cheque bounce of a receipt                                                                            | `kind` waiver/reversal/bounce, `demand_id` (waiver), `payment_id` (reversal, bounce), `amount`, `charge`, `charge_demand_id`, `status`, `decided_at`, `batch_id`, `undo_status`, `undone_at`, `lines` jsonb                                                                                                               | history (waiver and bounce reports)                 |
| `fee_change_requests`         | one approval request: late-fee waiver, receipt moved to another pupil, receipt/clearing date change, paid late fee or bounce charge moved into fee | `kind`, `student_id`, `payment_id`, `period_id`, `ledger`, `amount`, `to_student_id`, `new_received_on`, `new_cleared_on`, `demand_id`, `status`, `result` jsonb                                                                                                                                                          | history                                             |
| `fee_late_fee_overrides`      | a manual late-fee amount for one pupil's instalment (0 = waived)                                                                                   | `student_id`, `academic_year_id`, `period_id` (anchor month), `ledger`, `amount`, `reason`, `revoked_at`                                                                                                                                                                                                                  | history (active = `revoked_at IS NULL`)             |
| `fee_profile_changes`         | one approval request to change a pupil's fee profile                                                                                               | `student_id`, `academic_year_id`, `changes` / `before` jsonb, `status`, `regenerated_run_id`                                                                                                                                                                                                                              | history                                             |
| `fee_demand_runs`             | one run of the bill generator for one pupil and year                                                                                               | `student_id`, `academic_year_id`, `rows`, `total`, `ran_at`, `diff` jsonb                                                                                                                                                                                                                                                 | internal (history of rebuilds)                      |
| `fee_carry_runs`              | one year-end carry-forward run                                                                                                                     | `from_year_id`, `to_year_id`, `students`, `total_due`, `total_late`, `total_advance`, `ran_at`                                                                                                                                                                                                                            | history                                             |
| `fee_carry_forwards`          | what one pupil carried from one year to the next                                                                                                   | `run_id`, `student_id`, `from_year_id`, `to_year_id`, `due_school`, `due_hostel`, `late_fee`, `late_hostel`, `advance`, `demand_ids` (old lines marked carried), `undone_at`                                                                                                                                              | history                                             |
| `student_fee_profiles`        | one pupil's fee settings for one year                                                                                                              | `student_id`, `academic_year_id` (unique pair), `fee_group`, `student_type` new/old, `transport_slab_id`, `transport_disabled`, `discount_id`, `opening_balance`, `opening_hostel`, `opening_late_fee`, `opening_late_hostel`, `hosteller`, `hostel_from`, `hostel_to`, `pay_plan`, `hostel_pay_plan`, `hostel_fee_group` | master (per pupil)                                  |
| `student_fee_discounts`       | one dated discount given to a pupil for a run of fee months                                                                                        | `student_id`, `academic_year_id`, `discount_id`, `from_seq`, `to_seq`, `status` active/removed, `change_id`                                                                                                                                                                                                               | detail                                              |
| `student_fee_optional_heads`  | one optional head (swimming…) a pupil is opted into for a run of months                                                                            | `student_id`, `academic_year_id`, `head_id`, `from_seq`, `to_seq`, `status` active/removed                                                                                                                                                                                                                                | detail                                              |
| `fee_heads`                   | one fee head (Tuition, Transport, Previous dues, Bounce charge…)                                                                                   | `code`, `name`, `kind`, `ledger`, `is_optional`, `refundable`, `print_group`, `tax_certificate`, `sort_order`, `status`, `deleted_at`                                                                                                                                                                                     | master                                              |
| `fee_periods`                 | one fee month of an academic year                                                                                                                  | `academic_year_id`, `sequence` 1–12 (unique per year), `name`, `month`, `year`, `instalment`, `due_on`, late fee slabs, `visible_from`, `transport_charged`                                                                                                                                                               | master                                              |
| `fee_period_class_rules`      | a class's own calendar for one fee month                                                                                                           | `period_id`, `class_id` (unique pair), `due_on`, `late_fee_amount`, slabs, `late_per_day`, `instalment`, `start_on`, `challan_on`, `bounce_charge`, `fee_pay`, `show`                                                                                                                                                     | master                                              |
| `fee_class_charges`           | a class's fee rules for a year                                                                                                                     | `academic_year_id`, `class_id` (unique pair), `bounce_charge`, `late_mode` daywise/slab, `late_per_day`, `late_max`, `pay_plan`                                                                                                                                                                                           | master                                              |
| `fee_structures`              | the fee of one head for one class, fee group and student type in a year                                                                            | `academic_year_id`, `class_id`, `head_id`, `fee_group`, `student_type` all/new/old (unique set), `amount`, `amounts` (12 monthly amounts), `frequency`, `periods`                                                                                                                                                         | master                                              |
| `fee_discounts`               | one discount (concession) type of a year                                                                                                           | `academic_year_id`, `code` (unique per year), `name`, `head_id`, `percent` or `amount`, `applies_to_transport`, `status`                                                                                                                                                                                                  | master                                              |
| `fee_discount_lines`          | what one discount type takes off one head                                                                                                          | `discount_id`, `head_id` (unique pair), `percent` or `amount`                                                                                                                                                                                                                                                             | master                                              |
| `fee_payment_modes`           | one payment mode the school offers (its own names too)                                                                                             | `code`, `label`, `kind` (one of the 7 built-in modes), `at_counter`, `need_*` flags                                                                                                                                                                                                                                       | master                                              |
| `financial_years`             | one financial year (April–March)                                                                                                                   | `code`, `name`, `start_date`, `end_date`, `status`, `locks`                                                                                                                                                                                                                                                               | master                                              |
| `school_bank_accounts`        | one bank account of the school                                                                                                                     | `bank_id`, `account_name`, `account_no`, `ifsc`, `branch`, `purpose`, `is_default`, `status`                                                                                                                                                                                                                              | master                                              |
| `fee_deposit_slips`           | one bank deposit slip of cheques and drafts                                                                                                        | `slip_no`, `deposit_on`, `bank_account_id`, `instruments`, `total`, `kind` transfer/clearing, `status` open/cancelled                                                                                                                                                                                                     | detail                                              |
| `bank_statements`             | one uploaded bank statement file                                                                                                                   | `bank_name`, `account_ref`, `from_date`, `to_date`, `rows`, `matched`, `unmatched`, `returned`, `credits`, `debits`                                                                                                                                                                                                       | internal (reconciliation import)                    |
| `bank_statement_lines`        | one line of an uploaded bank statement                                                                                                             | `statement_id`, `line_no`, `txn_date`, `value_date`, `credit`, `debit`, `status`, `matched_by`, `payment_id`, `misc_receipt_id`                                                                                                                                                                                           | detail (reconciliation)                             |
| `payment_intents`             | one online payment attempt (any purpose)                                                                                                           | `txn_id` (globally unique), `purpose`, `entity_type`, `entity_id`, `ledger`, `amount` (fee + convenience charge), `charge`, `status`, `provider`, `gateway_id`, `provider_ref`, `created_at`, `succeeded_at`, `expires_at`, `meta`                                                                                        | main (online payments)                              |
| `payment_events`              | one event in an online payment's life                                                                                                              | `intent_id`, `kind`, `provider_ref`, `payload`, `created_at`                                                                                                                                                                                                                                                              | internal (log)                                      |
| `payment_webhooks`            | one notification received from a gateway                                                                                                           | `provider`, `external_id` (unique pair), `txn_id`, `signature_ok`, `outcome`, `payload`, `received_at`                                                                                                                                                                                                                    | internal (log)                                      |
| `payment_gateways`            | one gateway merchant account of the school                                                                                                         | `provider`, `label`, `mode` test/live, `charge_percent`, `charge_flat`, `active`, `bank_account_id`, `config`, `secret`                                                                                                                                                                                                   | master (never read `secret`)                        |
| `payment_gateway_routes`      | which gateway a fee type (ledger) is paid through, in order                                                                                        | `ledger`, `gateway_id`, `sort_order`                                                                                                                                                                                                                                                                                      | master                                              |
| `payment_settlements`         | one gateway payout (settlement) file                                                                                                               | `provider`, `settlement_ref`, `settled_on`, `utr`, `gross`, `charges`, `tax`, `net`, match counts                                                                                                                                                                                                                         | detail                                              |
| `payment_settlement_lines`    | one transaction in a payout file                                                                                                                   | `settlement_id`, `line_no`, `txn_id`, `provider_ref`, `amount`, `charges`, `tax`, `net`, `status`, `intent_id`, `payment_id`                                                                                                                                                                                              | detail                                              |
| `payment_reconciliation_runs` | one daily summary of online receipts vs settlements                                                                                                | `run_date` (unique per school), `as_of`, counts and amounts, `succeeded_without_receipt`, `variance`                                                                                                                                                                                                                      | internal (snapshot)                                 |
| `receipt_sequences`           | the receipt number counter of one ledger and financial year                                                                                        | `ledger_type`, `financial_year_id`, `prefix`, `next_no`, `width`                                                                                                                                                                                                                                                          | internal (sequence)                                 |
| `fee_refund_sequences`        | the refund voucher counter of one financial year and ledger                                                                                        | `financial_year_id`, `ledger` school/hostel, `next_no`                                                                                                                                                                                                                                                                    | internal (sequence)                                 |
| `fee_period_locks`            | one lock: no receipts dated on or before a date                                                                                                    | `ledger` (NULL = all), `locked_through`, `locked_at`, `released_at`                                                                                                                                                                                                                                                       | internal                                            |
| `fee_month_closes`            | one month-end close of the fee books                                                                                                               | `month` (first day; unique per school), `status` open/closed, `checks` jsonb, `pack_export_ids`, `closed_at`, `reopened_at`                                                                                                                                                                                               | internal                                            |
| `fee_reminders`               | one dues (or misc fee) reminder sent to a pupil's family on one channel on one day                                                                 | `student_id`, `sent_on`, `channel`, `balance` (at sending), `misc_fee_id`, `message_id`                                                                                                                                                                                                                                   | history                                             |
| `fee_collection_uploads`      | one Excel file of collections waiting to be posted                                                                                                 | `academic_year_id`, `rows` jsonb, `total_rows`, `good_rows`, `total_amount`, `status`, `receipts` jsonb                                                                                                                                                                                                                   | internal (import)                                   |
| `fee_opening_uploads`         | one Excel file of opening balances                                                                                                                 | `academic_year_id`, `ledger`, `rows` jsonb, `total_dr`, `total_cr`, `status`, `result`                                                                                                                                                                                                                                    | internal (import)                                   |
| `misc_fees`                   | one announced misc fee (trip, exam form, library charge…)                                                                                          | `academic_year_id`, `head_id`, `title`, `amount`, `last_date`, `mandatory`, `seats`, `status`, `announced_at`                                                                                                                                                                                                             | main                                                |
| `misc_fee_students`           | one pupil's (or staff member's) line of a misc fee                                                                                                 | `misc_fee_id`, `student_id` or `employee_id` (exactly one), `amount`, `last_date`, `paid`, `status` open/paid/cancelled, `paid_at`                                                                                                                                                                                        | main (misc dues)                                    |
| `misc_receipts`               | one misc receipt: misc fee, admission/registration fee, other income                                                                               | `receipt_no` (unique per school), `academic_year_id`, `financial_year_id`, `payer_kind`, `student_id`, `employee_id`, `payer_name`, `head_id`, `amount`, `refunded`, `received_on`, `mode`, `mode_label`, `status`, `misc_fee_student_id`, `application_id`, `cleared_on`, `deposit_slip_id`                              | main (misc collections)                             |
| `misc_fee_requests`           | one approval request about a misc fee or misc receipt                                                                                              | `kind`, `misc_fee_id`, `line_id`, `receipt_id`, `payload`, `status`, `decided_at`, `voucher_no`, `result`                                                                                                                                                                                                                 | history (misc refunds are read from here)           |
| `shadow_feeds`                | one feed of legacy receipts or balances during the parallel run                                                                                    | `kind` receipts/balances, `source`, `rows`, `accepted`, `posted`, `rejected`, `rejects`                                                                                                                                                                                                                                   | internal (legacy cut-over)                          |
| `shadow_legacy_receipts`      | one receipt from the old software                                                                                                                  | `legacy_receipt_no`, `admission_no`, `student_id`, `received_on`, `amount`, `late_fee`, `cancelled`, `payment_id` (the mirrored receipt)                                                                                                                                                                                  | internal (legacy cut-over)                          |
| `shadow_legacy_balances`      | one pupil's balance in the old software on a date                                                                                                  | `as_of`, `admission_no`, `student_id`, `balance`                                                                                                                                                                                                                                                                          | internal (legacy cut-over)                          |
| `shadow_runs`                 | one daily old-vs-new comparison                                                                                                                    | `run_date`, `from_date`, `to_date`, receipt and balance counts, `variance_amount`, `status` zero/variance                                                                                                                                                                                                                 | internal (legacy cut-over)                          |
| `shadow_variances`            | one difference found by a shadow run                                                                                                               | `run_id`, `kind`, `ref`, `legacy` / `current` jsonb, `delta`, `status`                                                                                                                                                                                                                                                    | internal (legacy cut-over)                          |
| `shadow_closures`             | the close of the parallel run                                                                                                                      | `closed_at`, `zero_runs`, `last_run_id`, `overridden`, `summary`                                                                                                                                                                                                                                                          | internal (legacy cut-over)                          |

Fee marts (schema `mart`, rebuilt for every school every 15 minutes by `app.refresh_marts()`; freshness in
`mart.refresh_log(mart, refreshed_at, rows)`):

| Mart                        | One row is                                                     | Built from                                                                                            | Use it for                                                                                                |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `mart.fee_dues`             | pupil × academic year × due date (both ledgers added together) | `fee_demands` with status pending/partial/paid; class from the **active** enrolment of that year      | defaulter lists, ageing (`bucket` current/1-30/31-60/61-90/90+, `days_overdue`), dues by class or section |
| `mart.fee_collection_daily` | academic year × receipt date × `mode`                          | `fee_payments` not reversed or bounced (gross: refunds are not taken off; misc receipts not included) | collection trend charts by day and mode                                                                   |
| `mart.fee_forecast`         | academic year × class × due month × ledger                     | `fee_demands` pending/partial/paid; `expected` = sum(net), `collected` = sum(paid), `balance`         | expected vs collected by month and class                                                                  |

## How the tables join

The spines: **`fee_demands`** for anything about what is billed or owed, **`fee_payments`** for money received on the
school and hostel ledgers, **`misc_receipts`** (+ `misc_fee_students`) for misc fees and other income, and
**`payment_intents`** for online payments.

Bills and the pupil

- `fee_demands.student_id → students.id`; `fee_demands.academic_year_id → academic_years.id`
- `fee_demands.period_id → fee_periods.id` (the fee month: `fee_periods.year`, `.month`, `.sequence`, `.instalment`)
- `fee_demands.head_id → fee_heads.id` (`fee_heads.kind`, `.ledger`, `.print_group`)
- `fee_demands.run_id → fee_demand_runs.id` (the generator run that last wrote the line)
- class of the pupil in the bill's year: `fee_demands.(student_id, academic_year_id) → enrolments.(student_id, academic_year_id)`
  (take the active one first, then the latest: `ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1`)
  `→ enrolments.class_section_id → class_sections.id → class_sections.class_id → classes.id`
- `student_fee_profiles.(student_id, academic_year_id)` = the pupil's settings that year;
  `student_fee_profiles.discount_id → fee_discounts.id`; `student_fee_profiles.transport_slab_id → transport_slabs.id`
- `student_fee_discounts.discount_id → fee_discounts.id`; `fee_discount_lines.discount_id → fee_discounts.id`, `.head_id → fee_heads.id`
- `student_fee_optional_heads.head_id → fee_heads.id`; both student tables: `.change_id → fee_profile_changes.id`
- `fee_structures.(academic_year_id, class_id, head_id)` → `academic_years` / `classes` / `fee_heads`; it applies to a pupil
  through `student_fee_profiles.fee_group` and `.student_type`
- `fee_period_class_rules.period_id → fee_periods.id`, `.class_id → classes.id`; `fee_class_charges.(academic_year_id, class_id)`
- `fee_profile_changes.regenerated_run_id → fee_demand_runs.id`
- an **instalment** is not a table: it is the lines of one pupil, year and ledger that share `fee_demands.due_on`

Receipts and what they paid

- `fee_payment_allocations.payment_id → fee_payments.id`; `fee_payment_allocations.demand_id → fee_demands.id`
- `fee_late_fee_postings.payment_id → fee_payments.id`; `.period_id → fee_periods.id`; it belongs to the instalment
  `(student_id, academic_year_id, ledger, due_on)` of `fee_demands`
- `fee_payments.student_id → students.id`; `.academic_year_id → academic_years.id` (the bills it settles);
  `.financial_year_id → financial_years.id` (by `received_on`); `.received_by → users.id` (NULL = online or a machine feed)
- `fee_payments.bank_account_id → school_bank_accounts.id`; `.deposit_slip_id → fee_deposit_slips.id`;
  `.bank_line_id → bank_statement_lines.id`; `.settlement_line_id → payment_settlement_lines.id`; `.intent_id → payment_intents.id`
- `fee_refunds.payment_id → fee_payments.id` (kind receipt); kind opening_advance uses `fee_refunds.student_id` / `.academic_year_id`
  instead; for both: `COALESCE(r.student_id, p.student_id)`. `.hostel_withdrawal_id → hostel_withdrawals.id`;
  `.withdrawal_id` = `student_withdrawals.id` (no foreign key)
- `fee_adjustments.demand_id → fee_demands.id` (waiver); `.payment_id → fee_payments.id` (reversal, bounce);
  `.charge_demand_id → fee_demands.id` (the bounce charge line)
- `fee_change_requests.payment_id → fee_payments.id`; `.period_id → fee_periods.id`; `.to_student_id → students.id`;
  `.demand_id` = a `fee_demands.id` (no foreign key: the line may be rebuilt)
- `fee_late_fee_overrides.(student_id, academic_year_id, period_id, ledger)` = the instalment whose anchor month is `period_id`

Online payments and banks

- `payment_intents.gateway_id → payment_gateways.id`; `payment_gateway_routes.gateway_id → payment_gateways.id`
- fee intents: `payment_intents.purpose = 'fee_instalment'`, `entity_type = 'student'`, `entity_id = students.id`,
  year in `meta->>'academicYearId'`; the receipt: `fee_payments.intent_id = payment_intents.id`
- misc intents: `purpose = 'misc'`, `entity_type = 'misc_fee_student'`, `entity_id = misc_fee_students.id` (the receipt is a
  `misc_receipts` row on that line). Admission intents: `purpose = 'admission_fee'`, `entity_type` `application`,
  `admission_registration` or `admission_offer`, `entity_id = applications.id`
- `payment_events.intent_id → payment_intents.id`; `payment_webhooks.txn_id` = `payment_intents.txn_id` (no foreign key)
- `payment_settlement_lines.settlement_id → payment_settlements.id`; `.intent_id → payment_intents.id`; `.payment_id → fee_payments.id`
- `bank_statement_lines.statement_id → bank_statements.id`; `.payment_id → fee_payments.id`; `.misc_receipt_id → misc_receipts.id`
- `fee_deposit_slips.bank_account_id → school_bank_accounts.id`; `payment_gateways.bank_account_id → school_bank_accounts.id`;
  `school_bank_accounts.bank_id → banks.id`

Misc fees and misc receipts

- `misc_fees.head_id → fee_heads.id`; `misc_fee_students.misc_fee_id → misc_fees.id`;
  `misc_fee_students.student_id → students.id` **or** `.employee_id → employees.id`
- `misc_receipts.misc_fee_student_id → misc_fee_students.id`; `.student_id → students.id`; `.employee_id → employees.id`;
  `.head_id → fee_heads.id`; `.application_id → applications.id` (registration / admission fee); `.financial_year_id → financial_years.id`
- `misc_fee_requests.misc_fee_id → misc_fees.id`; `.line_id → misc_fee_students.id`; `.receipt_id → misc_receipts.id`
- `fee_reminders.student_id → students.id`; `.misc_fee_id → misc_fees.id`; `.message_id → comms_messages.id`
- other modules point in: `applications.registration_receipt_id` / `.admission_receipt_id → misc_receipts.id`,
  `admission_refunds.receipt_id → misc_receipts.id`, `library_loans.fine_receipt_id`, `library_sale_orders.misc_receipt_id`,
  `library_charges.misc_fee_id` / `.misc_line_id`, `consent_forms.misc_fee_id`, `consent_form_responses.misc_line_id` /
  `.payment_intent_id`, `hostel_withdrawals.damage_misc_fee_id` / `.mess_misc_fee_id`, `admission_offers.intent_id`,
  `payroll_adhoc.fee_payment_id` (fee recovered from a staff parent's salary)

Year end, numbering, approvals, legacy

- `fee_carry_forwards.run_id → fee_carry_runs.id`; `.from_year_id` / `.to_year_id → academic_years.id`;
  `.demand_ids[]` = old-year `fee_demands.id` now `carried`
- `receipt_sequences.(ledger_type, financial_year_id)`; `fee_refund_sequences.(financial_year_id, ledger)`
- approvals: `fee_adjustments.workflow_instance_id`, `.undo_workflow_instance_id`, `fee_change_requests.workflow_instance_id`,
  `fee_profile_changes.workflow_instance_id`, `fee_refunds.workflow_instance_id`, `fee_opening_uploads.workflow_instance_id`,
  `misc_fee_requests.workflow_instance_id → workflow_instances.id`
- people who acted (`requested_by`, `decided_by`, `ran_by`, `uploaded_by`, `created_by`, `locked_by`, `closed_by` …) `→ users.id`
- `shadow_legacy_receipts.feed_id → shadow_feeds.id`; `.payment_id → fee_payments.id`; `shadow_legacy_balances.feed_id → shadow_feeds.id`;
  `shadow_variances.run_id → shadow_runs.id`; `shadow_closures.last_run_id → shadow_runs.id`; `shadow_feeds.service_key_id → service_keys.id`

## Life-cycles and statuses

**`fee_demands.status`** (`fee_demand_status`)

- `pending` nothing paid; `partial` some paid; `paid` fully paid. A fully waived line is also `paid` (net 0, paid 0),
  and an opening-credit line (negative net) becomes `paid` with `paid = net` once its instalment is settled.
- `waived` exists in the enum but no current code sets it (a waiver lowers `net` instead).
- `cancelled` taken off the bill: months after a pupil's leaving month, hostel months the pupil no longer stays.
  A withdrawal sets `net = paid`, but a hostel cancellation keeps `net` — so the amounts of a cancelled line are not 0.
- `carried` an old-year line whose unpaid part was carried to the next year's opening balance.
- **Count bills and dues with `status IN ('pending', 'partial', 'paid')`** (the ledger, dashboard and marts all do).
- Moves: allocation raises `paid` (→ partial / paid); a cancelled or bounced receipt and a refund with "fee due again"
  lower it (→ partial / pending); the generator deletes unpaid `pending`/`cancelled` lines and rebuilds them on every
  run (paid, part-paid and waived lines are kept); the carry-forward sets `carried` and its undo puts the status back.
  There is no status history table and no audit trigger on `fee_demands`: the history is in allocations,
  `fee_adjustments`, `fee_refunds`, `fee_demand_runs.diff` and `audit_logs` of the API actions.

**`fee_demands.source`** (text): `structure` (class fee), `transport`, `opening_balance` (previous dues, previous late
fine, advance carried or typed), `bounce_charge`.

**`fee_payments.status`** (text)

- `posted` normal; `partly_refunded` / `refunded` some or all of it refunded (`refunded >= amount` → `refunded`);
  `bounced` the cheque came back; `reversed` the receipt was cancelled (screens say "Cancelled").
- A bounced or reversed receipt keeps its number but loses its allocations and late fee postings (the bills reopen).
- **Money received = `status NOT IN ('reversed', 'bounced')`**, gross; take refunds off by `fee_refunds.paid_on`.
  The office's reports list bounced receipts with their status but never count them; reversed ones never appear.
- Reversal and bounce come from an approved `fee_adjustments` row; a receipt moved to another pupil
  (`fee_change_requests.kind = 'transfer'`) is reversed and posted again on the other pupil; a cancelled legacy
  receipt in the shadow run reversed its mirror. `reversed_at`, `reversal_reason` say when and why.

**`misc_receipts.status`**: `posted`, `reversed` (cancelled), `bounced`. Count `posted`; net of `refunded`.

**`fee_refunds.status`** (`refund_status`)

- `draft` saved, not sent (a withdrawal's provisional refund bill); `requested` waiting for approval; `approved`;
  `rejected`; `paid` money given back (`paid_on`); `failed` a gateway refund the provider refused.
- The bills change **at approval** (allocations reversed, `fee_payments.refunded` raised), not at payment. An offline
  refund is `paid` at approval; a gateway refund waits for the provider. A `failed` refund has already changed the books.
- **Money out = `status = 'paid'`, dated by `paid_on`.** `kind`: `receipt` (against a receipt) or `opening_advance`
  (last year's credit, no receipt). `fee_action`: `due` (the fee is asked again) or `cancel` (the fee line shrinks).

**`fee_adjustments`**: `status` (`workflow_status`) pending → approved / rejected / cancelled. `kind` waiver / reversal /
bounce. An approved waiver can be taken back: `undo_status` pending → approved / rejected, `undone_at` set when taken
back. **Count waivers with `status = 'approved' AND undone_at IS NULL`.** Lines of one waiver request share `batch_id`.

**`fee_change_requests.status`** and **`fee_profile_changes.status`** (`workflow_status`): pending → approved / rejected
/ cancelled. `fee_change_requests.kind`: `late_fee` (writes a `fee_late_fee_overrides` row), `transfer`, `date_change`
(rewrites `fee_payments.received_on` / `cleared_on`), `late_fee_to_fee`, `bounce_to_fee`.

**Online payments**

- `payment_intents.status` (`payment_status`): `created` → `succeeded` or `failed`. `pending` and `cancelled` are in the
  enum but not set by current code; a `created` intent past `expires_at` was abandoned. Only `succeeded` is money.
- `payment_webhooks.outcome`: `applied`, `rejected` (bad signature), `mismatch` (amount differs), `ignored` (provider said
  pending); a replay is not stored again (it is a `payment_events` row of kind `replay`).
- `payment_events.kind`: `created`, `webhook`, `webhook_rejected`, `webhook_mismatch`, `webhook_ignored`, `replay`.
- `payment_settlement_lines.status`: `matched`, `unmatched`, `amount_mismatch`, `duplicate`, `refund`.

**Banks and slips**

- `bank_statement_lines.status`: `matched` (stamps `cleared_on` and `bank_line_id` on the receipt), `unmatched`,
  `ambiguous` (several receipts fit), `returned` (a debit that looks like a returned cheque: `payment_id` points at that
  cheque's receipt — it is **not** a match), `ignored` (other debits).
- `fee_deposit_slips.status`: `open`, `cancelled` (its cheques are freed: `deposit_slip_id` set back to NULL).

**Misc fees**

- `misc_fees.status`: `pending` (asked, waiting for approval) → `announced` or `rejected`; `announced` → `closed`.
  Report on `announced` and `closed`.
- `misc_fee_students.status`: `open`, `paid`, `cancelled` (exclude cancelled). A cancelled or bounced misc receipt or a
  misc refund lowers `paid` and sets the line back to `open`.
- `misc_fee_requests.kind`: `announce`, `extend`, `pupil_change`, `add_pupils`, `close`, `receipt_cancel`,
  `receipt_bounce`, `receipt_refund`; `status` pending / approved / rejected. A misc refund is an approved
  `receipt_refund`: amount `result->>'back'`, mode `payload->>'mode'`, date `decided_at`, `voucher_no`.

**Set-up and control rows**

- `fee_late_fee_overrides`: active while `revoked_at IS NULL` (overrides are revoked and re-made, never edited).
- `student_fee_discounts`, `student_fee_optional_heads`: `status` active / removed (`removed_at`).
- `fee_carry_forwards`: active while `undone_at IS NULL`.
- `fee_heads.status`, `fee_discounts.status`, `school_bank_accounts.status`: `row_status`; `fee_heads` also soft-deletes.
- `fee_collection_uploads.status`: draft → pending → posted / rejected; draft → cancelled.
  `fee_opening_uploads.status`: draft → pending → applied / rejected / cancelled.
- `fee_month_closes.status` open / closed. Closing a month inserts a `fee_period_locks` row (ledger NULL,
  `locked_through` = last day of the month); reopening releases it (`released_at`). A lock is active while
  `released_at IS NULL`; `app.fee_locked_through(ledger)` gives the latest active date. The API refuses receipts dated
  on or before it.
- Writes on a year also pass `app.assert_year_open(year, 'fees')`: a `locked` academic year is read only unless its
  `locks->>'fees'` is `false`; a `closed` year is always read only.
- `shadow_runs.status` zero / variance; `shadow_variances.status` open / explained / resolved; `kind` missing_in_new,
  missing_in_legacy, amount, date, reversed_in_new, not_reversed, balance.

## Amounts, dates and counting rules

**A bill line (`fee_demands`)**

- `gross` = the fee as charged (structure amount of the month, transport amount, opening figure, bounce charge).
- `discount` = everything taken off: concessions of the month, approved waivers, refunds with `fee_action = 'cancel'`,
  the write-off of months after a withdrawal, a paid bounce charge or late fee moved into fee, and the rounding of the
  month to whole rupees (so `discount` can be a few paise negative).
- `net` = `gross − discount` = what is asked. It can be **negative**: an opening advance (credit) line.
- `paid` = what receipts hold against it now. **Balance = `net − paid`.** Sum it over the lines you want; a negative
  credit line reduces the pupil's balance.
- Late fee is **not** a bill line until collected (only last year's unpaid late fine is, on head kind `late_fee`,
  codes `PREVLATE` / `PREVLATEH`). Outstanding late fee is computed live:
  `app.late_fee(student_id, academic_year_id, due_on, as_of, ledger).o_amount − app.late_fee_posted(student_id, academic_year_id, due_on, ledger)`,
  per instalment. **Payable = balance + outstanding late fee** (the pupil ledger's figure).
- One line per pupil, year, fee month and head (UNIQUE `student_id, academic_year_id, period_id, head_id`). Bounce
  charges of the same month and head add up on one line.
- Group instalments by `due_on` (+ `ledger`). Group "fee month" reports by `period_id` → `fee_periods.year/month`.
  `fee_demands.due_on` is the pupil's real last date (class calendar and pay plan applied); `fee_periods.due_on` is
  only the school default.

**A receipt (`fee_payments`)**

- `amount` = all the money on the receipt for fees = fee set against bills + `late_fee` + advance.
  It does **not** include `convenience_charge` (the gateway surcharge, kept apart as income).
- Fee part ("principal") = `amount − late_fee`.
- Advance (money not yet set against any bill) = `amount − late_fee − refunded − (sum of its allocations)`.
- `late_fee` = sum of its `fee_late_fee_postings`. `refunded` = refunds applied to it (approved, paid or failed).
- `received_on` = the receipt date (a plain date). Use it for day books and cash. `academic_year_id` = the year of the
  bills it settles (April receipts often settle last year's dues). `financial_year_id` = the April–March year of
  `received_on`; receipt numbers run per ledger and financial year (`TF/…` school, `HF/…` hostel by default).
- `cleared_on` = the bank date of a cheque, draft or transfer; NULL = not yet seen in the bank.
- Mode: `mode` is one of 7 kinds (online, cash, cheque, dd, upi, bank, card); `mode_label` is the school's own name
  (NEFT, POS…). Show `COALESCE(mode_label, mode)`; filter by `mode` for the kind.

**Allocation rule.** A receipt settles instalments oldest first, on its own ledger only, never more than an
instalment's balance; the late fee of an instalment is taken after its fee is fully covered; the rest stays as advance.
Within an instalment the lines are filled in id order.

**Refunds.** Money out is `fee_refunds.amount` with `status = 'paid'` on `paid_on`, plus misc refunds (approved
`misc_fee_requests` of kind `receipt_refund`, by `decided_at` in IST). The receipt's own `amount` never changes.

**Misc.** `misc_fee_students.amount` is the pupil's due, `paid` what posted misc receipts hold (after cancels, bounces
and refunds). Due date = `COALESCE(misc_fee_students.last_date, misc_fees.last_date)`. `misc_receipts.amount` is gross;
net = `amount − refunded`. Ledger of a misc receipt: `admission` when `application_id` is set, else `misc`.

**Online.** `payment_intents.amount` = fee + `charge` (convenience charge); the receipt gets `amount − charge`. Settlement
lines carry the gateway's `charges` and `tax`; `net` is what reached the bank.

**Year end.** The carry-forward marks the old year's open lines `carried` and writes the new year's profile:
`opening_balance = due_school − advance`, `opening_hostel = due_hostel`, `opening_late_fee = late_fee − late_hostel`,
`opening_late_hostel = late_hostel`. The new bill shows them in the first fee month on heads `PREVDUE` / `PREVDUEH`
(kind `opening_balance`) and `PREVLATE` / `PREVLATEH` (kind `late_fee`), `source = 'opening_balance'`.

**Years.** Bills belong to an academic year. Receipts belong to the academic year of their bills and to a financial
year by date. Use academic year for dues and "fee of the session"; use `received_on` (and financial year) for money in.

**Snapshots and cached figures.** `fee_reminders.balance`, `fee_demand_runs.total`, `fee_carry_runs.*`,
`payment_reconciliation_runs.*`, `bank_statements` and `payment_settlements` counts, `fee_deposit_slips.total`,
`fee_collection_uploads.total_amount`, `shadow_runs.*` and every `mart.*` row are figures as of when they were written.

**Unique and one-per rules** (partial unique indexes are not in the schema digest):

- `fee_payments.receipt_no` unique per school (when set); `misc_receipts.receipt_no` unique per school.
- `student_fee_profiles` one per pupil and year; `fee_structures` one per year, class, head, fee group, student type;
  `fee_periods` one per year and sequence.
- One active `fee_late_fee_overrides` per pupil, year, period, ledger; one active `fee_carry_forwards` per pupil and
  target year; one pending `fee_adjustments` per receipt and per bill line; one pending `fee_profile_changes` per
  pupil and year; one open (requested/approved) refund and one draft refund per receipt; one open opening-advance
  refund per pupil and year.
- `fee_reminders`: one per pupil, day, channel and misc fee (dues reminders have `misc_fee_id` NULL).
- `misc_fee_students`: one line per misc fee and pupil (or employee).
- `payment_intents.txn_id` unique across all schools; `payment_webhooks` unique per provider and `external_id`.

## Answering report questions

**1. How much money came in between two dates, by ledger and mode, after refunds?** (the day-book total)

```sql
WITH p AS (SELECT DATE '2026-11-01' AS from_d, DATE '2026-11-23' AS to_d)
SELECT x.ledger, x.mode,
       sum(x.receipts)::int               AS receipts,
       sum(x.fee)                         AS fee,
       sum(x.late_fee)                    AS late_fee,
       sum(x.refunds)                     AS refunds_paid,
       sum(x.fee + x.late_fee - x.refunds) AS net_in
  FROM (
        SELECT fp.ledger::text AS ledger, COALESCE(fp.mode_label, fp.mode) AS mode, 1 AS receipts,
               fp.amount - fp.late_fee AS fee, fp.late_fee, 0::numeric AS refunds
          FROM fee_payments fp CROSS JOIN p
         WHERE fp.received_on BETWEEN p.from_d AND p.to_d
           AND fp.status NOT IN ('reversed', 'bounced')
        UNION ALL
        SELECT CASE WHEN m.application_id IS NOT NULL THEN 'admission' ELSE 'misc' END, COALESCE(m.mode_label, m.mode), 1,
               m.amount, 0, 0
          FROM misc_receipts m CROSS JOIN p
         WHERE m.received_on BETWEEN p.from_d AND p.to_d
           AND m.status = 'posted'
        UNION ALL
        SELECT COALESCE(fp.ledger::text, 'school'), r.mode, 0, 0, 0, r.amount
          FROM fee_refunds r
          LEFT JOIN fee_payments fp ON fp.id = r.payment_id
         CROSS JOIN p
         WHERE r.status = 'paid' AND r.paid_on BETWEEN p.from_d AND p.to_d
        UNION ALL
        SELECT 'misc', COALESCE(q.payload->>'mode', 'cash'), 0, 0, 0, (q.result->>'back')::numeric
          FROM misc_fee_requests q CROSS JOIN p
         WHERE q.kind = 'receipt_refund' AND q.status = 'approved'
           AND (q.decided_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.from_d AND p.to_d
       ) x
 GROUP BY x.ledger, x.mode
 ORDER BY x.ledger, x.mode
```

Do not filter receipts by `academic_year_id` here: money in is by date. Refunds are taken off on the day they were
paid. Admission-fee refunds live in `admission_refunds` (admissions module). Misc mode `transfer` is money moved from
another school of the group, not cash.

**2. Who owes fee that is past its due date, by class and section?** (crosses into enrolments / classes)

```sql
WITH p AS (SELECT 1::bigint AS year_id, DATE '2026-11-23' AS as_of)
SELECT s.admission_no, s.display_name AS student, k.name AS class, cs.name AS section,
       min(d.due_on) FILTER (WHERE d.net > d.paid)                       AS oldest_unpaid_due,
       sum(d.net - d.paid) FILTER (WHERE d.ledger = 'school')            AS school_balance,
       sum(d.net - d.paid) FILTER (WHERE d.ledger = 'hostel')            AS hostel_balance,
       sum(d.net - d.paid)                                               AS overdue_balance
  FROM fee_demands d
 CROSS JOIN p
  JOIN students s ON s.id = d.student_id
  LEFT JOIN LATERAL (
        SELECT e.class_section_id FROM enrolments e
         WHERE e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id
         ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true
  LEFT JOIN class_sections cs ON cs.id = en.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE d.academic_year_id = p.year_id
   AND d.status IN ('pending', 'partial', 'paid')
   AND d.due_on < p.as_of
   AND s.deleted_at IS NULL
 GROUP BY s.id, s.admission_no, s.display_name, k.display_order, k.name, cs.name
HAVING sum(d.net - d.paid) > 0
 ORDER BY k.display_order, cs.name, overdue_balance DESC
```

Fee only, late fee not included. Credit lines are netted, as on the pupil ledger; the office's defaulter report
counts only lines with `net > 0`. The latest enrolment of the year keeps pupils who left (the marts drop their class).

**3. What does each pupil of a section have to pay today, late fee included?**

```sql
WITH p AS (SELECT 1::bigint AS year_id, DATE '2026-11-23' AS as_of, 5::bigint AS class_section_id),
pupils AS (
  SELECT e.student_id FROM enrolments e CROSS JOIN p
   WHERE e.academic_year_id = p.year_id AND e.class_section_id = p.class_section_id AND e.status = 'active'),
inst AS (
  SELECT d.student_id, d.ledger, d.due_on, sum(d.net - d.paid) AS balance
    FROM fee_demands d CROSS JOIN p
   WHERE d.academic_year_id = p.year_id AND d.status IN ('pending', 'partial', 'paid')
     AND d.student_id IN (SELECT student_id FROM pupils)
   GROUP BY d.student_id, d.ledger, d.due_on)
SELECT i.student_id,
       sum(i.balance) AS fee_balance,
       sum(GREATEST(lf.o_amount - app.late_fee_posted(i.student_id, p.year_id, i.due_on, i.ledger), 0)) AS late_fee_outstanding,
       sum(i.balance) + sum(GREATEST(lf.o_amount - app.late_fee_posted(i.student_id, p.year_id, i.due_on, i.ledger), 0)) AS payable
  FROM inst i
 CROSS JOIN p
 CROSS JOIN LATERAL app.late_fee(i.student_id, p.year_id, i.due_on, p.as_of, i.ledger) lf
 GROUP BY i.student_id
```

The late fee exists only as this function (school settings, class calendar, overrides). It needs the tenant context
and runs per instalment, so keep it to a class or a few pupils.

**4. Class-wise fee of the session: billed, concession, collected, balance** (crosses into classes)

```sql
WITH p AS (SELECT 1::bigint AS year_id)
SELECT k.name AS class, d.ledger,
       count(DISTINCT d.student_id) AS pupils,
       sum(d.gross)                 AS billed_gross,
       sum(d.discount)              AS concession_and_write_offs,
       sum(d.net)                   AS billed_net,
       sum(d.paid)                  AS collected,
       sum(d.net - d.paid)          AS balance
  FROM fee_demands d
 CROSS JOIN p
  LEFT JOIN LATERAL (
        SELECT e.class_section_id FROM enrolments e
         WHERE e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id
         ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true
  LEFT JOIN class_sections cs ON cs.id = en.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE d.academic_year_id = p.year_id
   AND d.status IN ('pending', 'partial', 'paid')
 GROUP BY k.display_order, k.name, d.ledger
 ORDER BY k.display_order, d.ledger
```

`collected` is what receipts hold against these bills today, whenever paid (it can include last year's advance used).
`discount` mixes concessions, waivers and write-offs (see Amounts).

**5. Head-wise collection of a month (Tuition, Transport, Late fee, Advance, misc heads)**

```sql
WITH p AS (SELECT DATE '2026-11-01' AS from_d, DATE '2026-11-30' AS to_d),
counted AS (
  SELECT fp.* FROM fee_payments fp CROSS JOIN p
   WHERE fp.received_on BETWEEN p.from_d AND p.to_d AND fp.status NOT IN ('reversed', 'bounced'))
SELECT x.ledger, x.head_code, x.head_name, sum(x.receipts)::int AS receipts, sum(x.amount) AS amount
  FROM (
        SELECT h.ledger::text AS ledger, h.code AS head_code, h.name AS head_name,
               count(DISTINCT c.id) AS receipts, sum(a.amount) AS amount
          FROM fee_payment_allocations a
          JOIN counted c ON c.id = a.payment_id
          JOIN fee_demands d ON d.id = a.demand_id
          JOIN fee_heads h ON h.id = d.head_id
         GROUP BY h.ledger, h.code, h.name
        UNION ALL
        SELECT c.ledger::text, 'LATE_FEE', 'Late fee', count(DISTINCT c.id), sum(lf.amount)
          FROM fee_late_fee_postings lf JOIN counted c ON c.id = lf.payment_id
         GROUP BY c.ledger
        UNION ALL
        SELECT c.ledger::text, 'ADVANCE', 'Advance (not yet set against fee)', count(*),
               sum(c.amount - c.late_fee - c.refunded - COALESCE(al.total, 0))
          FROM counted c
          LEFT JOIN LATERAL (SELECT sum(a2.amount) AS total FROM fee_payment_allocations a2 WHERE a2.payment_id = c.id) al ON true
         WHERE c.amount - c.late_fee - c.refunded - COALESCE(al.total, 0) > 0.005
         GROUP BY c.ledger
        UNION ALL
        SELECT 'misc', h.code, h.name, count(*), sum(m.amount - m.refunded)
          FROM misc_receipts m CROSS JOIN p
          JOIN fee_heads h ON h.id = m.head_id
         WHERE m.received_on BETWEEN p.from_d AND p.to_d AND m.status = 'posted'
         GROUP BY h.code, h.name
       ) x
 GROUP BY x.ledger, x.head_code, x.head_name
 ORDER BY x.ledger, x.head_code
```

Heads come from allocations, never from `fee_demands.paid` (see Traps). The figures are what the receipts of the month
are set against **today**: a later refund takes its amount off the head. The built-in `fee_head_tally` export leaves
`refunded` out of its advance line; this sketch takes it off.

**6. Month by month: how much was expected and how much has come in?** (mart)

```sql
WITH p AS (SELECT 1::bigint AS year_id)
SELECT f.due_month, f.ledger,
       sum(f.students)  AS pupils_billed,
       sum(f.expected)  AS expected,
       sum(f.collected) AS collected,
       sum(f.balance)   AS balance,
       round(100 * sum(f.collected) / NULLIF(sum(f.expected), 0), 1) AS collected_pct,
       (SELECT max(l.refreshed_at) FROM mart.refresh_log l WHERE l.mart = 'fee_forecast') AS mart_refreshed_at
  FROM mart.fee_forecast f CROSS JOIN p
 WHERE f.academic_year_id = p.year_id
 GROUP BY f.due_month, f.ledger
 ORDER BY f.due_month, f.ledger
```

`due_month` is the month of the pupil's due date (a quarterly plan puts three fee months in one due month). Up to 15
minutes old; pupils who left have NULL class. For a live figure use question 4 grouped by `date_trunc('month', d.due_on)`.

**7. Ageing of dues by class** (mart)

```sql
WITH p AS (SELECT 1::bigint AS year_id)
SELECT k.name AS class, f.bucket,
       count(DISTINCT f.student_id) AS pupils,
       sum(f.balance)               AS balance
  FROM mart.fee_dues f
 CROSS JOIN p
  LEFT JOIN classes k ON k.id = f.class_id
 WHERE f.academic_year_id = p.year_id
   AND f.balance > 0
 GROUP BY k.display_order, k.name, f.bucket
 ORDER BY k.display_order, CASE f.bucket WHEN 'current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2 WHEN '61-90' THEN 3 ELSE 4 END
```

`mart.fee_dues` adds school and hostel together and keeps fully paid due dates (balance 0): filter `balance > 0`.
`bucket` and `days_overdue` are as of the last refresh.

**8. Which cheques bounced, and has the bounce charge been paid?**

```sql
WITH p AS (SELECT DATE '2026-04-01' AS from_d, DATE '2026-11-23' AS to_d)
SELECT (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS bounced_on,
       fp.receipt_no, fp.received_on, fp.ledger, COALESCE(fp.mode_label, fp.mode) AS mode,
       fp.instrument_no, fp.instrument_date, fp.bank_name, fp.amount AS cheque_amount,
       a.charge                          AS bounce_charge,
       COALESCE(cd.paid, 0)              AS charge_paid_so_far,
       jsonb_array_length(COALESCE(a.lines, '[]'::jsonb)) AS fee_lines_it_had_paid
  FROM fee_adjustments a
 CROSS JOIN p
  JOIN fee_payments fp ON fp.id = a.payment_id
  LEFT JOIN fee_demands cd ON cd.id = a.charge_demand_id
 WHERE a.kind = 'bounce' AND a.status = 'approved'
   AND (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.from_d AND p.to_d
 ORDER BY a.decided_at DESC
```

The bounce date is the approval date. One charge line can hold several bounces of the same month, so `charge_paid_so_far`
may be shared. Cheques still waiting for the bank: `fee_payments` with `mode IN ('cheque','dd')`, `status = 'posted'`,
`cleared_on IS NULL`.

**9. Are online payments healthy? (paid, failed, abandoned, missing receipts, not yet settled)**

```sql
WITH p AS (SELECT DATE '2026-11-01' AS from_d, DATE '2026-11-23' AS to_d)
SELECT i.provider, g.label AS gateway_account, i.ledger, i.purpose,
       count(*) FILTER (WHERE i.status = 'succeeded')                                    AS succeeded,
       COALESCE(sum(i.amount) FILTER (WHERE i.status = 'succeeded'), 0)                  AS paid_by_families,
       COALESCE(sum(i.charge) FILTER (WHERE i.status = 'succeeded'), 0)                  AS convenience_charges,
       count(*) FILTER (WHERE i.status = 'failed')                                       AS failed,
       count(*) FILTER (WHERE i.status IN ('created', 'pending') AND i.expires_at < now()) AS abandoned,
       count(*) FILTER (WHERE i.status = 'succeeded' AND i.purpose = 'fee_instalment' AND fp.id IS NULL) AS succeeded_without_receipt,
       count(*) FILTER (WHERE fp.id IS NOT NULL AND fp.settlement_line_id IS NULL
                          AND fp.status NOT IN ('reversed', 'bounced'))                  AS receipts_not_settled,
       COALESCE(sum(sl.charges + sl.tax), 0)                                             AS gateway_fees_on_settled
  FROM payment_intents i
 CROSS JOIN p
  LEFT JOIN payment_gateways g ON g.id = i.gateway_id
  LEFT JOIN fee_payments fp ON fp.intent_id = i.id
  LEFT JOIN payment_settlement_lines sl ON sl.id = fp.settlement_line_id
 WHERE (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.from_d AND p.to_d
 GROUP BY i.provider, g.label, i.ledger, i.purpose
 ORDER BY i.provider, g.label, i.ledger, i.purpose
```

`payment_intents.amount` includes the convenience charge; the receipt does not. Misc and admission intents post
`misc_receipts` (or admission records), not `fee_payments`, so their receipt columns stay empty here.

**10. How much concession did each discount type give, and how much was waived?**

```sql
WITH p AS (SELECT 1::bigint AS year_id),
holder AS (
  SELECT sfd.student_id, sfd.discount_id
    FROM student_fee_discounts sfd CROSS JOIN p
   WHERE sfd.academic_year_id = p.year_id AND sfd.status = 'active'
  UNION
  SELECT sp.student_id, sp.discount_id
    FROM student_fee_profiles sp CROSS JOIN p
   WHERE sp.academic_year_id = p.year_id AND sp.discount_id IS NOT NULL),
bill AS (
  SELECT d.student_id, sum(d.discount) AS concession
    FROM fee_demands d CROSS JOIN p
   WHERE d.academic_year_id = p.year_id AND d.status IN ('pending', 'partial', 'paid')
   GROUP BY d.student_id)
SELECT fd.code, fd.name, count(DISTINCT h.student_id) AS pupils, COALESCE(sum(b.concession), 0) AS concession_on_their_bills
  FROM holder h
  JOIN fee_discounts fd ON fd.id = h.discount_id
  LEFT JOIN bill b ON b.student_id = h.student_id
 GROUP BY fd.code, fd.name
UNION ALL
SELECT 'WAIVER', 'Approved waivers (not taken back)', count(DISTINCT a.student_id), COALESCE(sum(a.amount), 0)
  FROM fee_adjustments a CROSS JOIN p
 WHERE a.academic_year_id = p.year_id AND a.kind = 'waiver' AND a.status = 'approved' AND a.undone_at IS NULL
```

The bills do not record which discount type made each rupee of `discount`. A pupil with two types is counted under
both, and `concession_on_their_bills` also holds their waivers and write-offs: read it as "pupils on this type and
their total concession", not an exact split. The waiver row uses the requested amount (a waiver never takes more than
the line's open balance).

**11. Announced misc fees: how many pupils, billed, collected, outstanding**

```sql
WITH p AS (SELECT 1::bigint AS year_id)
SELECT f.title, h.name AS head, f.status, f.mandatory, f.last_date, f.seats,
       count(l.id) FILTER (WHERE l.status <> 'cancelled')                      AS pupils_or_staff,
       count(l.id) FILTER (WHERE l.status = 'paid')                            AS paid_in_full,
       COALESCE(sum(l.amount) FILTER (WHERE l.status <> 'cancelled'), 0)       AS billed,
       COALESCE(sum(l.paid) FILTER (WHERE l.status <> 'cancelled'), 0)         AS collected,
       COALESCE(sum(l.amount - l.paid) FILTER (WHERE l.status = 'open'), 0)    AS outstanding
  FROM misc_fees f
 CROSS JOIN p
  JOIN fee_heads h ON h.id = f.head_id
  LEFT JOIN misc_fee_students l ON l.misc_fee_id = f.id
 WHERE f.academic_year_id = p.year_id
   AND f.status IN ('announced', 'closed')
 GROUP BY f.id, f.title, h.name, f.status, f.mandatory, f.last_date, f.seats
 ORDER BY f.last_date, f.title
```

Lines can be pupils or staff (`employee_id`). An optional fee past its last date is not asked for any more: treat its
open lines as closed, not as dues.

**12. Transport fee billed and collected by bus route** (crosses into transport)

```sql
WITH p AS (SELECT 1::bigint AS year_id),
rider AS (
  SELECT DISTINCT ON (t.student_id) t.student_id, t.pick_route_id
    FROM student_transport t CROSS JOIN p
   WHERE t.academic_year_id = p.year_id AND t.status <> 'cancelled'
   ORDER BY t.student_id, (t.status = 'active') DESC, t.created_at DESC)
SELECT r.code AS route_code, r.name AS route,
       count(DISTINCT d.student_id) AS pupils,
       sum(d.net)                   AS transport_billed,
       sum(d.paid)                  AS transport_collected,
       sum(d.net - d.paid)          AS transport_balance
  FROM fee_demands d
 CROSS JOIN p
  LEFT JOIN rider ON rider.student_id = d.student_id
  LEFT JOIN transport_routes r ON r.id = rider.pick_route_id
 WHERE d.academic_year_id = p.year_id
   AND d.source = 'transport'
   AND d.status IN ('pending', 'partial', 'paid')
 GROUP BY r.code, r.name
 ORDER BY r.code
```

Transport lines are `source = 'transport'` on the school ledger. A pupil who changed route is shown on the latest
route. `paid` per line can be distorted by an opening credit in the same instalment (see Traps); for exact cash by
head use the allocations as in question 5.

## Traps

- **Wrong status filters.** Bills: `status IN ('pending','partial','paid')` — `cancelled` lines keep a non-zero `net`
  (hostel months) and `carried` lines still show their old balance, which was moved into next year's opening
  balance. Counting them double-counts. Receipts: leave out `reversed` and `bounced` (the month-end close screen leaves out only `reversed`, so its
  receipt total includes bounced cheques). Misc: receipts `posted`, lines not `cancelled`, fees `announced`/`closed`.
- **`fee_demands.paid` is not cash by head.** When an instalment holds an opening-credit line (negative net), settling
  the instalment marks every line `paid = net`: the fee line shows more paid than any receipt gave and the credit line
  shows a negative paid. Sums per pupil and instalment are right; per head use `fee_payment_allocations`.
- **Gross vs net of refunds.** `fee_payments.amount` never shrinks; refunds are separate rows, money out on
  `fee_refunds.paid_on`. `mart.fee_collection_daily` and the dashboard totals are gross (refunds not taken off).
  `fee_payments.refunded` also counts approved and failed gateway refunds that were not paid out.
- **Late fee is not stored as a due.** Only what was collected (`fee_late_fee_postings`) and last year's carried fine
  (`PREVLATE`/`PREVLATEH` lines) are rows. Outstanding late fee comes from `app.late_fee` as of a date, and changes when
  the school changes its late fee settings.
- **Receipt year vs receipt date.** `fee_payments.academic_year_id` is the year of the bills, not of the date.
  Collections "this month" must filter `received_on`; "this year's" dashboard figure filters the academic year.
  A `date_change` request rewrites `received_on`, so a past day book can change.
- **Convenience charge.** In `payment_intents.amount`, not in `fee_payments.amount`; it is in
  `fee_payments.convenience_charge` / `misc_receipts.convenience_charge`. Intent totals ≠ receipt totals.
- **Year end carry.** Old-year `carried` lines are out of the old year's balance; the new year has the same money on
  `opening_balance` lines. The old year's receipts still show their advance, which was carried as a negative opening
  balance: do not add the old advance and the new credit together.
- **`discount` is not only concession.** It holds waivers, cancelled-fee refunds, withdrawal write-offs, moved bounce
  charges and rounding. For waivers alone use `fee_adjustments` (approved, `undone_at IS NULL`).
- **Marts.** Up to 15 minutes old; `fee_dues` mixes school and hostel and keeps zero balances; marts take the class
  from the active enrolment only, so pupils who left show NULL class; mart day counts use the database date at refresh.
- **Shadow tables.** `shadow_*` only compared the old software with this one during the parallel run. Ignore them for
  reports. The legacy receipts they mirrored were posted into `fee_payments` as ordinary receipts (school ledger,
  `reference` = legacy receipt no, `remarks` starting `shadow: legacy`), so they already count once there; never add
  `shadow_legacy_receipts` to them. Old history loaded by the ETL is mapped in `etl.legacy_map`.
- **Merged pupils.** A merge moves every fee row of the duplicate to the kept pupil (`students.merged_into_id`), so fee
  tables do not hold the duplicate's id. Still join `students` and drop `deleted_at IS NOT NULL` for lists.
- **Bank lines `returned`.** `bank_statement_lines.payment_id` on a `returned` line names the cheque that came back, not
  a match. Count matches with `status = 'matched'`.
- **One intent, one receipt** is the rule but not a constraint (`fee_payments.intent_id` is not unique); count intents
  and receipts separately.
- **Time zones.** `received_on`, `paid_on`, `sent_on` are plain dates. Online receipts and gateway refunds take the
  database server's `CURRENT_DATE`, not the Indian date, so a payment just after midnight IST can carry the day
  before when the server runs on UTC. For timestamps (`decided_at`, `created_at`) use
  `(x AT TIME ZONE 'Asia/Kolkata')::date`, as the office's reports do.
- **Hostel vs school.** Both ledgers share `fee_demands` and `fee_payments`; a receipt settles only its own ledger.
  Filter `ledger` whenever the question names one; most totals and `mart.fee_dues` mix them.
- **Waived status.** `fee_demand_status = 'waived'` never appears; filtering on it returns nothing.
- **Numbers and prefixes.** Reversed receipts keep their numbers (gaps are normal). Refund vouchers are `RF/<fy>/…`
  (school) and `HR/<fy>/…` (hostel); admission receipts have their own series (by default `RF/<session>/…` for
  registration), so a prefix alone does not tell refunds from receipts.
- **Soft-deleted heads.** `fee_heads.deleted_at` hides a head from set-up, but old lines still point at it: do not
  filter old bills by `fee_heads.deleted_at`.

## Personal and sensitive data

- **Names and contacts:** `misc_receipts.payer_name`, `payer_mobile`; `payment_intents.payer_name`, `payer_email`,
  `payer_mobile`; `mart.fee_dues.student_name`, `admission_no`; `shadow_legacy_receipts.admission_no`,
  `shadow_legacy_balances.admission_no`; names reached through `students`, `guardians`, `employees`, `users`.
- **Bank and payment details:** `fee_payments.instrument_no`, `bank_name`, `reference`; `misc_receipts.instrument_no`,
  `bank_name`, `reference`; `fee_refunds.reference`, `provider_ref`; `payment_intents.provider_ref`,
  `provider_order_id`, `txn_id`; `bank_statement_lines.narration`, `reference` (often carry payer names and account
  numbers); `payment_settlements.utr`; `school_bank_accounts.account_no`, `ifsc` (the school's own accounts:
  confidential).
- **Secrets — never read or send:** `payment_gateways.secret` (encrypted gateway keys) and `payment_gateways.config`
  (merchant ids, key ids).
- **Raw gateway and file payloads:** `payment_webhooks.payload`, `payment_events.payload`, `payment_intents.meta`,
  `fee_collection_uploads.rows`, `fee_opening_uploads.rows` / `result`, `shadow_legacy_receipts.lines`,
  `shadow_variances.legacy` / `current`, `shadow_feeds.rejects`, `bank_statements.file_name`.
- **Money of a named family** (financial standing): balances, receipts and refunds per pupil; `fee_reminders.balance`
  with `message_id` (the message text sent to the family).
- **Socio-economic categories:** `student_fee_profiles.fee_group` (e.g. staff ward, EWS) and the discount type a pupil
  holds (`student_fee_discounts`, `student_fee_profiles.discount_id`) can reveal a family's circumstances.
- **Free text about people:** `reason`, `decision_note`, `undo_reason`, `remarks`, `reversal_reason`, `note`,
  `notes` (`student_fee_profiles`), `explanation`, `release_reason`, `fee_profile_changes.changes` / `before`,
  `fee_adjustments.lines`, `fee_refunds.lines` — waiver and refund reasons often describe a family's hardship.
- Aggregates by class, head, mode or month are safe to share; mask pupil-level rows (names, admission numbers,
  instrument numbers) before they reach an AI model.
