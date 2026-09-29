# Runbook: month-end fee close (Sprint 23)

|        |                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner  | Accounts head (`fees.period.lock`); the auditor reads (`fees.period.view`)                                                                  |
| When   | Within three working days of the month end, after the last bank statement of the month is uploaded                                          |
| Screen | **Fees → Month-end close**                                                                                                                  |
| Effect | The period is locked through the last day of the month: no receipt (fee or misc) can be dated on or before it; the month-end pack is queued |

## 1. Before the close

1. Upload the last bank statement of the month (**Fees → Bank statements**) and match every credit.
2. Upload the gateway settlement files (**Payments → Settlements**); every online receipt of the month
   must have a settlement line.
3. Decide every pending adjustment request (**Fees → Adjustments**).
4. While the shadow run is open, explain or resolve every variance (**Fees → Variance workbench**).
5. Count the cheques not yet cleared; they do not block the close but appear on the pack.

## 2. The close

1. Open **Fees → Month-end close**, pick the month; every check must be green (blocking checks: bank
   credits unmatched, settlement lines unmatched or mismatched, open variances, pending adjustments).
2. Tick "queue the month-end pack" and close with a fresh sign-in (second factor).
3. The pack (day book PDF, head-wise tally, Tally XML, defaulters) lands in **Reports → Exports**;
   file it with the physical day books; import the Tally XML into the accounts system.
4. Hand the pack to the auditor; the auditor reads the checks on the same screen.

## 3. After the close

- A receipt dated inside a closed month is refused (`fees.period_locked`); post it with today's date
  and a remark, or reopen the month.
- **Reopen** needs a reason and a second factor; it releases the lock, is audited, and the month must
  be closed again afterwards (the pack is re-queued).
- Locks can also be set by hand (per ledger, any date) for a partial close, for example the hostel
  ledger after the hostel audit.

## 4. First live month-end (Sprint 23 exit criterion)

The first close after go-live is done together by the accounts head and the delivery team: the pack
is compared line by line with the legacy month (day book totals per mode, head-wise tally) and the
differences explained in the retrospective.
