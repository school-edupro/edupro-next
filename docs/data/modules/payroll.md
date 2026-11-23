# Payroll — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

The school pays its staff monthly. Set-up: dated rules (DA / HRA rates, PF, ESI, profession tax, LWF, overtime, tax
slabs), pay heads with dated versions, the pay matrix, a payroll profile and a dated salary structure per employee.
Each month the office gathers inputs (payroll attendance and loss of pay, holds, loans, one-off items, recurring
deductions, claims, overtime, typed tax, arrears); a **run** works out one **record** per employee and goes DRAFT →
PROCESSING → REVIEW → APPROVED → LOCKED (payslips frozen) → PAID. Around it: bank files, statutory returns, the tax year
(declarations, Form 16 / 130), revisions and arrears, full and final settlements, bonus, and the move from the old payroll.

## Tables

All 69 tables have `school_id` and forced row-level security. "Dated" = the eight tables with
`effective_from / effective_to / status draft|active|ended|withdrawn` (see Life-cycles).

| Table                                       | One row is                                                                                       | Key columns                                                                                                                                                                                                                                                                                                                                                                                             | For reports            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Set-up: rules and rates**                 |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_settings`                          | the school's payroll settings (one per school)                                                   | PK `school_id`; `state_code`, `tan`, `pf_establishment_code`, `esi_code`, `ptrc_no`, `pay_cycle_from_day`, `net_rounding`, `confidential_employee_ids[]`, `matrix_code`, gratuity / encashment caps, `jv_ledgers`                                                                                                                                                                                       | internal (settings)    |
| `payroll_rates`                             | one dated value of a rate code (`DA_RATE`, `HRA_RATE`, `MIN_WAGE_<STATE>…`, `LABOUR_CODE_WAGES`) | `rate_code`, `rate_value` (a fraction: 0.58 = 58 %), `effective_from/to`, `status`; unique (school, rate_code, effective_from)                                                                                                                                                                                                                                                                          | master (dated)         |
| `payroll_pf_settings`                       | a dated PF rule set                                                                              | `ee_rate`, `er_rate`, `eps_rate`, `eps_wage_ceiling`, `edli_*`, `admin_*`, dates, `status`                                                                                                                                                                                                                                                                                                              | master (dated)         |
| `payroll_esi_settings`                      | a dated ESI rule set                                                                             | `ee_rate`, `er_rate`, `wage_limit`, `wage_limit_pwd`, dates, `status`                                                                                                                                                                                                                                                                                                                                   | master (dated)         |
| `payroll_pt_slabs`                          | a dated profession-tax slab of a state and gender                                                | `state_code`, `gender` (M/F/ANY), `wage_from/to`, `monthly_amount`, `month_overrides` jsonb, dates, `status`                                                                                                                                                                                                                                                                                            | master (dated)         |
| `payroll_lwf_settings`                      | a dated labour-welfare-fund rule of a state                                                      | `state_code`, `ee_rate`/`ee_cap`/`ee_flat`, `er_flat`/`er_multiplier`, `frequency`, `months[]`, dates, `status`                                                                                                                                                                                                                                                                                         | master (dated)         |
| `payroll_ot_rates`                          | a dated overtime rate for a staff type                                                           | `employee_type` (text = `employees.employee_type`), `daily_amount`, `hourly_amount`, dates, `status`                                                                                                                                                                                                                                                                                                    | master (dated)         |
| `payroll_tds_slabs`                         | one income-tax slab of a year and regime                                                         | `fy` ('2026-27'), `regime` NEW/OLD, `slab_from`, `slab_to`, `rate` (fraction)                                                                                                                                                                                                                                                                                                                           | master                 |
| `payroll_tds_config`                        | a year and regime's tax settings                                                                 | `fy`, `regime`, `standard_deduction`, `rebate_income_limit`, `rebate_max`, `cess_rate`, `pan_absent_rate`; unique (school, fy, regime)                                                                                                                                                                                                                                                                  | master                 |
| `payroll_tds_surcharges`                    | one surcharge step                                                                               | `fy`, `regime`, `income_from`, `rate`                                                                                                                                                                                                                                                                                                                                                                   | master                 |
| `payroll_tax_labels`                        | a tax line's printed name, cap and "declarable" flag for a year                                  | `fy`, `line_code` (e.g. `CHAPVIA_80C`, `HRA_RENT`), `label`, `applies_to`, `cap_amount`, `cap_group`, `declarable`                                                                                                                                                                                                                                                                                      | master                 |
| `payroll_tax_years`                         | a tax year's settings                                                                            | PK (`school_id`, `fy`); `declare_from/to`, `proof_due`, `listed_cities[]`, `frozen_at`                                                                                                                                                                                                                                                                                                                  | master                 |
| **Set-up: pay heads, matrix, templates**    |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_pay_heads`                         | a pay head (identity)                                                                            | `code` (BASIC, DA, HRA, PF, TDS, ADV …), `name`, `head_type` EARNING/DEDUCTION, `category`, `print_order`, `status`; unique (school, code)                                                                                                                                                                                                                                                              | master                 |
| `payroll_pay_head_versions`                 | a dated version of how a head is worked out                                                      | `pay_head_id`, `calc_type` FIXED/FORMULA/SLAB/MANUAL/SYSTEM, `formula`, `is_taxable`, `pf_wage`, `esi_wage`, `pt_wage`, `prorate_on_lop`, `rounding`, dates, `status`; unique (pay_head_id, effective_from)                                                                                                                                                                                             | master (dated)         |
| `payroll_pay_head_slabs`                    | one slab line of a SLAB version                                                                  | `version_id`, `basis`, `range_from/to`, `flat_amount` or `percent` (a per cent figure, 12.5), `seq`                                                                                                                                                                                                                                                                                                     | master                 |
| `payroll_formula_tests`                     | a saved test of a head's formula                                                                 | `pay_head_id`, `name`, `inputs` jsonb, `expected`, `last_status`                                                                                                                                                                                                                                                                                                                                        | internal               |
| `payroll_pay_matrix`                        | one cell of the pay matrix                                                                       | `matrix_code` (PM_2016), `pay_level`, `cell_no`, `basic`; unique (school, matrix_code, pay_level, cell_no)                                                                                                                                                                                                                                                                                              | master                 |
| `payroll_structure_templates`               | a named set of head amounts to fill structures from                                              | `name`, `staff_types[]`, `lines` jsonb {HEAD: amount}                                                                                                                                                                                                                                                                                                                                                   | master                 |
| `payroll_bank_accounts`                     | the school's own debit account at one bank, with its file layout                                 | `bank_code` (IFSC's first four letters), `bank_name`, `account_no`, `file_format`, `layout`, `active`; unique (school, bank_code)                                                                                                                                                                                                                                                                       | master                 |
| `payroll_payees`                            | a third party that recurring deductions are paid to (LIC, society, union, court)                 | `name`, `party_type`, `payee_account`, `active`                                                                                                                                                                                                                                                                                                                                                         | master                 |
| `payroll_bonus_rules`                       | the school's bonus rule for a financial year                                                     | `fy` (unique per school), `kind` PERCENT/FIXED/STATUTORY, `rate`, `amount`, `prorate`, `min_months`, `min_days`, `max_wage`, `wage_cap`                                                                                                                                                                                                                                                                 | master                 |
| `payroll_report_presets`                    | a saved column set of a payroll report                                                           | `report_key`, `name`, `columns[]`, `owner_id` (NULL = shared), `deleted_at`                                                                                                                                                                                                                                                                                                                             | internal               |
| **People**                                  |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_profiles`                          | one employee's payroll profile (today's values)                                                  | PK `employee_id`; `pf_applicable`, `eps_applicable`, `vpf_*`, `nps_*`, `esi_applicable`, `pwd`, `pt_applicable`, `tax_regime`, `tds_mode`, `pay_level`, `pay_cell`, `category`, `payroll_status` ACTIVE/HOLD/LEFT, `pay_mode` BANK/CASH/CHEQUE                                                                                                                                                          | master                 |
| `payroll_profile_changes`                   | one change of one profile field                                                                  | `employee_id`, `field`, `old_value`, `new_value`, `effective_from`, `changed_at`                                                                                                                                                                                                                                                                                                                        | history                |
| `payroll_nominees`                          | a nominee of an employee                                                                         | `employee_id`, `name`, `relation`, `dob`, `share_percent`, `purpose` GRATUITY/EDLI/GENERAL                                                                                                                                                                                                                                                                                                              | detail                 |
| `payroll_structures`                        | the dated amount of one head for one employee                                                    | `employee_id`, `pay_head_id`, `amount`, `effective_from/to`, `status`, `revision_id` (no FK) — no unique key                                                                                                                                                                                                                                                                                            | main (set-up), history |
| `payroll_ward_links`                        | a staff member's child (student) whose fees payroll may recover                                  | `employee_id`, `student_id`, `source` mobile/manual, `active`; unique (employee_id, student_id)                                                                                                                                                                                                                                                                                                         | master                 |
| **Monthly inputs**                          |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_attendance`                        | one employee's days for one pay month                                                            | `employee_id`, `month`; unique (employee_id, month); `month_days`, `present_days`, `paid_leave_days`, `lop_days`, `pre_join_days`, `post_leave_days`, `paid_days`, `ot_hours`, `window_from/to`, `source`, `finalised`                                                                                                                                                                                  | main (inputs)          |
| `payroll_holds`                             | a salary hold of an employee-month                                                               | unique (employee_id, month); `mode` HOLD/SKIP, `reason`, `active`                                                                                                                                                                                                                                                                                                                                       | detail                 |
| `payroll_loans`                             | a loan or advance (or a RECOVERY of a negative net)                                              | `employee_id`, `loan_type`, `principal`, `emi`, `interest_rate` (per cent a year), `interest_method`, `balance`, `start_month`, `status`                                                                                                                                                                                                                                                                | main                   |
| `payroll_adhoc`                             | a one-off earning or deduction for an employee-month                                             | `employee_id`, `month`, `pay_head_id`, `amount`, `ref_module` (NULL typed by hand, FEE, CLAIM, OT, FNF, BONUS, RECOVERY), `ref_id` (unique while live), `paid_in_record_id`, `fee_payment_id`, `deleted_at`                                                                                                                                                                                             | detail                 |
| `payroll_recurring`                         | a standing monthly deduction (LIC, society …)                                                    | `employee_id`, `pay_head_id`, `payee_id`, `amount`, `start_month`, `end_month`, `status`                                                                                                                                                                                                                                                                                                                | detail                 |
| `payroll_claims`                            | a reimbursement claim                                                                            | `employee_id`, `pay_head_id`, `amount_claimed`, `amount_approved`, `status`, `pay_month`, `adhoc_id`, `paid_in_record_id`                                                                                                                                                                                                                                                                               | main                   |
| `payroll_ot_entries`                        | rate-based overtime of an employee-month                                                         | `employee_id`, `month` (one live per employee-month), `basis` DAY/HOUR, `qty`, `rate`, `derived_amount`, `amount`, `adhoc_id`, `deleted_at`                                                                                                                                                                                                                                                             | detail                 |
| `payroll_tds_manual`                        | income tax typed by hand for an employee-month                                                   | unique (employee_id, month); `it_amount`, `cess_amount`, `reason`                                                                                                                                                                                                                                                                                                                                       | detail                 |
| `payroll_lop_reversals`                     | loss-of-pay days given back (+) or charged (−) for a locked month                                | `employee_id`, `source_month`, `source_record_id`, `days`, `amount_pf`, `amount_other`, `status`, `arrear_pf_id`, `arrear_other_id`                                                                                                                                                                                                                                                                     | detail                 |
| `payroll_arrears`                           | an amount owed for an earlier month, waiting for a run to pay it                                 | `employee_id`, `pay_head_id`, `period_month` (owed for), `amount` (negative = recovery), `source` LOP_REVERSAL/REVISION/MANUAL, `source_id`, `revision_id`, `paid_in_record_id`, `cancelled_at`                                                                                                                                                                                                         | detail                 |
| **The run**                                 |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_runs`                              | a pay run of a month                                                                             | `month`, `run_type` REGULAR/SUPPLEMENTARY/BONUS, `seq`, `purpose` (FNF), `employee_ids[]` (supplementary), `stage`, cached `emp_count`/`gross_total`/`deduction_total`/`net_total`, `imported`, `deleted_at`; unique (school, month, run_type, seq); one live REGULAR and one live BONUS a month                                                                                                        | main (header)          |
| `payroll_run_events`                        | one action on a run                                                                              | `run_id`, `action`, `stage_from`, `stage_to`, `comment`, `created_at`                                                                                                                                                                                                                                                                                                                                   | history                |
| `payroll_records`                           | **one employee in one run**: what was paid and why, frozen                                       | `run_id`, `employee_id`, `month`; unique (run_id, employee_id); `status`, `is_top_up`, snapshots (`employee_code`, `employee_name`, `designation`, `department`, `staff_type`, `pay_level`, `pay_cell`, `category`, bank, `tax_regime`), days, `gross_fixed`, `gross_earned`, `lop_amount`, `pt_amount`, `it_amount`, `cess_amount`, `total_deductions`, `net_pay`, `paid_at`, `payment_ref`, `payslip` | **main (spine)**       |
| `payroll_record_lines`                      | one earning or deduction line of a record                                                        | `record_id`, `pay_head_id` (NULL for rounding), `code`, `name`, `head_type`, `rate`, `amount`, `is_arrear`, `is_structure`, `is_taxable`, `source_kind`, `source_id`                                                                                                                                                                                                                                    | detail                 |
| `payroll_record_statutory`                  | a record's PF / EPS / EDLI / NPS / ESI / LWF figures (employer shares too)                       | PK `record_id`; `pf_wage`, `eps_wage`, `edli_wage`, `ee_pf`, `vpf`, `er_eps`, `er_epf`, `edli`, `pf_admin`, `ncp_days`, `nps_*`, `esi_covered`, `esi_wage`, `esi_ee`, `esi_er`, `lwf_state`, `lwf_ee`, `lwf_er`                                                                                                                                                                                         | detail                 |
| `payroll_record_tax`                        | how a record's monthly TDS was worked out                                                        | PK `record_id`; `fy`, `mode` PROJECTION/TYPED/NONE, `regime`, `gross_projection`, `taxable_income`, `annual_tax`, `ytd_tds`, `months_left`, `monthly_tds`, `exemptions`, `perquisites`, `prev_salary`, `working` jsonb                                                                                                                                                                                  | detail                 |
| `payroll_record_loans`                      | a loan instalment one record took                                                                | PK (`record_id`, `loan_id`); `opening`, `interest`, `emi`, `principal`, `closing`                                                                                                                                                                                                                                                                                                                       | detail                 |
| `payroll_esi_coverage`                      | whether an employee is ESI-covered for a contribution period                                     | PK (`employee_id`, `period_start` = 1 Apr or 1 Oct); `covered`, `wage_at_start`, `record_id`                                                                                                                                                                                                                                                                                                            | detail                 |
| **Payment**                                 |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_bank_batches`                      | one bank file made from a run                                                                    | `run_id`, `seq`, `bank_code`, `bank_account_id`, `status`, `provisional`, `txn_count`, `total`, `utr`, `value_date`, stage timestamps                                                                                                                                                                                                                                                                   | main                   |
| `payroll_bank_batch_lines`                  | one salary in a bank file                                                                        | `batch_id`, `line_no`, `record_id`, `employee_code`, `employee_name`, `bank_ifsc`, `account_enc`, `account_masked`, `amount`, `status` SENT/REJECTED/CANCELLED; one SENT line per record                                                                                                                                                                                                                | detail                 |
| **Statutory**                               |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_returns`                           | a PF ECR return the school filed                                                                 | `kind` ECR, `month`, `seq` (1 regular, 2+ supplementary), `members`, `totals` jsonb, `ack_no`, `filed_on`                                                                                                                                                                                                                                                                                               | history                |
| `payroll_return_members`                    | one member's line in a filed ECR                                                                 | PK (`return_id`, `employee_id`); `uan`, `line` jsonb, `record_ids[]`                                                                                                                                                                                                                                                                                                                                    | detail                 |
| `payroll_compliance`                        | one statutory due in the year's calendar                                                         | `fy` (**integer**, first year), `item` ECR/ESI/TDS/PT/LWF/TDS_RETURN, `month`, `period`, `due_on`, `done_at`, `ack_no`, `amount_paid`, `amount_computed`; unique (school, fy, item, period)                                                                                                                                                                                                             | main                   |
| **Income tax**                              |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_declarations`                      | one declared section (80C, HRA …) of an employee for a year                                      | `employee_id`, `fy`, `line_code`, `declared`, `verified`, `status`, `detail` jsonb (HRA months, landlord), `proof_file_ids[]`, `deleted_at`; one live per (employee, fy, line_code)                                                                                                                                                                                                                     | main                   |
| `payroll_prev_employment`                   | an earlier employer's salary and tax for the year                                                | `employee_id`, `fy`, `employer_name`, `employer_tan`, `gross`, `exempt`, `pf`, `pt`, `tds`, `status`, `deleted_at`; one live per (employee, fy)                                                                                                                                                                                                                                                         | detail                 |
| `payroll_perquisites`                       | a perquisite counted in tax only                                                                 | `employee_id`, `fy`, `perq_type`, `amount`, `verified`, `superseded_at`, `deleted_at`                                                                                                                                                                                                                                                                                                                   | detail                 |
| `payroll_tax_finals`                        | the school's fixed annual tax for an employee's year                                             | `employee_id`, `fy`, `annual`, `spread_months`, `computed_annual`, `cleared_at`; one live per (employee, fy)                                                                                                                                                                                                                                                                                            | detail                 |
| `payroll_tds_challans`                      | a TDS deposit challan                                                                            | `fy`, `quarter` (1 = Apr–Jun), `bsr_code`, `challan_no`, `deposited_on`, `amount` (tax + cess), `interest`, `late_fee`, `months[]` (1–12), `deleted_at`                                                                                                                                                                                                                                                 | main                   |
| `payroll_regime_events`                     | a tax-regime choice or change                                                                    | `employee_id`, `fy`, `regime`, `how` IN_WINDOW/ADMIN, `reason`, `created_at`                                                                                                                                                                                                                                                                                                                            | history                |
| `payroll_certificates`                      | an employee's annual certificate (Form 16 / 130) for a year                                      | unique (employee_id, fy); `part_a_file_id`, `file_id`, `made_at`, `released_at`, `emailed_at`                                                                                                                                                                                                                                                                                                           | detail                 |
| **People events**                           |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_revisions`                         | a pay revision (RATE, FORMULA or yearly INCREMENT)                                               | `kind`, `detail` jsonb, `effective_from`, `status`, `arrears_total`, `arrears_count`, `applied_at`                                                                                                                                                                                                                                                                                                      | main                   |
| `payroll_revision_letters`                  | a numbered revision letter to one employee                                                       | `revision_id`, `employee_id` (unique pair), `letter_no` (PR/2026/0001), `before`/`after` jsonb, `effective_from`                                                                                                                                                                                                                                                                                        | detail                 |
| `payroll_settlements`                       | the full and final settlement of a leaver                                                        | `employee_id`, `exit_id` (unique), `last_day`, `reason`, `status`, `gratuity`, `gratuity_tax_free`, `encash_amount`, `notice_amount`, `loans`, `other_payable`, `other_recovery`, `net`, `pay_month`, `dues_letter_no`                                                                                                                                                                                  | main                   |
| `payroll_transfer_imports`                  | payroll's part of a transfer from a sister school, brought once                                  | `transfer_id` (unique), `employee_id`, `packet` jsonb, `written` jsonb                                                                                                                                                                                                                                                                                                                                  | history                |
| `payroll_bonus_postings`                    | one posting of a year's bonus into a month                                                       | `fy`, `month`, `rule` jsonb, `posted`, `total`                                                                                                                                                                                                                                                                                                                                                          | history                |
| **Go-live from the old payroll (internal)** |                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                         |                        |
| `payroll_cutover`                           | the school's move from the old PHP payroll (one per school)                                      | PK `school_id`; `status`, `history_from`, `parallel_months[]`, `switch_month`, `first_live_lock_at`                                                                                                                                                                                                                                                                                                     | internal (cut-over)    |
| `payroll_legacy_rows`                       | one old-payroll row as read (holding area)                                                       | PK (`school_id`, `tbl`, `legacy_id`); `payload` jsonb, `read_id`                                                                                                                                                                                                                                                                                                                                        | internal (legacy)      |
| `payroll_legacy_map`                        | what an old row became here                                                                      | PK (`school_id`, `tbl`, `legacy_id`); `entity` (table name), `entity_id`                                                                                                                                                                                                                                                                                                                                | internal (legacy)      |
| `payroll_parity_batches`                    | one parity comparison (REPLAY of old months, or PARALLEL months)                                 | `kind`, `months[]`, `engine_version`, `counts`                                                                                                                                                                                                                                                                                                                                                          | internal (parity)      |
| `payroll_parity_results`                    | one employee × month × component compared                                                        | `batch_id`, `employee_id`, `month`, `component`, `legacy`, `ours`, `diff`, `status`                                                                                                                                                                                                                                                                                                                     | internal (parity)      |
| `payroll_parity_explanations`               | a person's explanation of a difference                                                           | PK (`school_id`, `kind`, `employee_id`, `month`, `component`); `code`, `diff`, `note`                                                                                                                                                                                                                                                                                                                   | internal (parity)      |
| `payroll_golive_signoffs`                   | the parity sign-off and countersign                                                              | `batch_id`, `months[]`, `scoreboard`, `checksum`, `signed_by`, `countersigned_by`                                                                                                                                                                                                                                                                                                                       | internal (cut-over)    |

## How the tables join

**Spine:** `payroll_records` joined to `payroll_runs` (for the stage). Almost every money report starts there and goes
down to `payroll_record_lines` (heads), `payroll_record_statutory` (PF / ESI / employer shares) or
`payroll_record_tax` (tax working). Set-up reports start from `payroll_structures` or `payroll_profiles`.

The run and its records

- `payroll_records.run_id → payroll_runs.id` (not cascade; records are deleted by the API when a run is reprocessed)
- `payroll_records.employee_id → employees.id`
- `payroll_record_lines.record_id → payroll_records.id` (cascade; many per record)
- `payroll_record_lines.pay_head_id → payroll_pay_heads.id` (NULL on the `ROUND_ADJ` rounding line — use a LEFT JOIN)
- `payroll_record_statutory.record_id → payroll_records.id` (1 : 1)
- `payroll_record_tax.record_id → payroll_records.id` (1 : 1; absent on imported history)
- `payroll_record_loans.record_id → payroll_records.id`; `payroll_record_loans.loan_id → payroll_loans.id`
- `payroll_esi_coverage.record_id → payroll_records.id` (the record that decided the period)
- `payroll_run_events.run_id → payroll_runs.id`
- `payroll_records.payslip_message_id → comms_messages.id`
- `payroll_record_lines.source_id` (text, no FK) → by `source_kind`: `structure` → `payroll_structures.id`, `arrear` →
  `payroll_arrears.id`, `adhoc` → `payroll_adhoc.id`, `recurring` → `payroll_recurring.id`, `loan` → `payroll_loans.id`;
  `legacy:<id>` on imported lines

Monthly inputs → the record that paid them

- `payroll_attendance.(employee_id, month) ↔ payroll_records.(employee_id, month)` (no FK; one attendance row, maybe several records)
- `payroll_holds.(employee_id, month)`, `payroll_tds_manual.(employee_id, month)`, `payroll_ot_entries.(employee_id, month)` — same pairing
- `payroll_adhoc.paid_in_record_id → payroll_records.id`; `payroll_adhoc.pay_head_id → payroll_pay_heads.id`
- `payroll_claims.adhoc_id → payroll_adhoc.id`; `payroll_claims.paid_in_record_id → payroll_records.id`; `payroll_claims.proof_file_id → files.id`
- `payroll_ot_entries.adhoc_id → payroll_adhoc.id`
- `payroll_recurring.payee_id → payroll_payees.id`; `payroll_recurring.pay_head_id → payroll_pay_heads.id`
- `payroll_arrears.paid_in_record_id → payroll_records.id`; `payroll_arrears.revision_id → payroll_revisions.id`;
  `payroll_arrears.source_id` → `payroll_lop_reversals.id` (source LOP_REVERSAL) or `payroll_revisions.id` (REVISION), no FK
- `payroll_lop_reversals.source_record_id → payroll_records.id`; `payroll_lop_reversals.arrear_pf_id / arrear_other_id → payroll_arrears.id`
- Settlement items: `payroll_adhoc.ref_module = 'FNF'` and `payroll_adhoc.ref_id LIKE 'FNF/' || payroll_settlements.id || '/%'`
- Bonus items: `payroll_adhoc.ref_module = 'BONUS'`, `ref_id = 'BONUS/<fy>/<employee_id>'`; claims `CLAIM/<claim id>`; overtime `OT/<YYYY-MM>/<employee_id>`

Set-up

- `payroll_pay_head_versions.pay_head_id → payroll_pay_heads.id`; `payroll_pay_head_slabs.version_id → payroll_pay_head_versions.id`
- `payroll_formula_tests.pay_head_id → payroll_pay_heads.id`
- `payroll_structures.employee_id → employees.id`; `payroll_structures.pay_head_id → payroll_pay_heads.id`
- `payroll_profiles.employee_id → employees.id` (1 : 1); `payroll_profile_changes.employee_id`, `payroll_nominees.employee_id → employees.id`
- `payroll_profiles.(pay_level, pay_cell) ↔ payroll_pay_matrix.(pay_level, cell_no)` with `payroll_pay_matrix.matrix_code = payroll_settings.matrix_code` (text match)
- `payroll_ot_rates.employee_type ↔ employees.employee_type::text`; `payroll_pt_slabs.state_code`, `payroll_lwf_settings.state_code ↔ payroll_settings.state_code`
- `payroll_tds_slabs / payroll_tds_config / payroll_tds_surcharges / payroll_tax_labels` by `(fy, regime)` or `(fy, line_code)`

Payment and statutory

- `payroll_bank_batches.run_id → payroll_runs.id`; `payroll_bank_batches.bank_account_id → payroll_bank_accounts.id`
- `payroll_bank_batch_lines.batch_id → payroll_bank_batches.id`; `payroll_bank_batch_lines.record_id → payroll_records.id`
- `payroll_return_members.return_id → payroll_returns.id`; `payroll_return_members.employee_id → employees.id`;
  `payroll_return_members.record_ids[]` ↔ `payroll_records.id` (array, no FK)
- `payroll_tds_challans.(fy, quarter, months[])` ↔ records by month (no key); `payroll_compliance` stands alone (its `fy` is an integer)

Income tax

- `<table>.employee_id → employees.id` for `payroll_declarations`, `payroll_prev_employment`, `payroll_perquisites`,
  `payroll_tax_finals`, `payroll_regime_events` and `payroll_certificates`; each also has `fy` ↔ `payroll_tax_years.fy`
  and `payroll_record_tax.fy`
- `payroll_declarations.line_code ↔ payroll_tax_labels.line_code` (same `fy`)
- `payroll_certificates.file_id / part_a_file_id → files.id`; `payroll_certificates.message_id → comms_messages.id`

People events and other modules

- `payroll_settlements.exit_id → employee_exits.id`; `employee_fnf.exit_id = payroll_settlements.exit_id` (the exit statement)
- `payroll_revision_letters.revision_id → payroll_revisions.id`; `payroll_revision_letters.employee_id → employees.id`
- `payroll_transfer_imports.transfer_id → employee_school_transfers.id`
- `payroll_ward_links.student_id → students.id`; `payroll_adhoc.fee_payment_id → fee_payments.id`; `payroll_adhoc.detail->>'studentId'` (FEE items)
  → `students.id`; then `fee_payments.(student_id, academic_year_id) → enrolments → class_sections → classes`
- `payroll_records.department` (text) ↔ `departments.name` (text match, not a key; the snapshot is the employee's legacy department text)
- `employees.user_id → users.id` (the staff member's own sign-in: My payslips, My tax); every `*_by` column → `users.id`
- Payroll does not use `workflow_instances`: maker / checker is in its own columns (`created_by`, `approved_by`, `decided_by`).

Go-live (internal)

- `payroll_parity_results.batch_id → payroll_parity_batches.id`; `payroll_golive_signoffs.batch_id → payroll_parity_batches.id`
- `payroll_parity_explanations.(kind, employee_id, month, component) ↔ payroll_parity_results.(employee_id, month, component)` of a batch of that kind
- `payroll_legacy_map.entity_id` → the row of the table named in `entity` (for example `payroll_runs.id`); `payroll_legacy_rows.read_id ↔ payroll_cutover.read_id`

## Life-cycles and statuses

The module has no enum types of its own: every status is a `text` column with a CHECK. The staff type on a record
(`payroll_records.staff_type`) is the text of the `employee_type` enum (teaching, non_teaching, contract, visiting).

**`payroll_runs.stage`** — DRAFT → PROCESSING → REVIEW → APPROVED → LOCKED → PAID; REJECTED (with a comment) goes back
to DRAFT on the next Process.

- DRAFT / PROCESSING / REVIEW / REJECTED: work in progress. Its records are deleted and made again on every reprocess.
  Never report them as pay.
- APPROVED: checked, not final. Reports and bank files may use it, marked **PROVISIONAL**. Payslips do not exist yet.
- LOCKED: **final**. Payslips are frozen (`payroll_records.payslip`), fee-recovery receipts are posted, the month counts
  in the year's tax. Statutory files, Form 16 / 130, year-to-date tax and the transfer packet read only LOCKED and PAID.
- PAID: locked and nothing left to pay (every COMPUTED / RELEASED record with `net_pay > 0` is paid; held salaries do not
  keep it open). A bank line returned later puts a PAID run back to LOCKED.
- Reopen (payroll admin): LOCKED → DRAFT, records purged, loans restored, fee receipts reversed. A PAID run is never reopened.
  Unapprove: APPROVED → REJECTED.
- `deleted_at`: a deleted draft, or a parallel-month trial run removed at the go-live switch. Always exclude.
- `run_type`: REGULAR (whole roster; one live a month), SUPPLEMENTARY (the staff in `employee_ids`; any number, `seq`),
  BONUS (one live a month; pays pending one-off earnings and arrears only). `purpose = 'FNF'` marks a full-and-final
  supplementary run. Supplementary and bonus runs come only after the month's regular run is locked.
- `imported = true`: history brought from the old payroll (stage LOCKED or PAID); read-only.
- History: `payroll_run_events` (action, stage_from, stage_to, comment) and `audit_logs`.

**`payroll_records.status`** — COMPUTED (worked out, waiting to be paid), FAILED (could not be worked out:
`failure_code`, `failure_reason`; all money 0), HELD (worked out, not paid: `held_reason`; from a salary hold, a profile
on HOLD, a checker's hold, or a bank return), RELEASED (a held salary let go; paid with the next file), PAID (`paid_at`,
`paid_by`, `payment_ref` = UTR or voucher / cheque number). **Exclude FAILED always.** Include HELD in cost and
registers (it is owed); use `status = 'PAID'` only for "money actually paid". `is_top_up = true`: the record pays only
what was pending in a month a locked run already paid (its days are 0). History: `audit_logs` (trigger on status,
held_reason, payment_ref).

**Dated set-up rows** (`payroll_rates`, `payroll_pf_settings`, `payroll_esi_settings`, `payroll_pt_slabs`,
`payroll_lwf_settings`, `payroll_ot_rates`, `payroll_pay_head_versions`, `payroll_structures`) — `status`:
draft (made by a maker, not in force), active (approved by a checker; read for the months its dates cover), ended
(no longer produced: migration 0380 turned every ended row into active, a row is bounded by its dates alone),
withdrawn (approved by mistake and taken back; kept as history, never read; `withdrawn_by/at`, `withdraw_reason`).
A month reads **status = 'active' AND effective_from ≤ month end AND (effective_to IS NULL OR effective_to ≥ month
start)**, the latest `effective_from` winning. Approving a new row gives the previous active row an `effective_to` (the
day before) and records it in `closed_rows`. History: the rows themselves plus `audit_logs`.

**Other statuses**

| Column                                                                               | Values and meaning                                                                                                                                                                                                                                                               | For reports                                                                                                                   |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `payroll_pay_heads.status`                                                           | active / inactive (not used by new runs)                                                                                                                                                                                                                                         | lines keep the code and name as paid                                                                                          |
| `payroll_profiles.payroll_status`                                                    | ACTIVE; HOLD (salary worked out but held); LEFT (off the roster)                                                                                                                                                                                                                 | current only; history in `payroll_profile_changes`                                                                            |
| `payroll_attendance.finalised`                                                       | true = checked by a checker; a regular run needs it. `source`: register, manual, import, quick_fill                                                                                                                                                                              | use finalised rows                                                                                                            |
| `payroll_holds.mode` / `active`                                                      | HOLD (worked out, held) / SKIP (left out of the month); `active = false` = lifted                                                                                                                                                                                                | active only                                                                                                                   |
| `payroll_loans.status`                                                               | ACTIVE (instalments taken), HOLD (paused), CLOSED (balance 0, settled, or carried away)                                                                                                                                                                                          | outstanding = ACTIVE or HOLD with balance > 0                                                                                 |
| `payroll_recurring.status`                                                           | ACTIVE, HOLD, ENDED; also bounded by `start_month` / `end_month`                                                                                                                                                                                                                 | ACTIVE within months                                                                                                          |
| `payroll_claims.status`                                                              | SUBMITTED → APPROVED (a one-off line made for `pay_month`) → PAID (set when a run **processes** it; back to APPROVED if that run is purged); or SUBMITTED → REJECTED. Decided by someone other than who entered it                                                               | "paid" = PAID **and** the paying record's run LOCKED / PAID                                                                   |
| `payroll_adhoc`                                                                      | live while `deleted_at IS NULL`; pending while `paid_in_record_id IS NULL`; `receipt_pending` (FEE: receipt posted at lock)                                                                                                                                                      | check the paying run's stage                                                                                                  |
| `payroll_ot_entries`                                                                 | live while `deleted_at IS NULL` (one live per employee-month)                                                                                                                                                                                                                    | live only                                                                                                                     |
| `payroll_lop_reversals.status`                                                       | DRAFT → APPROVED (two arrears made) or CANCELLED; one live (not cancelled) per employee and source month                                                                                                                                                                         | APPROVED                                                                                                                      |
| `payroll_arrears`                                                                    | pending (`paid_in_record_id IS NULL AND cancelled_at IS NULL`), paid (record set), cancelled                                                                                                                                                                                     | paid = record in a LOCKED / PAID run                                                                                          |
| `payroll_bank_batches.status`                                                        | GENERATED → UPLOADED → CONFIRMED (UTR; marks its lines' records PAID) or CANCELLED (before upload, with reason); `provisional` = made while the run was APPROVED                                                                                                                 | CONFIRMED = money sent                                                                                                        |
| `payroll_bank_batch_lines.status`                                                    | SENT (stays SENT after confirm), REJECTED (returned by the bank; record goes HELD), CANCELLED (its batch cancelled)                                                                                                                                                              | paid by bank = SENT in a CONFIRMED batch                                                                                      |
| `payroll_returns.seq`                                                                | 1 = the month's regular ECR, 2+ = supplementary; withdrawing deletes the latest (members cascade)                                                                                                                                                                                | as filed                                                                                                                      |
| `payroll_compliance`                                                                 | done when `done_at` is set (needs `ack_no`, `ack_date`); `reopen_reason` when reopened. DONE / OVERDUE / DUE_SOON are worked out on screen from `due_on`, not stored                                                                                                             | overdue = `done_at IS NULL AND due_on < today`                                                                                |
| `payroll_declarations.status`, `payroll_prev_employment.status`                      | SUBMITTED, VERIFIED (`verified` amount), REJECTED (`reject_reason`); `deleted_at`                                                                                                                                                                                                | a declaration counts: VERIFIED → `verified`; SUBMITTED → `declared` until `payroll_tax_years.proof_due`, then 0; REJECTED → 0 |
| `payroll_perquisites`                                                                | `verified`; a change supersedes (`superseded_at`); `deleted_at`                                                                                                                                                                                                                  | verified, not superseded, not deleted                                                                                         |
| `payroll_tax_finals`                                                                 | live while `cleared_at IS NULL`                                                                                                                                                                                                                                                  | live only                                                                                                                     |
| `payroll_tax_years.frozen_at`                                                        | the year closed                                                                                                                                                                                                                                                                  | —                                                                                                                             |
| `payroll_certificates`                                                               | made (`made_at`), released to My tax (`released_at`), e-mailed (`emailed_at`)                                                                                                                                                                                                    | released = staff can see it                                                                                                   |
| `payroll_revisions.status`                                                           | DRAFT (simulated) → APPLIED (structures / rates changed, arrears made) or CANCELLED                                                                                                                                                                                              | APPLIED                                                                                                                       |
| `payroll_settlements.status`                                                         | DRAFT (made by a trigger when an exit is approved) → COMPUTED → APPROVED (another checker) → STAGED (items put into `pay_month` as FNF one-off lines) → SETTLED (all items paid by a locked run); or APPROVED → DUES (net below 0, dues letter) → SETTLED (collected); CANCELLED | exclude CANCELLED; SETTLED = done                                                                                             |
| `payroll_cutover.status`                                                             | SETUP → BROUGHT (people and history here) → PARALLEL (two months both systems run; the old one pays) → SIGNED → SWITCHED                                                                                                                                                         | internal                                                                                                                      |
| `payroll_parity_results.status`                                                      | MATCH, OPEN, EXPLAINED                                                                                                                                                                                                                                                           | internal                                                                                                                      |
| `payroll_bonus_rules.kind`                                                           | PERCENT of basic + DA, FIXED sum, STATUTORY formula                                                                                                                                                                                                                              | —                                                                                                                             |
| `payroll_bank_accounts.active`, `payroll_payees.active`, `payroll_ward_links.active` | true = in use                                                                                                                                                                                                                                                                    | —                                                                                                                             |
| `payroll_formula_tests.last_status`                                                  | pass / fail                                                                                                                                                                                                                                                                      | internal                                                                                                                      |
| `payroll_report_presets.deleted_at`                                                  | soft delete                                                                                                                                                                                                                                                                      | internal                                                                                                                      |

## Amounts, dates and counting rules

**The one filter every money report needs** (records of runs that count, never a failed record):

```
FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
WHERE u.deleted_at IS NULL AND r.status <> 'FAILED'
  AND u.stage IN ('LOCKED', 'PAID')              -- final figures
  -- or u.stage IN ('APPROVED', 'LOCKED', 'PAID') -- with this month's provisional run; flag it as PROVISIONAL
