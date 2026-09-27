# Threat model: platform and identity

Method: STRIDE over the data-flow diagram of the foundation (design section 2 and 3). Scope: browser to BFF, BFF to API, API to PostgreSQL and Redis, One Auth, workers, device ingestion endpoint (design only, Sprint 9), object storage (Sprint 3). Out of scope until their sprints: payments, notifications, exports, compatibility API.

Severity uses the VAPT remediation scale from the project plan: critical 48 h, high 7 days, medium 30 days, low next release.

## 1. Assets

| Asset                                                                                          | Why it matters                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Children's and guardians' personal data (names, DOB, mobile, address, Aadhaar, health, photos) | DPDP Act 2023 children's data; reputational and legal harm |
| Employee personal and financial data (PAN, bank account, salary)                               | statutory and fraud risk                                   |
| Money records (receipts, adjustments, payroll)                                                 | fraud, audit findings                                      |
| Marks and report cards                                                                         | integrity of results, board compliance                     |
| Credentials and tokens (One Auth tokens, session cookie, API keys, DB roles)                   | full compromise if leaked                                  |
| Audit trail                                                                                    | evidence; must be tamper-evident                           |
| Tenant boundary                                                                                | one school must never see another's data                   |

## 2. Trust boundaries

1. Internet to Next.js apps (browser, mobile, devices)
2. Next.js BFF to NestJS API (internal network, bearer token)
3. API and workers to PostgreSQL (application role, RLS) and Redis
4. Platform to One Auth (OIDC, JWKS)
5. Platform to object storage and third parties (later sprints)
6. Operator access (migrator role, CI, Key Vault)

## 3. Threats and controls

