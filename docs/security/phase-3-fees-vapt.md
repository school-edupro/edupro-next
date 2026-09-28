# Phase 3 fees: load test at 5× peak and internal VAPT (Sprint 16)

|        |                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope  | Sprints 12 to 16: fee masters and demand, cashier and receipts, online payments and settlement, adjustments, hostel and misc ledgers, reports centre and exports, bank reconciliation, the shadow run and service keys                                                                                                                                      |
| Method | Threat-model driven (design notes 08 to 12), automated attack cases in `apps/api/test/pentest-fees.e2e-spec.ts` (run on every CI e2e pass), a Jest load probe in `apps/api/test/performance-fees.e2e-spec.ts`, a k6 script `perf/k6/due-date-peak.js` for staging, plus manual review of the guards, SECURITY DEFINER routines and the one new public route |
| Tester | Platform team, 2026-09-28                                                                                                                                                                                                                                                                                                                                   |
| Result | No open high or medium findings. Two low findings found by the automated cases and fixed in this sprint; two informational items accepted                                                                                                                                                                                                                   |

## 1. Load: the due-date peak

The pilot's busiest fee day is the 10th of a quarter month: about 400 receipts in the two office hours
with parents also opening ledgers and the office running the day book. 5× that peak is ~2,000 receipts
in two hours, i.e. a sustained 0.3 receipts/s with bursts of 100 concurrent postings.

Measured locally (user-space PostgreSQL 16, one API process, `performance-fees.e2e-spec.ts`):

| Probe                                              | Result                                  | Target       |
| -------------------------------------------------- | --------------------------------------- | ------------ |
| 100 concurrent receipts through `app.post_receipt` | 273 ms wall, 366 receipts/s, 0 errors   | p95 < 500 ms |
| Numbering under concurrency                        | 100 distinct sequential receipt numbers | no gaps/dups |
| Student ledger (`GET /fees/students/:id/ledger`)   | p95 9 ms                                | < 300 ms     |
| Day book dataset (month)                           | 7 ms                                    | < 2 s        |
| Head-wise tally dataset (month)                    | 52 ms                                   | < 2 s        |
| Principal dashboard (`GET /insights/dashboard`)    | 4 ms                                    | < 1 s        |

`perf/k6/due-date-peak.js` replays the same mix (70 % ledger reads, 20 % receipts, 10 % day book) with
ramping VUs for staging; thresholds encode the targets above. Rate limiting is lifted for the cashier
role's receipt route only through the configured per-user limit, so the 5× run is done with
`RATE_LIMIT_PER_MINUTE` raised on the test environment (documented in the k6 header).

## 2. Attack cases (automated)

`apps/api/test/pentest-fees.e2e-spec.ts` (5 cases, each with several probes):

| Case                                                                                                 | Expected                                                                                                                         | Result |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Another school cannot read a ledger, a receipt PDF, a bank statement, an export or report rows by id | 404 on every route, never an empty 200                                                                                           | pass   |
| A family reads only its own ledger and receipts; another family gets nothing                         | own children only; foreign student 403/404; intents own only                                                                     | pass   |
| Report parameters, feed rows and CSVs are data, never SQL or code                                    | 400 for control characters and non-dates; injection strings stored verbatim and matched nowhere; CSV formulas escaped in exports | pass   |
| Service keys: guessed, foreign-scope and revoked keys are refused; the key is never readable again   | 401 / 403 / 401; list and audit show the hash prefix only                                                                        | pass   |
| A locked year refuses receipts and adjustments even for administrators                               | 409 `year-locked` on receipt, waiver and shadow feed                                                                             | pass   |

Earlier automated cases that stay in CI and cover this scope: `pentest.e2e-spec.ts` (Phase 2 scope),
`sprint13.e2e-spec.ts` (payment webhooks replay, family pays only for own children, SoD on reversals),
`sprint14.e2e-spec.ts` (adjustment approval MFA), `redteam.e2e-spec.ts` (assistant: prompt injection through
data, scope escalation, surface claims, destructive verbs).

## 3. Findings

| #   | Severity | Finding                                                                                                                                                                 | Fix                                                                                                                                     |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Low      | A report parameter containing a NUL byte reached PostgreSQL and produced a 500 (stack in the log, no data)                                                              | `ReportsService.prepare` rejects control characters and validates the date parameters (`from`, `to`, `asOf`, `date`, `onDate`) with 400 |
| 2   | Low      | `GET /fees/students/:id/demands` for a student of another school returned an empty 200 (a tenant oracle: exists-but-hidden vs not-found were distinguishable elsewhere) | 404 `not-found` for unknown, deleted or foreign students, matching the ledger route                                                     |
| 3   | Info     | Service keys are bearer credentials; a leaked key can feed receipts (never read them) until revoked                                                                     | Accepted: scope-limited, hashed at rest, `last_used_at` visible, revoke is one click; rotation in the runbook                           |
| 4   | Info     | The mock assistant router matched destructive verbs ("delete the defaulters") to a read query                                                                           | Refused now (verb guard); the real provider was never allowed a write tool. Kept as an eval case                                        |

## 4. Manual review notes

- The only new public route is `POST /shadow/feeds/ingest`; it is allow-listed in
  `permission-coverage.spec.ts`, authenticates by `x-service-key` (sha256 lookup through a SECURITY
  DEFINER function that returns only active keys), sets the tenant from the key, and requires the
  `shadow.feed` scope. Body size is capped by the global limit; rows are validated by the ETL steps.
- `app.run_shadow_reconcile` and `app.compute_exam_results` run under RLS with the caller's school; they
  take no table names or dynamic SQL.
- `platform.service_key.manage` and adjustment approvals are `requires_mfa`.
- Receipt PDFs and exports are served only to their owner (`reports.export.view` or the family route) and
  never by a guessable path.
