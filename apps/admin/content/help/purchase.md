# Purchase

Staff ask for what their department needs on a **Purchase Indent (PI)**; the department's approvers
decide it in turn; the purchase office turns approved PIs into a **Requisition (PR)** and an **Order
(PO)**. This page covers the masters they pick from (units, HSN / SAC codes with GST, item categories
and items, payment terms, vendors, rate contracts, who approves, the settings), the PI, the PR, the
PO, the emergency purchase, the stores and receiving what was ordered.

## Who does what

| Who                                                  | What                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Purchase office** (its own role)                   | Keeps items, units, HSN codes, categories, payment terms, rate contracts; adds and changes vendors   |
| **Someone with vendor approval** (the school admin)  | Approves a new vendor and a change of a vendor's bank account, GSTIN or PAN — never one they entered |
| **School admin**                                     | Settings, the purchase committee, who approves per department, the bypass rules                      |
| **Any staff member** (teachers, office staff)        | Raises PIs for their own department, in the admin or the staff app                                   |
| **The department's approvers** (HOD, Principal…)     | Approve, send back or reject the PIs at their level; hand their approvals to a colleague when away   |
| **Purchase office** (requisitions)                   | Makes PRs from approved PIs (or directly), enters quotes, chooses vendors, sends PRs for approval    |
| **The purchase committee** (named in settings)       | Signs the comparative statement of a PR in the committee tier, in the admin or the staff app         |
| **Purchase office** (orders)                         | Checks the draft POs, sends them for approval, e-mails them to vendors, closes and amends them       |
| **School admin** (orders)                            | Cancels an approved PO (its own right)                                                               |
| **The Principal** (or the designation in settings)   | Ratifies an emergency purchase                                                                       |
| **Auditor** (read only)                              | The purchase dashboard and reports                                                                   |
| **Store keeper** (its own role, per store)           | Keeps the stores given to them: opening stock, receipts, issues, returns, transfers and counts       |
| **The department's inspectors** (the HOD by default) | Inspect and accept what was received for the department's POs, in the admin or the staff app         |
| **Whoever took it, the indent's raiser or the HOD**  | Acknowledges what the store issued to the department (admin or staff app)                            |
| **School admin** (stores)                            | Approves physical counts (never one they took part in)                                               |
| **The condemnation committee** (named in settings)   | Signs the recommendation to write off unserviceable, obsolete or surplus assets and stock            |
| **School admin** (condemnation)                      | Approves the write-off (never one they proposed)                                                     |
| **Whoever keeps an asset**                           | Acknowledges an asset handed to them; sees what is in their care (staff app)                         |

## Set it up, in this order

**Purchase → Purchase set-up** lists the steps with what is done:

1. **Purchase settings** — the school's **GSTIN** (optional; it gives the school's state: a vendor in
   the same state is charged CGST + SGST, one in another state IGST — without a GSTIN the billing
   address's state decides), the **billing address** (printed on the PO: the line, then country, state
   and city from Masters → Countries / States / Cities, and the PIN, filled from the city; it must be in
   the GSTIN's state) and the **delivery address** (the same as the billing one unless you untick it and
   enter its own), the
   numbering (PI / PR / PO prefixes, restarting each financial year), the **sourcing limits** (direct
   purchase up to ₹50,000 with one quote and a reasonable-price certificate; up to ₹2.5 lakh at least 3
   quotes and the purchase committee's signed comparative statement; above that a tender reference —
   the GFR 2017 figures, change them if your school follows its own), **emergency purchase** on or off,
   the PO's validity, terms and signatures, the department whose levels approve a PR combining
   departments, the large-PO list and the split window. Every box is checked as you leave it and when
   you press **Save the settings**, the problem shown under it (a prefix per document, the committee
   limit at least the direct one, the committee's signatures no more than its members, days from 1 to
   365 …). The **Vendor approval** card names who approves vendors (see Vendors).
