# Runbook: monitoring, on-call and the hotfix lane (Sprints 22-23)

|          |                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner    | Platform engineering                                                                                                                                                                |
| Coverage | Hypercare (go-live to exit): 07:00-19:00 IST on site or remote with a 30-minute response; afterwards business hours with a 4-hour response for S1                                   |
| Tools    | `/health`, `/metrics` (Prometheus text), `scripts/synthetic-check.mjs`, **System → Jobs** (outbox), **System → Hypercare**, the API and worker logs (request ids, no personal data) |

## 1. Signals and alert rules

| Signal                                   | Source                                                                             | Threshold                                | Action                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------- |
| Synthetic check failing or slow          | `synthetic-check.mjs` every 5 minutes                                              | any FAIL, or > 1.5 s twice in a row      | page on-call                           |
| HTTP 5xx rate                            | `edupro_http_requests_total`                                                       | > 1 % over 5 minutes                     | page on-call                           |
| p95 latency of receipts and ledger reads | `edupro_http_request_duration_seconds`                                             | > 500 ms / 300 ms over 10 minutes        | on-call investigates; capacity tuning  |
| Permission denied spikes                 | `edupro_security_events_total`                                                     | > 50 per minute from one user or IP      | security review; rate limit            |
| Outbox backlog                           | `jobs_outbox` pending count                                                        | > 500 for 10 minutes, or oldest > 30 min | check workers; restart; replay         |
| Failed notifications                     | `comms_messages.status = failed`                                                   | > 5 % of the day                         | provider status; retry from the outbox |
| Nightly jobs missed                      | `retention.purge`, `shadow.reconcile`, `archive.closed_years`, `reports.scheduled` | no run by 06:00 IST                      | run by hand; investigate the scheduler |
| Database                                 | connections, disk, replication lag                                                 | > 80 % / > 80 % / > 60 s                 | scale; page on-call                    |
| Backups                                  | nightly dump present with checksum                                                 | missing by 03:00 IST                     | run `scripts/backup.sh`; investigate   |

## 2. On-call routine (hypercare)

1. 07:00 IST: run the synthetic check, read the hypercare digest, check the outbox and the nightly
   jobs, look at the error rate of the last 12 hours.
2. During the day: every S1 or S2 from **System → Hypercare** gets a first response within the SLA
   (S1 4 h, S2 24 h) and a workaround where one exists.
3. 19:00 IST: hand over in the channel: open S1/S2, anything scheduled for the night.
4. Daily stand-up with the school at 15:00: the issue list, counts of the day (receipts, attendance
   marked, messages sent), what ships tonight.

## 3. Hotfix lane

1. A defect with an S1 or S2 issue gets a branch `hotfix/<HC-number>` from `main` (the release is
   frozen: `docs/release-1-freeze.md`).
2. Fix with a test that reproduces the issue; lint, typecheck and the related e2e suite green.
3. Review by a second engineer; squash-merge to `main`; tag `hotfix-<date>-<n>`.
4. Deploy through the release workflow to staging, run the synthetic check and the smoke suite, then
   production in the evening window (after 19:00 IST) unless the school agrees to a daytime deploy.
5. Update the issue with the tag and the verification; the reporter verifies (`verified`) before it is
   closed.

## 4. Capacity tuning knobs

| Knob                           | Where                                   | Default  | Notes                                           |
| ------------------------------ | --------------------------------------- | -------- | ----------------------------------------------- |
| API replicas                   | container app scale rule (CPU 70 %)     | 2-6      | receipts and ledger reads are the hot paths     |
| Worker concurrency             | `WORKER_CONCURRENCY` per queue          | 4        | exports and notifications scale separately      |
| Rate limit per user per minute | `RATE_LIMIT_PER_MINUTE`                 | 300      | raise for the cashier role on due dates         |
| PostgreSQL                     | `max_connections`, work_mem, autovacuum | managed  | marts refresh nightly; the fee dues mart hourly |
| Export PDF engine              | `EXPORT_PDF_ENGINE`                     | chromium | one renderer per worker replica                 |

## 5. Escalation

On-call → platform lead (30 minutes without progress on an S1) → delivery lead and the school
principal (S1 beyond 2 hours, or any personal-data incident: `incident-breach.md`).