```

**One row per what.** `payroll_records` is one per employee **per run**, not per month (unique `run_id, employee_id`).
A month can hold a regular record plus top-ups (supplementary, bonus, full and final) for the same person. For "per
employee per month", group by `employee_id, month`: **sum** the money, take days with
`max(paid_days) FILTER (WHERE NOT is_top_up)`. `payroll_attendance` is one per employee and month. `payroll_profiles` is
one per employee. `payroll_structures` has no unique key: pick the active row in force.

**Record money** (rupees, `numeric(12,2)`; the engine works in paise, half-up):

- `gross_fixed` = the full-month amounts of the structure's earning heads (before loss of pay).
- `gross_earned` = **gross pay**: every EARNING line paid — prorated structure heads, arrears, one-off earnings.
- `lop_amount` = `gross_fixed` − the structure earnings actually paid (the loss-of-pay cut).
- `total_deductions` = every DEDUCTION line, **including the `ROUND_ADJ` rounding line** (which can be negative when the
  net is rounded up).
- `net_pay` = `gross_earned − total_deductions` (never below 0; a negative net is refused and recovered as a RECOVERY loan).
- `pt_amount` = profession tax; `it_amount` + `cess_amount` = **TDS** of the month (the TDS line carries both).
- `pf_wage`, `esi_wage` (0 when not ESI-covered), `pt_wage` = the wages each deduction stood on.
- Cached on the run: `payroll_runs.gross_total / deduction_total / net_total / emp_count` (non-failed records). They can
  drift on imported runs; sum the records instead.

**Lines** (`payroll_record_lines`): `amount` = paid this month; `rate` = the full-month entitlement for a structure line
(for other lines it equals the amount). `head_type` EARNING / DEDUCTION; `is_arrear`; `is_structure`; `is_taxable`
(earnings only); `source_kind` structure / arrear / adhoc / recurring / loan / engine (PF, VPF, NPS, ESI, PT, LWF, TDS)
/ rounding. Structure earning lines are written even at 0; filter `amount <> 0` when counting people on a head.
`sum(amount)` of EARNING lines = `gross_earned`; of DEDUCTION lines = `total_deductions`.

**Statutory** (`payroll_record_statutory`): employee shares `ee_pf`, `vpf`, `esi_ee`, `nps_ee`, `lwf_ee` (these are
also deduction lines); **employer shares are only here**: `er_epf` (the employer's EPF difference), `er_eps`, `edli`,
`pf_admin`, `esi_er`, `nps_er`, `lwf_er`. **Cost to school** (the API's definition) = `gross_earned` + `er_epf + er_eps +
edli + pf_admin + esi_er + nps_er + lwf_er` (no gratuity). ESI counts only where `esi_covered`; `esi_wage` here holds
the wage even when not covered.

**Tax** (`payroll_record_tax`): annual projection figures (`gross_projection`, `taxable_income`, `annual_tax`,
`ytd_tds`, `months_left`) and the month's `monthly_tds`. The year as paid = the employee's **last** LOCKED / PAID record
of the `fy` with `mode = 'PROJECTION'` (what Form 16 / 130 Part B reads). Year-to-date taxable salary = sum of EARNING
lines with `is_taxable` in that year's locked records.

**Signs.** `payroll_arrears.amount` negative = a recovery. `payroll_adhoc.amount` negative only for a RECOVERY offset.
`payroll_lop_reversals.days` negative = days charged. `payroll_settlements.net` negative = dues the school collects.
Everything else is positive; deductions are positive amounts on DEDUCTION lines (subtract them yourself).

**Dates.** Every `month`, `start_month`, `period_month`, `pay_month`, `source_month` is the first day of the month
(CHECK). Group pay by `payroll_records.month` (the pay month), not by `paid_at` (when the money went; `timestamptz`,
use Asia/Kolkata). Arrears: `period_month` is the month owed for, the paying record's `month` is when paid. A school
with a pay cycle (`payroll_settings.pay_cycle_from_day`) reads attendance from `window_from` to `window_to`, which spans
two calendar months; the pay month label stays the same.

**Years.** Payroll uses the **financial year** April–March, not the academic year. `fy` is text `'2026-27'` in the tax
tables, records' tax, bonus and certificates; **`payroll_compliance.fy` is an integer** (2026 = 2026-27). TDS quarters:
1 = Apr–Jun, 2 = Jul–Sep, 3 = Oct–Dec, 4 = Jan–Mar; `payroll_tds_challans.months` are calendar month numbers. ESI
contribution periods start 1 April and 1 October.

**Rates: fractions vs per cents.** Fractions: `payroll_rates.rate_value` (0.58 = 58 %), PF / ESI / NPS / cess / TDS
slab / surcharge rates, `payroll_bonus_rules.rate`. Per cent figures: `payroll_pay_head_slabs.percent` (12.5),
`payroll_loans.interest_rate` (9.5 a year), `payroll_settings.increment_pct` (3).

**Current vs historical.** For a past month use the record's snapshots (`employee_name`, `designation`, `department`,
`staff_type`, `pay_level`, `pay_cell`, `category`, bank, `pan_masked`, `tax_regime`), never today's `employees` or
`payroll_profiles` row. A structure as of a date = the active row covering it. Formula heads (DA, HRA, TA) are worked
out in the run: the structure holds only their parameters (e.g. TA_BASE), so a monthly salary comes from the records
(`gross_fixed`, or structure lines' `rate`), not from adding up `payroll_structures.amount`.

## Answering report questions

There is **no mart** for payroll: reports read the base tables. The API's own report scope (`RECS` in
`apps/api/src/modules/payroll/payroll-reports.ts`) and the report-builder datasets `payroll_register` and
`payroll_heads` (`packages/db/src/datasets.ts`) are the reference queries. Every sketch below passed `explain.mjs`;
dates are examples (October 2026, FY 2026-27).

**1. What did each employee get in October 2026 (gross, deductions, net)?**

```sql
SELECT r.employee_id,
       max(r.employee_code)                              AS emp_code,
       max(r.employee_name)                              AS employee,
       max(r.department)                                 AS department,
       max(r.designation)                                AS designation,
       max(r.paid_days) FILTER (WHERE NOT r.is_top_up)   AS paid_days,
       max(r.lop_days)  FILTER (WHERE NOT r.is_top_up)   AS lop_days,
       sum(r.gross_earned)                               AS gross,
       sum(r.total_deductions)                           AS deductions,
       sum(r.net_pay)                                    AS net,
       sum(r.it_amount + r.cess_amount)                  AS income_tax,
       bool_or(r.status = 'HELD')                        AS held,
       bool_or(u.stage = 'APPROVED')                     AS provisional
  FROM payroll_records r
  JOIN payroll_runs u ON u.id = r.run_id
 WHERE r.month = DATE '2026-10-01'
   AND u.deleted_at IS NULL
   AND u.stage IN ('APPROVED', 'LOCKED', 'PAID')
   AND r.status <> 'FAILED'
 GROUP BY r.employee_id
 ORDER BY department NULLS LAST, employee;
