# 84 — Purchase phase 2: stores, goods receipt, stock, issue, assets

Phase 2 of the purchase module ([83](83-purchase-module.md)): what happens after the Purchase Order.
The goods come to a **store**, are **received** against the PO and **accepted** after inspection; what
was bought for a department's indent is **issued** to it at once; the rest is **stock**, kept in a
ledger per store, issued against indents or at the counter, returned, transferred and **counted**;
**asset** items get a tag per unit, a custodian, a place and yearly depreciation; old and broken things
are **condemned** and disposed of with approval. Phase 3 (vendor bills, payments, budgets) follows.

## What there is

- **Legacy** (`Admin/Inventory/`, about 2016, kept as data only): an item master, suppliers,
  "Enter goods detail to inventory" (item, make, model, quantity, rate, PO and bill numbers), goods
  issue to a person or purpose and goods return (numbers typed by hand), a live stock report (bought
  less issued), and an asset master with make / model, salvage value, depreciation method and period,
  insurance policy, value and renewal month. No stores, no write-off, no numbering. The newer
  `Admin/Purchase/` has warehouses with a manager who decides, for each indent, to buy (convert to PO)
  or to issue from the warehouse ("dispatch", printed slip with _Received by_); its item master has
  minimum (danger) and maximum (alert) levels; the stock it shows is always 0 — there is no stock
  table and nothing receives goods against a PO.
- **EduPro Next**: phase 1 ends at the PO (closed by hand). The requisition marks a line "from the
  store" with a note typed by hand. The clinic keeps medicine stock with batches, expiry and moves
  (received, given, written off) — the nearest pattern; the library has a physical stock check with
  an Excel count sheet; nothing else keeps stock or assets ("EduPro keeps no asset register yet",
  doc 38).

## Benchmark

- **edumerge** posts the accepted quantity of a GRN to stock with no second entry, makes asset records
  for asset-type items received, logs each issue against a cost centre, purpose and person, and has
  dead-stock reports and reorder alerts.
- **Fedena**: stores and store items, indents, purchase orders, GRNs, asset reports, obsolete items.
- **Raising Foundation (Zoho)**: on a GRN, the approved indent's pending quantity is issued at once.
- **ERPNext**: a purchase receipt with quality inspection before it is submitted; moving-average
  valuation set by receipts; material issue and transfer as stock entries; stock reconciliation for
  counts and opening balances.
- **NIEPA Samarth** (Indian universities): consumable and non-consumable items issued to staff; items
  marked for condemnation cannot be issued.
- **GFR 2017**: rule 208 — goods received are checked against the contract and entered in the stock
  register, which is certified; rule 213 — fixed assets and consumables physically verified at least
  once a year, differences investigated and adjusted; rule 217 — surplus, obsolete or unserviceable
  items declared by the competent authority (or a committee) with the reasons, book / reserve value
  worked out, disposed of by tender or auction above ₹2 lakh residual value, otherwise as the
  authority decides; form GFR-17 for disposal.
- **MSMED Act s.15**: a micro or small supplier is paid within the agreed term, at most 45 days from
  the day of **acceptance** or **deemed acceptance** (no written objection within 15 days of delivery).

## Decisions (user, 6 Nov 2026)

| Question            | Answer                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stores              | **Main store + sub-stores**: one main store receives; labs, sports room, library… may have a sub-store with its keeper; stock moves between them by transfer                                                                                                                                                                                                                            |
| Receiving           | **Receive, then accept**: the keeper records what came (part deliveries, short, excess, damaged, batch / expiry, serial numbers); the indenting department — the purchase committee above a value — inspects and accepts; only accepted quantity enters stock; the acceptance date starts the MSME 45 days; the PO's maker cannot receive it; services get a **completion certificate** |
| Issue               | **Issued at once on acceptance**: accepted goods bought for an approved indent go straight to that department on an issue slip it acknowledges (_Received by_); the rest stays in stock; requisition lines "from the store" reserve stock and the keeper issues them                                                                                                                    |
| Valuation           | **Weighted average** per item and store; issues go out at the average                                                                                                                                                                                                                                                                                                                   |
| Assets              | **Tag per unit + depreciation**: each accepted unit gets a tag (QR label), location, custodian, condition, warranty and insurance; transfers and repairs recorded; yearly depreciation per category (straight line or written-down value)                                                                                                                                               |
| Requests from stock | **Indent + counter issue**: the indent stays the one route (the requisition now shows stock in hand; "from the store" lines reserve and are issued); the keeper may make a quick counter issue to a department and the person who took it                                                                                                                                               |
| Verification        | **Yearly count + condemnation**: a physical count per store at least yearly (GFR 213), differences adjusted with approval; unserviceable or obsolete items declared by a committee, written off and disposed of (sold, scrapped…) with approval (GFR 217)                                                                                                                               |
| Who runs the store  | **A Store keeper role**, given per store: receives, issues, transfers, counts; the purchase office keeps the POs; reorder levels per item and store alert and draft an indent                                                                                                                                                                                                           |

