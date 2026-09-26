# Logging and personal data standard

Applies to the API, workers, Next.js apps, jobs and database procedures. Enforced by code in `apps/api/src/config/logging.ts` and `packages/db/src/audit-masks.ts`, and by review.

## 1. Classification

| Class | Examples | Log | Audit payload | Export |
|---|---|---|---|---|
| Public | school name, class code, notice title | yes | yes | yes |
| Internal | ids, timestamps, status, request ids, permission codes | yes | yes | yes |
| Personal | names, email, mobile, address, DOB, photos, guardian details, employee code | never in logs; ids only | yes, unmasked (needed for audit) | only with `*.export` permissions, audited |
| Sensitive | Aadhaar and other government ids, bank account and IFSC, PAN, health and clinic notes, disability, caste category, religion, salary, passwords and OTPs, tokens and secrets | never | masked as `***` | never in bulk; field-level permission |

Children's data is Personal or Sensitive by default. Parental consent records are Internal but reference Personal data.

## 2. Log rules

1. Structured JSON only (pino). Every line carries `requestId`, `schoolId` (when known), `userId` (when known), `route`, `status`, `durationMs`. Never the request body, query string values, headers other than an allow-list, or response bodies.
2. Redaction is applied by the logger, not by discipline: `authorization`, `cookie`, `set-cookie`, and any key matching the PII path list in `logging.ts` are replaced with `[Redacted]`.
3. Errors log `type`, `status`, `message` and the stack in non-production; production logs the stack to the error tracker only.
4. Security events are logged at `warn` with `event` set: `auth.failed`, `tenant.forbidden`, `permission.denied`, `mfa.required`, `sod.conflict`, `rate.limited`, `handler.misconfigured`. Alerts are built on these.
5. Procedures log with `RAISE LOG` including the request id passed in the context; never personal data.
6. Retention: application logs 90 days hot, 12 months cold; security events 12 months hot. Audit rows follow ADR-005.
7. Levels: `debug` local only, `info` production default, `warn` for security and degraded dependencies, `error` for failed requests with status 500 and job failures.

## 3. Audit payload rules

1. `before` and `after` images are stored unmasked for Personal fields and masked for Sensitive fields listed in `audit-masks.ts` (per entity type and a global list).
2. Never store credentials, tokens, OTPs or full card numbers in audit rows, even masked.
3. Audit rows for exports record the filter used and the row count, never the exported data.

## 4. Front-end rules

1. No personal data in URLs (query strings or paths): use ids. Search terms are POSTed or sent as headers-free fetch bodies through the proxy.
2. No personal data in browser storage beyond the current form draft; drafts are cleared on submit and logout.
3. Analytics, if ever added, receives page names and timings only.

## 5. Data subject rights support (DPDP)

Every Personal or Sensitive field maps to an entity in `docs/data/02-data-inventory-dpdp.md`, which is the source for the access, correction and erasure tooling in Sprint 20. New tables add their fields to that inventory in the same pull request.