| ID  | Threat (STRIDE)                                                  | Boundary | Control in place                                                                                                                                                                        | Gap and owner                                                                                | Severity |
| --- | ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| T01 | Spoofing: forged or replayed bearer token                        | 2        | RS256 verification against One Auth JWKS, `iss`/`aud`/`exp`/`nbf`, 30 s tolerance; dev bypass refused in production and gated by `AUTH_DEV_BYPASS`                                      | Add `jti` replay cache for high-value actions (Sprint 5)                                     | High     |
| T02 | Spoofing: session cookie theft                                   | 1        | JWE `A256GCM` cookie, `HttpOnly`, `Secure` in production, `SameSite=Lax`, 12 h max age; access token never reaches the browser                                                          | Bind session to a device fingerprint hash and rotate on privilege change (Sprint 5)          | High     |
| T03 | Spoofing: developer sign-in reachable in production              | 1        | `env.devBypass` false unless development; API refuses to start with the flag in production; production build never renders the form                                                     | CI check that production images have the flag unset (Sprint 5 deploy workflow)               | Critical |
| T04 | Tampering: cross-tenant read or write through a missing filter   | 3        | RLS enabled and forced on every tenant table; `WITH CHECK` on writes; `Db.withTenant()` is the only entry; structural test fails the build for any table with `school_id` but no policy | Add the same structural test for future schemas (reporting)                                  | Critical |
| T05 | Tampering: forged `X-School-Id`                                  | 2        | TenantGuard validates the header against memberships loaded at authentication; RLS context set only after validation                                                                    | none                                                                                         | Critical |
| T06 | Tampering: privilege escalation through role assignment          | 2, 3     | `access.assignment.manage` requires MFA; SoD rule blocks holding assignment management and audit export together; every grant audited                                                   | Grant-time SoD check implementation (Sprint 3)                                               | High     |
| T07 | Tampering: audit log modification                                | 3        | Append-only: no UPDATE/DELETE privilege for the app role, trigger rejects both, partitions unreachable directly, migrator has SELECT only on the parent                                 | Ship audit partitions to write-once storage nightly (Sprint 5)                               | High     |
| T08 | Tampering: migration run as app role or app run as migrator      | 3, 6     | Separate roles; `Db.assertApplicationRole()` refuses `BYPASSRLS`, superuser or `edupro_migrator`; migrations checksum-locked                                                            | Rotate the migrator password into Key Vault; CI uses a scoped secret (S0-09)                 | High     |
| T09 | Repudiation: action without actor                                | 2        | Every mutating request audited with actor, request id, IP, user agent; triggers on money and marks tables                                                                               | Service-level audit is post-commit; use the outbox so a crash cannot lose the row (Sprint 3) | Medium   |
| T10 | Repudiation: impersonation misuse                                | 2        | Design: impersonation token with `impersonated_by`, audited start and end, MFA required                                                                                                 | Implement in Sprint 5 with time box and reason                                               | High     |
| T11 | Information disclosure: PII in logs                              | 1, 2     | pino redaction of authorization, cookies, and PII paths; problem details never echo request bodies; request id only                                                                     | Log review in staging before pilot; alert on redaction misses (Sprint 5)                     | High     |
| T12 | Information disclosure: verbose errors                           | 2        | Problem details with stable types; stack traces only in server logs; Swagger disabled in production                                                                                     | none                                                                                         | Medium   |
| T13 | Information disclosure: BigInt ids reveal volume; enumeration    | 2        | Ids are numeric strings; RLS makes enumeration across tenants return 404                                                                                                                | Consider opaque ids for public endpoints (public app, Sprint 8)                              | Low      |
| T14 | Information disclosure: `/me` leaks memberships of other schools | 2        | Only the caller's own memberships are returned; schools visible through self-membership policy only                                                                                     | none                                                                                         | Low      |
| T15 | Denial of service: request floods, expensive queries             | 1, 2     | Fastify rate limit per user or IP; 1 MB body limit; 15 s statement timeout on every tenant transaction; pool max 20                                                                     | WAF and CDN in front of production; per-endpoint limits for public forms (Sprint 8)          | Medium   |
| T16 | Denial of service: connection exhaustion from workers            | 3        | Separate pool per process; `SET LOCAL` context dies with the transaction                                                                                                                | Pool sizing per environment (Sprint 5)                                                       | Medium   |
| T17 | Elevation: handler without permission                            | 2        | Deny-by-default guard returns 500 on a missing declaration; CI permission-coverage test                                                                                                 | none                                                                                         | Critical |
| T18 | Elevation: stale permission cache after revocation               | 2        | 5 minute in-process cache; invalidated on grant or revoke in the same process                                                                                                           | Move to Redis with pub/sub invalidation across processes (Sprint 3)                          | Medium   |
| T19 | Elevation: SQL injection                                         | 3        | Parameterised queries everywhere; identifiers never interpolated from input; zod validation at the edge                                                                                 | Static rule in lint to forbid template-literal SQL with `${}` (Sprint 2)                     | High     |
| T20 | Elevation: dependency compromise                                 | 6        | pnpm lockfile, `pnpm audit` in CI, gitleaks                                                                                                                                             | SBOM and signed images (Sprint 5); Renovate weekly                                           | Medium   |
| T21 | Spoofing: OIDC state and nonce                                   | 1, 4     | PKCE, random `state` and `nonce` stored in a 10 minute HttpOnly cookie, verified on callback; `returnTo` restricted to same-origin paths                                                | none                                                                                         | High     |
| T22 | Information disclosure: secrets in repository                    | 6        | `.env` ignored, `.env.example` has placeholders, gitleaks in CI, Key Vault for environments                                                                                             | Rotate the development passwords before any shared environment                               | High     |

## 4. Abuse cases to test in the internal pentest (Sprint 11)

1. Member of school A with `academics.class.view` requests school B's class by id: expect 404, and no audit row in school B.
2. Class Teacher scoped to VI-A lists sections of VI: expect only VI-A.
3. Revoke a role then call within 5 minutes: document the cache window, verify Redis invalidation once implemented.
4. Replay a captured `Authorization` header after logout: expect success until token expiry; confirms the need for T01's `jti` cache for privileged actions.
5. Submit `school_id` inside a JSON body on any endpoint: expect it ignored (DTOs never accept it).
6. Attempt `UPDATE audit_logs` as the application role: expect permission denied.
7. Start the API with the migrator credentials: expect refusal.
8. Post a 2 MB body: expect 413.
9. Call `/api/docs` in production: expect 404.
10. Send `X-Academic-Year-Id` of another school: expect 403 `year-forbidden`.

## 5. Residual risk accepted for Sprint 1

In-process permission cache (T18) and post-commit audit write (T09) are accepted until Sprint 3 delivers Redis and the outbox. Both are logged in the RAID log.
