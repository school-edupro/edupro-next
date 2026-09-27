# Runbook: backups, restore and disaster recovery

|            |                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Owner      | Platform engineering                                                                                                   |
| Targets    | RPO 15 minutes (WAL archiving on the managed server), RTO 60 minutes for the database, 30 minutes for the applications |
| Last drill | 2026-09-27 on the local stack with `scripts/restore-drill.sh` (see the Sprint 5 record for the measured duration)      |

## 1. What is backed up

| Data                                   | Mechanism                                                                                                         | Frequency                         | Retention                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| PostgreSQL (all schools, one database) | Managed server point-in-time restore (WAL) plus `scripts/backup.sh` logical dumps to the backup storage container | Continuous plus nightly 01:30 IST | 35 days point-in-time; dumps 30 days, monthly copies 12 months (storage lifecycle rule) |
| Object storage (files, exports)        | Storage account soft delete and geo-redundant replication                                                         | Continuous                        | 30 days soft delete                                                                     |
| Redis                                  | Not backed up; queues are rebuilt from `jobs_outbox` (ADR-009)                                                    |                                   |                                                                                         |
| Secrets                                | Key Vault soft delete and purge protection                                                                        |                                   | 90 days                                                                                 |
| Configuration                          | Terraform state in the state storage account; workflows in git                                                    |                                   |                                                                                         |

## 2. Restore procedure (database)

1. Declare the incident in the security channel and freeze deployments (`workflow_dispatch` on the deploy workflow is blocked while the incident label is set).
2. Point-in-time: in the Azure portal or with `az postgres flexible-server restore --restore-time <UTC>` create a new server from the latest good point. For a logical dump: `scripts/restore-drill.sh <dump> edupro_restored` against the new server.
3. Run `pnpm db:migrate` against the restored server; the API refuses to start on a schema mismatch (S5-05), which is the check that the restore is complete.
4. Rotate the application role passwords in Key Vault, then update `DATABASE_URL` on the API and workers container apps and restart them.
5. Replay: the outbox publisher re-publishes any `pending` rows; exports and notifications created after the restore point are lost and are listed for the schools from the audit log of the old server if it is still readable.
6. Verify with the smoke suite (`pnpm --filter @edupro/admin e2e` against staging) and a manual sign-in per school.
7. Close the incident with the post-mortem template; record the achieved RPO and RTO in this runbook.

## 3. Restore drill (quarterly)

`scripts/restore-drill.sh backups/` restores the newest dump into a scratch database, verifies the checksum, prints the schema version and core row counts, refuses tables without forced row-level security, runs the database test suite against the copy and prints the elapsed time. The drill is scheduled in the nightly workflow on the first Sunday of each quarter (`workflow_dispatch` any time).

## 4. Staging anonymisation

Staging is refreshed from a production dump only after `pnpm --filter @edupro/db anonymise` has run on the restored copy (`packages/db/src/anonymise.ts`): names become synthetic, mobiles and emails are replaced with school-specific test values, addresses and document numbers are cleared, audit images are masked. The script refuses to run unless `ALLOW_ANONYMISE=1` and the database name contains `staging`, `scratch`, `drill` or `test`.

## 5. Application recovery

Container apps are stateless. Recovery is `terraform apply` for the environment followed by the deploy workflow for the last known good image tag. Object storage and Key Vault are geo-redundant; failover is a Terraform variable (`location`) change and a DNS update.