```

Salary register. All runs of the month together; drop `'APPROVED'` for final figures only.

**2. Month by month this financial year: staff paid, gross, net and cost to school.**

```sql
SELECT to_char(r.month, 'YYYY-MM')                     AS month,
       count(DISTINCT r.employee_id)                   AS staff_paid,
       sum(r.gross_earned)                             AS gross,
       sum(r.total_deductions)                         AS deductions,
       sum(r.net_pay)                                  AS net,
       sum(COALESCE(st.er_epf, 0) + COALESCE(st.er_eps, 0) + COALESCE(st.edli, 0) + COALESCE(st.pf_admin, 0)
           + COALESCE(st.esi_er, 0) + COALESCE(st.nps_er, 0) + COALESCE(st.lwf_er, 0)) AS employer_share,
       sum(r.gross_earned)
         + sum(COALESCE(st.er_epf, 0) + COALESCE(st.er_eps, 0) + COALESCE(st.edli, 0) + COALESCE(st.pf_admin, 0)
               + COALESCE(st.esi_er, 0) + COALESCE(st.nps_er, 0) + COALESCE(st.lwf_er, 0)) AS cost_to_school
  FROM payroll_records r
  JOIN payroll_runs u ON u.id = r.run_id
  LEFT JOIN payroll_record_statutory st ON st.record_id = r.id
 WHERE r.month BETWEEN DATE '2026-04-01' AND DATE '2027-03-01'
   AND u.deleted_at IS NULL
   AND u.stage IN ('LOCKED', 'PAID')
   AND r.status <> 'FAILED'
 GROUP BY r.month
 ORDER BY r.month;
