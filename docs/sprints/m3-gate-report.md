# M3 gate report: fees

|                |                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-09-29                                                                                                                                                                                                                                                                |
| Scope          | Phase 3, Sprints 12 to 16, shadow run Sprints 16 to 19 (`SCHOOL_ERP_SPRINT_PLAN.md`)                                                                                                                                                                                      |
| Recommendation | Pass with conditions: the fee module, the payments service, the reconciliation job and the closure procedure are built, tested and verified locally with demo data; the shadow term itself needs the pilot's legacy feed, which was not available to the engineering team |

## 1. What M3 was to deliver

"One full term of fee collection reconciles to the rupee; online payments live for the pilot."

## 2. Evidence

| Area              | Evidence                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fee ledger        | Sprints 12 to 14: heads, structures, concessions, demand, instalments, receipts with allocation, late fees, reversals, bounces, waivers with approval, hostel and misc ledgers; `fees`, `fee-ledger`, `collect-and-pay`, `sprint14` e2e       |
| Payments          | Sprints 9 and 13: intents, PayU / CCAvenue / Razorpay adapters with signed idempotent webhooks, settlement files, refunds; Sprint 19 reuses the same contract for consent-form fees; `collect-and-pay`, `sprint19` e2e                        |
| Reports and Tally | Sprint 15: day book, head-wise tally, defaulters, Tally XML export; datasets exportable as Excel, CSV and PDF                                                                                                                                 |
| Shadow run        | Sprint 16: dual-post feed from the legacy receipts through a service key, nightly reconciliation (`run_shadow_reconcile`), variance workbench with explain / resolve / reopen; `sprint16` e2e                                                 |
| Closure           | Sprint 19: `POST /shadow/close` closes after three consecutive zero-variance runs, or earlier with a reason and a second factor; `shadow_closures` keeps the summary (runs, zero runs, legacy and new totals, open variances); `sprint19` e2e |
| Performance       | `performance-fees.e2e-spec.ts` and `perf/k6/due-date-peak.js` (5× due-date peak): receipt p95 under the 500 ms budget locally                                                                                                                 |
| Security          | `docs/security/phase-3-fees-vapt.md`: internal VAPT of the fee module and retest clean; `pentest-fees` e2e                                                                                                                                    |
| Fees UAT script   | `docs/quality/uat-fees.md` (20 scenarios) ready for the pilot's accounts office                                                                                                                                                               |
| Test totals       | see `docs/sprints/sprint-19.md` section 4                                                                                                                                                                                                     |

## 3. Conditions to close M3

| Condition                                                                                                     | Owner                               | Why it is open                                                   |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Run the shadow term for real: the pilot's legacy cron feeds each day's receipts; the nightly run reaches zero | Pilot accounts office with the team | No legacy receipt feed in this environment; demo data stands in  |
| Record three consecutive zero-variance runs and close the shadow run without an override                      | Pilot accounts office               | Depends on the condition above                                   |
| Connect the pilot's payment gateway account in test mode, then live, and complete one real online payment     | Pilot school with the gateway       | No merchant credentials; the development gateway is used locally |
| Run `docs/quality/uat-fees.md` with the accounts office and record the results                                | Pilot school with the delivery team | No pilot users have used the local build yet                     |
| Import one month of Tally vouchers into the pilot's Tally and reconcile with the head-wise tally              | Pilot accounts office               | Depends on the shadow term                                       |

## 4. Carried into Sprint 20

The conditions above; the parent app's payment history screen polish; the ledger export review with
the accounts team (S20 row).