Decided here (to confirm while building): **GST is part of the stock cost** (a school's supplies are
largely exempt, so it rarely takes input credit; a setting can leave GST out); stock is kept in the
item's unit, with an optional **issue unit** and conversion (a ream of 500 sheets); **excess**
deliveries are refused unless within a tolerance % set in Purchase settings (default 0); a receipt not
inspected within **15 days** shows the MSME **deemed acceptance** date; numbers per financial year like
phase 1 (`GRN/2026-27/0001`, 4 digits); the PO closes by itself when every line is accepted in full (a
short close stays by hand, with a reason).

## Plan

### Part 6 — Stores and stock (the foundation)

- **Stores**: code, name, kind **main** (one per school) or **sub** (under the main store), the
  department it belongs to, where it is (room / block), its **keepers** (employees), status. The main
  store is made on first use from Purchase settings.
- **Store keeper** role (built-in): `purchase.store.operate` for the stores they keep;
  `purchase.store.view` (stock, ledgers) for the purchase office and admins; `purchase.store.manage`
  (stores, reorder levels, opening stock, item stock settings) for the purchase office and admins.
- **Item stock settings** (on the item master): kept in stock or not (services never); batch and
  expiry tracked (lab chemicals, first-aid); serial numbers (assets); issue unit and conversion;
  per store **reorder level**, **reorder quantity** and **maximum**.
- **Stock ledger**: every move in or out of a store — opening, receipt, issue, return in, return to
  vendor, transfer out / in, adjustment, write-off — with quantity, rate, value, the document it came
  from, batch and expiry; **balances** per store and item (quantity, value, average rate, reserved).
  The weighted average is worked out on each move in; moves out take the average.
- **Opening stock**: per store, by hand or from Excel (item code, quantity, rate, batch, expiry), checked
  before saving; posted as opening moves (once per store and item; later changes by adjustment).
- **Screens**: Stores (list, a store with its keepers and stock), Stock in hand (by store and category,
  value, reserved, below reorder level marked), an item's stock register (the ledger with running
  balance), opening stock.

### Part 7 — Goods receipt (GRN) and service completion

- **Receive** against an approved or sent PO (not by its maker): the store (the main store unless the
  PO names another), the date, the vendor's challan / invoice number and date and a photo or PDF of
  it, and per PO line the quantity received, refused (damaged, wrong, short-shipped) with the reason,
  batch and expiry, serial numbers for asset items; quantities beyond the PO only within the tolerance.
  Several GRNs per PO (part deliveries).
