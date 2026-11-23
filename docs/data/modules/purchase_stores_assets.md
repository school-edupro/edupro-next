# Purchase, stores and assets — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

A department raises a **Purchase Indent** (PI); its levels approve it and free store stock is held for it first. The
purchase office turns the rest into a **Purchase Requisition** (PR) with **quotes** and a comparative statement (or the
system approves it under a bypass rule), then one **Purchase Order** (PO) per vendor: approved, sent, amended, closed.
Goods arrive on a **goods receipt** (GRN), are inspected, and the accepted part enters a **store** through the append-only
**stock ledger**; stock is then issued, returned, transferred, counted, revalued or written off. Asset units become
**assets** (tag, custodian, yearly depreciation, condemnation, disposal). Vendors, items, HSN and rate contracts are masters.

## Tables

| Table                            | One row is                                                                              | Key columns                                                                                                                                                                                                                                                                                                  | For reports                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `purchase_uoms`                  | a unit (NOS, BOX, KG …)                                                                 | `code`, `name`, `decimals`, `status`                                                                                                                                                                                                                                                                         | master                                                                                   |
| `purchase_hsn`                   | an HSN (goods) or SAC (services) code with its GST rate                                 | `code` (unique), `kind`, `gst_rate`, `reverse_charge`, `exempt`, `effective_from`                                                                                                                                                                                                                            | master (rate history only in `audit_logs`)                                               |
| `purchase_item_categories`       | a category (`parent_id` NULL) or a sub-category (`parent_id` set); two levels only      | `code`, `name`, `parent_id`, `dep_method`, `useful_life_years`, `salvage_pct`, `wdv_rate_pct`                                                                                                                                                                                                                | master                                                                                   |
| `purchase_items`                 | a catalogue item: consumable, asset or service                                          | `code` (unique), `name`, `item_type`, `category_id` (always the main category), `sub_category_id`, `uom_id`, `hsn_id`, `gst_rate`, `stock_tracked`, `tracks_batch`, `tracks_serial`, `stock_uom_id`, `stock_per_unit`, `last_purchase_rate`, `last_purchased_on`                                             | master                                                                                   |
| `purchase_payment_terms`         | a payment term                                                                          | `code`, `name`, `print_text`, `is_default` (one per school)                                                                                                                                                                                                                                                  | master                                                                                   |
| `purchase_payment_term_lines`    | one instalment of a term                                                                | `term_id`, `seq`, `pct`, `due_on` (advance / delivery / invoice), `days`                                                                                                                                                                                                                                     | master                                                                                   |
| `vendors`                        | a supplier (one master for the school)                                                  | `code`, `legal_name`, `trade_name`, `kind`, `gst_status`, `gstin`, `pan`, `state_code`, `msme_type`, `status`, `category_ids` (bigint[]), `payment_term_id`                                                                                                                                                  | master                                                                                   |
| `vendor_contacts`                | a contact person at a vendor                                                            | `vendor_id`, `name`, `phone`, `email`, `is_main`                                                                                                                                                                                                                                                             | master                                                                                   |
| `vendor_documents`               | a file kept for a vendor (GST, PAN, cheque …)                                           | `vendor_id`, `kind`, `file_id`                                                                                                                                                                                                                                                                               | detail                                                                                   |
| `vendor_changes`                 | a change of bank / GSTIN / PAN waiting for a second person                              | `vendor_id`, `changes`, `before` (jsonb), `status`, `requested_at`, `decided_at`                                                                                                                                                                                                                             | history                                                                                  |
| `purchase_rate_contracts`        | an agreed vendor and rate for an item over a period                                     | `vendor_id`, `item_id`, `rate`, `gst_inclusive`, `valid_from`, `valid_to`, `status`                                                                                                                                                                                                                          | master                                                                                   |
| `purchase_settings`              | one row per school: GSTIN, limits, prefixes, addresses, signatures                      | `direct_limit`, `committee_limit`, `committee_quotes`, `direct_pr_limit`, `stock_gst_in_cost`, `receipt_tolerance_pct`, `purchase_department_id`, `large_po_alert`                                                                                                                                           | internal (settings)                                                                      |
| `purchase_committee_members`     | an employee on the purchase committee                                                   | `employee_id`, `role`                                                                                                                                                                                                                                                                                        | master                                                                                   |
| `purchase_vendor_approvers`      | an employee named to approve vendors                                                    | `employee_id`                                                                                                                                                                                                                                                                                                | internal (settings)                                                                      |
| `purchase_department_approvals`  | a department's approval levels for one document type                                    | `department_id`, `doc_type` (indent, requisition, order, inspection, count, revaluation), `levels` (jsonb, ≤ 3)                                                                                                                                                                                              | internal (settings)                                                                      |
| `purchase_department_rules`      | a department's bypass rules                                                             | `department_id`, `bypass_limit`, `rate_contract_bypass`                                                                                                                                                                                                                                                      | internal (settings)                                                                      |
| `purchase_numbering`             | the next number of a document type in a financial year                                  | `doc`, `fy`, `next_no`                                                                                                                                                                                                                                                                                       | internal (sequence)                                                                      |
| `purchase_indents`               | a Purchase Indent (PI) of a department                                                  | `number` (NULL until first sent), `department_id`, `raised_by`, `on_behalf_employee_id`, `status`, `route`, `bypass_rule`, `estimate`, `priority`, `submitted_at`, `decided_at`, `workflow_instance_id`                                                                                                      | main                                                                                     |
| `purchase_indent_lines`          | an item (or a line in words) on an indent                                               | `indent_id`, `seq`, `item_id` / `free_text`, `quantity`, `uom_id`, `est_rate`, `rate_source`, `contract_id`, `stock_qty`, `stock_free`, `stock_reason`                                                                                                                                                       | detail                                                                                   |
| `purchase_indent_files`          | a file attached to an indent                                                            | `indent_id`, `file_id`                                                                                                                                                                                                                                                                                       | detail                                                                                   |
| `purchase_requisitions`          | a Purchase Requisition (PR): the sourcing decision                                      | `number`, `department_id`, `combined`, `status`, `tier`, `auto_rule`, `estimate`, `approved_at`, `revision`, `workflow_instance_id`                                                                                                                                                                          | main                                                                                     |
| `purchase_requisition_lines`     | a PR line: bought, or issued from a store                                               | `requisition_id`, `seq`, `item_id` / `free_text`, `quantity`, `uom_id`, `est_rate`, `vendor_id`, `rate`, `gst_rate`, `contract_id`, `fulfil`, `store_id`, `choice_reason`, `closed_reason`, `closed_at`                                                                                                      | detail                                                                                   |
| `purchase_requisition_sources`   | the part of an indent line a PR line carries                                            | `requisition_line_id`, `indent_line_id` (unique: one PR per indent line), `quantity`                                                                                                                                                                                                                         | detail (link)                                                                            |
| `purchase_requisition_files`     | a tender or other document on a PR                                                      | `requisition_id`, `kind`, `file_id`                                                                                                                                                                                                                                                                          | detail                                                                                   |
| `purchase_quotes`                | one vendor's quotation for a PR                                                         | `requisition_id`, `vendor_id` (unique per PR), `quote_ref`, `quote_date`, `valid_until`, `delivery_days`                                                                                                                                                                                                     | detail                                                                                   |
| `purchase_quote_lines`           | a vendor's rate for one PR line (the comparative statement)                             | `quote_id`, `requisition_line_id`, `rate`, `gst_rate`                                                                                                                                                                                                                                                        | detail                                                                                   |
| `purchase_cs_signoffs`           | a committee member's signature on a PR's comparative statement                          | `requisition_id`, `employee_id`, `user_id`, `signed_at`                                                                                                                                                                                                                                                      | detail (current signatures: deleted when the statement changes)                          |
| `purchase_orders`                | one revision of a PO to one vendor                                                      | `number` + `revision` (unique together), `supersedes_id`, `status`, `emergency`, `requisition_id`, `department_id`, `vendor_id`, `po_date`, `delivery_date`, `taxable`, `cgst`, `sgst`, `igst`, `rcm_gst`, `round_off`, `total`, `receipt_status`, `approved_at`, `sent_at`, `closed_at`                     | main                                                                                     |
| `purchase_order_lines`           | a line of a PO                                                                          | `order_id`, `seq`, `requisition_line_id`, `item_id`, `description`, `hsn_code`, `quantity`, `uom_id`, `rate`, `discount_pct`, `gst_rate`, `taxable`, `cgst`, `sgst`, `igst`, `rcm_gst`, `total`, `received_qty`, `accepted_qty`, `rejected_qty`, `returned_qty`, `contract_id`, `short_reason`, `close_rest` | detail                                                                                   |
| `purchase_order_charges`         | freight, installation, packing or other charge on a PO                                  | `order_id`, `kind`, `amount`, `gst_rate`, `cgst`, `sgst`, `igst`, `total`                                                                                                                                                                                                                                    | detail                                                                                   |
| `purchase_order_sends`           | one e-mail of the PO to the vendor                                                      | `order_id`, `to_address`, `file_id`, `message_id` → `comms_messages`, `sent_at`                                                                                                                                                                                                                              | history                                                                                  |
| `goods_receipts`                 | a goods receipt (GRN, into a store) or a service completion certificate, against one PO | `number`, `kind`, `order_id`, `store_id`, `received_on`, `status`, `inspection`, `accepted_on`, `invoice_no`, `challan_no`, `workflow_instance_id`                                                                                                                                                           | main                                                                                     |
| `goods_receipt_lines`            | a PO line on a receipt                                                                  | `receipt_id`, `seq`, `order_line_id`, `received_qty`, `refused_qty`, `accepted_qty`, `rejected_qty`, `unit_cost`, `batch_no`, `expiry`, `serials`                                                                                                                                                            | detail                                                                                   |
| `goods_receipt_signoffs`         | a committee member's signature on an inspection                                         | `receipt_id`, `employee_id`, `user_id`, `signed_at`                                                                                                                                                                                                                                                          | detail (current signatures: deleted when the inspection changes)                         |
| `stores`                         | a store: one `main` per school, `sub` stores under it                                   | `code`, `name`, `kind`, `parent_id`, `department_id`, `location`, `status`                                                                                                                                                                                                                                   | master                                                                                   |
| `store_keepers`                  | an employee who keeps a store                                                           | `store_id`, `employee_id`                                                                                                                                                                                                                                                                                    | master                                                                                   |
| `item_store_levels`              | reorder settings of an item in a store (store unit)                                     | `store_id`, `item_id`, `reorder_level`, `reorder_qty`, `max_qty`                                                                                                                                                                                                                                             | master                                                                                   |
| `stock_moves`                    | one move of an item in or out of a store — **the ledger**, append-only                  | `store_id`, `item_id`, `kind`, `qty` (signed), `rate`, `value` (signed), `balance_qty`, `balance_value`, `batch_no`, `expiry`, `doc_type`, `doc_id`, `doc_line_id`, `moved_on`                                                                                                                               | main (source of truth)                                                                   |
| `stock_balances`                 | the current quantity, value and average rate of an item in a store                      | `store_id` + `item_id` (PK), `qty`, `value`, `avg_rate`, `reserved`, `last_move_on`                                                                                                                                                                                                                          | main (current snapshot, kept by `app.stock_post`)                                        |
| `stock_batches`                  | the quantity left of one batch / expiry of an item in a store                           | `store_id`, `item_id`, `batch_no`, `expiry`, `qty_left`                                                                                                                                                                                                                                                      | detail                                                                                   |
| `stock_openings`                 | one posting of opening stock (by hand, Excel, or a correction)                          | `store_id`, `source`, `reason`, `undone_at`, `created_at`                                                                                                                                                                                                                                                    | history                                                                                  |
| `stock_reservations`             | stock held for a PR line or an approved indent line                                     | `store_id`, `item_id`, `requisition_line_id` / `indent_line_id` (exactly one), `qty`, `issued_qty`, `status`                                                                                                                                                                                                 | detail                                                                                   |
| `stock_issues`                   | an issue slip from a store to a department                                              | `number`, `store_id`, `department_id`, `kind`, `indent_id`, `requisition_id`, `receipt_id`, `taken_by_employee_id`, `issued_on`, `status`, `acknowledged_at`                                                                                                                                                 | main                                                                                     |
| `stock_issue_lines`              | an item on an issue (store unit)                                                        | `issue_id`, `item_id`, `indent_line_id`, `qty`, `rate`, `value`, `batch_no`, `move_id`, `reservation_id`, `returned_qty`                                                                                                                                                                                     | detail                                                                                   |
| `stock_returns`                  | a return note: back into the store against an issue, or to the vendor against a PO      | `number`, `kind`, `store_id`, `issue_id`, `order_id`, `department_id`, `vendor_id`, `returned_on`                                                                                                                                                                                                            | main                                                                                     |
| `stock_return_lines`             | an item on a return                                                                     | `return_id`, `item_id`, `issue_line_id`, `receipt_line_id`, `source`, `condition`, `qty`, `rate`, `value`, `replacement`, `move_id`                                                                                                                                                                          | detail                                                                                   |
| `stock_transfers`                | a transfer of stock between two stores                                                  | `number`, `from_store_id`, `to_store_id`, `status`, `sent_on`, `received_on`                                                                                                                                                                                                                                 | main                                                                                     |
| `stock_transfer_lines`           | an item on a transfer (store unit)                                                      | `transfer_id`, `item_id`, `qty`, `rate`, `value`, `batch_no`, `expiry`, `out_move_id`, `in_move_id`                                                                                                                                                                                                          | detail                                                                                   |
| `stock_counts`                   | a physical count of one store (all items or one category)                               | `number`, `store_id`, `category_id`, `status`, `counted_on`, `decided_at`, `workflow_instance_id`                                                                                                                                                                                                            | main                                                                                     |
| `stock_count_lines`              | an item (batch) on a count                                                              | `count_id`, `item_id`, `batch_no`, `expiry`, `book_qty`, `counted_qty`, `reason_code`, `added`, `rate`, `value`, `move_id`                                                                                                                                                                                   | detail                                                                                   |
| `stock_revaluations`             | a rate correction of what is left of an item in a store                                 | `number`, `store_id`, `item_id`, `qty`, `old_rate`, `new_rate`, `status`, `decided_at`                                                                                                                                                                                                                       | history                                                                                  |
| `assets`                         | one unit of an asset item, with its tag                                                 | `tag` (unique), `item_id`, `status`, `store_id`, `department_id`, `location`, `custodian_employee_id`, `condition`, `cost`, `acquired_on`, `put_to_use_on`, `receipt_line_id`, `order_id`, `vendor_id`, `left_on`, `book_value_at_exit`, `opening_move_id`, `warranty_until`, `insured_value`                | main                                                                                     |
| `asset_movements`                | one event in an asset's life (received, issued, custody, repair …)                      | `asset_id`, `kind`, `status`, `moved_on`, `from_store_id`/`to_store_id`, `from_department_id`/`to_department_id`, `from_custodian_id`/`to_custodian_id`, `vendor_id`, `cost`                                                                                                                                 | history                                                                                  |
| `asset_depreciation`             | an asset's depreciation for one financial year                                          | `asset_id` + `fy` (PK), `method`, `opening`, `depreciation`, `closing`, `days`                                                                                                                                                                                                                               | history                                                                                  |
| `asset_depreciation_runs`        | one year's depreciation run                                                             | `fy` (PK with school), `assets`, `total`, `run_by`, `run_at`                                                                                                                                                                                                                                                 | internal (log)                                                                           |
| `condemnation_committee_members` | an employee on the condemnation committee                                               | `employee_id`, `role`                                                                                                                                                                                                                                                                                        | master                                                                                   |
| `condemnations`                  | a condemnation proposal (assets and / or stock to write off)                            | `number`, `title`, `status`, `submitted_at`, `decided_at`, `written_off_on`                                                                                                                                                                                                                                  | main                                                                                     |
| `condemnation_lines`             | an asset, or a quantity of an item in a store, on a condemnation                        | `condemnation_id`, `kind`, `asset_id`, `store_id`, `item_id`, `batch_no`, `qty`, `reason_kind`, `book_value`, `move_id`                                                                                                                                                                                      | detail                                                                                   |
| `condemnation_signoffs`          | a committee member's signature on a condemnation                                        | `condemnation_id`, `employee_id`, `user_id`, `signed_at`                                                                                                                                                                                                                                                     | detail (current signatures: cleared when it is sent to the committee again or sent back) |
| `disposals`                      | how a written-off condemnation was disposed of                                          | `condemnation_id` (unique), `method`, `disposed_on`, `party`, `amount`, `reference`, `file_id`                                                                                                                                                                                                               | detail                                                                                   |

