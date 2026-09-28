# ADR-013: One report definition for the screen and the file

Status: accepted (Sprint 15, 2026-09-28)

## Context

The sprint plan asked for "a report framework on Kysely with materialised views refreshed by jobs" and a
fee reports centre (day book, head-wise tally, defaulters, forecast, Tally export). Two things were already
true in the code base: reports are bound-parameter SQL run under the tenant wrapper with row-level security
(ADR-010 rejected materialised views because they cannot carry RLS; the marts are tables refreshed by the
`insights.refresh` job), and the export service already renders a **dataset definition** (id, permission,
columns, SQL) to CSV, Excel and PDF under the requester's tenant context.

## Decision

- The dataset registry (`packages/db/src/datasets.ts`) is the report framework. A report is one definition;
  `GET /reports/datasets/:id/rows` runs it live for a screen (row cap, DATE columns as `YYYY-MM-DD`) and
  `POST /reports/exports` renders the same definition to a file. Permission and class-section scope
  narrowing are shared (`ReportsService.prepare`).
- Kysely is not introduced. Every report stays parameterised SQL inside the tenant transaction; a second
  query layer would add a dependency without adding safety, and the definitions are reviewable as SQL.
- Reports that must agree with the counter the same minute read base tables (day book, head-wise tally,
  vouchers); reports over the whole year read marts (defaulters from `mart.fee_dues`, forecast from the new
  `mart.fee_forecast`), refreshed by the existing job.
- Pivots (days × heads, months × classes) are done by the screen from long-form rows, so the file export
  stays a flat, sortable table.
- The export service gains the `xml` format. For `fee_tally_vouchers` it renders Tally's import XML
  (Receipt vouchers, debit cash or bank from settings `fees.tally.*`, credit one ledger per fee head); for
  any other dataset a generic `<report><row>` document.

## Consequences

- A new fee report is a dataset entry plus, if it needs a screen, a tab in the reports centre; exports,
  permissions and scoping come for free.
- The plan's Kysely line is recorded as a deliberate deviation in the Sprint 15 record; if a report ever
  needs composable, dynamic SQL, a builder can be introduced for that report without changing the contract.
- Materialised views remain out (ADR-010); `mart.fee_forecast` follows the mart pattern.