```

Final months only. Statutory is 1 : 1 with a record, so the LEFT JOIN does not repeat rows.

**3. Head-wise totals of a month (how much basic, DA, HRA, PF, TDS …).**

```sql
SELECT l.code,
       max(l.name)                    AS head,
       l.head_type,
       max(h.category)                AS category,
       count(DISTINCT r.employee_id)  AS staff,
       sum(l.amount)                  AS amount,
       sum(l.amount) FILTER (WHERE l.is_arrear) AS of_which_arrears
  FROM payroll_record_lines l
  JOIN payroll_records r ON r.id = l.record_id
  JOIN payroll_runs u ON u.id = r.run_id
  LEFT JOIN payroll_pay_heads h ON h.id = l.pay_head_id
 WHERE r.month = DATE '2026-10-01'
   AND u.deleted_at IS NULL
   AND u.stage IN ('LOCKED', 'PAID')
   AND r.status <> 'FAILED'
 GROUP BY l.code, l.head_type
HAVING sum(l.amount) <> 0
 ORDER BY l.head_type, min(l.print_order), l.code;
```

The LEFT JOIN keeps the `ROUND_ADJ` line (no pay head). Employer shares are not here (see question 2).

**4. Salary by department and staff type for a month.**

```sql
SELECT COALESCE(r.department, '(none)')        AS department,
       COALESCE(r.staff_type, '(none)')        AS staff_type,
       count(DISTINCT r.employee_id)           AS staff,
       sum(r.gross_earned)                     AS gross,
       sum(r.net_pay)                          AS net,
       round(sum(r.gross_earned) / NULLIF(count(DISTINCT r.employee_id), 0), 2) AS avg_gross_per_person
  FROM payroll_records r
  JOIN payroll_runs u ON u.id = r.run_id
 WHERE r.month = DATE '2026-10-01'
   AND u.deleted_at IS NULL
   AND u.stage IN ('LOCKED', 'PAID')
   AND r.status <> 'FAILED'
 GROUP BY 1, 2
 ORDER BY 1, 2;
