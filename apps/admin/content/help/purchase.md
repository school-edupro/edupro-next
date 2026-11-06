# Purchase

Staff ask for what their department needs on a **Purchase Indent (PI)**; the department's approvers
decide it in turn; the purchase office turns approved PIs into a **Requisition (PR)** and an **Order
(PO)**. This page covers the masters they pick from (units, HSN / SAC codes with GST, item categories
and items, payment terms, vendors, rate contracts, who approves, the settings) and the PI. (The PR and
PO screens come next.)

## Who does what

| Who                                                 | What                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Purchase office** (its own role)                  | Keeps items, units, HSN codes, categories, payment terms, rate contracts; adds and changes vendors   |
| **Someone with vendor approval** (the school admin) | Approves a new vendor and a change of a vendor's bank account, GSTIN or PAN — never one they entered |
| **School admin**                                    | Settings, the purchase committee, who approves per department, the bypass rules                      |
| **Any staff member** (teachers, office staff)       | Raises PIs for their own department, in the admin or the staff app                                   |
| **The department's approvers** (HOD, Principal…)    | Approve, send back or reject the PIs at their level; hand their approvals to a colleague when away   |

## Set it up, in this order

**Purchase → Purchase set-up** lists the steps with what is done:

1. **Purchase settings** — the school's **GSTIN** (it gives the school's state: a vendor in the same
   state is charged CGST + SGST, one in another state IGST), the billing and delivery addresses, the
   numbering (PI / PR / PO prefixes, restarting each financial year), the **sourcing limits** (direct
   purchase up to ₹50,000 with one quote and a reasonable-price certificate; up to ₹2.5 lakh at least 3
   quotes and the purchase committee's signed comparative statement; above that a tender reference —
   the GFR 2017 figures, change them if your school follows its own), **emergency purchase** on or off,
   the PO's validity, terms and signatures, the department whose levels approve a PR combining
   departments, the large-PO list and the split window.
2. **Items, units and HSN** (Purchase → Items, units and HSN, the tabs **Units**, **HSN / SAC codes**,
   **Item categories**, **Items**, **Rate contracts**): every tab has Add, Edit, Excel upload with a check
   before saving, Excel and PDF of the list. The HSN list starts short on purpose (school stationery,
   books, maps, computers): add the codes of what the school buys, with the GST rate, and tick **Reverse
   charge** where the school pays the GST itself (e.g. an advocate's legal services) or **Exempt for the
   school**. Confirm every rate with the school's CA. Categories have two levels: a category and its
   sub-categories. An item has a code, a type (consumable, asset, service), its category (and
   sub-category), its unit and its HSN / SAC (its GST rate comes from there unless the item has its own).
3. **Payment terms** — a term is one or more instalments that add up to 100%: each a share, due **in
   advance**, **after delivery** or **after the invoice**, and after how many days ("50% in advance, 50%
   15 days after delivery"). One is the school's default. A term whose longest wait is over 45 days is
   marked: micro and small suppliers must be paid within 45 days.
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
  status and **GSTIN** (checked, its last character too; the **PAN** and the state are read from it; an
  unregistered vendor has a state and maybe a PAN), MSME (micro / small / medium and the Udyam number),
  address, phone, the e-mail the PO goes to, contacts, the **bank account** (stored encrypted; screens show
  only the bank, the last four digits and the IFSC).
- A new vendor **waits for approval**: someone with vendor approval opens **Vendor approvals** (or the
  vendor), checks the GSTIN, PAN and bank account against the documents, and approves or rejects (with a
  reason). Whoever entered or last changed a waiting vendor cannot approve it. Until it is approved a
  vendor cannot be used on a PR, a PO or a rate contract.
- On an approved vendor, a new **bank account**, **GSTIN**, **PAN** or **GST status** waits for approval
  the same way (with the reason for the change); the old details stay in force until then. Everything
  else (name, address, contacts, categories, term) changes at once.
- **Same GSTIN, PAN or bank account as another vendor**: the form names the other vendor and asks why;
  it is saved only with a reason.
- **Documents**: upload the GST certificate, PAN card, cancelled cheque, Udyam certificate or an
  agreement (PDF or photo, up to 5 MB) — View opens it, Download saves it.
- **Make inactive** (not offered on new PRs and POs), **Blacklist** (with a reason: never offered),
  **Make active** again.
- **Import from Excel**: download the format, fill one row per vendor, **Check** (every row is checked
  and the problems listed), then **Import the good rows**. Imported vendors wait for approval; bank
  details are not imported.

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
