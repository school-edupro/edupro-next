# Environment plan

| Environment | Purpose                                            | Data                                | Identity                          | Who deploys                          | Availability              |
| ----------- | -------------------------------------------------- | ----------------------------------- | --------------------------------- | ------------------------------------ | ------------------------- |
| local       | developer machine                                  | synthetic seed (`seed:dev`)         | dev bypass or One Auth dev realm  | developer                            | n/a                       |
| test        | CI per pull request                                | fixtures                            | dev bypass                        | GitHub Actions                       | ephemeral                 |
| staging     | production-like integration, demos, pentest target | anonymised copy of the pilot school | One Auth staging realm, MFA on    | `main` auto-deploy                   | business hours            |
| uat         | per school during rollout                          | migrated copy of that school        | One Auth production realm, MFA on | release manager                      | business hours            |
| production  | live                                               | live                                | One Auth production realm, MFA on | release manager with change approval | 99.9 percent school hours |

## Topology per environment (staging and above)

- Region: Indian region of the chosen cloud (data residency).
- Ingress: WAF and TLS termination; separate hostnames per app (`admin.`, `parent.`, `teacher.`, `apply.`, `api.`); HSTS preload.
- Compute: containers for `api`, `workers`, `admin`, `parent`, `teacher`, `public`; horizontal scale on the API and workers; Next.js apps run the standalone server.
- Data: managed PostgreSQL 16 with one read replica, point-in-time recovery, encrypted storage; managed Redis; object storage bucket per environment with server-side encryption and signed URLs only.
- Secrets: Azure Key Vault per environment; workloads read through managed identity; no secrets in images or pipeline logs.
- Observability: OpenTelemetry collector, metrics dashboard, log store with the retention in the logging standard, error tracker, uptime checks on `/api/v1/health` and `/healthz`.
- Backups: nightly full plus continuous WAL; monthly restore test into a scratch environment; audit partitions copied to write-once storage.

## Promotion

`local` -> pull request (`test`) -> merge to `main` (`staging`, automatic) -> tag (`uat`, then `production`, manual approval). Database migrations run as a pre-deploy job with the migrator credential from Key Vault; the API refuses to start if the schema is behind (migration check added in Sprint 5).

## Configuration matrix

| Setting                | local | test | staging | uat   | production                    |
| ---------------------- | ----- | ---- | ------- | ----- | ----------------------------- |
| `AUTH_DEV_BYPASS`      | 1     | 1    | unset   | unset | unset (API refuses otherwise) |
| Swagger at `/api/docs` | on    | on   | on      | off   | off                           |
| Rate limit per minute  | 600   | 600  | 600     | 300   | 300                           |
| Statement timeout      | 15 s  | 15 s | 15 s    | 10 s  | 10 s                          |
| Log level              | debug | info | info    | info  | info                          |
| Session max age        | 12 h  | 12 h | 8 h     | 8 h   | 8 h                           |

## Sprint 5 deliverables that complete this plan

Deploy workflows, infrastructure as code, Key Vault wiring, schema-version check at startup, anonymisation job for staging data, restore drill runbook.
