# Sprint 21 record: VAPT readiness and remediation, M4 (Phase 4, weeks 43-44)

|             |                                                                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal        | Remediation of security findings across platform, squads and front ends (CSP, headers, client storage); the CERT-In empanelled VAPT with retest and certificate; UAT completion; M4 gate                                                           |
| Environment | Local only. No external auditor, staging or pilot users were available, so the sprint ran the internal readiness pass (`docs/security/release-1-vapt-readiness.md`) and remediated every finding it produced; the external VAPT is an M4 condition |
| Commit      | see `git log` (this record is committed with the code)                                                                                                                                                                                             |

## 1. Scope and outcome

| Id     | Task (sprint plan row S21)                            | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S21-01 | Platform and infrastructure remediation               | Done. `pnpm audit --prod`: fastify 5.11.3 → 5.12.5 (schema coercion bypass, X-Forwarded spoofing), `@fastify/static` 8 → 10.1.5 (path traversal, route-guard bypass), postcss → 8.5.28 (source-map file read, `</style>` XSS); `trustProxy` narrowed to the single ingress hop; result 0 high / 0 critical, one moderate dev-only (`uuid` under the load tool)                                                                                   |
| S21-02 | Squad A and B remediation                             | Done as part of the readiness pass: the compat parity layer checks permissions where the legacy contract has none (visitor log, gate-pass decisions); erasure guards and second factor verified by `sprint20.e2e-spec.ts`; the attack suites re-run green on the upgraded stack (44 tests across `security`, `pentest`, `pentest-fees`, `redteam`, `hardening`, `compat`, `compat-writes`, `sprint20`)                                           |
| S21-03 | Front-end remediation: CSP, headers, client storage   | Done. Production Content-Security-Policy on the parent, teacher and public apps (admin already had one); the pay routes carry a policy that allows only the gateway origins and the checkout script; HSTS and Cross-Origin-Opener-Policy on every app; `object-src 'none'`; service workers never cache `no-store` responses and clear the whole cache on sign-out (`/login?signedOut=1`); a smoke test asserts the header set on every response |
| S21-04 | CERT-In empanelled VAPT executes; retest; certificate | Not possible here (no auditor, no staging). `docs/security/vapt-scope.md` is the engagement brief; `release-1-vapt-readiness.md` the evidence pack. M4 condition                                                                                                                                                                                                                                                                                 |
| S21-05 | UAT completion                                        | Scripts ready (`docs/quality/uat-phase-2.md`, `uat-fees.md`, `uat-exams-transport-library.md`); execution with the pilot is an M4 condition                                                                                                                                                                                                                                                                                                      |
| S21-06 | M4 gate                                               | `docs/sprints/m4-gate-report.md`: pass with conditions                                                                                                                                                                                                                                                                                                                                                                                           |

## 2. Changes

`package.json` overrides (`fastify`, `postcss`), `apps/api/package.json` (`@fastify/static`),
`apps/api/src/main.ts` (proxy trust), `apps/{parent,teacher,public}/next.config.ts` and
`apps/admin/next.config.ts` (headers and CSP), `apps/{parent,teacher}/public/sw.js` and
`components/RegisterSw.tsx` (cache rules and sign-out clearing), `packages/bff/src/index.ts`
(sign-out redirect flag), `apps/admin/e2e/smoke.spec.ts` (header test). No migration.

## 3. Verification

| Suite                               | Result                                       |
| ----------------------------------- | -------------------------------------------- |
| Security-related API e2e (8 suites) | 44/44                                        |
| Full API e2e on the upgraded stack  | see the commit message                       |
| Admin smoke (incl. the header test) | pass                                         |
| Lint, typecheck, format             | clean on every app and package               |
| Builds (production, CSP applied)    | api, workers, admin, parent, teacher, public |

## 4. Carried into the pilot

The M4 conditions (external VAPT, legacy report-card comparison, UATs, M3 conditions, DR drill on
staging); Release 2 scope per `docs/release-1-freeze.md`.
