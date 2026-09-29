# VAPT scope for Release 1 (CERT-In empanelled auditor, Sprint 21)

|             |                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose     | Independent vulnerability assessment and penetration test of EduPro Next before the pilot go-live (M4 gate: no open critical or high)                               |
| Standard    | CERT-In guidelines for auditing organisations; OWASP ASVS 4 level 2 for the web applications and API; OWASP MASVS L1 for the compat surface used by the mobile apps |
| Window      | Sprint 21 weeks 43-44: test 5 working days, remediation 5, retest 2                                                                                                 |
| Environment | Staging (production-like, anonymised demo data from `packages/db/src/anonymise.ts`), never production                                                               |

## 1. Assets in scope

| Asset                          | URL / entry point                                            | Notes                                                                                |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Admin app                      | `https://admin.staging.<domain>`                             | Next.js BFF, One Auth sign-in, encrypted session cookie, CSP and security headers    |
| Parent app                     | `https://parent.staging.<domain>`                            | PWA, offline shell, payment flows (gateway test mode)                                |
| Teacher app                    | `https://teacher.staging.<domain>`                           | PWA                                                                                  |
| Public admissions app          | `https://apply.staging.<domain>`                             | OTP-authenticated applicants, proof of work                                          |
| API                            | `https://api.staging.<domain>/api/v1`                        | NestJS on Fastify; OpenAPI at `/api/docs` on staging                                 |
| Compatibility API              | `https://api.staging.<domain>/api/v1/compat/v1`              | Handshake with the legacy central-auth token; legacy envelopes                       |
| Device ingestion               | `…/attendance/rfid`, `…/attendance/punch`, `…/transport/gps` | Per-device or service keys                                                           |
| Gateway callbacks and webhooks | `…/payments/*`, `…/comms/delivery`                           | Signed; replay protected                                                             |
| Workers                        | no inbound surface                                           | Review of job payload handling and outbox                                            |
| Infrastructure                 | Azure resource group of staging                              | Container apps, PostgreSQL flexible server, Redis, storage, Key Vault, network rules |

## 2. Roles and test accounts

Ten accounts on staging, one per role (group admin, school admin, coordinator, class teacher, subject
teacher, accountant, clerk, librarian, parent with two children, student), plus a second parent in
another school for cross-tenant tests, a device key, a service key with `shadow.feed`, and an
expired-MFA variant of the admin. Credentials handed over out of band; rotated after the retest.

## 3. What to test (minimum)

- Authentication and session: One Auth flows, cookie attributes, session fixation, logout, MFA
  step-up on privileged actions, compat handshake replay and token forgery.
- Authorisation: horizontal (another family's child, another school's data), vertical (permission
  codes, scopes by section, SoD pairs), row-level security bypass attempts through every list and
  export, break-glass and impersonation audit.
- Input handling: injection on every parameter (SQL through bound parameters, template placeholders,
  CSV/Excel uploads with formulas, file uploads with content sniffing), mass assignment on DTOs.
- Business logic: fee posting idempotency and concurrency, payment webhook signature and replay,
  refund and reversal approvals, marks locks, report-card withholding, consent enforcement at dispatch,
  DSR erasure guards.
- Files and exports: signed URL lifetime and scope, export ownership, sensitive-file audit.
- Client: CSP effectiveness, clickjacking, DOM XSS in rendered templates and the assistant, storage of
  personal data in the browser (the offline shell), service-worker cache scope.
- Infrastructure: TLS configuration, exposed ports, container images, secrets handling, backup access,
  logging of personal data (`docs/standards/logging-and-pii.md`).
- Rate limiting and abuse: OTP endpoints, public admissions, handshake, assistant budgets.

## 4. Out of scope

Denial of service beyond rate-limit verification, social engineering, the legacy PHP server, the
third-party gateway and messaging providers themselves (contractual assurance), physical security.

## 5. Evidence we provide

`docs/security/*.md` (foundation review, Phase 2 pentest, Phase 3 fees VAPT), the threat models
(`docs/design/03` to `06`), the permission catalogue and coverage test, the CSP and headers config,
the pentest e2e suites (`pentest*.e2e-spec.ts`, `redteam.e2e-spec.ts`), SBOMs from the build.

## 6. Deliverables expected

Report with CVSS-scored findings and reproduction steps; a remediation call; retest report; the
CERT-In format certificate on closure of all critical and high findings (M4 gate evidence).
