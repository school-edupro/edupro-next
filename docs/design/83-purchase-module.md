# 83 · Purchase: masters, Purchase Indent → Requisition → Order, department approvals, delegation, rule bypass

Status: phase 1 part 1 built 6 Nov 2026 (**As built** at the end); planned 6 Nov 2026 (phase 1 of three), **re-validated the same day** against the vendors'
own documentation, procure-to-pay control practice and the Indian rules (see **Validation**). Asked by
the school: "make a purchase module: all masters like item master, payment term master, vendor master,
HSN master; in the school segment PI / PR / PO; approver process department-wise and delegation of
approval; process bypass like PI to PO, meaning PR is auto approval — benchmark with the best education
ERPs", then "re-validate this process and benchmarks with best industries".

## Benchmark (checked against their published material)

| Product                       | Flow (as published)                                                                                                                                                 | Worth taking                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **edumerge** (education ERP)  | Indent → Purchase Requisition → RFQ → PO → GRN → Invoice → Payment                                                                                                  | Every document linked to its parent; the PR checked against budget (block / escalate); stock soft-reserved against a PR / PO; a GST- and PAN-verified vendor master                   |
| **Fedena** (education ERP)    | Stores and store items → indent (any employee) → PO (only against an approved indent) → GRN; reports per indent / PO / GRN                                          | A PO always traces to an approved indent; sequential numbers; a GRN can issue the pending indent quantity to the indenter at once                                                     |
| Entab CampusCare              | No public module documentation found                                                                                                                                | — (not used as a reference)                                                                                                                                                           |
| **ERPNext** (open source ERP) | Material Request → RFQ → Supplier Quotation → PO → Receipt → Invoice → Payment; the Material Request optional                                                       | A direct PO when the need is already approved (our bypass); roles, workflows and authorisation rules to separate request, approval, receipt, invoice, payment; "PO required" settings |
| **SAP** (purchasing)          | Requisition release strategy chosen by document type, plant, purchasing group and **value**; item-wise or whole release                                             | Approval chosen by attributes of the document (our department), value thresholds                                                                                                      |
| **Oracle** Purchasing         | Approval by **position hierarchy** (limits per position) or employee / supervisor chain                                                                             | Position-based routing survives staff changes (a chain of named people breaks when someone leaves)                                                                                    |
| **GFR 2017** (Govt. of India) | Up to ₹50,000 direct purchase with a certificate (Rule 154, raised from ₹25,000 in July 2024); up to ₹2.5 lakh a purchase committee (Rule 155); above, tender / GeM | Value tiers for how a purchase is sourced, a committee-signed comparative statement — the norm aided schools and institutions audit against                                           |

Common to the best: a catalogue with HSN and GST, a governed vendor master, approvals chosen by the
document's attributes, delegation and escalation, competitive quotes by value, a PO PDF to the vendor,
contract items that skip sourcing, linked documents and a complete record of every decision.

## What there is

- **Legacy PHP** (`Admin/Purchase`, the newer module; `Admin/Inventory`, the older one): material
  classification Type → Group → Category → Sub-category (+ Model); items (SKU, HSN, UOM, unit price,
  min / max levels, risk category, origin country); vendors (name, phone, GSTIN, address, contact,
  e-mail, state, supplier code); indent (PC code, warehouse, MR type, lines with on-behalf and an
  attachment) with L1 → L2 → L3 approval by **warehouse** (three named employees, a level skipped when
  the same person holds the next one); after approval "issue from warehouse" or "convert to PO"; PO with
  vendor, rates, discount, GST (CGST / SGST / IGST, inclusive or not), freight, delivery date and
  **payment terms as free text**, its own L1 → L3, print, then "mark fulfilled" to close. The older
  module also had purchase requests, vendor quotes (L1 / L2 approval), goods receipt, issue and return,
  live stock. No department-wise approval, no delegation, no HSN or payment-term master, no rule bypass.
- **EduPro**: `departments` (employee master) and each employee's department; the **workflow engine**
  (`modules/workflow`: definitions per entity type, levels with resolvers — named user, role,
  designation, any-of, reporting chain — SLA and escalation, a level skipped when nobody holds it or the
  same person approved earlier, a full event history, the approvals inbox) already honours
  **delegations** (`access/delegations`: from → to, dates, reason); department approver rules exist in
  the lesson planner; separate vendor lists in Library and Transport; Communication templates and the
  e-mail worker; PDF exports. No items, HSN, payment terms, purchase documents or stock.

## Decisions (user, 6 Nov 2026)

| Question           | Answer                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PI / PR / PO       | **Indent → Requisition → Order**: PI = a department asks for items; PR = the purchase office combines indents, checks stock, gets quotes, decides what to buy; PO = the order to the vendor; each approved                                                        |
| Bypass             | **Rule-based**: PI → PO with the PR made and approved by the system when every line is a rate-contract item, or the PI total is under the department's limit; the PR is kept, marked "auto-approved: rule …"                                                      |
| Approvals          | **Department levels only**: each department has its levels (e.g. HOD → Admin officer → Principal), set separately for PI, PR and PO; no amount slabs                                                                                                              |
| Amount guard       | **Declined** (asked again after the validation): no approver added by amount; the risk is accepted and offset (see Validation)                                                                                                                                    |
| Delegation         | **For dates**: an approver (or the admin for them) hands their purchase approvals to a colleague for a period, with a reason; "approved on behalf of" in the history; an unanswered step escalates after its SLA                                                  |
| "hon master"       | **HSN / SAC with GST**: codes with description and GST rate; an item takes its HSN; the PO works out CGST + SGST or IGST from the vendor's state                                                                                                                  |
| Scope              | **Phase 1: masters, PI, PR, PO** (stock note, quotes, PDF and e-mail to the vendor, reports); phase 2: GRN, store stock, issue, return; phase 3: vendor bill matched to PO and GRN, payments, budgets                                                             |
| Quotes             | **GFR-style tiers** (school-set, defaulting to GFR): up to ₹50,000 one quote + a "reasonable price" certificate; up to ₹2.5 lakh at least 3 quotes and a **comparative statement signed by the purchase committee**; above, a tender reference with its documents |
| Emergency purchase | **Allowed, with ratification**: the purchase office records a post-facto PO (vendor bill attached, reason); it skips PI / PR and needs the **Principal's ratification**; its own report; a school can switch it off                                               |
| Vendors            | **One common vendor master** for the school; Library and Transport vendors can move into it later                                                                                                                                                                 |
| Vendor control     | **Maker-checker**: a new vendor, or a change of its bank account, GSTIN or PAN, is pending until a second person with the vendor-approve right approves it; a pending vendor can't be on a PO; duplicates flagged                                                 |
| Who raises a PI    | **Any staff with the indent right, for their department** (from the employee master) or on behalf of a colleague; the school admin and purchase office for any department                                                                                         |
| Payment terms      | **Instalments**: a term is one or more instalments — % + trigger (advance / on delivery / after invoice) + days; the vendor has a default term, the PO copies it and may change it; printed on the PO                                                             |
| Budget             | **Not in phase 1**: the PI and reports show the department's spend this year (approved POs); budgets with warn / block come with the accounts link                                                                                                                |
| Schools            | **Per school**, each its own masters and records; a school may **copy** items, HSN, UOM, payment terms and vendors from another school of its group                                                                                                               |

Decided here (to confirm while building): the item classification is **type** (consumable / asset /
service, fixed) + the school's **category → sub-category** (the legacy Type / Group / Category /
Sub-category maps onto it); a **PR that combines departments** takes the approval levels of the
purchase office's department (a setting), a PR for one department that department's; a **PO** takes
its PR's department; a PO changed after approval is **amended** (revision R1, approved again, the old
one superseded); delegation gains a **scope** (all approvals / purchase only).

## Validation against industry practice (6 Nov 2026)