- **Inspect and accept**: the receipt goes to the PO department's **inspection** level (a new column
  on Purchase → Who approves, the HOD by default) or, above the committee limit, to the purchase
  committee (signatures as on comparative statements); per line accepted and rejected quantity with
  the reason; nobody accepts a receipt they made; 15 days without a decision shows the deemed
  acceptance date. **On acceptance**: the accepted quantity enters the store's stock at the PO line's
  rate (with GST unless the setting says otherwise; freight shared over the lines); quantities bought
  for an indent are **issued at once** to that department (part 8's issue slip); the PO line's received
  and accepted quantities move, the PO shows **Part received** / **Received** and closes by itself when
  all is accepted; rejected quantity waits as **to return to the vendor**.
- **Services**: a **completion certificate** instead of a GRN — the department certifies the work done
  (all, or a part with what was done), with a file; it is the acceptance for the MSME clock.
- **GRN PDF** (the goods received and inspection note), the PO's receipts on its page, **Pending
  deliveries** (PO lines not received by the delivery date), the GRN register.

### Part 8 — Issue, return, transfer, physical count

- **Reservation**: a requisition line "from the store" picks the store and reserves the quantity there
  (stock in hand and reserved shown as the PR is made); the reservation goes when issued or the PR is
  cancelled.
- **Issue** (`ISS/2026-27/0001`): against an indent (its reserved lines, or what came for it on a GRN)
  or at the **counter** (a department, the person who took it, the purpose); batches go out earliest
  expiry first; the **issue slip** PDF with _Received by_; the department **acknowledges** it (admin or
  staff app); items marked for condemnation cannot be issued.
- **Return to store** (unused, or broken, against the issue), **return to vendor** (rejected or found
  defective: a return note; the PO line waits for a replacement or is short-closed; the debit note is
  phase 3), **transfer** between stores (in transit until the receiving keeper receives it).
- **Physical count** (GFR 213): a count of a store (all items or a category) — the sheet on screen or
  as Excel —, counted against the book quantity, the differences with reasons, **approved** (the school
  admin) before the adjustments post; a count of the year shown on the store.
- **Reports**: stock in hand and value, stock register per item, issues by department (consumption),
  slow-moving and dead stock (no issue in N days), expiring soon, below reorder level, GRN register,
  pending deliveries, transfers in transit, count differences.

### Part 9 — Reorder, assets, condemnation

- **Reorder**: items below their reorder level (stock less reserved plus on order) on the dashboard and
  a list; **Raise an indent** drafts a PI for the store's department with the reorder quantity (or up
  to the maximum).
- **Asset register**: each accepted unit of an asset item becomes an **asset** with a tag
  (`AST/2026-27/0001`, a QR label sheet to print), the item, GRN, PO and vendor, the cost (the unit's
  share with GST and charges), the date put to use, the place (store, room or department), the
  **custodian** (an employee), serial number, warranty end, insurance (insurer, policy, value, renewal),
  condition and status (in use, in store, under repair, lost, written off, disposed). **Movements**:
  transfer (place or custodian, with the receiver's acknowledgement), repair (out to a vendor, back,
  cost), lost. Existing assets come in from Excel (the legacy asset master's fields).
- **Depreciation**: per asset category — straight line (by useful life and salvage %) or written-down
  value (rate %); a yearly run at the financial year's end (pro rata from the date put to use) kept
  per asset and year; the fixed-asset register with opening, additions, depreciation, disposals and
  closing value.
- **Condemnation and disposal** (GFR 217): a proposal of assets or stock quantities that are
  unserviceable, obsolete or surplus, with the reasons and book value; the **condemnation committee**
  (named in settings) recommends; the school's approver approves; the items are **written off** (stock
  move, asset status) and later **disposed of** (auction, sale, scrap, donation, destruction; the buyer,
  amount and date; form GFR-17 style record).
- **The employee's assets**: assets in an employee's custody show on their profile and in the exit
  no-dues clearance (doc 38).

### Staff app

The department's acknowledgement of issues and transfers; the HOD's inspection and acceptance of
receipts and completion certificates; _Assets in my care_; for store keepers, the stock of their stores
and counter issue.

### Rights

`purchase.store.view`, `purchase.store.operate` (per store, the keepers), `purchase.store.manage`,
`purchase.asset.manage`, `purchase.count.approve`; acceptance and condemnation approvals follow the
levels (no right of their own). The built-in **Store keeper** role; the Purchase office keeps POs, the
stores master and reports; the auditor reads.

### Data (per school, RLS)

`stores`, `store_keepers`, item stock columns and `item_store_levels`; `stock_moves`, `stock_balances`,
`stock_batches`; `goods_receipts` + `_lines` (+ serials, files), `goods_inspections` (or the workflow
instance with line outcomes), `service_completions`; `stock_reservations`; `stock_issues` + `_lines`,
`stock_returns` + `_lines`, `stock_transfers` + `_lines`; `stock_counts` + `_lines`; `assets`,
`asset_movements`, `asset_categories` (depreciation), `asset_depreciation`; `condemnations` + `_lines`,
`disposals`; `purchase_numbering` gains grn, issue, return, transfer, count, asset, condemnation; the PO
lines gain received and accepted quantities.