2. **Items, units and HSN** (Purchase → Items, units and HSN, the tabs **Units**, **HSN / SAC codes**,
   **Item categories**, **Items**, **Rate contracts**): every tab has Add, Edit, Excel upload with a check
   before saving, Excel and PDF of the list. The HSN list starts short on purpose (school stationery,
   books, maps, computers): add the codes of what the school buys, with the GST rate, and tick **Reverse
   charge** where the school pays the GST itself (e.g. an advocate's legal services) or **Exempt for the
   school**. Confirm every rate with the school's CA. Categories have two levels: a category and its
   sub-categories. A sub-category is a row of **Item categories** with **Sub-category of (category)**
   filled (e.g. ELEC-LIGHT "Lights and fans" under ELEC); leave it empty for a main category. A main
   category's **code** is the short one you type (STAT, IT); a sub-category's is filled in from its
   category as you pick it — AV-01, AV-02 … (type over it if you prefer, e.g. AV-DISPLAY). Item codes
   start with these codes. An item
   has a code, a type (consumable, asset, service), its category (and sub-category), its unit and its
   HSN / SAC (its GST rate comes from there unless the item has its own).
   **Item codes are made for you**: on **+ Add**, picking the category fills the next code, and the
   sub-category (its list shows only the sub-categories of the category picked) narrows it — ELEC-0001, then ELEC-LIGHT-0001 (numbered per sub-category; a sub-category
   code that already starts with its category's is not repeated, so PENS under STAT gives
   STAT-PENS-0001). Type over it to keep the school's own code. A code left as filled is given again
   when you save, so two people adding at once never get the same one. In an Excel upload, leave
   **Item code** empty for a new item; a row with an existing code updates that item. A code never
   changes afterwards, even if the item moves to another category.
3. **Payment terms** — a term is one or more instalments that add up to 100%: each a share, due **in
   advance**, **after delivery** or **after the invoice**, and after how many days ("50% in advance, 50%
   15 days after delivery"). One is the school's default. A term whose longest wait is over 45 days is
   marked: micro and small suppliers must be paid within 45 days. Filter the list by **Search**,
   **Status**, **Pays** (has an advance / after delivery / after the invoice) and **Longer than 45
   days**; **Excel** and **PDF** give the list with those filters. **Upload payment terms from Excel**:
   the format comes filled with the school's terms, one row per term with up to four instalments across
   (%, due on, days); correct or add rows, **Check**, then **Save the good rows** — a code already there
   updates its term (purchase orders already made keep what they printed). A term with more than four
   instalments is changed on the screen.
4. **Vendors** — see below.
5. **Who approves** — pick a department: up to three levels each for its **PIs**, **PRs** and **POs**
   (named employees, everyone with a designation such as Principal, or the department's HOD), with how
   many hours a level has before the step moves on. A level nobody holds is skipped; the screen says
   which levels would be skipped (no HOD set, nobody who can sign in). **When a PI skips the PR**: under
   an amount, or when every line is on a rate contract (the PR is then made and approved by the system,
   with the rule written on it).
6. **The purchase committee** (Purchase settings, at the end) — the members who sign comparative
   statements, and how many must sign.

A school of a group can **copy** units, HSN codes, categories, items, payment terms and vendors from
another school of the group (Purchase set-up, at the end). Codes the school already has stay as they
are; copied vendors wait for approval here.

## Vendors

- **Add vendor**: code, legal and trade name, kind, payment term, the categories it supplies, the GST
  status and **GSTIN** (checked, its last character too; the **PAN** and the state are read from it),
  MSME (micro / small / medium with the Udyam number), the address, mobile, the e-mail the PO goes to,
  contacts and the **bank account** (stored encrypted; screens show only the bank, the last four digits
  and the IFSC).
- **The code is filled in** (V-0001, V-0002 …): leave it and the next free one is given when you save,
  or type the school's own.
- **Required** (marked \*): legal name, kind, GST status, the GSTIN of a registered vendor or the PAN of
  an unregistered one, address, country, state, city, PIN, mobile, e-mail, and the main contact's name
  and mobile. The bank account is optional; once you start it, the bank, IFSC, account number (typed
  twice) and holder are all needed.
- **Picked from the masters**: country, state and city come from Masters → Countries / States / Cities
  (India and its states are there already; a missing city is added in **Cities**, under its state — the
  form has a link for those who may); the bank from **Banks** (Fees set-up). A registered vendor's state
  is its GSTIN's and is picked for you; a city fills its PIN.
- **Checked as you type**: each box says what is wrong under it when you leave it, and all of them when
  you press **Add vendor** — PIN six digits, mobile 10 digits starting with 6–9, a valid e-mail, the
  Udyam number like UDYAM-MH-12-1234567, the IFSC of the bank chosen (SBI's start SBIN), an account
  number of 9 to 18 digits typed the same twice. The server checks the same again.
- A new vendor **waits for approval**: someone with vendor approval opens **Vendor approvals** (or the
  vendor), checks the GSTIN, PAN and bank account against the documents, and approves or rejects (with a
  reason). Whoever entered or last changed a waiting vendor cannot approve it. Until it is approved a
  vendor cannot be used on a PR, a PO or a rate contract.
- **Who approves vendors**: **Purchase → Settings → Vendor approval**. Add the employees (who sign
  in) who approve new vendors and bank / GSTIN / PAN changes: then only they approve. While nobody is
  named there, anyone whose role has the right **Approve a new vendor** approves (School Admin and Group
  Admin by default; roles are changed in **Access → Roles**). The card lists who can approve now.
- **The header's Approvals icon** counts the new vendors and bank / GSTIN / PAN changes waiting for
  you (**Vendors to approve** in My approvals) — only when you are a vendor approver, never what you
  entered yourself. A named approver opens Vendor approvals and the vendor from there even without a
  purchase role.
- On an approved vendor, a new **bank account**, **GSTIN**, **PAN** or **GST status** waits for approval
  the same way (with the reason for the change); the old details stay in force until then. Everything
  else (name, address, contacts, categories, term) changes at once.
- **Same GSTIN, PAN or bank account as another vendor**: the form names the other vendor and asks why;
  it is saved only with a reason.
- **The vendor's page** shows its **Details** (names, code and kind, GST, PAN, MSME, the address,
  mobile and e-mail, payment term, what it supplies, the bank account — in full only to a vendor
  approver — and the contacts), then its **Documents**, then **Change the vendor** (folded; open it to
  edit).
- **Documents**: upload the GST certificate, PAN card, cancelled cheque, Udyam certificate or an
  agreement (PDF or photo, up to 5 MB) — View opens it in the browser, Download saves it. Anyone who
  can see the vendor (the purchase office, a vendor approver) can open them, without a separate file
  right; each opening is recorded. The card says which of the usual papers are not attached yet.
- **Make inactive** (not offered on new PRs and POs), **Blacklist** (with a reason: never offered),
  **Make active** again.
- **Import from Excel**: download the format — required columns are marked \*, kind, GST status,
  country, state, city, payment term and bank are drop-downs from the masters, every column has a note,
  and a **How to fill** sheet lists the rules. Fill one row per vendor (leave **Code** empty for the next
  one), **Check** (every row is checked with the same rules as the form; a problem names its column),
  then **Import the good rows**. Bank details may be included; imported vendors wait for approval.

## Rate contracts

An agreed vendor and rate for an item for a period (Items, units and HSN → Rate contracts): one contract
per item on any day, only with an approved vendor. A PI whose lines are all on rate contract can skip the
PR (when the department allows it) and the PO takes the contract rate.

## Purchase Indents

**Purchase → Purchase Indents** (in the staff app: **Office → Purchase indents**).

- **Raise an indent**: the department (your own, from your employee record; the purchase office picks
  any), **for a colleague** if you raise it for someone, **needed by**, the **purpose** and the
  **priority** (urgent ones are listed first). Each line is an item from the list, picked by category
  (its rate comes from its **rate contract**, else its **last purchase**; type your own estimate if you
  know better — **Use ₹…** goes back to the list rate) or **Not in the list: describe it** with its unit
  (the purchase office matches it on the PR). Items counted in whole units take whole numbers. The
  estimate adds up as you type.
- **Save as draft** keeps it to finish later; **Save and send for approval** gives it its number
  (PI/2026-27/0001, restarting each financial year) and sends it to the department's first level.
- **Approvers** see it under **Waiting for me** (and in My approvals): the amount, the lines with
  where each rate came from, and the department's approved indents this year. **Approve** sends it to
  the next level; **Send back** (say what to change) returns it to the raiser, who changes it and sends
  it again through every level; **Reject** (with the reason) closes it.
- **Nobody approves their own**: a level held by the raiser **passes on** to the next level; when the
  last level is the raiser's, the school admin decides. A level nobody holds is skipped.
- **Withdraw**: the raiser withdraws a draft, one sent back, or one nobody has approved yet.
- **Where an approved PI goes** (the department's rules on Who approves):
  - **every line on a rate contract** (when allowed) — a PR is made and approved by the system with the
    contract vendor and rate on each line; the PI waits for the PO (**PR skipped: for the PO**);
  - **within the department's limit** — the same, unless the department's earlier PIs that skipped the PR
    by the limit in the split window (Purchase settings, 30 days) share an item category with it and
    together go over the limit: then it says so ("Not skipped: …") and waits for the PR — this stops a
    large purchase being split into small ones;
  - **otherwise** it waits for the purchase office's PR (**Waiting for the PR**).

## Purchase Requisitions

**Purchase → To requisition** lists the approved PIs waiting for the purchase office. Tick the ones to
buy together and **Make a requisition**: the same item's lines are added up into one line and each PI
stays linked to it. PIs of several departments make a **combined** PR, approved by the department set
on Purchase settings ("the department whose levels approve a PR combining departments"). **Close** a
PI you will not buy (issued from stock, no longer needed) with the reason; its raiser sees it.
**Direct requisition** (Purchase → Purchase Requisitions) is for a need that did not come through a PI.

On the PR:

- **Change the lines**: match a line asked for in words to an item from the list, change a quantity,
  or mark a line **From the store** (no vendor needed): an item kept in stock names the **store** it
  comes from — the list shows what each store has free (in hand less reserved); an item not kept in
  stock says what the store issues. A line that came from a PI stays on the PR.
- **Sourcing** follows the PR's **value before GST** (the larger of the estimate and the chosen
  rates), with the limits from Purchase settings (GFR 2017 by default):
  - **direct purchase** (up to ₹50,000): a vendor and rate per line — **Add a quote**, or pick a vendor
    and type the agreed rate in the comparative statement — and **Record the certificate** ("I am
    personally satisfied that the goods … at a reasonable price") in the purchase officer's name;
  - **purchase committee** (up to ₹2.5 lakh): at least 3 quotes (**Add a quote**: the vendor, its
    reference, date, validity, delivery days, the file, and the rate of each line it quoted; the GST
    is the item's for a registered vendor, none for an unregistered or composition one). The
    **comparative statement** shows for each line what the school pays per unit with GST and marks the
    lowest **L1**; choose the vendor per line — a dearer one needs the reason. Then the committee
    members sign it (as many as Purchase settings asks). **Changing the lines, a quote or the vendors
    clears the signatures**;
  - **tender** (above): run the tender outside EduPro; record its **reference**, attach its
    **documents** and choose the vendor with the agreed rates.
- **Send for approval** says what is still missing (the Sourcing card lists it too) — including **not
  enough free stock** for a line from the store. Sending **reserves** that stock for the PR; sending
  it back, rejecting, cancelling or reopening it lets the reservation go. The PR goes to its
  department's PR levels (Purchase → Who approves); nobody approves their own.
- **Approved**: one draft **purchase order per chosen vendor** is made at once (Purchase Orders →
  Drafts); a PI all of whose lines come from the store closes ("From the store on PR/…") and the store
  keeper finds the lines under **Issues → To issue**. **Rejected** or **cancelled**: its PIs go
  back to To requisition with the reason. **Reopen to change** an approved PR (before any order): it
  goes back to draft and is approved again (the next revision).
- Approvers and committee members find theirs in **My approvals** or the staff app (**Office →
  Purchase requisitions**); a PI's raiser opens the PR from the PI.

## Purchase Orders

**Purchase → Purchase Orders.** Approving a requisition drafts one PO per chosen vendor; a PI whose lines
are all on rate contracts drafts its PO at once. **Purchase → To order** lists what is left to order —
lines of a cancelled or rejected PO, or of a requisition the system approved under a department's limit
(no vendor chosen yet): tick the lines, pick the vendor, **Draft the PO**.

On a draft PO:

- **Change**: the vendor's quotation reference, PO date, validity, delivery date and address, the payment
  term (the vendor's, else the school's default), terms and conditions; each line's words, HSN / SAC,
  quantity (no more than the requisition still needs), rate, discount % and GST %; other charges
  (freight, installation, packing) with their GST. A rate-contract line keeps the contract rate unless
  you give the reason. Taking a line off sends it back to To order.
- **GST** is worked out from the vendor and the school's state (Purchase settings): **CGST + SGST** for a
  registered vendor in the same state, **IGST** for one in another state, **none** for an unregistered
  or composition vendor. A **reverse-charge** service (e.g. an advocate's legal services) shows the GST
  the school pays itself, apart from the vendor's total. The total is rounded to the rupee and given in
  words; the GST summary is by HSN / SAC and rate.
- **MSME**: a micro or small vendor on a payment term longer than 45 days is warned (they must be paid
  within 45 days).
- **Send for approval**: the department's PO levels (Purchase → Who approves); nobody approves their own
  PO — their level passes on.
- **Approved**: **View / Download** the PDF (DRAFT is printed across it until approved), then **E-mail the
  PO with the PDF** to the vendor (the address is the vendor's, change it if needed). The words are the
  template "Purchase: order to the vendor" on Communication → Templates; every e-mail is listed on the PO
  with its delivery status. The items' last purchase rate is updated.
- **Close** when the goods have come; **Amend** to change an approved PO — the next revision (R1, R2…)
  opens as a draft and is approved again; the old one stays in force until then and is then marked
  replaced; **Cancel** an approved PO needs the cancel right (the school admin) and a reason — tell the
  vendor; its lines go back to To order.

## Emergency purchase

When something could not wait (a burst pipe, a broken generator), the purchase office records it after
the fact: **Purchase Orders → Record an emergency purchase** — the vendor, what was bought (item or in
words, quantity, rate, GST), the vendor's **bill** (PDF or photo) and **why it could not wait**. Then
**Send for ratification**: everyone with the designation set on Purchase settings (the Principal by
default) ratifies it or not, in the admin or the staff app. It is marked **Emergency** on screen and on
the PDF. Purchase settings can switch emergency purchases off.

## The dashboard and reports

**Purchase → Purchase dashboard**: the figures first — open indents, waiting for approval, to
requisition, to order (lines), orders this month and what was ordered this year; each opens the list it
counts. Then the oldest approvals waiting (with the days and whether past the SLA), the largest orders
of the year and those over the alert amount (Purchase settings), then spend by department and by month.
Spend counts **orders placed** with vendors (approved, sent or closed) by their PO date, this financial
year (April to March).

**Purchase → Purchase reports**: pick a report, set the filters (the period — this financial year to
today unless changed —, a department, a vendor, an item, a status), **Show**; **Excel** or **PDF** saves
it with every row and the filters in words.

| Report                    | What it shows                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Purchase Indent register  | every indent sent: department, raiser, estimate, status, where it went                                                                |
| Requisition register      | every PR: the sourcing tier, quotes, vendors chosen, value, status                                                                    |
| Purchase Order register   | every PO by date: vendor, taxable, GST, reverse charge, total, status, revision                                                       |
| Status tracker            | each indent line to its PR and PO, the vendor and when it was ordered                                                                 |
| Pending approvals         | what waits now, with whom, their delegate, since when, past the SLA or not                                                            |
| **Overrides**             | PRs skipped by a rule, the split guard, vendors other than L1, emergency purchases, cancelled and amended POs, contract rates changed |
| Department spend by month | placed orders by department and month                                                                                                 |
| Purchases by vendor       | orders, taxable, GST and total per vendor, its MSME type                                                                              |
| Item purchase history     | an item's orders: dates, vendors, quantities, rates                                                                                   |
| Comparative statements    | every quote on every PR line: with GST, L1, the vendor chosen and why, the signatures                                                 |
| GST summary               | GST on placed orders by HSN / SAC and rate; reverse charge (paid by the school) apart                                                 |
| MSME vendors              | micro, small and medium vendors, their payment terms (over 45 days marked), orders placed                                             |

## A worked example: chairs for the chemistry lab

1. **The teacher raises an indent** (staff app, Office → Purchase indents): Science, "chairs for the
   chemistry lab", 10 student chairs at the last rate of ₹1,200 — ₹12,000. Sent: **PI/2026-27/0007**.
2. **The HOD of Science approves it**, then the Principal (Science's PI levels). Science's limit for
   skipping the PR is ₹10,000, so it waits for the PR ("Waiting for the PR").
3. **The purchase office makes the requisition** (To requisition: ticks PI/0007 with another Science
   indent for 4 chairs): **PR/2026-27/0004**, 14 chairs, ₹16,800 — a **direct purchase** (under
   ₹50,000). It picks the vendor with the agreed rate ₹1,150, records the reasonable-price certificate
   and sends it; Science's HOD approves it.
4. **The PO is drafted** at once: **PO/2026-27/0009** to the vendor (in the school's state: CGST 9% +
   SGST 9%). The office adds ₹500 freight, sends it for approval (HOD, then Principal), then **E-mails
   the PO with the PDF** to the vendor.
5. The chairs come: **Close** the PO. The tracker shows PI/0007 → PR/0004 → PO/0009 with the dates; the
   chair's last purchase rate is now ₹1,150.

## Stores and stock

**Purchase → Stores.** The **main store** (made by itself, under the purchase office's department)
receives what the school buys; **sub-stores** (a lab, the sports room, the library) sit under it.
**Add a sub-store** (the purchase office or the school admin): code, name, department, where it is,
and its **keepers** — employees who also need the **Store keeper** role (Access → Users). A keeper works
only the stores they keep; the purchase office works all of them. A store holding stock cannot be made
inactive; the main store is always active.

**How an item is kept** (Items, units and HSN → Items): **Kept in stock** (no for a service), the
**store unit** when the store counts in something smaller than the purchase unit (a box of 10 pieces:
store unit NOS, 10 store units per unit), **Batch and expiry** (lab chemicals, first aid: the earliest
expiry goes out first), **Serial numbers** (assets). The units cannot change once stock has moved.

**Opening stock** (on a store's page): what the store holds on the day it starts — per item the
quantity in the store unit and what one cost, the batch and expiry for an item kept by batch; or **from
Excel** (download the format, fill it, **Check**, then **Post the good rows**). Once per store and item:
stock found different later is put right by a physical count.

**Reorder levels** (on a store's page, the purchase office): per item the **reorder level** (when the
free stock — in stock less reserved — falls to it, the item is listed for reordering), the **reorder
quantity** and the **maximum**.

**Stock in hand** (Purchase → Stock in hand): every store's items with quantity, reserved, average
rate, value, the reorder level and the earliest expiry; filter by store, category, a search or **below
the reorder level**; Excel or PDF. Open an item for its **stock register**: every move in and out with
the balance and value after it, the batches in hand, and the balance in each store.

Stock is valued at the **weighted average**: each receipt re-averages the item's rate in that store and
issues go out at the average. The register is never changed: a mistake is put right by another move.

## Receiving goods and services

**Purchase → To receive** lists the approved and sent POs the vendor still owes something on, the
earliest delivery date first and the late ones marked. When the delivery comes, the **store keeper**
(or the purchase office — never the person who made the PO) presses **Receive goods**:

- the **store** it goes into (the main store unless you keep another), the day, the vendor's **challan**
  and **invoice** numbers and dates, and a photo or PDF of them;
- per line the quantity **received** (what is still to come is filled in) and what was **refused at the
  door** with the reason (damaged, wrong, more than ordered). More than ordered is refused unless
  Purchase settings allows a few per cent over; the **batch** and expiry of an item kept by batch; the
  **serial numbers** (one per line) of an asset, when it has them.

A delivery in parts gets one receipt each time (`GRN/2026-27/0001`). A receipt entered wrongly is
**cancelled** (while it waits for inspection) and recorded again.

**Inspection.** The receipt then waits for the PO's department: its **Inspection** levels on Purchase →
Who approves, or the department's **HOD** when none is set (the school admin when there is no HOD). For
a PO above the committee limit the **purchase committee** inspects instead: its members sign the same
inspection, and changing it asks the others to sign again. Nobody inspects what they received. The
inspector (in the admin under My approvals, or in the staff app) marks per line what is **accepted** and
what is **rejected** with the reason — ticking the rejected serial numbers — or **rejects it all**.

**On acceptance**:

- the accepted quantity **enters the store** at what each unit cost on the PO: the rate after discount,
  its GST (unless Purchase settings leaves GST out of the stock cost) and its share of the freight and
  other charges, shared by value;
- what was bought **for an indent** goes straight to that department on an **issue**
  (`ISS/2026-27/0001`) — up to what the indent asked for; the rest stays in the store;
- the PO's **Deliveries** show ordered, received, accepted, rejected and still to come; **rejected**
  goods wait to go back to the vendor (returns come with issues); a PO whose lines are all accepted
  **closes by itself**, otherwise **Close short** with the reason. Once something has come, a PO can no
  longer be cancelled or amended.

**Services** have no goods: **Work done (services)** on the PO records what was done; the department
**certifies** it the same way (`SCC/2026-27/0001`, the completion certificate).

**The 15 days.** Under the MSMED Act a delivery with no written objection within 15 days counts as
accepted. Each receipt shows that **deemed acceptance** date; past it the receipt is marked, and the
dashboard counts them. The acceptance date (or the deemed date) starts the vendor's 45-day payment
clock.

The **PDF** on each receipt is the goods received and inspection note (or the completion certificate)
with who received and who inspected it. **Reports**: the **Goods receipt register** and **Pending
deliveries** (late only, if you like).

## Issues, returns and transfers

**Purchase → Issues.** **To issue** lists, per approved requisition and store, what it **reserved** and
is still to go out. **Issue** gives it out: how much now (a part is fine — the rest stays reserved),
the batch if you want a particular one (otherwise the **earliest expiry goes first**), and who took it
(otherwise the indent's raiser). The quantity is shared among the indents the line came from — each
indent gets its own issue (`ISS/2026-27/0001`). Goods bought for an indent are issued the moment they
are accepted on a goods receipt.

**Counter issue** is the quick way for a need that has no indent: the store, the department, who took
it, the purpose and the items. Only **free** stock goes out — what requisitions reserved stays.

Every issue goes out at the store's **average cost**, and prints as an **issue slip** with _Received
by_. The department **acknowledges** it: whoever took it, the indent's raiser or the HOD presses
**Acknowledge: received** (admin, My approvals, or the staff app → **Issued to my department**). For a
department without a sign-in the keeper presses **Record the signed slip** and says who signed it.

**Goods brought back** (on the issue): unused goods go back into stock at the rate they went out at;
damaged goods are recorded with what is wrong and stay out of stock (for condemnation later).

**Return to the vendor** (the PO's Deliveries, or a goods receipt with rejected lines): goods
**rejected at inspection** (they never entered stock) and goods **found defective** later (they come
out of stock at the average). Tick **A replacement is wanted** and the order waits for it — an order
that had closed by itself opens again; otherwise close the order short. The return note
(`RTN/2026-27/0001`) prints with the carrier or docket. The debit note follows with the bill (phase 3).

**Purchase → Transfers → Send to another store**: from a store you keep, any items with free stock
(batch by batch). They leave your store at once and stay **in transit** until the receiving keeper
presses **Receive** (in at the same cost, batch and expiry). The sender can **cancel** one still in
transit: the items go back.

## Physical count

Every store is counted **at least once a year** (GFR 2017 rule 213); **Purchase → Physical counts**
shows when each was last counted. **Start a count** (the keeper): the whole store or one category. The
book quantity of every item (each batch for batch items) is taken then; the sheet is **blind** — it
shows the book quantity only once a line is counted.

Count on screen, or **Download the sheet (Excel)**, fill **Counted** and upload it. Add a line for an
item or batch found that is not listed. Every line needs a count (0 when none is found) and every
difference a **reason**; then **Send for approval**.

The **school admin** (not someone who counted) sees book, counted, the difference and its value, and
**approves** — each difference posts as an **adjustment** at the average rate — or **sends it back** to
count again. The statement prints with the differences.

**Stock reports**: issues by department (consumption), slow-moving and dead stock, expiring soon,
below reorder level, transfers, count differences — with stock in hand and each item's register.

## Reorder

Set each item's **reorder level**, **reorder quantity** and **maximum** on the store's page. **Purchase →
Reorder** lists, per store, the items whose free stock (in hand less reserved) plus what is on order is
at or below the level, with the quantity to ask for (the reorder quantity, or up to the maximum) and
any indent already open for it. Tick the ones to ask for, change a quantity, and **Raise an indent**: a
draft indent for the store's department, priced from the rate contract or the last purchase, opens for
you to check and send.

## Assets

Every unit of an **asset item** (item type asset) has its own record with a **tag**
(`AST/2026-27/0001`) and a **QR label**:

- it joins the register when it is **accepted on a goods receipt** — what one unit cost (its share of
  the PO with GST and freight), the serial number, the PO and vendor — and sits in the store;
- it follows the store: an **issue** gives it to the department and whoever took it (one bought for an
  indent goes straight to the indent's raiser), goods **brought back** put it back in the store (marked
  unserviceable when damaged), a **transfer** moves it between stores, a **return to the vendor** takes
  it off the register;
- on its page the office records **custody** (department, room, who keeps it — a new custodian who signs
  in acknowledges first, from My approvals or the staff app → **Assets in my care**), **repair** (sent
  to a repairer, back with the cost), **lost** and **found**, and keeps the make, model, condition,
  warranty and insurance;
- **Print QR labels** for the ticked assets (24 to an A4 sheet);
- existing assets come in from the old register by **Import from Excel** (one row per unit; the store's
  stock is not changed);
- an employee's assets show on their page (**Assets in care**) and on the **exit clearance**: they come
  back before the employee leaves.

**Depreciation** (Assets → Depreciation): each item category has its method on Purchase set-up → Item
categories — **straight line** over the useful life down to the salvage % (5% if not set), or
**written-down value** at a rate a year (a sub-category without its own takes its category's). Run
the year at its end: **Work it out**, then **Save**. Each asset is depreciated pro rata from the day it
was put to use (or bought); earlier years not yet run are worked out first, so each year opens at the
last one's closing. A year can be run again until a later year is run. Reports → **Fixed-asset
register** gives each category's opening, additions, depreciation, disposals and closing.

## Condemnation and disposal

Unserviceable, obsolete, surplus or expired assets and stock are **condemned** (GFR 2017 rule 217):

1. **Propose condemnation** (the purchase office): the assets (unserviceable ones first) and the stock
   quantities (a batch for a batch item), each with why. Its book value is worked out; **stock on an
   open proposal is held** — it cannot be issued or transferred.
2. **Send to the committee**: the **condemnation committee** (Purchase settings, with how many must
   sign) signs it — or sends it back.
3. The **school admin** (never the one who proposed it) **approves**: the assets are **written off** at
   their book value and the stock leaves the store as a write-off — or rejects it (the stock is free
   again).
4. **Record the disposal**: how (public auction, sale by tender, sale, buy-back, scrap, donation,
   destruction), when, to whom, for how much, the reference and a file. Above **₹2 lakh** of book value
   it must be a public auction or a tender, with its reference.

The record prints in the manner of form GFR-17. Reports → **Condemnations and disposals**.

## Hand over my approvals

Away for some days? **Purchase → Hand over my approvals** (staff app: the link under Purchase indents):
pick the colleague, the first and last day, and the reason. For those days the colleague approves your
PIs (later PRs and POs too) in your place; the history says they acted on your behalf. Only purchase
approvals move — leave, fees and the rest stay with you. **End now** stops it early. The school admin can
hand over anyone's.

## Common questions

- **Why can't I approve this vendor?** You entered it (or last changed it), or you do not have vendor
  approval. Another person approves it.
- **Why is my bank change not showing?** It waits in Vendor approvals; the old account is used until it
  is approved.
- **The GSTIN is refused as mistyped.** The last character of a GSTIN is a check character worked out
  from the others: one character is wrong. A well-formed GSTIN is not proof the vendor is registered:
  check it on the GST portal.
- **Why are only a few HSN codes there?** The starter list holds only codes whose rates are settled;
  add the rest from the school's bills or an Excel sheet and confirm the rates with the CA.
- **Can an approver be added by amount?** No: approvals follow the department's levels only; the
  amount is shown first to every approver, and Purchase settings can list POs above an amount on the
  dashboard.
- **Why can't I approve my own indent?** Nobody approves their own: your level passes to the next one
  (the school admin when you are the last level).
- **"Who approves Science's Purchase Indents is not set".** The school admin sets the department's levels
  on Purchase → Who approves.
- **My PI was approved but no PR came.** It waits in Waiting for the PR unless every line is on a rate
  contract or it is within the department's limit; the indent says which rule applied, or why not.
- **Why can't I send the PR for approval?** The dialog lists what its tier still needs: a vendor on
  every line, the certificate, the quotes, the committee's signatures or the tender documents.
- **The committee's signatures disappeared.** The lines, a quote or the vendors chosen changed after
  they signed: they sign the new statement.
- **Why is the GST IGST?** The vendor's state (from its GSTIN) is not the school's. Check the vendor's
  GSTIN and the school's GSTIN on Purchase settings.
- **I cannot cancel an approved PO.** Cancelling one the vendor may already have needs the cancel right
  (the school admin). Amend it instead to change it.
