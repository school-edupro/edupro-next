# Security policy

EduPro Next handles personal data of children, parents and staff, and school money. Security is a product requirement, not a phase.

## Reporting a vulnerability

Email security@mobilise.co.in with a description, reproduction steps and impact. Do not open a public issue. We acknowledge within 2 working days and aim to remediate critical findings within 48 hours, high within 7 days, medium within 30 days.

## Standards

- OWASP ASVS 5.0 Level 2 across the product; Level 3 controls for authentication, session management, access control, payments and audit.
- CERT-In empanelled VAPT before every major release and annually.
- Digital Personal Data Protection Act 2023 and DPDP Rules 2025: consent, notices, children's data, data principal rights, breach notification.
- ISO 27001 aligned secure development lifecycle.

## Controls enforced by this repository

| Control                                       | Where                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Deny-by-default authorisation                 | `apps/api/src/common/access/permission.guard.ts` and the CI test that every handler declares a permission |
| Tenant isolation in the database              | `packages/db/migrations/0002_rls.sql`, `packages/db/test/rls.test.ts`                                     |
| Append-only audit                             | `packages/db/migrations/0003_audit.sql`                                                                   |
| Secret scanning, SAST, dependency scanning    | `.github/workflows/ci.yml`                                                                                |
| Development auth bypass refused in production | `apps/api/src/common/auth/jwt.guard.ts`                                                                   |
| Security headers and strict CORS              | `apps/api/src/main.ts`, `apps/admin/next.config.ts`                                                       |
