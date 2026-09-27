# Fee ledger foundation and reporting marts (Sprint 12)

Status: implemented in Sprint 12 (Phase 3 start). This note records the rules the ledger applies so that the
accounts team, the ETL rehearsal and the assistant (Sprint 14) read the same definitions.

## 1. Instalments and the ledger view

- A student's demand rows (`fee_demands`, one per head and period) form **instalments by due date**: every row
  that shares a `due_on` belongs to one instalment. This holds for the school's own periods (quarterly, monthly)
  and for a student's instalment variant (`instalments_override`, Sprint 11), which only moves due dates.
- `GET /fees/students/:id/ledger?asOf=` returns the instalments with net, paid, balance, the late fee as of
  the date, the visibility date, a status (`paid`, `overdue`, `due`, `upcoming`), the receipts of the year with
  their numbers and unallocated advance, the active late fee overrides and the last regeneration with its diff.
  Totals include `payable = balance + late fee`.
- The working year comes from the header (`X-Academic-Year-Id`), so the same screen reads a closed year
  read-only; writes call `app.assert_year_open(year, 'fees')` and are refused on locked and closed years.

## 2. Late fee rule (`app.late_fee`)

The legacy `fnlLateFee` / `fnlLateFeeWithDate` and `fees_latefee_adjust`, restated for one instalment:

| Step            | Rule                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not yet due     | Nothing before the due date; nothing when the instalment's net is zero                                                                                                                                                         |
| Settled on time | Nothing when the allocations received on or before the due date cover the net                                                                                                                                                  |
| End date        | The as-of date, or the date the instalment became fully paid (latest allocation date) when that is earlier                                                                                                                     |
| Override        | An active `fee_late_fee_overrides` row for the student and the instalment's anchor period wins; amount 0 waives. Overrides are revoked, never edited, and every change is audited (`fees.late_fee.override`, `_revoke`)        |
| Day-wise        | `(end − due) × fees.late_fee_per_day`                                                                                                                                                                                          |
| Slab            | The anchor period's amounts: after slab 3 date → slab 3 amount; else after slab 2 → slab 2; else after slab 1 → slab 1; else `late_fee_amount` (after the due date). Dates and amounts are edited per period under Fee masters |
| Mode            | `fees.late_fee_mode` (System → Settings), per school; the amounts are read at query time so a change applies to every open instalment at once                                                                                  |

The anchor period of an instalment is the period with the lowest sequence that carries that due date. The
function reads only; posting the late fee onto a receipt is the collection procedure's job (Sprint 13).

## 3. Visibility to families

An instalment is shown to families from `fee_periods.visible_from` of its anchor period, or, when that is
empty, from `due_on − fees.instalment_visible_days_before` (default 30 days). The ledger reports `visibleFrom`
and `visible`; the parent app's fee screen (Sprint 13) hides instalments that are not yet visible.

## 4. Receipt numbers and sequences

- Every `fee_payments` row gets `receipt_no` from `app.next_receipt_no(ledger, financial_year)` inside the same
  transaction as the payment (row-locked `receipt_sequences`, one per school, ledger and financial year; the
  legacy `'TF' + MAX+1` had no lock). Counter payments refuse a date outside every financial year; gateway
  payments fall back to today's financial year so a webhook never fails on numbering.
- `GET/PUT /fees/receipt-sequences` shows and sets prefix, width and start number per ledger and financial
  year; changes are allowed only until the first receipt of that sequence is issued (409 afterwards).
- Receipt PDFs render through the document template kind `fee_receipt` (default template installed with the
  others) and the export service (`POST /fees/payments/:id/receipt` → export centre).

## 5. Regeneration with diff

`POST /fees/students/:id/demands/regenerate` snapshots the rows (period, head, net, due date), runs
`app.generate_fee_demand` and `app.apply_instalment_override`, snapshots again and stores the diff (added,
removed, changed with before/after, kept) on `fee_demand_runs.diff`. Paid rows are never replaced; the diff
shows them as kept.

## 6. Reporting marts (`mart.*`, ADR-010)

Regular tables in schema `mart`, rebuilt per school by `app.refresh_marts()` under that school's tenant
context, so forced RLS applies to reads exactly as it does to base tables. The workers refresh every active
school every 15 minutes (`insights.refresh`; the school list comes from the SECURITY DEFINER
`app.mart_schools()`); `POST /insights/marts/refresh` rebuilds on demand.

| Mart                   | Grain                                                            | Used by                                                       |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `attendance_daily`     | section × working day (any day with a session, plus today)       | attendance %, unmarked sections, class table, 14-day trend    |
| `fee_dues`             | student × due date, with balance, days overdue and ageing bucket | due/collected/balance till date, ageing, defaulters, by class |
| `fee_collection_daily` | day × mode                                                       | collected today/7/30 days, previous week, by mode             |
| `admissions_funnel`    | cycle × class × application status                               | admissions funnel                                             |
| `comms_delivery_daily` | IST day × channel × status (120 days)                            | delivery table and rate                                       |
| `refresh_log`          | one row per mart per refresh                                     | freshness badges and the stale alert                          |

The principal dashboard adds live counts (pending approvals, reader last-seen) and a fixed alert rule set:
unmarked sections after 10:00, attendance below 85% (class below 80%), weekly collection below half of the
previous week, balances over 90 days, readers silent for 24 h, approval backlog, stale marts.

## 7. Transport fleet

`transport_vehicles` (registration, make, seats, insurance, fitness and permit expiries, GPS id),
`transport_drivers` (licence and expiry, optional employee link) and `transport_stops` (ordered per route, with
latitude and longitude, pickup and drop times and the transport slab the stop falls in). Routes link a
vehicle, a driver and a conductor; assignments may name a stop, whose name and times fill the assignment.
Stops are replaced as an ordered list; stops that keep their id keep their riders.