```

Uses the snapshots on the record, so moves and renames after the month do not change it. "staff" counts persons, not records.

**5. PF, ESI, PT and LWF register of a month.**

```sql
SELECT r.employee_id,
       max(r.employee_code)                               AS emp_code,
       max(r.employee_name)                               AS employee,
       max(r.uan)                                         AS uan,
       max(r.esi_number)                                  AS esi_ip_number,
       sum(r.gross_earned)                                AS gross,
       sum(st.pf_wage)                                    AS epf_wage,
       sum(st.eps_wage)                                   AS eps_wage,
       sum(st.ee_pf)                                      AS employee_pf,
       sum(st.vpf)                                        AS vpf,
       sum(st.er_eps)                                     AS employer_eps,
       sum(st.er_epf)                                     AS employer_epf_difference,
       sum(st.edli + st.pf_admin)                         AS edli_and_admin,
       max(st.ncp_days) FILTER (WHERE NOT r.is_top_up)    AS ncp_days,
       bool_or(st.esi_covered)                            AS esi_covered,
       sum(st.esi_wage) FILTER (WHERE st.esi_covered)     AS esi_wage,
       sum(st.esi_ee)   FILTER (WHERE st.esi_covered)     AS employee_esi,
       sum(st.esi_er)   FILTER (WHERE st.esi_covered)     AS employer_esi,
       sum(r.pt_amount)                                   AS profession_tax,
       sum(COALESCE(st.lwf_ee, 0))                        AS employee_lwf,
       sum(COALESCE(st.lwf_er, 0))                        AS employer_lwf
  FROM payroll_records r
  JOIN payroll_runs u ON u.id = r.run_id
  JOIN payroll_record_statutory st ON st.record_id = r.id
 WHERE r.month = DATE '2026-10-01'
   AND u.deleted_at IS NULL
   AND u.stage IN ('LOCKED', 'PAID')
   AND r.status <> 'FAILED'
 GROUP BY r.employee_id
 ORDER BY employee;
