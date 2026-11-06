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
