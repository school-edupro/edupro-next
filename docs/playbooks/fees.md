# Playbook: fees (draft for the finance workshop)

Source: rules recovered from the legacy fee engine (`fee_ledger/fee_function.php` and related, see the blueprint sections 5.3 and 5.10). Status: **draft**; every rule needs confirmation by the school's finance team in the Sprint 1 workshop. Open questions are numbered Q-F1 onward for the tracker.

## 1. Entities

| Entity        | Meaning                                                                                              | Target table                                  |
| ------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Fee head      | a chargeable item (tuition, transport, annual, hostel, misc) with a priority order and optional flag | `fee_heads`                                   |
| Fee structure | amounts per class, head, period and student type (new or old) for a year                             | `fee_structures`, `fee_structure_lines`       |
| Fee period    | instalment or month with a due date and up to three later slab dates                                 | `fee_periods`                                 |
| Discount rule | percentage or fixed reduction per head, tied to a category or a named concession                     | `fee_discount_rules`, `student_fee_discounts` |
| Demand        | the amount a student owes per head per period after discounts                                        | `fee_demands`                                 |
| Receipt       | a collection event with mode, reference and lines allocated per head and period                      | `receipts`, `receipt_lines`                   |
| Adjustment    | waiver, reversal, refund, late-fee override, bounce charge                                           | `fee_adjustments`                             |
| Ledger type   | school, hostel, misc, admission; separate receipt sequences                                          | `receipt_sequences.ledger_type`               |

## 2. Rules recovered from the legacy system

| ID    | Rule                                                                                                                                                                     | Legacy evidence                                               | Confidence |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| R-F1  | Demand is generated per student from the structure for the student's class and type (new or old), one row per head per period                                            | `GenerateFee()`                                               | high       |
| R-F2  | Withdrawn students get no demand                                                                                                                                         | `GenerateFee()` rejects withdrawn                             | high       |
| R-F3  | Discounts apply per head; a student carries one discount type with an amount or percentage                                                                               | `fees_discountmaster`, `student_master.DiscontType`           | medium     |
| R-F4  | Transport fee is added from the student's route slab as head 13 unless the class setting disables transport fee for discounted students                                  | `GenerateFee()`                                               | medium     |
| R-F5  | Opening balances (credit or debit) from the previous year are applied before the first period                                                                            | `upload_cr_dr_balance`                                        | medium     |
| R-F6  | Amounts are rounded and a reconcile step fixes rounding differences                                                                                                      | rounding reconcile in `GenerateFee()`                         | low        |
| R-F7  | Late fee mode is a per-school setting: day-wise = days after due date times a per-day amount; slab-wise = fixed amounts after due date, then after slab dates 1, 2 and 3 | `fnlLateFee`, `fnlLateFeeWithDate`, `$lateFeeCalculationType` | high       |
| R-F8  | Manual late-fee overrides are recorded per student and period                                                                                                            | `fees_latefee_adjust`                                         | high       |
| R-F9  | Receipt numbers are sequential per ledger and financial year with a prefix (`TF`)                                                                                        | `'TF' + MAX+1`                                                | high       |
| R-F10 | A receipt allocates the paid amount across heads and periods in head priority order; partial payments leave a balance                                                    | `student_fee_pay`                                             | medium     |
| R-F11 | Cheque receipts carry cheque number, bank and date; a bounce reverses the receipt and adds a bounce charge                                                               | `fee_bounce_student_data`, `cheque_status`                    | high       |
| R-F12 | Misc fees are collected against announced misc heads and may be paid by students, employees or vendors                                                                   | `fees_misc_announce`, `fees_misc_collection`                  | medium     |
| R-F13 | Category or discount changes and transport requests need approval before they affect demand                                                                              | `category_approvals.php`, `transport_approvals.php`           | high       |
| R-F14 | Online payments: an intent is staged, the gateway callback is verified, then the receipt is posted once (idempotent)                                                     | `payment_callback.php` (canonical)                            | high       |
| R-F15 | Fee months are opened for collection by a schedule (visibility flag per period)                                                                                          | `cronJobFeeSubmission.php`                                    | medium     |
| R-F16 | Hostel fees use the same engine with separate heads, structures and receipt series                                                                                       | `hostel_fee/`                                                 | high       |
| R-F17 | Reports: day book by date and mode, head-wise tally, yearly projection, defaulters by period, income tax certificate per payer                                           | `fee_ledger` reports                                          | high       |

## 3. Proposed behaviour in EduPro Next

1. Demand generation is a procedure (`app.generate_fee_demand`) run per student and year, idempotent, with a diff shown before regeneration.
2. Late fee is a pure function (`app.late_fee`) reading the school setting and the period slabs; overrides are adjustments with reason and approver.
3. Receipt posting is one transaction (`app.post_receipt`) that allocates, numbers, writes lines and audit, and rejects when the year's fees stage is locked.
4. Every reversal, refund, waiver and bounce is an adjustment with a workflow approval where the school requires it.
5. Online and counter payments share the posting procedure; the gateway webhook is idempotent on the intent id.

## 4. Open questions for the finance workshop

| ID    | Question                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------- |
| Q-F1  | Is the late-fee mode the same for all classes and ledgers in a school, or can hostel differ?                         |
| Q-F2  | For day-wise late fee, is there a cap per period or per year, and are Sundays and holidays excluded?                 |
| Q-F3  | Allocation order of a partial payment: oldest period first, then head priority, or head priority across all periods? |
| Q-F4  | May a receipt be reversed after the day book is closed, or only refunded? Who approves?                              |
| Q-F5  | Are opening balances carried per head or as one amount?                                                              |
| Q-F6  | Which discount types exist today (sibling, staff ward, merit, EWS, management) and can a student hold more than one? |
| Q-F7  | Which fee heads are optional and who decides opt-in per student?                                                     |
| Q-F8  | How are cheque bounce charges set: fixed per school, per bank, or per amount?                                        |
| Q-F9  | What is the receipt numbering format required by the auditors (prefix, year, width, ledger)?                         |
| Q-F10 | Which reports are statutory and in what layout (day book, fee register, income tax certificate)?                     |
| Q-F11 | Is the ledger export to Tally required daily, and in which format?                                                   |
| Q-F12 | For transport, is the fee by slab of distance, by stop, or by route, and what happens on mid-year changes?           |