```

ECR wages are whole rupees in the filed file; here they are rupees and paise. ESI figures only for covered staff.

**6. TDS deducted each quarter against challans deposited (FY 2026-27).**

```sql
WITH ded AS (
  SELECT ((extract(month FROM r.month)::int + 8) % 12) / 3 + 1 AS quarter,
         count(DISTINCT r.employee_id)                         AS staff_taxed,
         sum(r.it_amount + r.cess_amount)                      AS deducted
    FROM payroll_records r
    JOIN payroll_runs u ON u.id = r.run_id
   WHERE r.month BETWEEN DATE '2026-04-01' AND DATE '2027-03-01'
     AND u.deleted_at IS NULL
     AND u.stage IN ('LOCKED', 'PAID')
     AND r.status <> 'FAILED'
     AND (r.it_amount + r.cess_amount) > 0
   GROUP BY 1),
dep AS (
  SELECT quarter, count(*) AS challans, sum(amount) AS deposited, sum(interest) AS interest, sum(late_fee) AS late_fee
    FROM payroll_tds_challans
   WHERE fy = '2026-27' AND deleted_at IS NULL
   GROUP BY quarter)
SELECT q.quarter,
       COALESCE(d.staff_taxed, 0)   AS staff_taxed,
       COALESCE(d.deducted, 0)      AS deducted,
       COALESCE(p.challans, 0)      AS challans,
       COALESCE(p.deposited, 0)     AS deposited,
       COALESCE(d.deducted, 0) - COALESCE(p.deposited, 0) AS not_yet_deposited
  FROM generate_series(1, 4) AS q(quarter)
  LEFT JOIN ded d ON d.quarter = q.quarter
  LEFT JOIN dep p ON p.quarter = q.quarter
 ORDER BY q.quarter;