| Area                     | Practice found                                                                                                                         | Plan                                                | Verdict                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The chain                | Indent → PR → (RFQ) → PO → GRN → invoice → payment (edumerge, ERPNext); Fedena indent → PO → GRN                                       | PI → PR (quotes) → PO now; GRN, bill, payment later | **Holds**                                                                                                                                                                                                                |
| Skipping the PR          | ERPNext: the request is optional, a direct PO when the need is approved; contract items skip sourcing (SAP)                            | Rule-based bypass with the PR kept                  | **Holds**, plus a **split-indent guard** (below)                                                                                                                                                                         |
| Approval routing         | By document attributes (SAP: plant, purchasing group, type, value); by position (Oracle)                                               | Department levels                                   | **Holds**, but levels set **by designation** (e.g. the department's HOD) with named people only as fallback, so a leaver doesn't break the chain                                                                         |
| Value thresholds         | SAP release by value; Oracle limits per position; GFR tiers                                                                            | None (declined)                                     | **Risk accepted**; offset by: the tiers for sourcing, the amount shown first to every approver, a "largest POs" list and an over-₹X alert on the dashboard (X set by the school, information only)                       |
| Segregation of duties    | Requester ≠ final approver; separate request, approval, receipt, invoice, payment (ERPNext, audit practice)                            | Engine "auto if requester"                          | **Changed**: in purchase a level held by the requester (or the PO's maker) **passes to the next level**, never approves itself; on the last level it goes to the school admin; the PO maker can't approve that PO        |
| Delegation               | A named delegate per approver; the delegate's authority no wider than the delegator's; every delegated action traced; no self-approval | Delegation for dates                                | **Holds**, plus: a delegate can't approve a document they raised or made (passes on); no onward delegation; Settings lists approvers with no delegate                                                                    |
| Change after approval    | A material change after approval needs approval again                                                                                  | PO amendment                                        | **Holds**; also for a PR changed after approval                                                                                                                                                                          |
| Competitive quotes       | GFR: direct up to ₹50,000, committee up to ₹2.5 lakh, tender above; a committee-signed comparative statement                           | One limit                                           | **Changed** to GFR-style tiers (decided)                                                                                                                                                                                 |
| Emergency purchases      | Post-facto approval is common; auditors want each one visible                                                                          | Not planned                                         | **Added** with ratification (decided)                                                                                                                                                                                    |
| Vendor master governance | Vendor-master control is a core procurement control; GST- and PAN-verified suppliers (edumerge)                                        | GSTIN format                                        | **Changed**: maker-checker (decided); GSTIN **checksum** (Luhn mod 36), PAN = GSTIN characters 3–12, state from its first two; duplicates (GSTIN, PAN, bank account) flagged; a format check doesn't prove registration  |
| MSME suppliers           | MSMED Act s.15: pay micro / small suppliers within the agreed term, at most 45 days (15 without an agreement); Income-tax s.43B(h)     | —                                                   | **Added**: Udyam number and micro / small / medium on the vendor; a payment term over 45 days for a micro or small vendor is warned on the PO; the dues report comes with payments (phase 3)                             |
| GST on services          | Reverse charge on some services (e.g. an advocate's legal services); security services to a school up to higher secondary exempt       | GST rate only                                       | **Added**: HSN / SAC flags "reverse charge" (the PO shows "GST payable by the school under reverse charge", the vendor charges none) and "exempt for the school"; vendor GST status regular / composition / unregistered |
| Documents linked         | Every document links to its parent (edumerge); a PO only from an approved indent (Fedena)                                              | PR lines keep their PI lines; PO from PR / PI       | **Holds**; the tracker report follows each line                                                                                                                                                                          |
| Budget at PR             | edumerge checks the PR against budget                                                                                                  | Phase 3                                             | **Gap kept** (decided); the department's spend shown meanwhile                                                                                                                                                           |
| Services                 | A service entry / completion instead of a GRN; two-way match for services                                                              | —                                                   | **Noted for phase 2 / 3**: service items get a completion certificate instead of a GRN                                                                                                                                   |
| Stock                    | Soft reservation against PR / PO (edumerge); GRN issues to the indenter (Fedena)                                                       | Phase 2                                             | **Noted for phase 2**                                                                                                                                                                                                    |

**Split-indent guard** (a known abuse of value limits): the under-limit bypass adds up the department's
bypassed PIs of the same item category in the last 30 days; if the sum would pass the limit, the PI
goes to the PR as usual (and the overrides report shows it).

## Plan

### 1. Masters (Purchase → Masters)

| Master                   | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Units (UOM)**          | code (NOS, BOX, REAM, KG, LTR, SET, PAIR, MTR…), name, decimals allowed; seeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **HSN / SAC**            | code (4–8 digits), kind (HSN goods / SAC services), description, GST rate (0 / 0.25 / 3 / 5 / 12 / 18 / 28), **reverse charge** flag, **exempt for the school** flag (with a note to confirm with the school's CA), effective from (a rate change keeps history); seeded with the common school codes (stationery, paper, furniture, IT, sports, uniforms, lab, cleaning, repairs, printing, transport, catering, security, legal)                                                                                                                                                                                                                                                       |
| **Item categories**      | category → sub-category (the school's own), each active / inactive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Items**                | code (unique in the school), name, description / specification, type (consumable / asset / service), category, sub-category, UOM, HSN / SAC (its GST rate by default, may be overridden), brand / make, last purchase rate (kept), image, preferred vendors, status; Excel import / export (legacy columns accepted)                                                                                                                                                                                                                                                                                                                                                                     |
| **Payment terms**        | name ("50% advance, 50% within 15 days of delivery"), instalments (% adding to 100, trigger, days), the text printed on the PO, default; the longest days shown (for the MSME check)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Vendors** (common)     | code, legal and trade name, kind (manufacturer / dealer / service provider), **GST status** (regular / composition / unregistered), GSTIN (format, **checksum**, state from its first two digits), PAN (must match GSTIN characters 3–12), **MSME**: Udyam no and micro / small / medium, address, contacts (name, phone, e-mail, role), bank (account masked, IFSC), categories supplied, default payment term, documents (GST certificate, cancelled cheque, Udyam certificate), status **pending** / active / inactive / **blacklisted** (with reason); **maker-checker** for new vendors and bank / GSTIN / PAN changes; duplicates flagged; Excel import (imported vendors pending) |
| **Rate contracts**       | vendor × item × rate (GST extra or inclusive) × valid from / to, the document attached; one valid contract per item at a time; drives the bypass rule and fills the PO rate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Settings**             | the school's GSTIN and state, billing and delivery address, numbering (PI / PR / PO + financial year, e.g. `PO/2026-27/0001`), **quote tiers** (direct up to ₹50,000; committee up to ₹2.5 lakh; tender above — school-set), the **purchase committee** (named members, how many must sign), **emergency purchase** on / off, PO terms and conditions, PO validity days, the purchase office's department, signatures on the PO, the "large PO" alert amount (information only)                                                                                                                                                                                                          |
| **Department approvals** | per department × document (PI / PR / PO): up to 3 levels, each **a designation in the department** (e.g. HOD) or one or more named employees (any one approves); SLA hours per level (escalation to the next level); the department's **bypass limit** (₹, 0 = off); "rate-contract bypass" on / off                                                                                                                                                                                                                                                                                                                                                                                     |

### 2. Purchase Indent (PI)

- **Raise** (admin app and the staff app): department (the employee's own; any for admin / purchase
  office), on behalf of (an employee), purpose, required-by date, priority (normal / urgent), lines:
  item (catalogue) or a **free-text line** for an item not in the catalogue (the purchase office maps it
  to an item, or adds one, on the PR), quantity, UOM, estimated rate (the rate contract's, else the
  last purchase rate, editable), line note, attachment; the department's spend this year shown.
- **Approve**: submit starts the workflow (`purchase_indent`) on the department's PI levels — approve,
  reject (reason), **send back** (to edit and resubmit); cancel by the raiser before the first
  approval; every step in the history; the approver sees the amount first, the lines, the estimate and
  the department's spend.
- **On approval, the bypass rules** (in order): **(a) rate contract** — every line is a catalogue item
  with a valid rate contract: a PR is made **approved by the system** ("Auto-approved: all lines on rate
  contract") and **draft POs**, one per contract vendor, at the contract rates, go to the purchase office
  to confirm and submit; **(b) under the limit** — the PI's estimate ≤ the department's bypass limit,
  **and** with the department's bypassed PIs of the same category in the last 30 days still within it
  (the split-indent guard): an approved PR ("Auto-approved: ₹8,400 under Science's limit of ₹10,000")
  and the PI waits in the purchase office's **To order** list to make the PO directly; **(c)
  otherwise** it waits in **To requisition**.

### 3. Purchase Requisition (PR)

- **Make** from approved PIs (several, from several departments; the same item's lines combined, each
  PI line kept as the source) or directly (the purchase office's own need). Per line: **from store**
  (phase 1: marked by hand with a note; phase 2: the stock shown and issued) or **buy**.
- **Sourcing by tier** (the PR's estimate): **direct** (up to ₹50,000) — one vendor and rate, the
  "reasonable price" certificate recorded by the purchase officer; **committee** (up to ₹2.5 lakh) — at
  least 3 quotes (vendor, rate per line, GST, delivery days, validity, file), the **comparative
  statement** per line (lowest marked L1), the vendor chosen per line (a costlier one needs a reason),
  **signed** by the purchase committee members in EduPro (each a recorded sign-off) before the PR goes
  for approval; **tender** (above) — the tender reference, its documents and the chosen vendor recorded
  (the tender itself outside EduPro).
- **Approve** on the PR levels of its department (or the purchase office's for a combined PR); a change
  after approval sends it for approval again; on approval the POs are drafted, one per chosen vendor.

### 4. Purchase Order (PO)

- **Make** from an approved PR (drafted per vendor) or from a bypassed PI: vendor (**active** — not
  pending, inactive or blacklisted), quotation reference, delivery date and address, payment term (the
  vendor's, may change; **a term over 45 days for a micro or small vendor is warned**), validity; lines:
  item, description, HSN / SAC, quantity, UOM, rate, discount %, taxable value, GST rate, **CGST + SGST**
  (vendor in the school's state) or **IGST** (other state; none for an unregistered or composition
  vendor; **reverse charge** lines show the GST the school pays), line total; other charges (freight,
  installation, with their GST), round-off, total and **amount in words**; terms and conditions.
- **Approve** on the PO levels of its department (its maker can't approve it); then the **PO PDF**
  (letterhead, the lines, the GST summary by HSN, the payment instalments, terms, signatures) and
  **e-mail to the vendor** (a Communication template, the PDF attached; sent by the user's choice,
  logged). States: draft → pending approval → approved → sent → **closed** (fulfilled, by hand in phase
  1. / **cancelled** (reason, its own right) / **amended** (revision R1, approved again, the old
     superseded).
- **Emergency purchase** (when switched on): the purchase office records a post-facto PO — vendor,
  lines, the vendor's bill attached, the reason; no PI or PR; it goes to the **Principal for
  ratification** (approve / reject with reason); marked "Emergency" everywhere and listed in its own
  report.

### 5. Approvals and delegation (the workflow engine)

- Three workflow definitions (`purchase_indent`, `purchase_requisition`, `purchase_order`, plus
  `purchase_emergency` for ratification) whose levels use a new resolver **`department_level`** {level
  1–3}: the designation in the document's department (or the named employees) set at that level for
  that document; the engine's skips (nobody set, already approved earlier by the same person) and SLA
  escalation apply.
- **Segregation of duties**: a level whose approver is the document's requester, or the PO's maker,
  **passes to the next level** (on the last level to the school admin) instead of approving itself.
- **Delegation**: Access → Delegations gains a **scope** (all approvals / purchase approvals); the
  delegate approves "on behalf of" (already in the engine's history); not a document the delegate raised
  or made (it passes on); no onward delegation; Settings lists the purchase approvers who have no
  delegate.
- **System approvals** (the bypass): the PR's step recorded as decided by the system with the rule and
  the figures, so reports and the audit show every bypass.

### 6. Reports and dashboard

Registers (PI, PR, PO) with filters and Excel / PDF; **status tracker** PI → PR → PO per line;
**pending approvals** with ageing; **overrides** — bypassed PIs (rule, figures), split-indent guard
hits, costlier vendors chosen, emergency purchases, cancelled and amended POs; department-wise and
vendor-wise purchase; item purchase history (last rates, vendors); comparative statements; PO **GST
summary** by HSN and rate (reverse charge apart); **MSME vendors** with their payment terms. Dashboard:
figures first (open PIs, awaiting approval, To requisition, To order, POs this month and value), then
the tables (oldest pending, largest POs, POs over the alert amount), then small charts (spend by
department, by month).

### 7. Rights and roles

`purchase.master.manage`, `purchase.vendor.approve` (the checker), `purchase.indent.raise`,
`purchase.indent.view` (own department; all with scope), `purchase.requisition.manage`,
`purchase.committee.sign`, `purchase.order.manage`, `purchase.order.cancel`,
`purchase.emergency.record`, `purchase.report.view`, `purchase.settings.manage`; a built-in **Purchase
office** role (masters, PR, PO, reports; not vendor approval); teachers and staff get
`purchase.indent.raise` for their department; approving needs no right of its own (the department's
approval set decides).

### 8. Data (per school, RLS)

`purchase_uoms`, `purchase_hsn` (+ rate history), `purchase_item_categories`, `purchase_items`,
`purchase_payment_terms` (+ instalments), `vendors` (+ pending changes for maker-checker),
`vendor_contacts`, `vendor_documents`, `purchase_rate_contracts`, `purchase_settings` (+ committee
members), `purchase_department_approvers` (department × document × level → designation / employees,
SLA, bypass limit), `purchase_indents` + `_lines`, `purchase_requisitions` + `_lines` (+ `_sources` to
the PI lines), `purchase_quotes` + `_lines`, `purchase_cs_signoffs`, `purchase_orders` + `_lines` +
`_charges` (revisions, emergency flag), numbering per financial year; the workflow instances by entity
type; bank details encrypted as provider keys are. Copy from another school of the group: items,
categories, UOM, HSN, payment terms, vendors (copied vendors pending).

## Phases and parts

**Phase 1** (this plan), in parts:

1. **Masters** — migration, UOM and HSN / SAC seeded (with reverse-charge and exempt flags), categories,
   items (Excel), payment terms, vendors (GSTIN checksum, PAN match, MSME, documents, maker-checker,
   duplicates, blacklist; Excel), rate contracts, settings (tiers, committee, emergency), department
   approvals by designation, copy from a school; rights and the Purchase office role; admin pages; tests.
2. **Purchase Indent** — raise (admin and staff app), lines, attachments, the workflow with the
   `department_level` resolver and the segregation rule, approve / reject / send back / cancel,
   delegation scope and rules, the bypass rules with the split-indent guard; tests (each rule, a level
   passing on, delegation, escalation).
3. **Purchase Requisition** — from PIs (combined) or direct, store / buy per line, sourcing by tier
   (certificate, quotes, comparative statement, committee sign-off, tender reference), vendor per line,
   approval, POs drafted.
4. **Purchase Order** — from PR or bypassed PI, GST split with reverse charge, charges, payment term
   with the MSME warning, approval, PDF, e-mail, close / cancel / amend; emergency purchase and
   ratification.
5. **Reports, dashboard, help** — registers, tracker, pending, overrides, spend, GST summary, MSME
   vendors; help pages; a11y and browser checks.

**Phase 2**: stores (locations), **GRN** against the PO (partial) and a completion certificate for
services, stock ledger with soft reservation, issue to departments against the PI (from the GRN at
once when wanted), returns, reorder levels, asset tags for asset items. **Phase 3**: vendor bills with
3-way match (PO · GRN · bill; 2-way for services), payment schedule from the payment term, MSME dues
(the 45-day rule, the half-yearly MSME-1 figures), department budgets (warn / block at the PR), TDS,
the accounts link, vendor rating.

## Not in scope (phase 1)

Central purchase for a group; running tenders or e-auctions (only their reference is recorded); a
vendor portal (vendors quoting online); verifying a GSTIN with the GST portal (needs a GSP; the
checksum only shows it is well formed); budgets; stock and GRN (phase 2); payments (phase 3); moving
Library and Transport vendors into the common master (later, by choice).

## Sources (validation)

- edumerge — Procurement Management: https://www.edumerge.com/products/finance-and-control/procurement-management
- Fedena — inventory feature tour and support: https://fedena.com/feature-tour/school-inventory-management-system , https://support.fedena.com/support/solutions/articles/29797-what-is-the-use-of-inventory-module-
- ERPNext — buying and procurement cycle: https://docs.frappe.io/erpnext/procurement-cycle-overview , https://docs.frappe.io/erpnext/material-request
- SAP — releasing purchase requisitions: https://learning.sap.com/courses/purchasing-in-sap-s-4hana/releasing-purchase-requisitions
- Oracle — approval hierarchies: https://docs.oracle.com/cd/A60725_05/html/comnls/us/po/apsetup.htm
- GFR 2017 amendment (Rule 154 to ₹50,000, July 2024): https://gconnect.in/news/amendment-general-financial-rules-2017.html
- MSMED s.15 and Income-tax s.43B(h): https://taxmann.com/post/blog/faqs-liability-of-buyer-u-s-15-of-msmed-act-to-make-timely-payments-to-mse-suppliers
- GST reverse charge (services): https://taxguru.in/goods-and-service-tax/detailed-analysis-rcm-gst.html ; security services to schools: https://www.taxwink.com/blog/rcm-security-services-gst-applicability
- GSTIN checksum (Luhn mod 36): https://arthurdejong.org/git/python-stdnum/plain/stdnum/in_/gstin.py
- Procure-to-pay controls (segregation, three-way match): https://sapinsider.org/articles/use-a-three-way-invoice-control-assessment-to-reduce-the-risk-of-fraud-and-money-loss/
- Delegation practice: https://www-p504.intacct.com/ia/docs/en_US/help_action/Purchasing/Setting_up_Purchasing/Approvals/set-up-approval-delegation.htm

Figures from secondary sources (the GFR limits, the 43B(h) reading, the GST exemptions) are to be
confirmed with the school's CA before go-live; the settings keep them editable.

## As built — part 1, the masters (6 Nov 2026)

- **Migration 0316**: rights `purchase.master.view` / `.manage`, `purchase.vendor.approve`,
  `purchase.settings.manage` (school and group admins all; the new **Purchase office** role view and
  manage); tables `purchase_uoms`, `purchase_hsn` (GST rate, `reverse_charge`, `exempt`, rate history in
  the audit), `purchase_item_categories` (two levels, a trigger), `purchase_items` (a trigger keeps the
  sub-category under the item's category), `purchase_payment_terms` + `_lines` (instalments: %, advance /
  delivery / invoice, days; one default), `vendors` (GST status, GSTIN and PAN with their checks, state,
  MSME and Udyam, bank encrypted with a hint, categories, term, status pending / active / inactive /
  blacklisted / rejected; audit masks the bank), `vendor_contacts`, `vendor_documents`, `vendor_changes`
  (one pending change at a time), `purchase_rate_contracts` (a trigger: one active contract per item per
  day, only an active vendor), `purchase_settings` (GSTIN and state, addresses, prefixes, sourcing tiers
  with GFR defaults, committee quotes and signatures, emergency, PO validity, terms, signatures, the
  combined-PR department, large-PO alert, split window), `purchase_committee_members`,
  `purchase_department_approvals` (department × PI / PR / PO → up to 3 levels as the workflow engine's
  staff resolver: employees, designation, HOD; SLA hours), `purchase_department_rules` (bypass limit,
  rate-contract bypass); `app.purchase_seed_masters()` (18 units, 7 HSN codes whose rates are settled
  since 22 Sep 2025, NET30, the settings row) run for active schools and on first use.
- **Masters grid** (group `purchase`, Purchase → Items, units and HSN): Units, HSN / SAC codes, Item
  categories, Items (sub-category picked under its category), Rate contracts (only active vendors), and
  Vendors and Payment terms as read-only tabs (Excel / PDF) edited on their own screens.
- **API** `modules/purchase`: `gstin.ts` (format, state code, Luhn mod 36 check character, PAN inside),
  `PurchaseVendorsService` (list with counts, detail with contacts, documents and the pending change;
  create pending; update — pending / rejected vendors at once (the editor becomes the maker), approved
  ones: plain fields at once, bank / GSTIN / PAN / GST status as a pending change with a reason;
  duplicates of GSTIN, PAN or bank account → 409 `purchase.vendor_duplicate` unless a reason, checked on
  what changes only; decide vendor / change (403 `purchase.maker_checker` for the maker); withdraw;
  status active / inactive / blacklisted (reason); documents (a PDF or photo the user uploaded, 5 MB);
  Excel format and import with a dry run, rows pending, no bank), `PurchaseSetupService` (overview,
  payment terms (100% check, words, longest days), settings (GSTIN check, signatures ≤ members),
  committee, department approvals with warnings for levels nobody can hold, rules, copy from a school of
  the group the user belongs to — items bring categories, units, HSN; vendors arrive pending).
- **Admin**: Purchase menu (cart icon): Purchase set-up (figures, the steps in order, what waits,
  copy from a school), Vendors (status tabs, search, import), Add / a vendor (status, approve / reject,
  the waiting change side by side, status actions, documents with View / Download, the form: GST fields
  as the status needs, contacts, bank, the change reason and the duplicate reason when asked), Vendor
  approvals (the approver sees the bank in full; "You entered it"), Payment terms (instalment editor
  with the running total), Who approves (department table, rules, three `ApprovalLevelsEditor`s — now
  with `maxLevels` and warnings), Purchase settings (sections + committee). Help `purchase.md`.
- **Tests**: `purchase-masters.e2e-spec.ts` (12: starter masters, category depth and item category,
  GSTIN / PAN / Udyam, maker-checker, duplicates, bank change, rate-contract overlap and pending vendor,
  payment terms, settings and committee, department approvals and rules, vendor import, copy from a
  school and rights); `gstin.spec.ts` (3); masters, RLS, audit-mask, anonymise and permission suites
  pass.

## As built — part 2, the Purchase Indent (6 Nov 2026)

- **Migration 0317**: rights `purchase.indent.raise` (staff roles, admins, Purchase office),
  `purchase.indent.view` and `purchase.indent.any_department` (admins, Purchase office);
  `purchase_numbering` with `app.purchase_fy()` and `app.purchase_next_number('indent' | 'requisition' |
'order')` → `PI/2026-27/0001` (the settings prefix, restarting each financial year, locked per row);
  `purchase_indents` (number given on the first submit, department, raiser, on behalf of, purpose, needed
  by, priority, status draft / submitted / approved / rejected / sent_back / cancelled, route
  to_requisition / to_order / in_requisition / ordered / closed, the bypass rule and its note, estimate,
  the workflow instance, audit), `purchase_indent_lines` (a catalogue item or words, quantity, unit,
  estimated rate and where it came from: contract / last / typed, the contract), `purchase_indent_files`,
  `purchase_requisitions` + `_lines` + `_sources` (enough for the PR the system makes; the PR screens are
  part 3); `delegations` gains `scope` ('all' | 'purchase') and a null role for a purchase-only one.
- **Departments' levels on the engine** (a change from the plan's `department_level` resolver):
  `purchase-flow.ts` keeps one workflow definition per department and document (`purchase_indent_<dept>`,
  hidden from Access → Approval workflows), synced from Who approves on save and on submit, its levels
  the engine's `staff` resolver (employees / designation / HOD with the indent's department), `autoSkip`
  and SLA escalation to the next level (the last to the school admin). Saving the levels re-plans the
  indents waiting.
- **Engine**: a level option `noSelfApproval` (purchase only): the requester is left out of the level —
  nobody left, the level passes on with the note "passed on (nobody approves their own)", and a last
  level passed on goes to the school admins; acting on one's own request is refused (403
  `workflow.self_approval`), as someone's delegate too. A purchase-scope delegation counts only on
  `purchase%` instances (the inbox query and `act`).
- **API** `PurchaseIndentsService`: list (views mine / waiting / all, status, route, department, search;
  the view right sees all, others theirs, their department's sent ones and those they approve; the
  waiting count), detail (lines with the rate source and contract vendor, the department's approved
  indents this financial year, the PR, the steps, the history, what the user may do), the form lists
  (departments: one's own from the employee record, all with the any-department right; the catalogue
  with contract and last rates; units; staff), create / change (draft or sent back; whole numbers for
  whole units; needed-by not in the past), submit (409 `purchase.no_approvers` with no levels), decide
  (approve / reject with a reason / send back with what to change — send back closes the instance and
  the resubmit starts a new one through every level), withdraw (before any approval), delegations
  (from–to IST days, reason; the school admin for anyone). **On approval** (the engine's completion
  handler): (a) every line on a valid rate contract and the department allows it → a PR approved by the
  system with each line's contract vendor, rate and contract, the indent "PR skipped: waiting for the
  PO" (the draft POs of the plan come with part 4); (b) the estimate within the department's limit and,
  with its earlier under-limit indents of the same item categories in the split window, still within
  it → a PR approved by the system, the indent to the PO; over it → "Not skipped: with PI/… the
  department's purchases of these categories come to ₹…" and the indent waits for the PR; (c)
  otherwise it waits for the PR. Names shown are the employee's (else the account's).
- **Admin**: Purchase → Purchase Indents (tabs Waiting for me (n), Raised by me, All I can see, and for
  the purchase office Waiting for the PR and PR skipped: for the PO; status filter, search), Raise an
  indent / Change (`IndentForm`: department, for a colleague, needed by, purpose, priority; lines with the
  item picked by category or "Not in the list: describe it" with its unit, the quantity, the rate with
  its source and "Use ₹…" to go back to it, note, amount; the running estimate; Save as draft / Save and
  send), an indent (status, what to change / why rejected, where it went and the rule, approve / send
  back / reject, send, withdraw; facts with the department's year; items; approvals; history), Hand over
  my approvals (whose — the school admin — to whom, days, reason; End now). My approvals gains a
  Purchase Indents group (and the general Approval steps leaves them out); the workflow inbox links to
  the indent.
- **Staff app**: Office → Purchase indents (shown with the raise right or when one waits): Raised by
  me / Waiting for me, Raise an indent (the same form), an indent (decide with a remark, change, send,
  withdraw), Hand over my approvals; Hindi labels.
- **Not yet**: attachments on an indent (the table is there; upload comes with the PR screens).
- **Tests**: `purchase-indents.e2e-spec.ts` (8: own department and pricing, the levels and the under-limit
  skip, the split guard, the rate-contract PR, nobody approves their own and the last level to the
  school admin, send back / resubmit / reject, the purchase delegation, withdraw and no approvers); the
  suites on the engine (workflow, recruitment, exits, fees, admissions, corrections, merges) pass.
  `merge-rules.ts` gains `report_card_told` (missed in 0314; the student-merges test caught it).

## As built — part 3, the Purchase Requisition (6 Nov 2026)

- **Migration 0318**: right `purchase.requisition.manage` (admins, Purchase office); no right to approve
  or sign — the department's PR levels and the purchase committee decide (the plan's
  `purchase.committee.sign` is not needed). `purchase_requisitions` gains needed by, `combined`, `tier`
  (none / direct / committee / tender), the reasonable-price certificate (text, by, at), the tender
  reference and note, the workflow instance, submitted / decided, the decision note, `revision`, and the
  statuses `part_ordered` / `ordered` (part 4); lines gain the store note, the chosen GST rate and the
  reason for a dearer choice; an indent line sits on one requisition at a time (unique index);
  `purchase_requisition_files` (tender documents), `purchase_quotes` (one per vendor per PR: reference,
  date, validity, delivery days, file, note) + `purchase_quote_lines` (rate and GST per PR line),
  `purchase_cs_signoffs` (a committee member's signature).
- **API** `PurchaseRequisitionsService` (+ `PurchaseRequisitionsController`): the indents waiting
  (`requisition-candidates`), make a PR from ticked indents — the same catalogue item and unit added up
  (weighted estimate), lines in words apart, every indent line kept as a source; several departments →
  `combined`, approved by the department in Purchase settings (409 `purchase.no_purchase_department`
  when unset) — or a direct PR (department, lines priced from the contract / last rate); change the
  lines (a line from an indent stays: matched to an item, its quantity changed, or marked **from the
  store** with what is issued); quotes (active vendors only; GST from the item's HSN for a regular
  vendor, none for unregistered or composition); the comparative statement ranks each line on the rate
  with GST — the lowest **L1**; choices (from a quote at its rate, or for direct / tender an agreed
  rate; dearer than L1 → 400 `purchase.choice_reason` without a reason); the certificate (GFR 2017
  rule 154 wording offered); the tender reference and documents; a committee member signs once every
  line bought has its vendor; **any change of lines, quotes or choices clears the signatures**. The
  **tier** is worked out again on each change from the larger of the estimate and the chosen rates
  (before GST): up to the direct limit, the committee limit, or above. **Send for approval** checks the
  tier's requirements (409 `purchase.sourcing_incomplete` with the list): a vendor and rate on every
  line bought, all active; direct — the certificate; committee — the set number of quotes, every choice
  from its quote, reasons, quotes still valid, the required signatures; tender — the reference and a
  document. Then the department's PR levels on the engine (the same sync as PIs, nobody approves their
  own: the maker cannot). Approve: an indent all of whose lines are issued from the store is closed
  ("Issued from the store"); reject or cancel: the sources are released and the indents go back to
  "Waiting for the PR" with the reason; reopen an approved PR (no order yet): back to draft, revision
  +1; the purchase office closes an indent it will not buy. Who sees a PR: the purchase office (and the
  indent-view right), its approvers, the committee (committee-tier PRs), the raisers of its indents
  (read-only).
- **Admin**: Purchase → To requisition (approved indents with their lines, tick and make one PR;
  Close with a reason; a note when departments are mixed and no purchase department is set), Purchase
  Requisitions (All / Waiting for me / To sign; status and search; From indents (n) and Direct
  requisition), a requisition (status and actions with the requirements in the Send dialog; Sourcing:
  the value, the limits, the checklist; lines with their indents; quotes with View / Download of the
  file, Change, Remove; the comparative statement with L1 and the choice per line — quoted vendors
  with what the school pays, other vendors at an agreed rate outside the committee tier, the reason;
  the certificate; the tender reference and documents; the committee's signatures; approvals;
  history), Add / change a quote (rates per line, GST defaulting to the item's), Change the lines
  (`RequisitionForm`), Direct requisition. My approvals: Purchase Requisitions and Comparative
  statements to sign; the workflow inbox links to the PR; an indent links to its PR.
- **Staff app**: Office → Purchase requisitions (when one waits for me or a statement waits for my
  signature): approve / send back / reject with a remark, sign or withdraw a signature, the lines, the
  comparative statement and the signatures; Hindi labels.
- **POs from an approved PR** (one per chosen vendor) come with part 4.
- **Tests**: `purchase-requisitions.e2e-spec.ts` (6: combining two departments' indents, direct with
  the certificate, the committee's quotes / L1 / reason / signatures cleared, the tender, from the store
  and reject / cancel / close, reopen and who sees what); the indent and masters suites pass.

## As built — part 4, the Purchase Order and emergency purchase (6 Nov 2026)

- **Migration 0319**: rights `purchase.order.manage` (admins, Purchase office), `purchase.order.cancel`
  (admins only: cancelling an approved PO), `purchase.emergency.record` (admins, Purchase office);
  `purchase_settings.emergency_ratifier` (a designation, "Principal" by default); `purchase_orders`
  (number + `revision` with `supersedes_id` and the amendment's reason; status draft / submitted /
  approved / sent / closed / rejected / sent_back / cancelled / superseded; `emergency` with its reason,
  the vendor's bill file and number; the requisition and department; the vendor's GST status and state
  when worked out, intra- / inter-state supply; quotation reference, PO date, delivery date and address,
  payment term and its words, validity days, terms; the MSME warning; taxable, CGST, SGST, IGST,
  reverse-charge GST, round-off, total; approval and send dates; closed with a note),
  `purchase_order_lines` (the requisition line, item, words, HSN / SAC, quantity, unit, rate, discount %,
  GST rate, reverse charge / exempt from the HSN, the taxes, the contract and the reason a contract rate
  changed), `purchase_order_charges` (freight, installation, packing, other with GST),
  `purchase_order_sends` (to, the PDF file, the outbox message); the e-mail template
  `purchase_order` (Communication → Templates) seeded for every school.
- **GST** (`purchase-gst.ts`, unit-tested): taxable = quantity × rate less discount; a regular vendor in
  the school's state CGST + SGST (half each), in another state IGST; an unregistered or composition
  vendor none; a reverse-charge line none from the vendor and the GST the school pays shown apart (a
  reverse-charge SAC keeps its rate whoever the vendor is); an exempt line none; per-paisa per line, the
  total rounded to the rupee; the GST summary by HSN and rate.
- **Drafting** (`purchase-order-core.ts`): approving a requisition drafts **one PO per chosen vendor**
  with the lines still to order (in the requisition maker's name); the indent's rate-contract bypass
  drafts its PO at once (made by the system); To order lists what is left — lines of a cancelled or
  rejected PO, of a requisition the system approved under the limit (no vendor yet) — to draft by
  vendor. A PO starts with the school's delivery address, validity and terms, and the vendor's payment
  term (else the default). Each change works the GST, totals, payment words and MSME warning (micro /
  small vendor, a term over 45 days) out again. Placed POs (approved, sent, closed) make the
  requisition `part_ordered` / `ordered` and its indents "Ordered"; a cancelled one gives the lines
  back. A requisition with a PO past draft cannot be reopened; reopening drops its draft POs.
- **API** `PurchaseOrdersService` (+ controller): list (all / waiting for me; status, emergency,
  search; counts of drafts, to send, to order), To order, draft from ticked lines (only an active
  vendor: 409 `purchase.vendor_not_active`), the detail (vendor, terms, lines, charges, totals and words,
  GST summary, revisions, e-mails with the message's status, approvals, history, what the user may do),
  change a draft (quantity no more than the requisition still needs; a rate-contract rate only with a
  reason: 400 `purchase.contract_rate`; lines taken off go back to To order), send for approval (the
  school's state needed for a registered vendor: 409 `purchase.school_state_missing`; the department's
  PO levels, nobody approves their own; the maker is refused), decide, approve (an amendment supersedes
  the revision before it; the items' last purchase rate and date), cancel (the cancel right once
  approved), close, amend (the next revision as a draft; the old one in force until it is approved),
  the **PDF** (`purchase-order-pdf.ts`, pdf-lib: the band with the school's GSTIN, vendor and order
  boxes, bill-to and deliver-to, the lines table across pages, charges, totals, amount in words,
  reverse-charge note, GST summary, payment, MSME, emergency reason, terms, signatures from Purchase
  settings, "Approved in EduPro by …", page numbers; DRAFT / CANCELLED / SUPERSEDED across it), **e-mail
  to the vendor** (the PDF stored as a file, the template filled, the message queued with it attached,
  logged; the PO becomes "Sent"), **emergency purchase** (switched on in settings; an active vendor, the
  lines, the bill — a PDF or photo the user uploaded — and the reason; ratified by the
  `purchase_emergency` level: everyone with the ratifier designation, the school admin when it is
  overdue; not ratified = rejected).
- **Admin**: Purchase → To order (by requisition and vendor: tick, pick the vendor, Draft the PO),
  Purchase Orders (All / Waiting for me / Drafts / Approved: to send / Emergency; search), a PO (status
  and actions — approve or ratify, send back, reject, send for approval, amend, close, cancel; the MSME
  alert; Send to the vendor with the address; vendor and terms; lines with GST; totals in words; GST
  summary; e-mails; revisions; approvals; history; View / Download the PDF), Change (`OrderForm`:
  header, lines, charges), Record an emergency purchase; Purchase settings: who ratifies; a requisition
  lists its POs; My approvals: Purchase Orders; the workflow inbox links to the PO.
- **Staff app**: Office → Purchase orders (when one waits): approve / send back / reject (an emergency:
  ratify or not) with a remark, the lines and totals, the PDF; Hindi labels.
- **Found in the browser check**: the Purchase office role could not upload or open files (vendor
  documents, quotes, tender documents, the emergency bill) — migrations **0320** (upload) and **0321**
  (view) grant them; and the Purchase menu was hidden by the pilot module switches — `purchase` is now
  one of `platform.modules_enabled`'s modules (on by default; a school with its own saved list switches
  it on in Settings).
- **Tests**: `purchase-orders.e2e-spec.ts` (8: drafts per vendor with CGST + SGST / IGST / none and
  reverse charge, the MSME warning; pending and blacklisted vendors refused; changing a draft;
  the maker's level passing on, the last rate and the requisition; the PDF and the e-mail; amend /
  supersede, cancel's right, close; the emergency purchase ratified; the rate-contract indent's PO);
  `purchase-gst.spec.ts` (4); the indent, requisition and masters suites pass.

## As built — part 5, reports, dashboard and help (6 Nov 2026)

- **Migration 0322**: right `purchase.report.view` (school and group admins, Purchase office,
  auditor).
- **API** `PurchaseReportsService` (+ `PurchaseReportsController`): `GET purchase/reports/:report` —
  on screen (the first 500 rows, with a link per row to its document) or with `format=xlsx|pdf` the
  file (every row; the shared `libraryFile`: Excel with "About this report", A4 landscape PDF with the
  filters under the title); filters `from` / `to` (the financial year to today by default), department,
  vendor, item, status (or the override kind; the PO register also takes `placed`), the filters in
  words. Twelve reports: the **PI register**, **PR register** (tier, quotes, vendors chosen), **PO
  register** (taxable, GST, reverse charge, total, revision, emergency), the **status tracker** (each
  indent line → PR → live POs and their vendor), **pending approvals** (the level, approvers, their
  active delegates, waiting since the previous level acted, days, past the SLA), **overrides** (PR
  skipped by a rule with its figures, the split guard's "Not skipped", vendors other than L1 with the
  reason, emergency purchases and whether ratified, orders cancelled after approval, amendments, contract
  rates changed), **department spend by month**, **purchases by vendor**, **item history**,
  **comparative statements** (each quote with GST, L1, chosen, reason, signatures), the **GST
  summary** (lines by HSN / SAC and rate, other charges apart, reverse charge paid by the school) and
  **MSME vendors** (term, longest days, over 45 marked, orders placed). Spend counts placed orders
  (approved, sent, closed) by PO date. `GET purchase/dashboard`: the figures (open indents, waiting for
  approval, to requisition, to order lines, orders this month and value, ordered this year, emergencies
  waiting), the ten oldest pending, the ten largest orders of the year, orders over the alert amount,
  spend by department and by month. `GET purchase/report-filters` for the pickers.
- **Admin**: Purchase → Purchase dashboard (the figure cards open the lists they count — the pending
  report, To requisition, To order, the PO register of placed orders this month, department spend —
  then the tables, then two small charts) and Purchase reports (report picker, the filters the report
  takes, the table with totals, Excel / PDF through `/api/purchase/report`). Help: who reads the
  reports, the table of reports, a worked example from an indent to a closed PO.
- **Not done**: "Settings lists approvers with no delegate" from the plan (the delegations page lists
  who has handed over).
- **Tests**: `purchase-orders.e2e-spec.ts` gains the reports and dashboard against what it did (the PO
  register's six orders, the five override kinds, vendor spend, MSME, the GST summary with charges
  apart, the tracker, the dashboard's figures equal to To order) and every report as Excel and PDF; the
  right refused to a teacher; an unknown report 404.

## As built — item codes from the category (7 Nov 2026)

Asked by the user on the Items Add form; decided with them (all four recommended options):

| Question | Decision |
| --- | --- |
| Format | **Category code + sub-category code + 4-digit number per sub-category**: STAT-PAPER-0001; no sub-category: STAT-0001. A sub-category code that already starts with its category's (STAT-PAPER under STAT) is not repeated; PENS under STAT gives STAT-PENS-0001. A pair longer than 25 characters keeps the sub-category's code alone (codes are at most 30). |
| Editable | **Filled in, can be typed over** on Add; fixed after saving, as before. A code left as filled is sent blank and made again at saving (someone may have taken the number meanwhile). |
| Excel upload | A blank **Item code** gets the next code; a row with a code updates that item (blank rows are never duplicates of each other). |
| Sub-categories | Stay rows of **Item categories**; the column is now **Sub-category of (category)** (the old header still uploads) with plain help on both tabs. |

Benchmark: ERPNext has no built-in item-group prefix; its forum's usual answers are a short code per
item group fed into a naming series, given only when the item is first made
(https://discuss.frappe.io/t/item-code-generation/16988,
https://discuss.frappe.io/t/item-code-auto-generation/101519); Odoo add-ons build a product code from
a category prefix and a running number (https://apps.odoo.com/apps/modules/19.0/cst_auto_generate_product_code).

- **Migration 0327**: `app.purchase_item_code_prefix(category, sub)`, `app.purchase_item_code(school,
  category, sub)` (the highest number used for the prefix + 1, typed codes counted; 4 digits, more past
  9999) and the trigger `purchase_items_auto_code` (BEFORE INSERT, only when the code is blank; an
  advisory lock per school and prefix so two saves never get the same number — the masters' save is an
  upsert and would otherwise update the other item).
- **Masters framework** (any master can use it): `autoKey: { field, fn, from }` on a definition — the key
  may be blank (`required: false`), the upload check treats blank keys as new rows, `save` returns the
  key the database gave, and `GET /masters/:master/next-key?category_id=…&sub_category_id=…` returns the
  next value without reserving it. `aliases` on a field: other headers an upload accepts.
- **Admin**: `components/AutoKey.tsx` on the Add form fills the code as the category / sub-category
  are picked (the sub-category's narrowing box too), leaves a code typed by hand alone, fills again when
  the box is emptied; `masterSave` sends a code left as filled blank. Route
  `app/api/masters/[master]/next-key`.
- **Tests**: `purchase-masters.e2e-spec.ts` — the preview, codes on save (per sub-category, the repeated
  prefix dropped, no sub-category, a typed code kept and counted), an upload with blank codes and an
  update, the old "Sub-category of" header.

## As built — vendor checks and lists from the masters (7 Nov 2026)

Asked by the user on Purchase → Vendors → Add: every field checked, required fields marked, country,
state, city and bank from the masters, the same checks on the Excel upload and a formatted sheet.
Decided with them (all recommended options):

| Question | Decision |
| --- | --- |
| Required | **Full set, bank optional**: code (filled in), legal name, kind, GST status, GSTIN (registered) or PAN (unregistered, India), address, country, state, city, PIN, mobile, e-mail, the main contact's name and mobile. The bank once started: bank, IFSC, account no. typed twice, holder. |
| A city not in the master | **Pick from the list only**; the form links to Masters → Cities (new tab) for those with the right; a sheet row with another city is refused naming the master. |
| Bank in Excel | **Bank columns added** (Bank, IFSC, Account no, Account holder), checked like the form; imported vendors are pending, so the approver sees the account. |
| Vendor code | **Automatic V-0001, can be typed over**; blank in Excel gets the next one. |

- **Migration 0328**: `vendors.country` / `vendors.state` (names from the masters; `state_code` stays the
  GST code, an unregistered vendor's taken from its state); the PIN check allows a foreign postal code
  (India's six digits are checked by the API); `app.purchase_vendor_code()` and the trigger
  `vendors_auto_code` (blank code → next V-NNNN under an advisory lock); `app.purchase_seed_masters` also
  gives a school India and its 36 states and union territories with GST codes where it has none (the
  cities stay the school's own).
- **API**: `vendor-rules.ts` (`checkVendorFields`: required fields; country → state → city from the
  masters, a registered vendor's state = its GSTIN's; PIN; Indian mobile normalised to 10 digits;
  MSME ↔ Udyam; the main contact; the bank from the Banks master with its IFSC prefix, 9–18 digits, the
  confirmation, the holder) answers `validation-failed` with `errors: [{ path, message }]`; used by
  create, change (with the stored address for what is not sent) and every Excel row (savepoint per row;
  a problem names its column). `GET /purchase/vendors/form-lists` (countries, states with GST codes,
  cities with PIN, banks with IFSC prefixes, the next code). The Excel format: 24 columns, required
  marked, drop-downs from the masters (city as "Noida · Uttar Pradesh"), notes and a How to fill sheet.
  Copying vendors between schools carries country and state.
- **Admin**: `VendorForm.tsx` rebuilt: selects from the masters (country → state → city; GSTIN picks the
  state; a city fills its PIN), each field's problem under it on leaving and on saving (focus to the
  first), the server's per-field answer under the same boxes; the account number typed twice (no paste);
  `lib/vendor-rules.ts` mirrors the API's rules. `.ep-select[aria-invalid]` gets the red border.
- **Tests**: `purchase-masters.e2e-spec.ts` — the lists, a body with eleven problems answered per field,
  the PAN of an unregistered vendor, the made code and a normalised mobile, the formatted sheet and an
  import with a blank code, a bank, a city not in the master and a missing contact mobile.

## As built — payment terms in Excel, filters; who approves vendors (7 Nov 2026)

Asked by the user on Purchase → Payment terms (upload Excel, export Excel and PDF, filters) and "who
approves a vendor, and where is it set up". Decided with them (all recommended options):

| Question | Decision |
| --- | --- |
| Excel layout | **One row per term**: code, name, print text, default, status, then up to 4 instalments across (%, due on, days); a term with more stays on the screen. |
| Same code in the file | **Updates that term** (name, print text, default, status, instalments); POs already made keep their printed `payment_text`. |
| Filters | **Search, status, how it pays (advance / delivery / invoice), longer than 45 days**; Excel and PDF keep them. |
| Vendor approvers | **Shown in Purchase → Settings**, still a role right (`purchase.vendor.approve`, School Admin and Group Admin by default), changed in Access → Roles. |

- **API**: `GET /purchase/payment-terms` takes `q`, `status`, `kind`, `over45` (and answers `total`);
  `GET /purchase/payment-terms/export?format=xlsx|pdf` (the shared `libraryFile`, filters in words);
  `GET /purchase/payment-terms/template` (filled with the school's terms, drop-downs, notes, an Example
  and a How to fill sheet); `POST /purchase/payment-terms/import` (dry run, then the good rows; a
  savepoint per row; checks per instalment column, the 100% total, one default in the file, the default
  term not left without one, more than four instalments refused); `saveTermIn` shared by the screen and
  the import. `GET /purchase/vendor-approvers` (roles with the right; people holding them in the school
  now).
- **Admin**: the payment terms page has the filter bar, Excel / PDF buttons (`api/purchase/payment-terms-file`)
  and `TermImport` (`api/purchase/payment-terms-format`); Purchase settings has the **Vendor approval**
  card (who, which roles, a link to Access → Roles, a warning when nobody can approve).
- **Tests**: `purchase-masters.e2e-spec.ts` — the four filters, both files, the filled format, an upload
  with a new term, an update and three refused rows; the approvers (roles, people, not the purchase office).

## As built — purchase settings checks, addresses from the masters, named vendor approvers (7 Nov 2026)

Asked by the user on Purchase → Settings: every field checked; the billing and delivery addresses with
country, state and city from the masters; vendor approval configured on the page. Decided with them
(recommended options): **pick the approvers here** (employees who sign in; while none is named, the
role right decides as before) and **"Same as billing" tick** for the delivery address (on by default).

- **Migration 0329**: `purchase_settings.billing_line / _country / _state / _city / _pin`,
  `delivery_same`, `delivery_line / … / _pin` (what was typed before became the line);
  `billing_address` / `delivery_address` stay the whole address as printed, made from the parts on
  saving ("1 School Road, Pune 411001, Maharashtra, India"), so the PO and its PDF are unchanged.
  `purchase_vendor_approvers` (school, employee; tenant RLS).
- **API**: `saveSettings` checks per field (`errors: [{ path, message }]`): the GSTIN (its own type,
  with the path), each address (line ≥ 5, country → state → city by `resolvePlace` — shared with the
  vendor rules — and the PIN by `pinProblem`), the billing state = the GSTIN's, a prefix per document,
  the committee's signatures ≤ its members, an active department; without a GSTIN the school's GST
  state is the billing state's. `GET/POST/DELETE /purchase/vendor-approvers` (the named ones, the roles
  with the right and their people; `mode` named | role); `mayApproveVendors()` (named → only them,
  else the right) used by the vendor detail, the approvals queue (`canApprove` in both answers) and
  both decisions (`purchase.not_vendor_approver`, 403); the decide routes need only the purchase view
  right, the service decides. `vendors/form-lists` is open to the purchase view right.
- **Admin**: `PurchaseSettingsForm.tsx` (client): the sections as before plus Billing address and
  Delivery address (the tick), each field's problem under it, the server's under the same box, focus
  to the first; a GSTIN picks the billing state, a city fills its PIN. The Vendor approval card: the
  named approvers (Remove, "cannot sign in now"), else who approves by the right, Add as vendor
  approver (employees who sign in), a warning when nobody can approve. The vendor pages take
  `canApprove` from the API.
- **Tests**: `purchase-masters.e2e-spec.ts` — the settings with the address parts (printed whole), a body
  with seven problems answered per field, a delivery address of its own, the named approvers (only
  employees who sign in; only the settings right; then the admin is refused and the named one
  approves; removed, the right decides again).

## As built — vendor approvals in the header (7 Nov 2026)

The header's Approvals count and My approvals have a **Vendors to approve** group: the new vendors and
bank / GSTIN / PAN changes the signed-in user may decide (a named vendor approver, or the right while
nobody is named), never one they entered or asked for; each opens the vendor.
`GET /purchase/vendor-approvals?mine=1` (`approvalsMine`: rows of kind vendor | change with what
changes) is asked for every user like the other "anyone may be named" sources. The approvals queue, the
vendor page and both decisions are `@AuthenticatedOnly` with the check in the service (`mayView`: the
purchase view right or a vendor approver), so a named approver without a purchase role can open what
waits; the admin pages show 404 on the API's 403. Tests in `purchase-masters.e2e-spec.ts` (what the
admin, the office and the named approver each see).

## As built — the vendor's page: details and documents (7 Nov 2026)

Asked by the user on a vendor's page: show the vendor with its attached documents, which users can
view. The page now reads: Status, **Details** (`ep-facts`: legal / trade name, code and kind, GST with
the state code, PAN, MSME and Udyam, the address in one line, mobile and e-mail as links, payment term,
the categories it supplies by name, the bank account — in full for a vendor approver, else its hint —
and a contacts table), the change waiting, **Documents** (kind, PDF / photo, when added, View and
Download icons, what is not attached yet: GST certificate for a registered vendor, PAN card, cancelled
cheque when a bank account is given, Udyam certificate for MSME), then **Change the vendor** folded in
a `<details>`. A document opens through `GET /purchase/vendors/:id/documents/:docId/file` (inline;
`?save=1` saves), checked like the vendor page (the purchase view right or a vendor approver — no
`platform.files.view` needed), each opening audited (`purchase.vendor.document_view`); admin route
`api/purchase/vendors/[id]/documents/[doc]`. The vendor detail answer adds `categories` (id, name).
Test in `purchase-masters.e2e-spec.ts` (upload, inline / save, a teacher refused, another vendor's
number not found).

## As built — sub-category codes; the item's sub-category follows its category (7 Nov 2026)

Asked by the user on the two Add forms. **Item categories**: a sub-category's code is filled in from its
category as "Sub-category of" is picked — the category code, a hyphen and a 2-digit number (AV-01,
AV-02; typed codes counted; may be typed over); a main category keeps the short code typed (STAT, IT).
Migration 0330: `app.purchase_category_code(school, parent)` and the trigger
`purchase_item_categories_auto_code` (blank code under a category → the next one under an advisory lock;
blank code with no category → `purchase.category_code`). The registry's `autoKey` gains `whenEmpty`
(the problem when the key and its `from` fields are all blank), checked at the upload check and on the
form's save. **Items**: the Sub-category picker no longer shows its own "Category" narrowing box (which
listed sub-categories too): a drop-down narrowed by a parent that the same form picks follows that box
(`RefDatalist` `follow`; masters `RowForm` finds the sibling field), a pick not under the newly chosen
category is cleared, and the item code follows (ELEC-0001). Tests in `purchase-masters.e2e-spec.ts`
(next-key, made and typed codes, a main category refused, the upload).

## As built — any one or all at a level; the admin passes a level (7 Nov 2026)

Asked by the user on Purchase → Approvals. Decided with them (recommended options): **per level, any
one or all** of its people, and the **admin may pass a level on someone's behalf** (the PR skip rules
stay as they were).

- **Workflow engine** (any module may use it): `Level.need` 'any' (default) | 'all';
  `workflow_steps.approved_by` (migration 0331) keeps who approved a level that needs all. `act()`
  counts an approval (a delegate's for the one they stand in for), refuses a second
  (`workflow.already_approved`), passes the level when everyone needed has approved (the requester left
  out where `noSelfApproval`); one rejection rejects. `replan()` counts the level's people who approved
  it or an earlier level (no single earlier approver passes an 'all' level). `MAY_ACT` leaves out who
  already approved, so the inbox and the purchase "waiting for me" lists drop them. `passLevel(ctx, step,
  reason)` = `act(…, { pass: true })`: no assignee check, never on one's own request
  (`workflow.self_approval`), the note "Passed for <names>: <reason>", event kind `passed`, audit
  `workflow.step.passed`. Steps carry `need` and `approvedBy` (names).
- **Purchase**: the levels' `need` saved with each department level (an HOD level is always any one)
  and passed to the engine by `syncFlow`; right `purchase.approval.override` (school and group admin);
  `POST /purchase/steps/:id/pass` (only purchase approval steps).
- **Admin**: `ApprovalLevelsEditor` `allowAll` (purchase only): "Level N: when several hold it" — Any
  one of them approves / All of them must approve; the PI, PR, PO and receipt pages show each approver
  of an 'all' level with ✓ and "n of m have" (`StepApprovers`) and, for the admin, **Pass level N for
  them** with the reason (`PassLevel`).
- **Tests**: `purchase-indents.e2e-spec.ts` — an 'all' level (the first approver drops out of the
  waiting list, a second approval refused, the second approver passes the level), the admin passing the
  Principal's level with the note, a teacher refused, one rejection rejecting, nobody passing their own.
  Every suite on the engine passed (purchase, workflow, recruitment, exits, leave, gate passes: 158).

## As built — Purchase Indents on every role's page (7 Nov 2026)

Asked by the user ("purchase indent add every role in arrange my page"). Migration 0332 gives
`purchase.indent.raise` to the staff roles that lacked it (built-in Gate / Security, the schools' own
Front Office) and adds `/purchase/indents` to every saved role quick menu (`dashboard_role_defaults`,
not the portal and support roles). The admin landing's default tiles (`pinnedActions`, a role without a
saved quick menu) always include Purchase Indents for whoever may open it. Personal arrangements are
left as the user made them (the admin may push the role's page). Auditor, support and portal roles stay
without it.

Later the same day (E013 could sign in but held no role, so no right at all): decided with the user,
**every active employee who signs in may raise a PI**, role or not. `AccessService.EMPLOYEE_BASELINE`
(`purchase.indent.raise`) joins the effective permissions of any user with an active `employees` row in
the school; everything else still comes from roles. A user who is not an employee gets nothing from it.
Test in `purchase-indents.e2e-spec.ts` (a no-role employee's /me and their draft PI; an outsider empty).

## As built — rates hidden from the raiser; the stock when raised; the printed PI (7 Nov 2026)

Asked by the user ("item rate not show to creator, user can print PI, at the time PI is created show the
selected item's stock if available in store"); benchmarked on education ERPs and institutional indent
slips (ERPNext's Material Request shows the actual and projected quantity per warehouse; NIT / AIIMS
indent slips carry an "items in stock" column and HOD, Principal and store-keeper signatures). Decided
with the user: rates go to the approvers and the purchase office; the PI prints once sent as a full
slip; the free stock shows by store; when the stores cover the quantity the raiser gives a reason.

- **Who sees rates** (`RATE_RIGHTS` in `purchase-indents.service.ts`): the purchase office and the
  admins (any of `purchase.indent.view`, `.requisition.manage`, `.order.manage`, `.report.view`,
  `.settings.manage`), and the PI's approvers on the PIs they approve (a step's assignee, the one who
  acted, or their delegate — never the raiser; the `approver` column of the PI select). Everyone else,
  the raiser included, gets `estimate`, `estRate`, `amount`, `rateSource`, `contractVendor` and
  `departmentSpendThisYear` as `null`, `showRates: false`, and the bypass note without its amounts
  ("Auto-approved: within Science's limit"). The indent form's lists carry no rates for them
  (`showRates`). A raiser's typed rate is ignored: the line is priced from the rate contract, else the
  last purchase rate, else 0 (a line in words is 0 until the purchase office prices it on the PR).
  The approval's title no longer carries the amount (the raiser can open the approval); the purchase
  approvals list still shows it to the approvers.
- **No auto-approval while a line has no rate**: under the department's limit the PR is still made by
  the purchase office when any line is priced 0 ("Not skipped: some lines have no rate yet …").
- **The stock when raised** (migration 0333): `purchase_indent_lines.stock_free` (the free stock — in
  hand less reserved — of the item in the main store and the PI department's stores, in the store unit),
  `stock_stores` (store by store) and `stock_reason`. Noted on every save and again on sending. The form
  shows it under the item ("In the stores: 55 NOS free (Main store 45 · Science lab store 10)") from the
  form lists (`stockTracked`, `stockUom`, `perUnit`, `stock` per item: the main store and the stores of
  the departments the raiser may raise for). Other departments' stores are not shown.
- **A reason when the stores cover it**: on sending, a line whose quantity (in the store unit:
  quantity × the item's store units per unit) is within that free stock needs `stockReason` (3–300
  characters); otherwise `400 validation-failed` with `errors[{path: lines.N.stockReason}]`. The form asks
  for it as soon as the quantity is covered ("Why buy it? The store has enough"). The approvers, the PI
  page and the printed PI show it. The purchase office may still issue it from the store at the PR.
- **The printed PI**: `GET /purchase/indents/:id/pdf` (`?save=1` to download), anyone who may see the PI,
  once it has its number (a draft: 409 `purchase.indent_draft`). `purchase-indent-pdf.ts`: the school's
  band, the PI's details, per line the item, quantity, unit and the stock when raised (with the reason),
  rates and the estimate only for those who see rates, the approval trail as recorded, and boxes to sign
  for the raiser, head of department, Principal and store keeper; "NOT APPROVED" / "REJECTED" /
  "WITHDRAWN" across one not approved. Admin: **Print** (View and Download) on the PI page
  (`/api/purchase/indents/[id]/pdf`); staff app: on the PI's status card (`/api/purchase-indent/[id]`).
- Tests in `purchase-indents.e2e-spec.ts`: the raiser's form and PI without rates (the office's with
  them), the free stock by store (another department's store left out), the reason refused then given,
  no amount in the approval's title, the approver's rates and reason, the PDF (draft 409, raiser and
  approver 200, outsider 404), the bypass note without amounts, and a line in words not auto-approved.

## As built — the purchase officer's dev login; rate contracts on the PR (7 Nov 2026)

Asked by the user ("create a purchase officer role dev so this role converts to PR and PR to PO, and how
to show contract item price so in PR the purchase officer selects the contract price or enters a
price"). Decided with the user: a new dev login in Alpha; the contract filled in and changeable;
contract lines need no quotes and stay out of the band; dearer than the contract needs a reason.

- **dev-purchase** (Pooja Purchase): the built-in `purchase_office` role in Alpha, linked to employee
  **PO01** (Purchase Officer, Administration) — its own code, so the school's own employees (E021 and
  on) are never touched by a rerun. In `seed-demo.ts` (DEMO_USERS and the employee) and on the admin
  sign-in list (`demo-roles.ts`); created in the dev database once by hand (same rows).
- **Rate contracts on the PR** (`purchase-requisitions.service.ts`): `contractsFor(items)` gives each
  item's contract in force (active vendor; the lowest rate if several), with the GST the vendor charges
  (a regular vendor the item's rate, others none) and the landed cost. `fillContracts` puts the lines
  bought with no vendor yet on their contract (vendor, rate, GST, `contract_id`) when the PR is made
  and when its lines change; a line matched to another item, or marked from the store, loses its
  choice (and contract). Choices: `useContract: true`, or the contract's vendor named without a quote
  at its rate (or with none), puts the line on the contract; another vendor whose landed cost is above
  the contract's needs `reason` (`purchase.choice_reason`), kept in `choice_reason`. The PR's lines
  carry `contract` (the item's contract in force), `contractInForce` and `aboveContract`; the PR
  carries `contractValue`.
- **The band leaves out contract lines**: the tier is set by the larger of the estimated and chosen
  totals of the lines bought not on a contract; a PR of only contract and store lines is `none` (now
  labelled "No sourcing needed" — no quotes, certificate or tender). In the committee tier a contract
  line needs no quote and no L1 reason. A readiness check: the contracts the lines are on are still in
  force.
- The comparative statement shows the contract on each line and offers **Rate contract: vendor:
  ₹landed** first in the vendor list; the lines table and the staff app's PR show "On rate contract"
  and "Above the rate contract (₹…): reason". The PO already carries the contract and asks a reason to
  change its rate (part 4).
- Fixed on the way: "Not the lowest" was shown for any vendor other than L1's, even a cheaper agreed
  rate (with an empty reason); it now means dearer than L1 with GST.
- Test in `purchase-requisitions.e2e-spec.ts`: the line filled from the contract, the band without
  it, dearer refused then given a reason, cheaper with none, back on the contract (asked, or its vendor
  named), no contract refused, a contract-only PR sent with tier `none`.

## As built — list filters and exports; the letterhead; the printed PR (7 Nov 2026)

Asked by the user ("PI, PR and PO lists need filters — department, Purchase Indent, date from–to, status
— and export to Excel and PDF; the indent, PO and PR PDF header the same as the shared screenshot" — the
Term Mark Register's letterhead). Decided with the user: PI number and vendor filters on PRs and POs;
the file is the list plus a sheet of item lines; the letterhead on the PI, PR and PO prints and the list
files (other purchase PDFs keep their band for now); a full PR print.

- **Filters** (the list DTOs, all `z.object`): Purchase Indents `from`/`to` (sent, else started, in
  India) beside `departmentId`, `status`, `route`, `q`; Requisitions `departmentId` (its own, or for a
  combined PR a department one of its indents came from), `from`/`to` (made), `indent` (a PI number, or
  part of it, that went into it), `vendorId` (chosen on a line); Orders the same with the PO date and its
  vendor. Each service builds the WHERE once (`filterOf`) for the screen and the file.
  `GET /purchase/list-filters`: the departments one may see (every one for the purchase office, admins
  and any-department raisers; else one's own) and, for those who see rates, the vendors.
- **Files**: `GET /purchase/{indents,requisitions,orders}/export?format=xlsx|pdf` with the same filters,
  every row (at most 5,000: narrow the filters), base64 like the other exports; the admin route
  `/api/purchase/list-file?doc=…`. `purchase-list-file.ts`: the Excel has the letterhead rows (logo,
  school, address, the list's name, the filters and "Generated on"), frozen and filtered column heads,
  totals, and a **Lines** sheet (one row per item line: indent lines with the stock when raised; PR lines
  with vendor, rate, GST, on rate contract, the indents; PO lines with HSN, discount, GST, totals); the PDF
  is `tablePdf` with the new `letterhead` option (A4 landscape). A raiser's indent file has no estimate
  or rates.
- **The letterhead** (`common/pdf/letterhead.ts`, `drawLetterhead`): the logo on the left; centred the
  school's name, its full address (line 1, line 2, city, state, PIN — `registerLetterhead`), an optional
  line (the PO's GSTIN, State, telephone, e-mail; a long line breaks at its separators), the paper's
  title and a details line ("No. … · Department: … · Generated on: 07-11-2026 06:15 PM"). Used by the
  printed PI, PO and PR and the list files; `purchaseHead(c, storage)` loads it.
- **The printed PR** (`GET /purchase/requisitions/:id/pdf`, anyone who may open the PR;
  `purchase-requisition-pdf.ts`): its details (made on, department, purpose, needed by, the indents,
  sourcing, status, made by), the lines (vendor, rate, GST %, amount; on rate contract, above the contract
  or not L1 with the reason; from the store), the value before GST, the comparative statement when there
  are quotes (landed rates, L1 marked, the quotes' references), the certificate, the tender reference,
  the approvals, and boxes to sign for the purchase officer, the committee members (committee tier) and
  each approval level; "NOT APPROVED" / "REJECTED" / "CANCELLED" across. **Print** on the PR page (admin)
  and its status card (staff app).
- Tests: `purchase-indents` (dates and department; the office's file with the letterhead line, the
  estimate and the Lines sheet; the raiser's without; the PDF; list-filters for both),
  `purchase-requisitions` (indent, vendor, department, dates; the file's "Indent:" line and "On rate
  contract"; the printed PR for the indent's raiser, refused to someone else), `purchase-orders`
  (vendor, dates; the file's two sheets; the PDF).

## As built — indent items from Excel, line documents; direct PR without approval (8 Nov 2026)

Asked by the user ("on the new PI page the user uploads items by Excel and a document per line,
optional; a direct requisition is the purchaser's only and needs no approval"). Benchmarked on GFR 2017
(rule 154: a purchase under the limit without quotes on the competent authority's certificate; rule 157:
no splitting a demand). Decided with the user: the sheet fills the form (nothing saved); one optional
document per line; no approval up to a limit in Purchase settings with the split check; a new right held
by the Purchase office role.

- **The item sheet**: `GET /purchase/indent-sheet` (raise right; `templateSheet`: Item as a drop-down of
  "Name (CODE)", Quantity*, Note, Description and Unit for an item in words, a guide and examples);
  `POST /purchase/indent-sheet` `{file}` reads it (`readSheet`) into `{lines, errors}` — the item by the
  code in brackets, the code or the exact name; quantity > 0, whole for whole units; an item in words
  needs its description and a unit from the master; at most 200 lines; errors carry the row number.
  Nothing is saved. Both forms: **Download item sheet** (admin `/api/purchase/indent-sheet`, staff
  `/api/purchase-indent-sheet`) and **Upload the filled sheet** (server action `readIndentSheet`); the
  rows join the lines already filled (rates for those who see them), the bad rows listed.
- **Line documents**: `purchase_indent_lines.file_id` (there since 0317). `POST /purchase/indent-files?name=`
  takes the PDF/JPEG/PNG as the request body (the raise right — a raiser without `platform.files.upload`
  can attach; the API's JSON limit is 1 MB, raw bodies 25 MB), checks the type by its first bytes, up to
  5 MB, and stores it with the new `FilesService.storeBytes` (storage + the scanner + a `files` row,
  owner `purchase_indent_line`, ready). A line takes a file the signed-in user uploaded or one already on
  the indent. `GET /purchase/indents/:id/lines/:lineId/file` for anyone who may see the PI; the PR shows
  each source line's document (`sources[].indentLineId/hasDocument`) through
  `GET /purchase/requisitions/:id/documents/:indentLineId` for anyone who may see the PR. The printed PI
  marks "Document attached". Forms: a file box per line (server action `uploadIndentFile`, the bytes as
  the body), the name with **Remove**; PI and PR pages: View and Download icons.
- **Direct PR without approval** (migration 0334): right `purchase.requisition.direct` (Purchase office
  role); `purchase_settings.direct_pr_limit` (default 50,000; 0 off; the settings form);
  `purchase_requisitions.no_approval_note`. Making a direct PR (no indents) needs the right (403
  otherwise; the admin list shows **Direct requisition** and `/purchase/requisitions/new` only with it).
  On sending (`submit`), after the usual readiness checks (vendors, rates, the certificate for the direct
  tier, quotes for the committee), `directApproval`: a PR with no indent line, sent by someone with the
  right, worth (before GST) up to the limit, and not over it together with the direct PRs approved this
  way in the split window sharing an item category (rule 157) — is approved at once: status approved, no
  workflow, the note "Approved by the system: a direct requisition by the purchase office, ₹… within the
  limit of ₹…", store lines reserved, `approvedEffects` (indents from the store closed, draft POs per
  vendor). Otherwise it goes to the levels and the response says why ("over the limit", "with PR/… of the
  last 30 days …"). Reopening clears the note. The PR carries `direct`, `noApproval {limit, applies}`
  (the page says "Send (approved by the system)") and `noApprovalNote`. A PR from indents is never
  approved this way; POs keep their approval.
- Tests: `purchase-indents` (the sheet read: three good rows, three refused by row, nothing saved; a
  document uploaded by a raiser without file rights, a fake PDF and a wrong type refused, viewed by the
  raiser, refused to an outsider, kept on a re-save, someone else's file refused), `purchase-requisitions`
  (a school admin without the right refused; within the limit approved by the system with a draft PO and
  no steps; the split check at a 5,000 limit; over a 1,000 limit), `purchase-orders` sets the limit to 0
  (its direct PR follows the levels).

## As built — the PO format; clearer PO edit page (8 Nov 2026)

Asked by the user with a school's own printed PO ("Vendor's quotation, HSN not shown, or 'Take line 2 off
(back to To order)' — what do these mean; change the PO format as shared"). The shared PO's structure and
wording only were used (no names or data from it). Decided with the user: the shared layout; its columns
plus HSN and make / model; its totals with our GST summary kept; names and signature images.

- **Edit page**: "Vendor's quotation no. (optional)" with help (the vendor's own quotation number,
  printed as "Your quotation"); HSN / SAC with a pick-list of the HSN master (a `datalist`) and, when
  empty, "Not set on the item: type or pick the code (set it on the item in Masters → Items for next
  time)" — a PO line copies the item's HSN; in Alpha only 19 of 85 items have one; Make and Model per
  line; Freight terms and Note to the vendor; "Remove line N from this PO (it waits on To order)" with a
  tooltip (the line leaves the draft, nothing is cancelled; it can be ordered later or from another
  vendor). The PO page shows make/model, freight terms and the note.
- **Migration 0335**: `purchase_settings.bill_to_name`, `bill_contact_name/phone`, `ship_to_name`,
  `ship_contact_name/phone` (empty: the school); `purchase_orders.freight_terms`, `vendor_note`;
  `purchase_order_lines.make`, `model` (a drafted line takes its item's `brand` as the make; existing
  lines filled once).
- **The PDF** (`purchase-order-pdf.ts`, rewritten): a frame; logo left, PURCHASE ORDER (or EMERGENCY
  PURCHASE) centred, "Regular / Emergency PO No" and PO Date right; three blocks — Supplier (name and
  code, address, GSTIN or its GST status, State, contact person = the main vendor contact, phone,
  e-mail, MSME, bank name, the account number masked to its last 4 digits, IFSC — decrypted from
  `bank_secure`), Ship To (place, the PO's delivery address, contact), Bill To (legal name, billing
  address, GSTIN, State, contact); a line of the quotation, validity, requisition, department and supply;
  the table Sr.No, Item (code, "Desc:", "HSN/SAC:"), Item Make / Model, Quantity, UOM, Unit Cost, Disc %,
  GST%, Amount (before GST) and the other charges as rows; Sub-Total, Discount, Price After Discount,
  Tax, Price After Tax, Freight and Other Charges With Tax, Round Off, Grand Total; "Amount In Words:-
  Rupees … Only"; the reverse-charge note; the GST summary by HSN and rate; General Instructions (the
  PO's terms), Payment Terms, Freight Terms, Expected Delivery Date, MSME, Note; the signature boxes of
  `po_signatures` — the first with the preparer, the last with the last approver once approved, each with
  `employees.signature_file_id`'s image; "* This is a system generated document. Signature is not
  required *"; on every page the footer "legal name || Registered Office: … || GSTIN No: …" and "1 of
  n". PENDING across a PO not yet approved (was DRAFT).
- Settings form: Bill to (legal name), contact person and no. under Billing address; Ship to (place) and
  contact under Delivery address.
- Test: `purchase-orders` saves freight terms, the note, make and model and reads them back; the PDF
  test prints the new layout.

## As built — the PO e-mail; signatures with ID and time; instructions from settings (8 Nov 2026)

Asked by the user ("send the PO e-mail formatted; the PO PDF needs the approved date-time and employee ID
with the employee signature; General Instructions come from Purchase settings' Terms and conditions").
Decided with the user: a designed e-mail with the order box and items; replies to a purchase office
e-mail; every box with signature, name, ID and date-time (middle boxes = earlier levels); instructions
from settings, fixed on approval.

- **Migration 0336**: `purchase_settings.office_email`; `comms_messages.reply_to` (a message's own
  reply-to; the workers' SMTP adapter uses it before the provider's — `OutboundMessage.replyTo`, unit
  test in `comms-adapters.test.ts`; restart the workers once); the template "Purchase: order to the
  vendor" reworded (a school still on the first wording gets it; an edited one is kept) with
  `{{vendor_contact}}`, `{{bill_to}}`, `{{signatory_designation}}`, `{{order_summary}}`, `{{items}}`.
- **The e-mail** (`purchase-order-email.ts`): `emailLayout` gains options — the logo inline (the school
  logo attached as `school-logo.png|jpg`, shown by `cid:`), the address under the name, its own footer
  ("Questions about this order? Write to … or reply to this e-mail"); the template's paragraphs with the
  variables filled in (escaped); `{{order_summary}}` a box (PO number, date, deliver by, deliver to with
  contact, bill to with GSTIN, your quotation, payment, freight, total with GST); `{{items}}` a table (#,
  item with code/make/model, qty, unit, rate with discount, amount; the first 25 lines, then "… and N
  more lines in the attached PO"; before GST, GST, charges, total). A template without the two boxes gets
  them after its first paragraph. Reply-to: the purchase office e-mail, else the school's.
- **Signatures**: `signer()` — the box's person (the PO's maker for the first, with "Prepared on" its
  sending for approval; the approved workflow steps in level order for the rest, "Approved on" the
  step's time; the last box the final approver once approved; the middle boxes the earlier levels) with
  the employee code and designation, the date-time in India and the signature image from
  `employees.signature_file_id`. The PDF box: signature, bold name, "Emp. ID … · designation", the time,
  the box's label.
- **Instructions**: the PO form no longer edits them (shown read-only with a link to settings); the update
  stops writing `terms`; approval sets `terms` from `purchase_settings.po_terms`; the detail and the PDF
  show the settings' text until the PO is approved (or superseded, cancelled), then its own. The settings
  field says so.
- Test: `purchase-orders` — the e-mail's reply-to, its order box and items, no `{{` left; the approved PO
  keeps the instructions it was approved with while a draft follows a change of the settings.

## As built — the PO's sourcing and amendments for its approvers (8 Nov 2026)

Asked by the user (a screenshot of the PR's quotes and comparative statement: "on the PO page approval
needs to show this data; and in the amendment case the old PO can be viewed"). Decided with the user:
this PO's lines; the admin and staff app PO pages.

- **`sourcing`** on `GET /purchase/orders/:id` (`sourcingOf`): the PO's requisition (number, tier, auto
  rule, the price certificate with who and when, the tender reference, the committee with who signed);
  the quotes of the vendors who quoted any of this PO's lines (vendor, GST status, MSME, reference, date,
  validity, delivery, a document, `thisPo`, and what these lines come to with GST); per PO line each
  quote's rate, GST and landed cost with L1, the vendor chosen and its landed cost, the rate contract,
  the choice's reason and `notL1`. **Why this vendor** card (admin `components/purchase/OrderSourcing.tsx`,
  staff app `components/OrderSourcing.tsx`); quote documents through `GET
  /purchase/orders/:id/quotes/:quoteId/file` (admin `/api/purchase/orders/[id]/quotes/[quoteId]`, staff
  `/api/purchase-order-quote/[id]/[quoteId]`) — an approver who cannot open the PR still sees them.
- **`amendment`** (`changesFrom`): the PO it replaces (id, label, status), the reason, and what changed —
  the total, deliver by / to, payment, validity, quotation, freight terms, the note, other charges, and
  line by line (matched by the requisition line, else the words) quantity, rate, discount %, GST %,
  words, lines added and taken off. **What changed from …** card with the link to the old PO and its PDF.
- **Every revision visible to those on any revision's approval** (`ANY_REVISION` replaces `PARTICIPANT`
  in `load()`: the PO and its PDF), so an amendment's approver opens the PO it replaces.
- In-text links on the PO page are underlined (the requisition in the facts; axe link-in-text-block).
- Test: `purchase-orders` — R1 carries the amendment (R0, the reason, the changes) and its sourcing
  lines; a user put on R1's approval opens R0 and its PDF (404 before).

## As built — the PO page: figures and folding cards (8 Nov 2026)

Asked by the user ("rebuild the UI of the PO page; What changed from PO / Why this vendor hidden until the
user clicks"). Decided with the user: **summary + folding**, **all but the essentials folded**, the same
in the staff app.

- **Figures first** (`ep-doc-kpis`: 2 / 3 / 6 across, `KpiTile`): total with GST (before GST as the hint),
  lines (other charges), deliver by (the receipt status while receiving, else the PO's validity),
  payment (the GST mode and freight), quotes · L1 (from `sourcing`: quotes, L1 on every line or on n of
  m quoted lines, else the tier), revision (R n and the PO it replaces). Then **Status and actions** (the
  waiting-with line, notes, MSME warning, an open amendment as an info alert, who made / approved /
  sent / closed it, the buttons), then **Send to the vendor** when it can be sent.
- **Folding cards** (`FoldCard` in admin `components/FoldCard.tsx` and staff `components/FoldCard.tsx`:
  `<details class="ep-card ep-fold">`, the `<summary>` bar holds the card's `h2` and a one-line hint, a
  chevron that turns; CSS `.ep-fold*` in `packages/ui/src/app.css`). Open: **Lines** (always a card),
  **Approvals** while `submitted`, **Deliveries** while `approved` / `sent`. Folded with a hint: **What
  changed from …** (n changes, the first three, the reason — `amendmentHint`), **Why this vendor** (tier,
  quotes, L1, certificate, committee signed — `sourcingHint`, `l1Count`), **Vendor and terms**, **GST
  summary** (now its own card, out of Lines), **E-mails sent**, **Revisions**, **History**.
- Admin order: figures, status and actions, send, what changed, why this vendor, lines, deliveries,
  vendor and terms, GST summary, e-mails, revisions, approvals, history — in `ep-doc-stack` (the cards
  spaced). Staff app: figures, status, your decision, what changed, why this vendor, lines, approvals
  (new on the staff page: each level, who, when, the note).
- The figures carry the revision and the payment, so the status card no longer repeats them; the page
  header reads vendor · date.
- Checked in a browser (dev-purchase admin, dev-principal staff; 1440 and 375 wide): axe clean with the
  cards folded and opened; the hints on PO 381 as above.

## As built — a PO line for less than the requisition needs (8 Nov 2026)

Asked by the user (PO 345 edit: "required quantity 2 but not in stock, so the purchaser changes the
quantity — how is it managed?"). Before: the quantity could already go down to any amount (capped at
what the requisition still needs), but silently — no reason, the rest drifted to To order with nothing
saying why, it could never be closed, the PR stayed "Partly ordered" and the indent's raiser was not
told. Decided with the user:

| Question | Decision |
| --- | --- |
| The rest | **The purchaser picks per line** on saving: **order later** (waits on To order) or **close it** (not to be ordered). |
| Reason | **Required, from a list**: vendor short of stock, sold in packs, over budget, no longer needed, other (with a note). |
| More than the requisition | **No**: the cap stays; buying more needs a new indent. |
| Who sees it | **On the PI in the app** (page and list), quantities only; no SMS / e-mail. |

- Migration **0337**: `purchase_order_lines.short_reason` / `short_note` / `close_rest` (a close needs a
  reason; Other needs a note); `purchase_requisition_lines.closed_reason` / `closed_note` / `closed_by`
  / `closed_at` (closed on To order).
- `purchase-order-core.ts`: `CLOSED_REST` (closed on To order, or by a **live** PO line with
  `close_rest` — so a cancelled or rejected PO gives the whole line back to To order, and an amendment
  copies the choice), `TO_ORDER` (bought, not all on live POs, rest not closed) used by To order, its
  count, drafting from it, the dashboard and the drafts made on approval; `CLOSED_PLACED` (closed on
  To order or by a **placed** PO line) makes `refreshOrdered` count the line as done for the PR's
  **Ordered** status and the indent's route. `LINE_ORDERING` + `orderingWords`: "Ordered 3 of 4 NOS on
  PO/… · the rest closed: No longer needed" / "· the rest to order later: …" / "· the rest still to
  order" — on the PI's lines (`ordered`; "(the requisition line also covers other indents)" when
  consolidated) and the PR's lines. The PI list row's `partClosed` ("Ordered · part closed").
- `PUT /purchase/orders/:id`: a line below `max_qty` needs `shortReason` + `shortAction` (`later` |
  `close`), Other a `shortNote` (`purchase.short_reason`, 400); a line back at full clears them. The
  amendment's copy now also keeps make and model (it dropped them before). **What changed** adds the
  reason and the rest's fate to a lowered quantity.
- `POST /purchase/to-order/close` {lineIds, reason, note} (purchase.order.manage): lines still to order
  closed with the reason (409 when one no longer waits); the PR / indents refreshed; audited
  `purchase.to_order.close`. To order lines carry `needed` and `short` (which PO took less, and why).
- Admin: the PO form's amber box under a lowered line (why, note, the rest: order later / close);
  the PO page's line note; To order shows "(of N)" and why, and **Close lines not to be ordered**
  (`ConfirmAction` gains `select` and an optional reason); the PR and PI pages show each line's
  ordering; the PI list "· part closed". Staff app: the PO page's line note, the PI page's line
  ordering, the PI list "· part closed". The To order card title's PR link is underlined (axe).
- **More than the requisition** (asked the same day: "show the error's why and explain"): the API's
  refusal is `purchase.over_requisition` — "Ball pen, red: 5 BOX is more than PR/… leaves for this PO (1
  BOX). A PO orders only what was indented and approved; to buy the extra 4 BOX, raise a new indent."
  (quantities without trailing zeros; "the rest is on other POs" when nothing is left). The PO form
  says it as you type: the help "Up to 1 BOX: what PR/… leaves for this PO", the quantity marked
  invalid with "4 BOX more than the approved requisition … raise a new indent" (linked), and Save
  stopped with the full sentence before anything is sent.
- Tests: `purchase-orders` — refused without a reason and for Other without a note; later vs close
  on To order; the PR part ordered with each line's words; closing on To order (403 for a teacher,
  400 Other without a note, 409 twice) makes the PR ordered; a rate-contract indent's line ordered 6 of
  10 with the rest closed shows on the teacher's PI (no rates) and the list's `partClosed`.

## As built — GST follows the HSN master (8 Nov 2026)

Asked by the user (PO/2026-27/0003: "the purchaser applied an HSN code but GST is not applied — why?").
Found: the item "Ball pen, red" had no HSN and no GST, so the PR and the PO line came at 0%; on the PO
form the HSN / SAC box and the GST % box were independent (the code only showed its description); the
code typed, 1234, was itself "16%, exempt" in the HSN master (16% is no slab; exempt means no GST); and
the line's exempt / reverse-charge flags still came from the item, not the code. Decided with the user:

| Question | Decision |
| --- | --- |
| GST from HSN | **Follows the HSN master**: a code in the master sets the line's GST %, exempt and reverse charge (GST % fixed); a code not in it keeps the GST % typed. |
| The item's HSN | **Filled from the PO when the item has none**; an item's HSN is never replaced from a PO. |
| HSN master | **Exempt = 0%, GST slabs only** (0, 0.25, 1.5, 3, 5, 12, 18, 28, 40); old wrong rows listed, not changed. |

- `PUT /purchase/orders/:id`: per line, the active HSN row of `hsnCode` gives `gst_rate` (0 when exempt;
  the item's own `gst_rate` when the code is the item's own HSN), `exempt` and `reverse_charge`; no row:
  the typed GST %, not exempt, no reverse charge. An item with `hsn_id IS NULL` takes the code's row
  (audited `purchase.item.hsn_from_po`). Lines carry `itemHsn` and `itemOwnGst`.
- PO form: the GST % follows the code as it is typed or picked (shaded, read-only, "From HSN / SAC …",
  "Exempt (HSN / SAC …)", "· reverse charge: the school pays it"), and shows the master's rate when the
  page opens; a code not in the master says to type the GST % and add the code; "saved on the item too"
  when the item has none.
- HSN master: `GST_SLABS` (packages/db `masters.ts`); the masters engine gains `allowed` (a number one of
  a list) and `zeroWhen` (0 when a yes/no field is yes; a cross-check), used by the HSN / SAC codes'
  GST %. Migration **0338**: `purchase_hsn_gst_slab` and `purchase_hsn_exempt_no_rate`, both `NOT VALID`
  (old rows stay until changed). `GET /purchase/overview` `hsnToFix`, shown on Purchase set-up as
  **HSN / SAC codes to fix** (Alpha: 1234 16% exempt, 9609 18% exempt — left for the school to correct).
- PO/2026-27/0003 itself was already sent for approval: its line stays at 0% unless sent back and saved
  again (where HSN 1234, being exempt, still gives 0% until the code is corrected).
- Tests: `purchase-orders` — a code not in the master keeps the typed GST; 9403 gives 18% (CGST + SGST)
  whatever was typed; the pen without an HSN takes 9403 and keeps it when the PO later carries another
  code; a reverse-charge SAC sets reverse charge. `purchase-masters` — 16% refused (the slab list), 18%
  exempt refused, 0% exempt and 18% saved, nothing to fix on a clean school.

## As built — direct requisition items from Excel (8 Nov 2026)

Asked by the user ("Direct requisition: upload items by bulk Excel"). Decided with the user:

| Question | Decision |
| --- | --- |
| Columns | **Item (drop-down or code), Quantity, Est. rate (₹), Note**; an item not in the list by Description + Unit. Vendors and quotes stay on the PR's sourcing page. |
| Upload | **Fills the form to check**, like the indent's sheet: nothing saved; bad rows by row number; the same item twice is one line (quantities added). |
| Where | **New direct PR and a draft / sent-back PR** (rows added; lines from indents stay). |

- `purchase-item-sheet.ts` (new): `itemSheetBytes` and `readItemRows` with a `SheetKind` (tab, file, the
  rate column, merging) — the indent's sheet now uses it unchanged (no rate, no merge). The
  requisition's: tab "Requisition items", `requisition-items.xlsx`, **Est. rate (₹)** (a number ≥ 0,
  empty = the item's list rate on the form), merging the same item (quantities added, notes joined;
  another rate for it refused: "… is also on row N at another rate: one rate per item").
- `GET` / `POST /purchase/requisition-sheet` (`purchase.requisition.manage`); admin
  `/api/purchase/requisition-sheet` and `readRequisitionSheet`. `RequisitionForm`: Download item sheet,
  Upload the filled sheet; a sheet item already on a PR line of its own (not from an indent) adds to its
  quantity (its rate replaced when the sheet gives one); "N lines added …; M lines already on the
  requisition got the quantity added: check them before saving". The indent form's "Rows not added" box
  laid out as one block (it sat side by side).
- Test: `purchase-requisitions` — a teacher cannot download it; the header row; two pen rows at one rate
  plus one with no rate merge (15, notes "Blue; Red"); a second rate refused by row; a negative rate
  refused; an unknown item listed; nothing saved. Browser: Direct requisition fills 2 lines from a
  sheet (the pen 3 + 2 at ₹55, a Bunsen burner in words), the bad row listed; axe clean.

## As built — the emergency purchase form (8 Nov 2026)

Reported by the user (a screenshot: "lines: Array must contain at least 1 element(s)" on Record an
emergency purchase, the form empty). Cause: the page was a plain server form of six fixed table rows;
its action dropped any row without item-or-words, quantity **and** rate (the Rate and GST % columns sat
off to the right of a wide table), so the API got no lines; the refusal was zod's own words; and the
redirect back emptied the form, the chosen bill too.

- `components/purchase/EmergencyForm.tsx` (client): the purchase's fields, the bill kept in the form
  ("Attached: bill.pdf"), lines as cards (item, or "Not in the list" with words and unit; quantity with
  the item's unit; rate before GST; GST % with the item's rate as the placeholder; the amount), **Add a
  line** / **Remove line N** (up to 50), the total before GST. Checked before sending, by name: "Pick the
  vendor.", "Say why it could not wait (at least 10 letters).", "Attach the vendor's bill…", "Add what
  was bought…", "Line 1: the rate (₹, before GST) is missing.", "Line 2: pick the unit." …
- `recordEmergency` returns a result (the bill uploaded, then the purchase) instead of redirecting, so a
  refusal keeps everything typed; on success the PO page opens with "… recorded: send it for
  ratification".
- `EmergencySchema` says it in words: "Add what was bought: at least one line with the item, quantity
  and rate", "Say why it could not wait (at least 10 letters)". The switched-off notice's settings link
  is underlined.
- Test: `purchase-orders` — no lines and a short reason refused with those words. Browser (nothing
  recorded): a line without its rate and a line in words without its unit are each named; the reason and
  the bill stay; axe clean.

## As built — set-up in sections, out of the menu (8 Nov 2026)

Asked by the user ("on /purchase use sections; Items / HSN, Vendors, Purchase settings, Who approves not
in the side menu: their links move to Purchase set-up"). Decided with the user: **all set-up links** leave
the menu; **section cards with links**.

- Menu (`apps/admin/lib/nav.ts`): Purchase keeps **Purchase set-up** (`/purchase`) only; Vendors, Vendor
  approvals, Items units and HSN, Payment terms, Who approves and Purchase settings are gone from it (their
  pages and rights unchanged; Vendor approvals is also in the Approvals inbox). The shell's `ALSO` makes
  `/masters/purchase` light up Purchase set-up; the other set-up pages already do (the longest `/purchase`
  prefix).
- `/purchase`: the figures, the waiting and HSN-to-fix notices, then `.ep-setup-sections` (auto-fit cards):
  **1. Rules and approvals** (Purchase settings, Who approves, Purchase committee), **2. Items and GST**
  (Units, HSN / SAC codes — "N to fix" when any, Item categories, Items, Rate contracts — optional, no
  badge, Payment terms), **3. Vendors** (Vendors with the blacklisted count, Vendor approvals — "N waiting"
  when any); each link Done / To do and what it holds. Then Copy from another school.
- Breadcrumbs start at **Purchase set-up** on Vendors (list, new, one vendor), Vendor approvals, Payment
  terms, Who approves, Purchase settings, and on `/masters/purchase` (Items, units and HSN). In-text links
  of the notices underlined.
- Checked in a browser (dev-purchase): none of the six in the menu, Purchase set-up there once; the three
  sections; Vendors, Items / HSN and Settings highlight Purchase set-up and lead back to it; axe clean.
- Later the same day ("Emergency purchase, To requisition, To order: not in the side menu"): those three
  left the menu too. They open from their lists' buttons — Purchase Requisitions → **To requisition (N)**
  (was "From indents"), Purchase Orders → **To order (N)** and **Record an emergency purchase** — and the
  shell's `ALSO` lights up Purchase Requisitions / Purchase Orders on them; their breadcrumbs already led
  back.

## As built — store menu, store documents like the indent's, the store keeper's dev login (8 Nov 2026)

Asked by the user: "To receive, Stock in hand not in the side menu; the GRN PDF like the indent's; a store
keeper dev login". Decided with the user: **GRN and all store slips**; GRN boxes **like the PO's**;
**dev-store, keeper of the Main store**.

- Menu: To receive and Stock in hand left it; Goods receipts → **To receive** (renamed from "Receive
  against a PO") and Stores → **Stock in hand** open them; the shell's `ALSO` lights up Goods receipts /
  Stores on them (`/purchase/stock/…` too).
- `purchase-doc-sign.ts` (new): `SignBox`, `signerOf` (by user or employee: Emp. ID, designation, the
  signature on the employee record, "Received on 08-11-2026 04:11 PM"), `blankBox`, `whenOf`,
  `drawSignBoxes` (rows of up to four, as on the PO; a long designation goes under the ID). The PO's own
  signer now uses `signerOf`.
- GRN / completion certificate PDF: `drawLetterhead` as the indent (title, "No. … · Generated on: …"),
  the details, lines and value as before, then boxes: **Received by** (the receipt's maker, when made),
  **Inspected by** per decided step ("Accepted on" / "Rejected on") or each committee member who signed
  ("Signed on"), an empty Inspected by while none has, then **Head of department** and **Principal**
  empty; "Printed …" and the page number at the foot. Data from `purchaseHead` (the register letterhead).
- Store slips (`purchase-stock-pdf.ts`: issue slip, return note, transfer note, count sheet,
  condemnation): the same letterhead and boxes; `pdfSchool` now gives the register letterhead and
  `generatedOn`. Their boxes carry the names and dates the slips knew (no Emp. ID / signature lookup yet).
- **dev-store** "Sunil Store": demo seed user + employee **SK01** (Store Keeper, Administration), the
  built-in **Store keeper** role in Alpha, keeper of the **Main store** (MAIN) when it exists; in the admin
  and staff sign-in lists; applied to Alpha now.
- Checked: purchase suites 89/89 (then receipts, issues, stores, assets, orders 42/42 after a slip fix);
  Alpha's GRN/2026-27/0001 and a sample issue slip rendered and looked at; dev-store signs in, its menu
  has neither entry, the buttons open them with the parent lit; axe clean.