## Parts and order

| Part | Scope                                                                                            | Depends on |
| ---- | ------------------------------------------------------------------------------------------------ | ---------- |
| 6    | stores, keepers, item stock settings, stock ledger and balances, opening stock, stock screens    | phase 1    |
| 7    | GRN, inspection and acceptance, auto-issue to the indent, service completion, PO received status | 6          |
| 8    | reservation, issue / counter issue, returns, transfers, physical count, stock reports            | 6, 7       |
| 9    | reorder, asset register and depreciation, condemnation and disposal, employee's assets           | 6–8        |

## Not in scope (phase 2)

Vendor bills, the 3-way match, payments, MSME dues and budgets (phase 3); barcode scanners (the QR
label carries the tag; scanning comes with the app); stock valuation methods other than weighted
average; manufacturing or kits.

## Sources

- [edumerge — inventory management](https://www.edumerge.com/products/finance-and-control/inventory-management),
  [procurement management](https://www.edumerge.com/products/finance-and-control/procurement-management)
- [Fedena — school inventory management](https://fedena.com/feature-tour/school-inventory-management-system)
- [Raising Foundation — what is a GRN](https://raisingfoundation.zohodesk.eu/portal/en/kb/articles/what-is-grn-and-how-to-create-it)
- [ERPNext — purchase receipt](https://docs.frappe.io/erpnext/purchase-receipt),
  [quality inspection](https://docs.frappe.io/erpnext/quality-inspection),
  [item valuation](https://docs.frappe.io/erpnext/item-valuation-transactions)
- [NIEPA Samarth — inventory management system](https://hindi.niepa.ac.in/download/samarth/Governance/Inventory%20Management%20System%20-%20Samarth.pdf)
- GFR 2017 rules 208, 213, 217:
  [a reproduction of the rules](https://nipulgs.github.io/my-blog/2023/10/08/General-Financial-Rules-GFR-2017),
  [AIIMS physical verification notice](https://aiims.edu/images/pdf/notice/MSU-6-5-24.pdf),
  [ICMR condemnation guidelines](https://icmr.gov.in/icmrobject/custom_data/pdf/resource-guidelines/Guidelines%20for%20Condemnation.pdf),
  [form GFR-17](https://ciphet.icar.gov.in/wp-content/uploads/2023/11/31.-Form-GFR-17-for-unserviceable-stores-for-disposal.pdf)
- MSMED Act s.15 (acceptance, deemed acceptance, 45 days):
  [Taxmann FAQs](https://taxmann.com/post/blog/faqs-liability-of-buyer-u-s-15-of-msmed-act-to-make-timely-payments-to-mse-suppliers)

## As built — part 6, stores and stock (6 Nov 2026)

- **Migration 0323**: rights `purchase.store.view` (admins, Purchase office, Store keeper, auditor),
  `purchase.store.operate` (admins, Purchase office, Store keeper — a keeper only for the stores they
  keep), `purchase.store.manage` (admins, Purchase office); the built-in **Store keeper** role (store
  view and operate, the purchase masters to read, raising indents, file upload and view); `stores` (one
  `main` per school, `sub` stores under it by a trigger; department, location, status; audit),
  `store_keepers`; `purchase_items` gains `stock_tracked` (false for services, by a trigger),
  `tracks_batch`, `tracks_serial` (on for existing assets), `stock_uom_id` and `stock_per_unit` (the
  trigger refuses a unit change once the item has moves); `item_store_levels` (reorder level, reorder
  quantity, maximum); `stock_moves` (opening, receipt, issue, return in, return to vendor, transfer out /
  in, adjustment, write-off; quantity signed in the store unit, rate, value, the balance and value after
  it, batch, expiry, the document and line, note, day, by) — **append-only** (a trigger refuses update
  and delete); `stock_balances` (quantity, value, average rate, reserved, last move); `stock_batches`
  (by store, item, batch, expiry); **`app.stock_post`** — the one way stock moves: in at its rate
  re-averaging the balance, out at the average and never below nothing (`stock.insufficient`), the last
  of it taking the value left, a batch item's move in to its batch (`stock.batch_required`) and out from
  the named batch or the earliest expiry first; `purchase_numbering` takes receipt, issue, return,
  transfer, count, asset, condemnation (`GRN/`, `ISS/`, `RTN/`, `TRF/`, `CNT/`, `AST/`, `CDN/`).
- **Masters**: the Items grid gains Kept in stock, Store unit, Store units per unit, Batch and expiry,
  Serial numbers.
- **API** `PurchaseStoresService` (+ controller): stores (the main store made on first use with the
  purchase office's department; keepers, stock value, items below reorder; "you keep it"), add / change
  a sub-store (codes unique; a store with stock stays active; the main store too), reorder levels,
  stock in hand (store, category, search, below reorder; value; Excel / PDF), an item's stock register
  (moves with balances, the batches, the balance per store; Excel / PDF), opening stock by hand and
  from Excel (format with the items not yet opened, every row checked, then the good rows posted; once
  per store and item; batches for a batch item), the form lists. `postStock()` wraps `app.stock_post`
  for the next parts, turning its errors into problems.
- **Admin**: Purchase → Stores (list, Add a sub-store, a store: details, keepers, stock, reorder levels,
  opening stock by hand or from Excel; Change), Purchase → Stock in hand (filters, Excel, PDF), an item's
  stock register. Help: Stores and stock.
- **Tests**: `purchase-stores.e2e-spec.ts` (5: the main store and a sub-store with its keeper; opening
  stock once per item with batches, services and missing batches refused, a keeper only in their store;
  the weighted average, the average out, earliest expiry first, never below nothing, the ledger and the
  units frozen; stock in hand with reorder levels and the files, the stock register; opening from Excel).

## As built — part 7, goods receipts and completion certificates (6 Nov 2026)

Confirmed while building: **GST is part of the stock cost** (a setting, on by default); **excess is
refused** beyond a tolerance % per PO line (Purchase settings, default 0); numbers `GRN/2026-27/0001`
for goods and `SCC/2026-27/0001` for completion certificates; **the PO closes by itself** when every
line is accepted in full (closing short stays by hand with the reason).

- **Migration 0324**: `purchase_settings` gains `stock_gst_in_cost` and `receipt_tolerance_pct`;
  `purchase_department_approvals` takes the doc type `inspection`; `purchase_numbering` takes
  `completion` (`SCC/`); `purchase_orders.receipt_status` (none, part, received);
  `purchase_order_lines` gain `received_qty`, `accepted_qty`, `rejected_qty`; `goods_receipts` (goods
  into a store or a service; the PO, store, day received, challan and invoice with their dates, a file,
  note; inspecting → accepted / rejected / cancelled; inspection by the department or the committee;
  the workflow; the acceptance date; who decided; audit), `goods_receipt_lines` (per PO line received,
  refused at the door with the reason, batch, expiry, serial numbers, work done; accepted, rejected
  with the reason, rejected serial numbers; the unit cost at acceptance), `goods_receipt_signoffs` (the
  committee's signatures, cleared when the inspection changes); `stock_issues` + `stock_issue_lines`
  (made now for what a receipt brings for an indent — kind `receipt`; part 8 adds the indent and
  counter kinds, the slip and the acknowledgement).
- **Inspection**: `syncFlow(c, 'inspection', department)` — the department's Inspection levels on
  Who approves, or one level "Head of department" when none is set, or the school admin when the
  department has no HOD who signs in; levels re-planned as usual, the receiver left out (their level
  passes on). A PO above the committee limit is inspected by the **purchase committee**: members who
  sign in, never the receiver; `committee_signatures` of them (all when not set) sign the same
  inspection; a member changing it clears the others' signatures. A PO without a department uses the
  purchase office's.
- **API** `PurchaseReceiptsService` (+ controller): the receipt list (status, kind, PO, store, search,
  "waiting for me"; the deemed-acceptance date 15 days after delivery and whether it has passed), the
  count waiting for me, **To receive** (approved and sent POs with something to come; goods and / or
  services; late; made by me), the **form** (per PO line ordered, received, accepted, rejected, waiting
  for inspection, still to come, the most allowed with the tolerance; the stores I may receive into),
  **receive** (not by the PO's maker; a goods receipt by the store's keepers or the store managers, a
  completion certificate by the purchase office or a keeper; goods and service lines kept apart; a batch
  for a batch item; serial numbers, when given, one per unit and never twice for the item; what was
  done for a service; all refused at the door is a rejected receipt with nothing to inspect),
  **inspect** (accept line by line — accepted + rejected = received, a reason for a rejection, the
  rejected serial numbers ticked — or reject it all with the reason; nobody inspects what they
  received), **cancel** (while inspecting, by whoever recorded it or the store / purchase managers),
  the **PDF** (goods received and inspection note / completion certificate; "NOT INSPECTED" across one
  waiting) and the vendor's **file** through the receipt (so an inspector without file rights sees
  it). On acceptance (`finalise`): lines without an outcome are accepted as they came; each line's unit
  cost is the PO line's taxable value + its GST (unless the setting leaves it out) + its share of the
  PO's other charges (with their GST) by taxable value, over the quantity; kept-in-stock goods post a
  `receipt` move at that cost per store unit with the batch; **issued at once** (`issueToIndents`): for
  each accepted line bought through a requisition, the indent lines it came from (approved indents,
  oldest first) get what they asked for less what they were issued before — one issue per indent, the
  same batch, out at the average; then the PO's quantities, receipt status and closing.
- **PO**: its lines show received, accepted and rejected; `receiptStatus`, the receipts list,
  `can.receive`; **cancel and amend are refused once anything has been received** (close it short;
  a new PO for a change).
- **Reports**: Goods receipt register (status or kind), Pending deliveries (late only). **Dashboard**:
  twelve figures (to receive, late deliveries, waiting for inspection with those past 15 days, accepted
  this month, stock value, below reorder level added).
- **Admin**: Purchase → To receive, Goods receipts (tabs: waiting for me, waiting for inspection,
  accepted, rejected, all), Receive goods / Work done (the form keeps what was typed when refused), a
  receipt's page (status and the deemed date, the vendor's papers, the inspection form, what came with
  the cost per unit, the issues made, the committee's signatures, the levels), the PO's **Deliveries**
  card and Receive buttons, **Close short**; Who approves gains the Inspection column (HOD when not
  set); Purchase settings gains Goods received; My approvals gains "Goods received to inspect". Help:
  Receiving goods and services.
- **Staff app**: Goods received to inspect (menu count), a receipt with the inspection form (accept
  line by line, rejected serial numbers, reject all), its PDF and the vendor's papers; Hindi.
- **Tests**: `purchase-receipts.e2e-spec.ts` (7: the maker cannot receive, the form; excess refused,
  a batch needed, service lines kept apart, a receipt cancelled; part received with a refusal, the
  HOD's inspection accepting part; the cost with GST and freight, the indent's share issued at once
  with the batch, the rest in stock; a completion certificate, a rejected receipt, a replacement, the
  PO closing by itself and no longer cancellable; the committee's signatures signed again after a
  change, serial numbers; the PDF, the GRN register, pending deliveries, Who approves).
- **Not yet** (part 8): the issue slip PDF and the department's acknowledgement, returning rejected
  goods to the vendor, reservations, counter issues, transfers, counts.

## As built — part 8, issues, returns, transfers and counts (6 Nov 2026)

Settled while building: stock is **reserved when the PR is sent** for approval (refused when not enough
is free), and let go when it is sent back, rejected, cancelled or reopened; a PR the store has issued
against cannot be reopened. A kept-in-stock item "from the store" must name its store (a note stays for
an item not kept in stock). Returns into the store: **unused** goes back into stock at the issue rate,
**damaged** is recorded only (for condemnation, part 9). The count is **blind** until a line is counted,
and its approver is never someone who started or sent it. "Items marked for condemnation cannot be
issued" waits for part 9.

- **Migration 0325**: right `purchase.count.approve` (group and school admins);
  `purchase_requisition_lines.store_id`; `stock_reservations` (store, item, PR line, quantity in the
  store unit, issued, open / done / released) and `app.stock_reserved_refresh` (the balance's reserved
  from the open reservations); `stock_issues` gain `requisition_id` and `ack_on_paper`,
  `stock_issue_lines` gain `reservation_id` and `returned_qty`; `purchase_order_lines.returned_qty`
  (sent back from stock with a replacement wanted); `stock_returns` + `_lines` (to the store against an
  issue, or to the vendor against a PO; source issue / rejected / stock; condition; replacement; the
  move — a vendor return's quantity is in the PO line's unit), `stock_transfers` + `_lines` (in
  transit / received / cancelled; out and in moves), `stock_counts` + `_lines` (one open count per
  store; book quantity taken at the start; counted, reason, added; the adjustment's rate, value and
  move).
- **Shared** (`purchase-stock-core.ts`): `storeProblems` / `reserveRequisition` / `releaseRequisition` /
  `issuedAgainst`, `freeStock`, `mustOperateStore`, `postIssues` (one issue per indent, or per
  department; issue moves at the average; reservations used up) and `shareAmongIndents` (a PR line's
  quantity shared to the indent lines it came from, oldest first, up to what each asked for less what
  it was issued) — the part 7 auto-issue on acceptance now uses them too; `purchase-stock-pdf.ts` (one
  layout for the issue slip, return note, transfer note and count sheet / statement).
- **Requisitions**: the requirement "Enough free stock" (and the store named); the PR form lists the
  stores with what is free; a line shows the store and what it holds reserved or was issued.
- **API**: `PurchaseIssuesService` (list — the stores see all, a department its own; to-issue groups per
  PR and store in the stores I keep; the counter form lists; issue against reservations or at the
  counter — never more than the free stock; acknowledge by whoever took it, the indent's raiser or the
  HOD, or a signed slip recorded by the keeper; return to the store; the slip PDF),
  `PurchaseReturnsService` (what of a PO can go back; the vendor return — rejected goods without a stock
  move, defective ones out of stock at the average; the PO's quantities worked out again, a PO closed by
  itself reopened for the replacement; the list, a return and its note PDF), `PurchaseTransfersService`
  (send batch by batch from free stock, receive by the receiving keeper, cancel back by the sender; the
  note PDF), `PurchaseCountsService` (start, blind lines, save, Excel sheet and import with lines found
  added, submit with every line counted and differences explained, approve into `adjustment` moves at
  the average — the last rate in when the average is nothing — or send back, cancel; the sheet /
  statement PDF; when each store was last counted) and one controller. The PO's received status now
  counts what went back from stock for a replacement (`refreshOrder`).
- **Reports**: issues by department (consumption, net of what came back), slow-moving and dead stock
  (no issue in 90 / 180 / 365 days), expiring soon (30 / 60 / 90 days, or expired), below reorder level
  (with what is on order), transfers, count differences.
- **Admin**: Purchase → Issues (To issue, waiting for acknowledgement, to acknowledge, all; Counter
  issue; an issue with its acknowledgement, slip and goods brought back), Returns (list, Return to the
  vendor from the PO's Deliveries or a receipt with rejected goods, a return note), Transfers (to
  receive, in transit, all; Send to another store; receive / cancel), Physical counts (the stores and
  when last counted, Start a count, the count sheet on screen or Excel, send, approve / send back); the
  store shows whether it was counted this year; the requisition form's store per line; the PO's
  returned quantity; My approvals gains issues to acknowledge and counts to approve. Help: Issues,
  returns and transfers; Physical count.
- **Staff app**: Issued to my department (acknowledge, the slip), Stock in my stores (keepers).
- **Tests**: `purchase-issues.e2e-spec.ts` (9: reservation on send and release on send-back; issue
  against the reservation to the indent with the earliest expiry first and the PR no longer reopened;
  the counter issue never taking reserved stock; acknowledgement and the signed slip; goods brought
  back; transfer received and cancelled; the blind count from Excel approved into an adjustment by the
  admin only; rejected and defective goods to the vendor with the PO reopened for the replacement; the
  six reports); `purchase-requisitions.e2e-spec.ts` updated (a kept-in-stock item from the store names
  its store).
- **Not yet** (part 9): reorder → indent, assets and depreciation, condemnation and disposal (the
  damaged returns wait for it), the employee's assets.