60 tables. There is **no mart** for this module: every report reads the base tables.

## How the tables join

**Spines.** Spend and orders: `purchase_orders`. The indent-to-order tracker: `purchase_indent_lines`. Stock now:
`stock_balances`; stock movement and stock on a past day: `stock_moves`. Issues and consumption: `stock_issue_lines`.
Assets: `assets`.

Masters

- `purchase_items.category_id → purchase_item_categories.id` (main category); `purchase_items.sub_category_id → purchase_item_categories.id`; `purchase_item_categories.parent_id → purchase_item_categories.id`
- `purchase_items.uom_id → purchase_uoms.id` (purchase unit); `purchase_items.stock_uom_id → purchase_uoms.id` (store unit, NULL = same as the purchase unit)
- `purchase_items.hsn_id → purchase_hsn.id`
- `vendors.payment_term_id → purchase_payment_terms.id`; `purchase_payment_term_lines.term_id → purchase_payment_terms.id`
- `vendor_contacts.vendor_id`, `vendor_documents.vendor_id`, `vendor_changes.vendor_id → vendors.id`; `vendor_documents.file_id → files.id`
- `vendors.category_ids` (bigint[]) holds `purchase_item_categories.id` values: `cat.id = ANY(v.category_ids)`
- `purchase_rate_contracts.vendor_id → vendors.id`; `purchase_rate_contracts.item_id → purchase_items.id`
- `purchase_department_approvals.department_id`, `purchase_department_rules.department_id`, `purchase_settings.purchase_department_id → departments.id`
- `purchase_committee_members.employee_id`, `purchase_vendor_approvers.employee_id`, `condemnation_committee_members.employee_id → employees.id`

