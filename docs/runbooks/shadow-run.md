# Runbook: the fees shadow run (Sprint 16)

The legacy ERP stays the system of record for fees during the shadow term. Every legacy receipt is fed
into EduPro Next daily, dual-posted into the new school ledger, and the two ledgers are reconciled. The
term ends when the variance report reads **zero for three consecutive days** and the pilot signs the fee
UAT (`docs/quality/uat-fees.md`); the cut-over then makes the new ledger the system of record.

## 1. Roles

| Who                                        | Does                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Platform team                              | Issues the service key, installs the legacy cron, watches the `shadow.variance` alerts               |
| Accountant (`fees.shadow.manage`)          | Uploads a day's file when the cron missed, explains or resolves variances, reruns the reconciliation |
| Auditor / coordinator (`fees.shadow.view`) | Reads runs and variances                                                                             |

## 2. One-time setup

1. **System → Service keys → Issue a key**, name `legacy-cron`, scope `shadow.feed`. The key is shown
   once (it travels in a two-minute httpOnly cookie, never in a URL); paste it into the legacy host's
   environment. Issuing needs a recent MFA sign-in (`platform.service_key.manage` is `requires_mfa`).
2. On the legacy host, schedule the export (after the day's last receipt run, e.g. 22:30 IST):

   ```bash
   mysql -N -e "SELECT ... FROM fees f JOIN fees_transaction t ... WHERE DATE(f.ReceiptDate) = CURDATE()" > /tmp/fees_today.json
   curl -sS -X POST "$EDUPRO_API/api/v1/shadow/feeds/ingest" \
     -H "content-type: application/json" -H "x-service-key: $EDUPRO_SERVICE_KEY" \
     --data-binary @/tmp/fees_today.json
   ```

   The body is `{ "kind": "receipts", "source": "legacy-cron", "rows": [...] }` where each row carries the
   legacy `fees` columns (`receipt`, `sadmission`, `ReceiptDate`, `fees_amount`, `PaymentMode`, `ChequeNo`,
   `BankName`, `FinancialYear`, `status`) and its `lines` (`fees_transaction` head and amount). A CSV with
   the same headers is accepted as `csv`. Balances go the same way with `kind: "balances"` and rows of
   `sadmission`, `as_of`, `balance` (a snapshot of `fees_student`), ideally once a day after the receipts.

3. The workers' `shadow.reconcile` job runs every 24 h on the `reconciliation` queue (yesterday → today,
   every school) and raises an `insight_alerts` row of kind `shadow.variance` (WhatsApp to
   `insights.alert_roles`) whenever a run is not zero.

## 3. Daily routine

| Step | Action                                                                                                                             | Where                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1    | Check that today's feed arrived (rows, posted, skipped, **rejected**)                                                              | **Fees → Variance workbench → Feeds** |
| 2    | If the cron missed, export the day's rows and upload them (CSV or JSON)                                                            | same card, **Feed and post**          |
| 3    | Open the run of the day; a green **Zero** badge ends the routine                                                                   | **Runs**                              |
| 4    | For every open variance decide: **Explain** (known, stays open in legacy) or **Resolve** (fixed on one side); both need a sentence | **Variances**                         |
| 5    | Re-run after fixes (**Reconcile now** for the window) and confirm the count dropped                                                | **Runs**                              |

### Reading a variance

| Kind                | Meaning                                                                                             | Usual fix                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `missing_in_new`    | Legacy receipt could not be posted (`post_error` shown: unknown admission, no demand, closed year…) | Fix the master (enrolment / demand) and re-feed the row; it posts on the next feed              |
| `missing_in_legacy` | A receipt posted directly in the new ledger that legacy never issued                                | During the shadow term nothing should be posted directly; reverse it, or explain (test receipt) |
| `amount` / `date`   | Same receipt, different amount or date                                                              | Legacy manual edits after posting; correct legacy or record a bounce / refund in the new ledger |
| `reversed_in_new`   | New ledger reversed it, legacy still counts it                                                      | Cancel in legacy                                                                                |
| `not_reversed`      | Legacy cancelled it, new ledger still counts it                                                     | Re-feed the row with `status = cancelled`; the feed reverses the posting                        |
| `balance`           | Per-student balance differs on the snapshot day                                                     | Usually a demand difference (concession, head, instalment); compare **Fees → Student ledger**   |

## 4. Rules that protect the term

- Shadow postings go through `app.post_receipt` like a cashier's receipt (same numbering, allocation and
  late fee rules), with `reference = legacy receipt no` and `remarks = 'shadow: <no>'`; the feed is
  idempotent (a receipt already posted is skipped, a cancelled one reverses once).
- Nothing in the shadow tables is deleted; a variance is closed by a decision with a name and a sentence.
- The reconciliation is a database function (`app.run_shadow_reconcile`) under RLS; the workbench only reads
  and decides.
- The service key is hashed at rest (sha256); revoke and reissue it if the legacy host is rebuilt.

## 5. Exit criteria

Three consecutive zero runs, balances snapshot compared on the last day of a month, fee UAT signed, and the
day book and head-wise tally of the shadow month matching the legacy reports to the rupee.