```

For one line per employee, group the records by `employee_id` and sum `it_amount + cess_amount` over the year.

**7. Each employee's salary structure in force today.**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
s AS (
  SELECT DISTINCT ON (s.employee_id, s.pay_head_id)
         s.employee_id, h.code, h.head_type, s.amount, s.effective_from
    FROM payroll_structures s
    JOIN payroll_pay_heads h ON h.id = s.pay_head_id
    CROSS JOIN today
   WHERE s.status = 'active'
     AND s.effective_from <= today.d
     AND (s.effective_to IS NULL OR s.effective_to >= today.d)
   ORDER BY s.employee_id, s.pay_head_id, s.effective_from DESC),
last_month AS (
  SELECT DISTINCT ON (r.employee_id) r.employee_id, r.month, r.gross_fixed
    FROM payroll_records r
    JOIN payroll_runs u ON u.id = r.run_id
   WHERE u.run_type = 'REGULAR' AND NOT r.is_top_up
     AND u.deleted_at IS NULL AND u.stage IN ('LOCKED', 'PAID') AND r.status <> 'FAILED'
   ORDER BY r.employee_id, r.month DESC)
SELECT e.employee_code,
       e.display_name,
       e.employee_type,
       jsonb_object_agg(s.code, s.amount ORDER BY s.code) AS structure_amounts,
       max(s.effective_from)                               AS latest_change_from,
       max(lm.month)                                       AS last_paid_month,
       max(lm.gross_fixed)                                 AS last_month_gross_fixed
  FROM s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN payroll_profiles p ON p.employee_id = e.id
  LEFT JOIN last_month lm ON lm.employee_id = e.id
 WHERE e.deleted_at IS NULL
   AND e.status = 'active'
   AND COALESCE(p.payroll_status, 'ACTIVE') <> 'LEFT'
 GROUP BY e.id, e.employee_code, e.display_name, e.employee_type
 ORDER BY e.display_name;
```

Structure amounts are FIXED amounts or formula parameters; the last locked regular month's `gross_fixed` is the
full-month salary actually worked out.

**8. Whose salary is still unpaid or held in locked months?**

```sql
SELECT to_char(r.month, 'YYYY-MM') AS month,
       u.run_type,
       u.seq,
       u.stage                      AS run_stage,
       r.employee_code,
       r.employee_name,
       COALESCE(r.pay_mode, 'BANK') AS pay_mode,
       r.status                     AS record_status,
       r.held_reason,
       r.net_pay,
       (SELECT b.status
          FROM payroll_bank_batch_lines bl
          JOIN payroll_bank_batches b ON b.id = bl.batch_id
         WHERE bl.record_id = r.id AND bl.status = 'SENT'
         LIMIT 1)                   AS live_bank_file_status
  FROM payroll_records r
  JOIN payroll_runs u ON u.id = r.run_id
 WHERE u.deleted_at IS NULL
   AND u.stage IN ('LOCKED', 'PAID')
   AND r.status IN ('COMPUTED', 'RELEASED', 'HELD')
   AND r.net_pay > 0
 ORDER BY r.month, r.status, r.employee_name;
```

`live_bank_file_status` shows a salary sitting in a file not yet confirmed. Zero-net records are left out.

**9. Loans and advances outstanding, with this year's recovery.**

```sql
SELECT e.employee_code,
       e.display_name,
       l.loan_type,
       l.principal,
       l.emi,
       l.interest_method,
       l.interest_rate,
       l.start_month,
       l.status,
       l.balance                         AS balance_now,
       COALESCE(x.instalments, 0)        AS instalments_this_fy,
       COALESCE(x.principal_recovered, 0) AS principal_recovered_this_fy,
       COALESCE(x.interest_recovered, 0) AS interest_recovered_this_fy
  FROM payroll_loans l
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN (
        SELECT rl.loan_id,
               count(*)          AS instalments,
               sum(rl.principal) AS principal_recovered,
               sum(rl.interest)  AS interest_recovered
          FROM payroll_record_loans rl
          JOIN payroll_records r ON r.id = rl.record_id
          JOIN payroll_runs u ON u.id = r.run_id
         WHERE u.deleted_at IS NULL
           AND u.stage IN ('LOCKED', 'PAID')
           AND r.status <> 'FAILED'
           AND r.month BETWEEN DATE '2026-04-01' AND DATE '2027-03-01'
         GROUP BY rl.loan_id) x ON x.loan_id = l.id
 WHERE l.status IN ('ACTIVE', 'HOLD')
   AND l.balance > 0
 ORDER BY e.display_name, l.id;
```

`balance_now` already includes instalments of runs only processed, not yet locked (see Traps).

**10. Who had loss of pay in October 2026, and how much did it cost them?**

```sql
SELECT e.employee_code,
       e.display_name,
       a.month_days,
       a.present_days,
       a.paid_leave_days,
       a.lop_days,
       a.pre_join_days,
       a.post_leave_days,
       a.paid_days,
       a.unmarked_days,
       a.source,
       a.finalised,
       p.lop_amount
  FROM payroll_attendance a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN LATERAL (
        SELECT sum(r.lop_amount) AS lop_amount
          FROM payroll_records r
          JOIN payroll_runs u ON u.id = r.run_id
         WHERE r.employee_id = a.employee_id
           AND r.month = a.month
           AND u.deleted_at IS NULL
           AND u.stage IN ('LOCKED', 'PAID')
           AND r.status <> 'FAILED') p ON true
 WHERE a.month = DATE '2026-10-01'
   AND a.lop_days > 0
 ORDER BY a.lop_days DESC, e.display_name;
```

`lop_days` includes absence, unpaid leave and salary-hold days; days before joining or after leaving are apart.

**11. (Fees) Staff children's fees recovered through salary this year, by class.**

```sql
SELECT c.name                          AS class,
       count(DISTINCT a.employee_id)   AS staff,
       count(DISTINCT fp.student_id)   AS children,
       count(*)                        AS deductions,
       sum(a.amount)                   AS recovered_from_salary
  FROM payroll_adhoc a
  JOIN payroll_records r ON r.id = a.paid_in_record_id
  JOIN payroll_runs u ON u.id = r.run_id
  JOIN fee_payments fp ON fp.id = a.fee_payment_id
  JOIN enrolments en ON en.student_id = fp.student_id AND en.academic_year_id = fp.academic_year_id
  JOIN class_sections cs ON cs.id = en.class_section_id
  JOIN classes c ON c.id = cs.class_id
 WHERE a.ref_module = 'FEE'
   AND a.deleted_at IS NULL
   AND u.deleted_at IS NULL
   AND u.stage IN ('LOCKED', 'PAID')
   AND r.status <> 'FAILED'
   AND fp.status <> 'reversed'
   AND r.month BETWEEN DATE '2026-04-01' AND DATE '2027-03-01'
 GROUP BY c.id, c.name, c.display_order
 ORDER BY c.display_order;
```

Crosses into Fees and Students: the receipt is posted at lock; a reopened run reverses it and clears `fee_payment_id`.

**12. (HR exits) Leavers' full and final settlements this year, with what payroll has paid.**

```sql
SELECT e.employee_code,
       e.display_name,
       x.exit_type,
       x.status                      AS exit_status,
       s.last_day,
       s.status                      AS settlement_status,
       s.gratuity,
       s.gratuity_tax_free,
       s.gratuity_forfeited,
       s.encash_days,
       s.encash_amount,
       s.notice_amount,
       s.loans,
       s.other_payable,
       s.other_recovery,
       s.net,
       s.pay_month,
       s.dues_letter_no,
       (SELECT sum(CASE WHEN h.head_type = 'EARNING' THEN a.amount ELSE -a.amount END)
          FROM payroll_adhoc a
          JOIN payroll_pay_heads h ON h.id = a.pay_head_id
          JOIN payroll_records r ON r.id = a.paid_in_record_id
          JOIN payroll_runs u ON u.id = r.run_id
         WHERE a.ref_module = 'FNF' AND a.ref_id LIKE 'FNF/' || s.id || '/%'
           AND a.deleted_at IS NULL AND u.deleted_at IS NULL AND u.stage IN ('LOCKED', 'PAID')) AS paid_through_payroll,
       f.status                      AS exit_statement_status,
       f.net                         AS exit_statement_net
  FROM payroll_settlements s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN employee_exits x ON x.id = s.exit_id
  LEFT JOIN employee_fnf f ON f.exit_id = s.exit_id
 WHERE s.status <> 'CANCELLED'
   AND s.last_day BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 ORDER BY s.last_day;
```