Indent → requisition → order

- `purchase_indents.department_id → departments.id`; `purchase_indents.raised_by → users.id`; `purchase_indents.on_behalf_employee_id → employees.id`
- `purchase_indent_lines.indent_id → purchase_indents.id`; `.item_id → purchase_items.id`; `.uom_id → purchase_uoms.id`; `.contract_id → purchase_rate_contracts.id`
- `purchase_requisition_sources.indent_line_id → purchase_indent_lines.id`; `purchase_requisition_sources.requisition_line_id → purchase_requisition_lines.id`
- `purchase_requisition_lines.requisition_id → purchase_requisitions.id`; `.vendor_id → vendors.id`; `.store_id → stores.id`; `.contract_id → purchase_rate_contracts.id`
- `purchase_quotes.requisition_id → purchase_requisitions.id`; `purchase_quotes.vendor_id → vendors.id`; `purchase_quote_lines.quote_id → purchase_quotes.id`; `purchase_quote_lines.requisition_line_id → purchase_requisition_lines.id`
- `purchase_cs_signoffs.requisition_id → purchase_requisitions.id`; `purchase_cs_signoffs.employee_id → employees.id`
- `purchase_orders.requisition_id → purchase_requisitions.id` (NULL for an emergency purchase); `purchase_orders.vendor_id → vendors.id`; `purchase_orders.department_id → departments.id`; `purchase_orders.supersedes_id → purchase_orders.id` (the revision it replaces)
- `purchase_order_lines.order_id → purchase_orders.id`; `purchase_order_lines.requisition_line_id → purchase_requisition_lines.id`; `.item_id → purchase_items.id`; `.uom_id → purchase_uoms.id`
- `purchase_order_charges.order_id`, `purchase_order_sends.order_id → purchase_orders.id`

