# Collect and pay (Sprint 13)

Phase 3, weeks 27-28. The collection procedure, refunds, three gateway adapters behind one notification
path, settlement matching, the family's own online payment, transport requests and vehicle logs, and the
department dashboards of the AI track. Builds on the ledger of [08-fee-ledger-and-marts.md](08-fee-ledger-and-marts.md).

## 1. The collection procedure: `app.post_receipt`

One PL/pgSQL function posts every receipt, whether cash at the counter, a cheque, or a gateway success
(legacy: `fee_submit.php` writing `fees` and `fees_transaction`). Inside one transaction:

| Step | Rule                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Validate: positive amount, known mode (`online`, `cash`, `cheque`, `dd`, `upi`, `bank`, `card`), an instrument number for cheque and DD, an existing student, the year open for the `fees` stage                                   |
| 2    | Insert `fee_payments` and number it from the row-locked sequence of its ledger and financial year (`app.next_receipt_no`). Counter receipts refuse a date outside every financial year; gateway receipts fall back to today's year |
| 3    | Walk the instalments (rows sharing a due date) oldest first. Settle the principal through `app.allocate_to_instalment`; when the instalment is covered, post its late fee as of the receipt date less anything already posted      |
| 4    | A receipt that cannot cover an instalment pays its principal only (the late fee waits for the settling receipt); one that covers the principal but not all of the late fee posts as much late fee as remains                       |
| 5    | Whatever is left is the receipt's advance; later allocation credits it to the next demand                                                                                                                                          |

Returns the payment id, the receipt number, the principal, the late fee posted, the advance and the number
of instalments touched. `app.allocate_fee_payment` (Sprint 9/12) now sits on the same
`app.allocate_to_instalment`, so the harness of Sprint 12 keeps passing unchanged.

**Late fee is posted, not only computed.** `fee_late_fee_postings` records what each receipt charged for
each instalment. The ledger shows three numbers per instalment: computed (`app.late_fee`), posted and
outstanding; `totals.payable` is the balance plus the outstanding late fee. A cashier holding
`fees.late_fee.manage` may post a receipt without collecting the late fee (`collectLateFee=false`), which
leaves it outstanding rather than waiving it (a waiver is still an override).

Audit: `fee_payments`, `fee_payment_allocations`, `fee_late_fee_postings` and `fee_refunds` carry the
row-change trigger `app.audit_row_change`, in addition to the API audit rows.

## 2. Refunds

`fee_refunds`: the accounts desk requests (`fees.refund.request`), an administrator decides
(`fees.refund.approve`). One open request per receipt; the amount may not exceed what is left on the receipt.

- **Offline modes** (cash, bank, cheque): approval applies `app.apply_fee_refund` and marks the refund paid
  with the payout reference.
- **Gateway**: allowed only for receipts collected by a gateway that refunds online (Razorpay, or the mock).
  Approval calls the provider's refund API, applies the ledger reversal, and waits for `refund.processed` to
  mark the refund paid (`app.refund_lookup` finds the school from the provider's refund id). PayU and
  CCAvenue refunds are made from the provider's dashboard and recorded as bank refunds.

`app.apply_fee_refund` takes the money first from the receipt's advance, then from its allocations newest
instalment first (the demand rows reopen: `paid` decreases, status goes back to partial or pending), then from
its late fee postings. The receipt becomes `partly_refunded` or `refunded`.

## 3. Gateway adapters and one notification path

| Provider | Start                                                                                            | Browser return                                                                                   | Server notification                               |
| -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| PayU     | auto-posted form, sha512 request hash (Sprint 9)                                                 | `/payments/payu/return`, sha512 response hash                                                    | `/payments/payu/webhook`, same hash               |
| Razorpay | server-to-server order (`POST /v1/orders`, basic auth); checkout.js with the key id and order id | `/payments/razorpay/return`: HMAC-SHA256(`order_id                                               | payment_id`, key secret)                          | `/payments/razorpay/webhook`: HMAC-SHA256(raw body, webhook secret) |
| CCAvenue | auto-posted `encRequest` (AES-128-CBC, key MD5(working key), fixed IV) plus `access_code`        | `/payments/ccavenue/return`: `encResp` must decrypt; `order_status`, order id and amount checked | none (CCAvenue has no server callback by default) |
| mock     | PayU-shaped form to `/payments/payu/mock`                                                        | the mock signs a PayU response                                                                   | —                                                 |

The school's gateway is the setting `payments.gateway`; the deployment default is `PAYMENT_PROVIDER`
(`mock` refused in production). Credentials are environment variables (Key Vault in production); the
working key and secrets never reach a browser.

Every return and webhook becomes a `Notification` (`provider`, our `txnId` or the provider's `orderId`,
`providerRef`, `status`, `amount`, `signatureOk`) and goes through `applyNotification`:

1. find the intent across tenants by our transaction id (`app.payment_intent_lookup`) or the provider's
   order id (`app.payment_intent_lookup_by_order`), then work inside that school's tenant transaction;
2. `rejected` when the signature fails, `mismatch` when an amount is given and differs to the paisa,
   `ignored` for pending statuses, else `applied`;
3. idempotency: one `payment_webhooks` row per (provider, reference, status). A **rejected** notification
   does not consume that key: a forged notification must not turn the genuine one that follows into a
   duplicate (found by the Sprint 13 e2e);
4. success marks the intent, runs the purpose's handler (fee instalments post a receipt through
   `app.post_receipt`, mode `online`), failure records the reason. Both answer 200 so the gateway stops
   retrying; the outcome column tells the operator what happened.