Crosses into HR exits: `employee_fnf` is the exit statement that payroll's figures feed. Earnings minus recoveries paid
by locked runs.

## Traps

- **Several records per employee per month.** Regular + supplementary + bonus + full-and-final top-ups. Count persons
  with `count(DISTINCT employee_id)`; sum money across records; never sum `paid_days`, `month_days` or `lop_days` across
  records (top-ups carry 0; take `max(...) FILTER (WHERE NOT is_top_up)`).
- **Unfinished runs.** Filter `payroll_runs.deleted_at IS NULL`, the stage, and `payroll_records.status <> 'FAILED'`.
  FAILED records carry 0 money but inflate head counts.
- **APPROVED is provisional.** During the go-live (`payroll_cutover.status` not SWITCHED) EduPro's runs of the
  `parallel_months` stop at APPROVED and are never paid — the old payroll paid those months (later brought in as
  `imported` runs). Use LOCKED / PAID for anything that must be true.
- **Records are rebuilt.** Reprocess, reject or reopen deletes a run's records and makes new ones with new ids. Do not
  keep record ids of unlocked runs.
- **Consumption is marked at processing, not at lock.** `payroll_loans.balance` (and CLOSED), `payroll_claims.status =
'PAID'`, `payroll_adhoc.paid_in_record_id` and `payroll_arrears.paid_in_record_id` are set when a run is processed and
  undone when it is purged. "Paid" needs the paying record's run in LOCKED / PAID.
- **Double counting the inputs.** A claim, an overtime entry, a settlement item, a bonus posting and a fee recovery each
  become a `payroll_adhoc` row, which becomes a record line. Count paid money once, from the record lines; count requests
  from the source table.
- **Rate-based overtime replaces structure OT.** When a live `payroll_ot_entries` row exists, the OT structure head is
  not worked out that month.
- **Employer shares are not lines.** Adding `payroll_record_statutory` to deduction lines double counts the employee's
  PF / ESI / NPS / LWF; employer shares exist only in `payroll_record_statutory`.
- **The rounding line.** `ROUND_ADJ` has `pay_head_id` NULL, `source_kind = 'rounding'`, may be negative and is inside
  `total_deductions`. An inner join to `payroll_pay_heads` drops it and the lines stop adding up.
- **TDS is `it_amount + cess_amount`.** Using `it_amount` alone misses the cess.
- **ESI wage when not covered.** `payroll_record_statutory.esi_wage` is filled even when `esi_covered` is false (with 0
  contributions); `payroll_records.esi_wage` is 0 then. Filter `esi_covered`.
- **Today's values for past months.** `employees.department`, `designation`, `employee_type` and `payroll_profiles` are
  today's. Use the record snapshots. Imported records got `staff_type`, `pay_cell` and `category` from the values at
  import time, not as paid.
- **Imported history** (`payroll_runs.imported`): records have `engine_version = 'legacy'`, no `payroll_record_tax` and
  no `payroll_record_loans`; staff the old system had but EduPro could not match were left out, so the run's cached
  totals may not equal the sum of its records.
- **Dated tables.** Drafts and withdrawn rows sit beside active ones; several active rows exist per key over time. Always
  filter `status = 'active'` and the date window, and take the latest `effective_from`.
- **Structures are not salaries.** Formula heads hold parameters; DA / HRA / OT are computed. Use record lines.
- **Fractions vs per cents** (see Amounts) and **`fy` text vs integer** (`payroll_compliance.fy`).
- **Bank totals.** `payroll_bank_batches.total` is the file as made; lines later REJECTED are inside it. A record can have
  a REJECTED line and a later SENT line. Paid by bank = SENT lines of CONFIRMED batches. A PAID run can return to LOCKED.
- **Soft deletes and live flags**: `payroll_runs`, `payroll_adhoc`, `payroll_ot_entries`, `payroll_declarations`,
  `payroll_prev_employment`, `payroll_perquisites` (+ `superseded_at`), `payroll_tds_challans`, `payroll_report_presets`
  (`deleted_at`); `payroll_arrears.cancelled_at`; `payroll_tax_finals.cleared_at`; `active` on holds, payees, ward links,
  bank accounts.
- **Department is text.** `payroll_records.department` is the employee's legacy department text; match `departments.name`
  by text if you need the master.
- **Attendance without pay.** `payroll_attendance` rows exist for skipped, failed or not-yet-run months, and imported
  ones (`source = 'import'`). Do not count them as paid staff.
- **Confidential staff.** `payroll_settings.confidential_employee_ids` are hidden from payroll makers in every list and
  report (checkers, the payroll admin and the auditor see them). A report for a maker must leave them out.
- **Time zone.** `paid_at`, `locked_at`, `approved_at`, `confirmed_at` are `timestamptz`; the school's day is Asia/Kolkata.

## Personal and sensitive data

Salary is confidential for every employee; bank and tax identifiers are sensitive personal data. Mask these or keep
them away from an AI model; send aggregates, not lines per named person, unless the user has the payroll right.

- **Bank details**: `payroll_records.bank_account_enc` (encrypted full account), `bank_account_masked`, `bank_ifsc`,
  `bank_name`; `payroll_bank_batch_lines.account_enc`, `account_masked`, `bank_ifsc`, `employee_name`, `amount`,
  `reject_reason`; `payroll_bank_batches.debit_account`, `utr`; `payroll_bank_accounts.account_no` (the school's account);
  `payroll_payees.payee_account`. Never send `*_enc` columns anywhere.
- **Tax and statutory identifiers**: `payroll_records.pan_masked`, `uan`, `pf_number`, `esi_number`;
  `payroll_return_members.uan`, `line` (name and wages); `payroll_declarations.detail` (landlord's name, address,
  relationship, encrypted and masked PAN, rent by month); `payroll_prev_employment.employer_name`, `employer_tan`;
  `payroll_certificates.file_id`, `part_a_file_id` (Form 16 with PAN); the school's `payroll_settings.tan`,
  `pf_establishment_code`, `esi_code`, `ptrc_no`.
- **Pay and money of a person**: every amount in `payroll_records`, `payroll_record_lines`, `payroll_record_statutory`,
  `payroll_record_tax` (incl. `working`), `payroll_record_loans`, `payroll_structures`, `payroll_revision_letters`
  (`before`, `after`), `payroll_loans`, `payroll_adhoc`, `payroll_recurring` (`reference_no` = policy or court-order
  number), `payroll_claims`, `payroll_ot_entries`, `payroll_tds_manual`, `payroll_arrears`, `payroll_lop_reversals`,
  `payroll_settlements`, `payroll_tax_finals`, `payroll_perquisites`, `payroll_declarations`, `payroll_esi_coverage`,
  `payroll_parity_results`; the frozen `payroll_records.payslip` and `trace` jsonb.
- **Names and identity**: `payroll_records.employee_code`, `employee_name`; `payroll_nominees.name`, `relation`, `dob`,
  `guardian_name`, `address`; `payroll_ward_links` (which student is which staff member's child) and
  `payroll_adhoc.detail` (studentId of a fee recovery).
- **Health, disability and conduct**: `payroll_profiles.pwd` (disability), `pt_exempt_reason`; `payroll_settlements.reason`
  (DEATH, DISABLEMENT, DISMISSAL), `forfeit_reason`, `detail` (nominees' shares, leave); `payroll_claims.description` and
  `proof_file_id` (bills, often medical); `payroll_attendance.detail` (leave by type).
- **Free-text notes about people**: `payroll_holds.reason`, `payroll_records.held_reason`, `failure_reason`, `warnings`,
  `payroll_claims.decision_remark`, `payroll_lop_reversals.reason`, `payroll_ot_entries.reason`, `payroll_loans.remarks`,
  `payroll_adhoc.remarks`, `payroll_declarations.reject_reason`, `payroll_regime_events.reason`,
  `payroll_tax_finals.reason`, `payroll_profile_changes.old_value/new_value`, `payroll_parity_explanations.note`,
  `payroll_run_events.comment`.
- **Files**: `payroll_claims.proof_file_id`, `payroll_declarations.proof_file_ids`, `payroll_prev_employment.proof_file_ids`,
  `payroll_parity_explanations.evidence_file_id`.
- **Bulk copies — never send**: `payroll_legacy_rows.payload` (raw old payroll rows), `payroll_transfer_imports.packet`
  and `written` (profile, structure, loans and tax of a person), `payroll_settings.payslip_password` (the password
  pattern: PAN / date-of-birth tokens), `payroll_settings.confidential_employee_ids`.