Receipt → stock → issue

- `goods_receipts.order_id → purchase_orders.id`; `goods_receipts.store_id → stores.id` (NULL for a service)
- `goods_receipt_lines.receipt_id → goods_receipts.id`; `goods_receipt_lines.order_line_id → purchase_order_lines.id`
- `stock_moves.store_id → stores.id`; `stock_moves.item_id → purchase_items.id`; `stock_balances` and `stock_batches` join on `(store_id, item_id)`
- `stock_moves.doc_type` / `doc_id` / `doc_line_id` (no FK) name the document: `'opening'` → `stock_openings.id`; `'goods_receipt'` → `goods_receipts.id` (`doc_line_id` → `goods_receipt_lines.id`); `'stock_issue'` → `stock_issues.id`; `'stock_return'` → `stock_returns.id`; `'stock_transfer'` → `stock_transfers.id`; `'stock_count'` → `stock_counts.id` (`doc_line_id` → `stock_count_lines.id`); `'condemnation'` → `condemnations.id` (`doc_line_id` → `condemnation_lines.id`); `'revaluation'` → `stock_revaluations.id`. An `opening_undo` move has `doc_line_id` = the opening move it reverses.
- Line tables point at their move directly: `stock_issue_lines.move_id`, `stock_return_lines.move_id`, `stock_count_lines.move_id`, `condemnation_lines.move_id`, `stock_transfer_lines.out_move_id` / `in_move_id → stock_moves.id`
- `stock_issues.store_id → stores.id`; `.department_id → departments.id`; `.indent_id → purchase_indents.id`; `.requisition_id → purchase_requisitions.id`; `.receipt_id → goods_receipts.id`; `.taken_by_employee_id → employees.id`
- `stock_issue_lines.issue_id → stock_issues.id`; `.indent_line_id → purchase_indent_lines.id`; `.reservation_id → stock_reservations.id`
- `stock_reservations.requisition_line_id → purchase_requisition_lines.id` or `stock_reservations.indent_line_id → purchase_indent_lines.id`
- `stock_returns.issue_id → stock_issues.id` (to_store) or `stock_returns.order_id → purchase_orders.id` (to_vendor); `stock_return_lines.issue_line_id → stock_issue_lines.id`; `stock_return_lines.receipt_line_id → goods_receipt_lines.id`
- `stock_transfers.from_store_id` / `to_store_id → stores.id`; `stock_transfer_lines.transfer_id → stock_transfers.id`
- `stock_counts.store_id → stores.id`; `stock_counts.category_id → purchase_item_categories.id`; `stock_count_lines.count_id → stock_counts.id`
- `stores.parent_id → stores.id` (the main store); `stores.department_id → departments.id`; `store_keepers.employee_id → employees.id`

Assets and condemnation

- `assets.item_id → purchase_items.id` (category through the item); `assets.receipt_line_id → goods_receipt_lines.id`; `assets.order_id → purchase_orders.id`; `assets.vendor_id → vendors.id`; `assets.opening_move_id → stock_moves.id`
- `assets.store_id → stores.id`; `assets.department_id → departments.id`; `assets.custodian_employee_id → employees.id`; `assets.issue_line_id → stock_issue_lines.id`; `assets.transfer_line_id → stock_transfer_lines.id`
- `asset_movements.asset_id`, `asset_depreciation.asset_id → assets.id`
- `condemnation_lines.condemnation_id → condemnations.id`; `condemnation_lines.asset_id → assets.id`; `condemnation_lines.store_id`/`item_id` → `stores`/`purchase_items`; `disposals.condemnation_id → condemnations.id`

Out to the backbone

- People: `*.created_by`, `decided_by`, `raised_by`, `acknowledged_by`, `user_id → users.id`; a user's staff name is `employees.display_name WHERE employees.user_id = users.id`.
- Approvals: `purchase_indents`, `purchase_requisitions`, `purchase_orders`, `goods_receipts`, `stock_counts`, `stock_revaluations`: `.workflow_instance_id → workflow_instances.id` → `workflow_steps.instance_id` (`workflow_instances.entity_type` = `purchase_indent`, `purchase_requisition`, `purchase_order`, `purchase_inspection`, `purchase_count`, `purchase_revaluation`). A resubmit after send-back starts a new instance; the column holds the latest.
- Files: `*.file_id`, `bill_file_id → files.id`. E-mail: `purchase_order_sends.message_id → comms_messages.id`.
- The module has no `academic_year_id` and no student link. It works in the Indian **financial year** (April–March).

## Life-cycles and statuses

All status columns are `text` with a CHECK (no enum types); masters use `row_status` (active / inactive).