The apps relay the browser return: `/api/payments/return?provider=…` on the public, parent and admin apps
posts the fields to the API and redirects to the intent's return URL with `?paid=`. Razorpay webhooks need
the raw body, which `app.setup.ts` keeps beside the parsed JSON.

## 4. Settlements

`payment_settlements` and `payment_settlement_lines`: the provider's payout CSV (header row; columns found
by alias: `payment_id`/`mihpayid`/`tracking_id`…, `order_id`/`txn_id`…, `amount`, `fee`, `tax`, `net`,
`type`) is stored line by line and matched to succeeded intents by the provider's reference or by our
transaction / order id. Outcomes: `matched` (the receipt gets `settlement_line_id`), `amount_mismatch`,
`duplicate` (already settled by an earlier file), `unmatched` (no intent, or not succeeded), `refund`. The
fees department dashboard shows unmatched and mismatched lines and the online receipts not yet settled.

## 5. The family's fees

`GET /fees/mine` (permission `fees.family.view`, parents and students) returns each child's ledger with only
the visible instalments (Sprint 12 visibility rule), receipts, refunds and `payableNow`. `POST
/payments/intents/mine` (`payments.family.pay`, parents only) starts a payment for one of the caller's
children, capped at `totals.payable`; the payer is the signed-in user. The parent app's `/fees/pay` renders
the gateway form, the Razorpay checkout or the development gateway with a success and a failure button.
Receipt PDFs for families arrive with the assistant work in Sprint 14.

## 6. Transport requests and vehicle logs

`transport_requests` (`join`, `change`, `leave`; one open request per student and year). A family creates
(`transport.request.create`); when the `transport_request` workflow is installed the request starts an
instance and the completion handler applies it (join/change upserts the assignment with the stop's name and
times; leave deletes it); otherwise the office decides directly (`transport.request.decide`, refused while a
workflow instance is pending). `transport_vehicle_logs`: one row per vehicle and day (odometer, fuel, trips,
incident), upserted by `PUT /transport/vehicles/:id/logs`.

## 7. Department dashboards and report centres (AI track S13)

`GET /insights/departments` lists the seven departments with `allowed`: a department opens for whoever holds
`insights.department.view` **and** one of the department's module permissions (academics: lesson plans,
daily work, timetable, substitutions; attendance: sessions or RFID; fees: ledger, demands or intents;
admissions: applications or cycles; transport: routes or fleet; communication: messages, queries or
consents; HR: employees or punches). The principal view (`insights.dashboard.view`) opens all.
`GET /insights/departments/:dept?date&classId` computes the dashboard in SQL from the marts and the module
tables; `GET /insights/departments/:dept/reports` lists the export datasets of the department with the
caller's permission on each. Fourteen datasets were added to `packages/db/src/datasets.ts` for the report
centres (fee dues, receipts, refunds, settlement lines, attendance by section, lesson plans, substitutions,
admissions funnel, riders, transport requests, vehicle logs, message delivery, parent queries, employees).

## 8. Decisions

- **One procedure for every receipt** (cash, cheque, gateway) so numbering, allocation and late fee cannot
  diverge between the counter and the gateway path.
- **Posted late fee beside the computed one**: what a family owes is the rule's number less what receipts
  already charged; nothing is charged silently.
- **Refunds reverse newest first** so the oldest dues stay settled; the demand reopens rather than a
  negative receipt being created.
- **Provider notifications normalised before any decision**, so the three gateways share idempotency,
  amount checks and audit.
- **Departments open by module permission**, not by a second permission tree: the finance team already has
  the fee permissions; the dashboard follows them.