**`purchase_indents.status`**: `draft` → `submitted` (with the department's PI levels) → `approved` | `rejected` | `sent_back` (back to the raiser; a resubmit starts again) | `cancelled` (withdrawn before any approval). `number` is given on the first submit, so drafts may have none. Count real demand as `status = 'approved'`; exclude `draft` and `cancelled`.
**`purchase_indents.route`** (only after approval): `to_requisition` (waiting for the purchase office's PR), `to_order` (PR skipped by a bypass rule: rate contract or under the limit; `bypass_rule` says which), `in_requisition` (on a PR), `ordered` (every line fully on placed POs or from the store), `closed` (not to be bought; `bypass_note` says why), `from_store` (every line served from stock). `priority`: normal / urgent.

**`purchase_requisitions.status`**: `draft` → `sourcing` (the first quote was entered) → `submitted` (PR levels) → `approved` → `part_ordered` / `ordered` (worked out from placed POs); or `sent_back`, `rejected`, `cancelled`. A reopened approved PR goes back to `draft` with `revision + 1`. `auto_rule` set = approved by the system (no levels); `no_approval_note` = a direct PR approved within `direct_pr_limit`. `tier` (when sent): `none` (only rate-contract or store lines), `direct`, `committee`, `tender`. A line's `fulfil` is `buy` or `store`; `closed_at`/`closed_reason` = the rest of the line is not to be ordered.

**`purchase_orders.status`**: `draft` → `submitted` → `approved` → `sent` (e-mailed) → `closed` (by hand, or by itself when every line is accepted in full: `closed_note = 'Received and accepted in full'`); or `sent_back`, `rejected`, `cancelled`. An amendment is a new row with the same `number`, `revision + 1` and `supersedes_id`; when it is approved the old row becomes `superseded`. **Spend counts "placed" POs: `status IN ('approved', 'sent', 'closed')`**, grouped by `po_date` (the app's own reports do this). A "live" PO (still counts for what is on order) is not `rejected` / `cancelled` / `superseded` and has no live newer revision. `emergency = true`: recorded after the fact with the bill; `submitted` = waiting for ratification, `rejected` = not ratified. `receipt_status`: `none` / `part` / `received` (cached from the receipts).

**`goods_receipts.status`**: `inspecting` (nothing in stock yet) → `accepted` (all or part accepted: stock posted) | `rejected` (nothing accepted) | `cancelled` (entered wrongly, only while inspecting). `kind`: `goods` (a GRN into `store_id`) or `service` (a completion certificate, no store, no stock). `inspection`: `department` levels or the purchase `committee` (above the committee limit; signatures in `goods_receipt_signoffs`).

**`stock_moves.kind`**: `opening`, `opening_undo` (reverses an opening exactly), `receipt` (accepted GRN), `issue`, `return_in` (unused goods back from a department), `return_vendor` (defective goods out of stock to the vendor), `transfer_out`, `transfer_in` (also used for a cancelled transfer coming back into the sender), `adjustment` (approved count difference), `write_off` (approved condemnation), `revalue` (a rate correction: always a pair, out at the old average then in at the new rate). The ledger is frozen by the trigger `stock_moves_frozen`: rows are never updated or deleted; a mistake is put right by another move.

**`stock_issues.status`**: `issued` (stock already out) → `acknowledged` by the department (`ack_on_paper` = a signed slip recorded by the keeper). `kind`: `receipt` (issued at once to an indent when a GRN is accepted), `indent` (against reservations of an indent or PR), `counter` (walk-in issue).
**`stock_reservations.status`**: `open` (held; counts in `stock_balances.reserved`) → `done` (issued in full, or partly issued and then let go) | `released` (let go unissued).
**`stock_returns.kind`**: `to_store` (against `issue_id`) or `to_vendor` (against `order_id`). Line `source`: `issue`, `rejected` (rejected at inspection, never in stock, no move), `stock` (taken out of stock). Line `condition` (to_store): `unused` (back into stock, `return_in` move) or `damaged` (recorded only, no move). `replacement` (to_vendor): the PO line waits for a replacement.
**`stock_transfers.status`**: `in_transit` (out of the sending store, not yet in the receiving one) → `received` | `cancelled` (back into the sender).
**`stock_counts.status`**: `counting` → `submitted` → `approved` (differences posted as `adjustment` moves) | `cancelled`; sent back = `counting` again. One open count per store. Line `reason_code`: not_found, damaged, expired, issued_no_slip, received_no_grn, entry_mistake, found, other.
**`stock_revaluations.status`**: `submitted` → `approved` (posts the `revalue` pair) | `rejected` | `cancelled`. One open per store and item.
**`stock_openings`**: `source` hand / excel / correction; `undone_at` set = the whole posting was reversed.

**`assets.status`**: `in_store`, `in_use`, `in_transit`, `under_repair`, `lost`, `returned` (sent back to the vendor), `written_off`, `disposed`. "On the books" (the app's `held`) = `in_store`, `in_use`, `in_transit`, `under_repair`, `lost`. `condition`: good / fair / poor / unserviceable. **`asset_movements.kind`**: received, imported, issued, back_to_store, store_transfer, custody, repair_out, repair_back, lost, found, returned, written_off, disposed; `status` `done` / `pending` (a custody change waiting for the new custodian, one at a time) / `cancelled`.
**`condemnations.status`**: `draft` → `committee` (signatures) → `approval` → `written_off` (assets to `written_off` at book value, stock out by `write_off` moves) → `disposed` (a `disposals` row; assets to `disposed`); or `rejected` / `cancelled`. Stock on an open condemnation (`draft`, `committee`, `approval`) is held in `stock_balances.reserved`. `disposals.method`: auction, tender_sale, sale, buyback, scrap, donation, destruction.

**`vendors.status`**: `pending` (waiting for a second person), `active`, `inactive`, `blacklisted`, `rejected`. Only active vendors get POs or rate contracts. **`vendor_changes.status`**: pending (one at a time per vendor), approved, rejected, withdrawn. `vendors.msme_type` micro / small / medium; `gst_status` regular / composition / unregistered.

**History.** Most tables have the audit trigger: every insert / update / delete is in `audit_logs` with `entity_type` = the table name (HSN rate changes, rate contracts, vendors — without `bank_secure` —, settings, indents, PRs, POs, receipts, issues, returns, transfers, counts, stores, assets, condemnations, disposals, openings, revaluations). Approval steps are in `workflow_steps` and `workflow_events`.

## Amounts, dates and counting rules

**Money** is rupees, `numeric(…,2)`; rates in the stock tables are `numeric(14,4)`.

- **PO** header: `taxable` = lines' taxable (quantity × rate less discount) **plus** the charges' `amount`; `cgst + sgst + igst` = GST charged by the vendor (CGST+SGST for a regular vendor in the school's state, IGST for another state, none for unregistered or composition vendors, none on exempt lines); `rcm_gst` = reverse-charge GST the school pays itself — **not in `total`**; `total` = taxable + GST rounded to the rupee (`round_off` is the difference). So `total` ≠ sum of `purchase_order_lines.total` whenever there are charges or a round-off. These are cached and worked out again on each change; on placed POs they are frozen.
- **Indent `estimate`** = Σ quantity × `est_rate` (before GST). **PR `estimate`** = Σ quantity × chosen `rate` (else `est_rate`) of the `buy` lines, before GST. Neither is spend.
- **GRN line `unit_cost`** (per PO-line unit, set at acceptance) = (line taxable + its GST when `purchase_settings.stock_gst_in_cost` + its share of the PO's charges by taxable value) / ordered quantity. Accepted value = `accepted_qty × unit_cost`.
- **Stock**: `stock_moves.qty` and `value` are **signed** (+ in, − out), in the **store unit**; `rate` is per store unit. Moves in come at their own rate and re-average the balance (weighted average); moves out go at the current average (`p_rate` ignored); the last unit out takes whatever value is left. `balance_qty` / `balance_value` are the store's balance after that move (in posting order, i.e. `id`). `stock_balances.value` / `avg_rate` are the same running figures now. `stock_issue_lines.value`, `stock_transfer_lines.value`, `stock_return_lines.value` are positive.
- **Units**: purchase unit on indent, PR, PO, GRN lines and on vendor-return lines (`source` rejected / stock); store unit on `stock_*` and `item_store_levels`. Store qty = purchase qty × `purchase_items.stock_per_unit`.
- **Assets**: `cost` = one unit's share of the PO line with GST and charges (or the opening line's rate). Book value = the latest `asset_depreciation.closing` (by `fy`), else `cost` — this is the value at the end of the last year run, not today. `book_value_at_exit` and `left_on` are set when it leaves the books.
- **Depreciation** per category: the run reads `dep_method`, `useful_life_years`, `salvage_pct` (5% when not set) and `wdv_rate_pct` of the item's main category (`purchase_items.category_id`; a sub-category's own values are not read); an item whose category has no method gets no depreciation. `slm` = (cost − salvage) / life a year, `wdv` = book × rate; pro rata by days from `put_to_use_on` (else `acquired_on`, else the created day) to `left_on`; never below salvage. One row per asset and `fy`; a run catches up earlier years and replaces the year's rows; no row for assets with `status = 'returned'`.
- **Disposals**: `amount` = what the sale brought in (0 for scrap, donation, destruction).

**Dates.** Use `po_date` for orders and spend, `received_on` / `accepted_on` for receipts (`accepted_on` starts the MSME 45 days), `issued_on` for issues, `returned_on`, `sent_on` / `received_on` for transfers, `counted_on`, `moved_on` for the ledger, `written_off_on` / `disposals.disposed_on`. Indents and PRs have only timestamps: the app dates an indent by `COALESCE(submitted_at, created_at)` and a PR by `created_at`, both `AT TIME ZONE 'Asia/Kolkata'`. **Year** = financial year April–March: `app.purchase_fy(day)` gives `'2026-27'`; document numbers (`PI/2026-27/0001`, `PO/…`, `GRN/…`, `SCC/…`, `ISS/…`, `RTN/…`, `TRF/…`, `CNT/…`, `AST/…`, `CDN/…`, `RVL/…`) restart each financial year; `asset_depreciation.fy` uses the same text.

**One row per what.** `purchase_orders`: one per number **and revision**. `purchase_quotes`: one per PR and vendor. `purchase_requisition_sources`: an indent line sits on one PR only. `stock_balances`: one per store and item. `stock_batches`: one per store, item, batch and expiry. `asset_depreciation`: one per asset and year. `disposals`: one per condemnation. `purchase_rate_contracts`: one active contract per item on any day (trigger).

```sql
SELECT cat.name AS category, ad.method,
       count(*) AS assets, sum(ad.opening) AS opening, sum(ad.depreciation) AS depreciation, sum(ad.closing) AS closing
  FROM asset_depreciation ad
  JOIN assets a ON a.id = ad.asset_id
  JOIN purchase_items i ON i.id = a.item_id
  JOIN purchase_item_categories cat ON cat.id = i.category_id
 WHERE ad.fy = '2025-26'
 GROUP BY cat.name, ad.method
 ORDER BY cat.name
```

Depreciation of one financial year by category (`fy` is text like `2025-26`).

## Answering report questions

1. **What did each department spend, month by month, this financial year?**

```sql
SELECT COALESCE(d.name, 'No department') AS department,
       to_char(po.po_date, 'YYYY-MM') AS month,
       count(*) AS orders,
       sum(po.taxable) AS taxable,
       sum(po.cgst + po.sgst + po.igst) AS gst,
       sum(po.total) AS total
  FROM purchase_orders po
  LEFT JOIN departments d ON d.id = po.department_id
 WHERE po.status IN ('approved', 'sent', 'closed')
   AND app.purchase_fy(po.po_date) = '2026-27'
 GROUP BY 1, 2
 ORDER BY 1, 2
```

Placed POs only. A combined PR's POs carry the purchase office's department (see Traps).

2. **Who are our biggest vendors this year, and which are MSMEs?**

```sql
SELECT v.code, v.legal_name, v.gst_status, v.msme_type,
       count(po.id) AS orders, sum(po.total) AS total, max(po.po_date) AS last_order
  FROM purchase_orders po
  JOIN vendors v ON v.id = po.vendor_id
 WHERE po.status IN ('approved', 'sent', 'closed')
   AND po.po_date BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY v.id, v.code, v.legal_name, v.gst_status, v.msme_type
 ORDER BY total DESC
 LIMIT 20
```

`msme_type` micro / small: payment due within 45 days of acceptance.

3. **Which approved indents are still waiting for a requisition, and for how long?**

```sql
SELECT pi.number, d.name AS department, pi.purpose, pi.priority, pi.estimate,
       (pi.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS approved_on,
       (now() AT TIME ZONE 'Asia/Kolkata')::date - (pi.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS days_waiting
  FROM purchase_indents pi
  JOIN departments d ON d.id = pi.department_id
 WHERE pi.status = 'approved' AND pi.route = 'to_requisition'
 ORDER BY pi.decided_at
```

`route = 'to_requisition'` is the purchase office's queue.

4. **Where has each indent line got to (requisition, order)?**

```sql
SELECT pi.number AS indent, d.name AS department, COALESCE(i.name, il.free_text) AS item, il.quantity, il.stock_qty AS held_from_stock,
       r.number AS requisition, r.status AS pr_status, rl.fulfil,
       (SELECT string_agg(po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END, ', ')
          FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
         WHERE pol.requisition_line_id = rl.id AND po.status NOT IN ('rejected', 'cancelled', 'superseded')) AS orders
  FROM purchase_indent_lines il
  JOIN purchase_indents pi ON pi.id = il.indent_id
  JOIN departments d ON d.id = pi.department_id
  LEFT JOIN purchase_items i ON i.id = il.item_id
  LEFT JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
  LEFT JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
  LEFT JOIN purchase_requisitions r ON r.id = rl.requisition_id
 WHERE pi.status <> 'draft'
   AND (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date >= DATE '2026-04-01'
 ORDER BY pi.number, il.seq
```

One row per indent line; a PR line made from several indents repeats its orders on each.

5. **What is still to be delivered on our orders, and what is late?**

```sql
SELECT po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS po,
       v.legal_name AS vendor, po.delivery_date, l.description, u.code AS unit, l.quantity,
       l.received_qty - l.rejected_qty - l.returned_qty AS in_hand_qty,
       l.quantity - (l.received_qty - l.rejected_qty - l.returned_qty) AS still_to_come,
       po.delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date AS late
  FROM purchase_order_lines l
  JOIN purchase_orders po ON po.id = l.order_id
  JOIN vendors v ON v.id = po.vendor_id
  JOIN purchase_uoms u ON u.id = l.uom_id
 WHERE po.status IN ('approved', 'sent')
   AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity
   AND NOT EXISTS (SELECT 1 FROM purchase_orders n WHERE n.supersedes_id = po.id AND n.status NOT IN ('rejected', 'cancelled'))
 ORDER BY po.delivery_date NULLS LAST, po.number, l.seq
```

In units of the PO line. Goods sent back for a replacement count as still to come.

6. **Which goods receipts are waiting for inspection, and which are past 15 days?**

```sql
SELECT g.number, g.kind, g.received_on, st.name AS store, v.legal_name AS vendor, d.name AS department,
       (now() AT TIME ZONE 'Asia/Kolkata')::date - g.received_on AS days_waiting,
       g.received_on + 15 < (now() AT TIME ZONE 'Asia/Kolkata')::date AS past_15_days,
       ws.name AS level_waiting
  FROM goods_receipts g
  JOIN purchase_orders po ON po.id = g.order_id
  JOIN vendors v ON v.id = po.vendor_id
  LEFT JOIN departments d ON d.id = po.department_id
  LEFT JOIN stores st ON st.id = g.store_id
  LEFT JOIN workflow_instances wi ON wi.id = g.workflow_instance_id AND wi.status = 'pending'
  LEFT JOIN workflow_steps ws ON ws.instance_id = wi.id AND ws.level = wi.current_level AND ws.status = 'pending'
 WHERE g.status = 'inspecting'
 ORDER BY g.received_on
```

Cross-module: the workflow engine says which level it waits at. Nothing of these is in stock yet.

7. **What is our stock worth now, by store and category?**

```sql
SELECT st.name AS store, cat.name AS category,
       count(*) FILTER (WHERE b.qty > 0) AS items_in_stock,
       sum(b.value) AS stock_value,
       sum(b.reserved) AS reserved_qty
  FROM stock_balances b
  JOIN stores st ON st.id = b.store_id
  JOIN purchase_items i ON i.id = b.item_id
  JOIN purchase_item_categories cat ON cat.id = i.category_id
 GROUP BY st.name, cat.name
UNION ALL
SELECT 'In transit: ' || fs.name || ' to ' || ts.name, NULL, count(DISTINCT l.item_id), sum(l.value), NULL
  FROM stock_transfers t
  JOIN stock_transfer_lines l ON l.transfer_id = t.id
  JOIN stores fs ON fs.id = t.from_store_id
  JOIN stores ts ON ts.id = t.to_store_id
 WHERE t.status = 'in_transit'
 GROUP BY fs.name, ts.name
ORDER BY 1, 2
```

`stock_balances` is the current snapshot; goods in transit are in no store and are added from the open transfers.

8. **What did a store hold at the end of a past day?**

```sql
SELECT st.name AS store, i.code, i.name AS item,
       sum(m.qty) AS qty_on_day, sum(m.value) AS value_on_day
  FROM stock_moves m
  JOIN stores st ON st.id = m.store_id
  JOIN purchase_items i ON i.id = m.item_id
 WHERE m.moved_on <= DATE '2026-09-30'
 GROUP BY st.name, i.code, i.name
HAVING sum(m.qty) <> 0
 ORDER BY st.name, i.name
```

Sum the signed ledger up to the day; do not pick the "last" `balance_qty` by `moved_on`, since a move can carry an earlier day than moves posted before it.

9. **How much did each department consume in a period?** (crosses into HR's `departments`)

```sql
SELECT d.name AS department, i.code, i.name AS item, COALESCE(su.code, u.code) AS store_unit,
       count(DISTINCT si.id) AS issues,
       sum(l.qty - l.returned_qty) AS net_qty,
       sum(l.value - round(l.returned_qty * l.rate, 2)) AS net_value
  FROM stock_issue_lines l
  JOIN stock_issues si ON si.id = l.issue_id
  JOIN departments d ON d.id = si.department_id
  JOIN purchase_items i ON i.id = l.item_id
  JOIN purchase_uoms u ON u.id = i.uom_id
  LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
 WHERE si.issued_on BETWEEN DATE '2026-04-01' AND DATE '2026-11-30'
 GROUP BY d.name, i.code, i.name, su.code, u.code
 ORDER BY d.name, net_value DESC
```

Net of what came back against the issue; store units; value at the issue rate.

10. **Which items are at or below their reorder level, and what is already on order?**

```sql
SELECT st.name AS store, i.code, i.name AS item, l.reorder_level, l.reorder_qty,
       COALESCE(b.qty, 0) AS in_hand, COALESCE(b.reserved, 0) AS reserved,
       COALESCE(b.qty, 0) - COALESCE(b.reserved, 0) AS free,
       COALESCE((SELECT sum((ol.quantity - ol.received_qty + ol.rejected_qty + ol.returned_qty) * i.stock_per_unit)
                   FROM purchase_order_lines ol JOIN purchase_orders po ON po.id = ol.order_id
                  WHERE ol.item_id = l.item_id AND po.status IN ('approved', 'sent')), 0) AS on_order
  FROM item_store_levels l
  JOIN stores st ON st.id = l.store_id
  JOIN purchase_items i ON i.id = l.item_id
  LEFT JOIN stock_balances b ON b.store_id = l.store_id AND b.item_id = l.item_id
 WHERE l.reorder_level > 0
   AND COALESCE(b.qty, 0) - COALESCE(b.reserved, 0) <= l.reorder_level
 ORDER BY st.name, i.name
```

Free stock = in hand less reserved; on order in store units.

11. **Which assets are with whom, at what book value — and are any with staff who have left?** (crosses into HR's `employees`)

```sql
SELECT d.name AS department, a.tag, i.name AS item, a.status, a.condition,
       e.employee_code, e.display_name AS custodian, e.status AS custodian_status, e.left_on AS custodian_left_on,
       a.cost,
       COALESCE((SELECT ad.closing FROM asset_depreciation ad WHERE ad.asset_id = a.id ORDER BY ad.fy DESC LIMIT 1), a.cost) AS book_value
  FROM assets a
  JOIN purchase_items i ON i.id = a.item_id
  LEFT JOIN departments d ON d.id = a.department_id
  LEFT JOIN employees e ON e.id = a.custodian_employee_id
 WHERE a.status IN ('in_store', 'in_use', 'in_transit', 'under_repair', 'lost')
 ORDER BY d.name NULLS FIRST, a.tag
```

Book value as of the last depreciation run.

12. **What did we write off this year, and what did the disposals bring in?**

```sql
SELECT k.number, k.title, k.status, k.written_off_on,
       count(cl.id) AS lines,
       count(cl.id) FILTER (WHERE cl.kind = 'asset') AS assets,
       sum(cl.book_value) AS book_value_written_off,
       dp.method AS disposal_method, dp.disposed_on, dp.amount AS disposal_amount
  FROM condemnations k
  JOIN condemnation_lines cl ON cl.condemnation_id = k.id
  LEFT JOIN disposals dp ON dp.condemnation_id = k.id
 WHERE k.status IN ('written_off', 'disposed')
   AND k.written_off_on BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY k.id, k.number, k.title, k.status, k.written_off_on, dp.method, dp.disposed_on, dp.amount
 ORDER BY k.written_off_on
```

`book_value` is the value proposed on the line; an asset's own `book_value_at_exit` is the value it left the books at.

## Traps

- **PO revisions.** An amended PO is several rows with the same `number`. Never sum all rows: use the placed filter (`approved`, `sent`, `closed`), which leaves out `superseded`, drafts and the not-yet-approved amendment. Show a PO as `number || '-R' || revision` when `revision > 0`.
- **`rcm_gst` is outside `total`.** Add it only when the question is "GST the school bears". The PO header's `taxable` includes the charges; line sums do not.
- **Department of a combined PR.** A PR made from several departments' indents (`combined = true`) and its POs carry the purchase office's department (`purchase_settings.purchase_department_id`). Department spend by `purchase_orders.department_id` therefore books combined buying to the purchase office; to apportion to the indenting departments go through `purchase_requisition_sources` and share by quantity. Consumption (`stock_issues.department_id`) is always the real receiving department.
- **Drafts and estimates are not spend.** Indent and PR `estimate`, draft POs and quotes are plans.
- **Ledger vs balance.** `stock_moves` is the source of truth; `stock_balances` is a running cache written by the same `app.stock_post` call (and `app.stock_opening_undo`), so they agree unless something bypassed it. Check:

```sql
SELECT b.store_id, b.item_id, b.qty AS balance_qty, b.value AS balance_value,
       COALESCE(m.qty, 0) AS ledger_qty, COALESCE(m.value, 0) AS ledger_value
  FROM stock_balances b
  LEFT JOIN (SELECT store_id, item_id, sum(qty) AS qty, sum(value) AS value FROM stock_moves GROUP BY store_id, item_id) m
         ON m.store_id = b.store_id AND m.item_id = b.item_id
 WHERE b.qty <> COALESCE(m.qty, 0) OR b.value <> COALESCE(m.value, 0)
```

`stock_balances.reserved` is recomputed separately (`app.stock_reserved_refresh`) from open reservations **plus stock on open condemnations**.

- **In transit is in no store.** A transfer's `transfer_out` has left the sender; until `received` its value is in `stock_transfer_lines`, not in any `stock_balances` row. Add it for a school-wide stock value.
- **Internal moves inflate flows.** For "stock in / stock out" totals leave out `transfer_out` / `transfer_in` (between stores), the `revalue` pair, and `opening` / `opening_undo` pairs; a cancelled transfer shows a `transfer_out` and a `transfer_in` into the same store.
- **Units.** Never add a PO / GRN quantity to a stock quantity without × `stock_per_unit`. Vendor-return lines are in the PO-line unit, to-store return lines in the store unit.
- **Stock enters on acceptance, not on receipt.** A GRN in `inspecting` has no move; `accepted_qty` is NULL until decided. The PO line's `received_qty` / `accepted_qty` / `rejected_qty` / `returned_qty` and the PO's `receipt_status` are cached from the GRN lines (`received_qty` counts every receipt not cancelled; accepted / rejected only decided ones).
- **Consumption and damaged returns.** `stock_issue_lines.returned_qty` grows for unused **and** damaged returns; only unused ones re-enter stock. The app's consumption report subtracts both.
- **Batches.** Batch quantities are in `stock_batches.qty_left` and should add up to the balance for a batch item; a non-batch item has no `stock_batches` rows. Expiry check:

```sql
SELECT st.name AS store, i.name AS item, sb.batch_no, sb.expiry, sb.qty_left,
       sb.expiry - (now() AT TIME ZONE 'Asia/Kolkata')::date AS days_left
  FROM stock_batches sb
  JOIN stores st ON st.id = sb.store_id
  JOIN purchase_items i ON i.id = sb.item_id
 WHERE sb.qty_left > 0 AND sb.expiry IS NOT NULL
   AND sb.expiry <= (now() AT TIME ZONE 'Asia/Kolkata')::date + 30
 ORDER BY sb.expiry, st.name
```

- **Assets vs stock.** An asset item's units in a store are both stock (`stock_balances`) and `assets` rows. Fewer asset rows than stock units is normal (stock from before the register). Never add asset cost to stock value for the same store. Assets imported from an old register changed the register only, not the stock.
- **Book value is as of the last run.** Depreciation is run once a year (`asset_depreciation_runs`); between runs book value does not fall. A rerun of a year replaces that year's rows.
- **Free-text lines.** Indent and PR lines may have `item_id` NULL (`free_text`); PO lines always have `description` but may have no `item_id`. Grouping by item drops them.
- **Item category.** `purchase_items.category_id` is always the main category; group sub-categories by `sub_category_id`. Assets get their category through the item.
- **Vendor details are not snapshotted** on the PO except `vendor_gst_status` and `vendor_state_code`. A renamed vendor shows its new name on old POs. Vendor history is in `audit_logs`; bank / GSTIN / PAN changes in `vendor_changes`.
- **Cached figures.** `purchase_items.last_purchase_rate` / `last_purchased_on` (set on PO approval), `purchase_orders.receipt_status`, the PO line quantities, `stock_balances.reserved`, `assets.status` / `store_id` / `custodian_employee_id` are kept by the API. For "what happened" use the documents and `asset_movements`.
- **Time zones.** Timestamps are UTC `timestamptz`: convert with `AT TIME ZONE 'Asia/Kolkata'` before taking a date. `po_date`, `received_on`, `issued_on`, `moved_on` are already school dates.
- **No soft delete, but lines are replaced.** None of these tables has `deleted_at`; cancelled / rejected / superseded statuses do that job and headers are never deleted. The lines of an indent, PR or PO being changed are deleted and inserted again (line ids change until it is approved); committee signatures are deleted when the document changes; assets made from a wrong opening are deleted when it is corrected.

## Personal and sensitive data

- `vendors`: `legal_name` / `trade_name` (often a proprietor's own name), `pan`, `gstin`, `udyam_no`, `address`, `city`, `pin`, `phone`, `email`; **`bank_secure`** (encrypted bank account — never send, never decrypt) and `bank_hint` (masked).
- `vendor_contacts`: `name`, `phone`, `email`. `vendor_changes.changes` / `before`: new and old bank (encrypted), GSTIN, PAN. `vendor_documents`: PAN cards, cancelled cheques (files).
- `purchase_settings`: `bill_contact_name`, `bill_contact_phone`, `ship_contact_name`, `ship_contact_phone`, `office_email`, `gstin`, addresses (the school's own; low risk).
- `purchase_order_sends.to_address` (vendor e-mail). `disposals.party` (a buyer's name). `stock_returns.dispatch` (carrier, who took it). `stock_counts.counted_by` (names typed as text).
- Links to staff: `assets.custodian_employee_id`, `asset_movements` custodians, `store_keepers`, committee members, signoffs, `stock_issues.taken_by_employee_id`, `purchase_indents.on_behalf_employee_id` — join to `employees` only for the name and code.
- Free-text notes about people or decisions: `note`, `decision_note`, `purpose`, `reason`, `choice_reason`, `emergency_reason`, `price_certificate`, `cancel_reason`, `ack_note`, `refused_reason`, `reject_reason`, `stock_reason`.
- Files: bills, invoices, challans, quotes and tender papers (`file_id`, `bill_file_id`).
