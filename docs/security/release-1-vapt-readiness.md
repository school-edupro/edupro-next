# Release 1 VAPT readiness and remediation (Sprint 21)

|        |                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope  | `docs/security/vapt-scope.md` (all four apps, the API, the compat API, device ingestion, webhooks, infrastructure)                                                                                                                                                           |
| Method | The CERT-In empanelled auditor was not engaged in this environment (no staging, no contract); the platform team ran the internal readiness pass: dependency audit, header and client-storage review, the automated attack suites, and the remediation of every finding below |
| Tester | Platform team, 2026-09-29                                                                                                                                                                                                                                                    |
| Result | No open high or critical finding from the internal pass. The external VAPT and its certificate remain the M4 condition                                                                                                                                                       |

## 1. Dependency audit (`pnpm audit --prod`)

| Package                    | Finding                                                                                                  | Severity | Remediation                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `fastify` 5.11.3           | schema validation bypass via root primitive coercion; X-Forwarded-\* spoofing under hop-count trustProxy | moderate | override raised to 5.12.5 (root `pnpm.overrides`); `trustProxy` set to exactly one hop (the ingress) instead of `true` |
| `@fastify/static` 8.3.0    | path traversal and route-guard bypass in directory listing and non-canonical paths                       | high     | `^10.1.5` in the API (Swagger UI is the only consumer, served on staging only)                                         |
| `postcss` 8.4.31 / ≤8.5.22 | arbitrary `.map` file read through `sourceMappingURL`; XSS via unescaped `</style>`                      | high     | override to 8.5.28 (build-time only; production images ship compiled CSS)                                              |
| `uuid` 8.3.2               | missing buffer bounds check in v3/v5/v6 with a caller-provided buffer                                    | moderate | dev-only (`autocannon → hyperid`), never in a production image; accepted, tracked until the load tool updates          |

After remediation: 0 critical, 0 high, 1 moderate (the dev-only `uuid`).

## 2. Headers and client-side controls

| Control                              | Admin                                                      | Parent                                                                                   | Teacher              | Public                | API                                       |
| ------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------- | --------------------- | ----------------------------------------- |
| Content-Security-Policy (production) | 'self', Google Fonts, no inline JS                         | 'self'; pay routes allow the gateway origins and the checkout script only                | 'self', Google Fonts | 'self', Google Fonts  | helmet defaults in production             |
| frame-ancestors / X-Frame-Options    | none / DENY                                                | none / DENY                                                                              | none / DENY          | none / DENY           | helmet                                    |
| X-Content-Type-Options               | nosniff                                                    | nosniff                                                                                  | nosniff              | nosniff               | helmet                                    |
| Referrer-Policy                      | strict-origin-when-cross-origin                            | same                                                                                     | same                 | same                  | helmet                                    |
| Permissions-Policy                   | camera, mic off; geolocation self                          | camera and geolocation self (bus map, photo upload)                                      | same as parent       | all off               | n/a                                       |
| Strict-Transport-Security            | 2 years, preload                                           | added (S21)                                                                              | added (S21)          | added (S21)           | helmet                                    |
| Cross-Origin-Opener-Policy           | same-origin (S21)                                          | same-origin (S21)                                                                        | same-origin (S21)    | same-origin (S21)     | helmet                                    |
| Session cookie                       | HttpOnly, Secure (prod), SameSite=Lax, encrypted (ADR-007) | same                                                                                     | same                 | applicant token, same | bearer from the BFF only                  |
| Offline cache (service worker)       | none                                                       | shell + last copy of pages; `no-store` responses never cached; cleared on sign-out (S21) | same as parent       | none                  | n/a                                       |
| Browser storage                      | sidebar and tour flags only                                | language cookie; no personal data in local storage                                       | same                 | none                  | n/a                                       |
| Rate limiting                        | per user through the API                                   | per user; public OTP and handshake per IP                                                | same                 | per IP                | `RATE_LIMIT_PER_MINUTE`, keyed by user/IP |

The admin smoke test asserts the header set on every response; the CSP strings are the production
configuration in each `next.config.ts`.

## 3. Automated attack suites (all pass on the freeze commit)

`security.e2e-spec.ts` (auth, RLS, permission coverage, compat shapes), `pentest.e2e-spec.ts` and
`pentest-fees.e2e-spec.ts` (injection, IDOR, replay, signature forgery, mass assignment, upload
sniffing), `redteam.e2e-spec.ts` (assistant prompt injection and data exfiltration), `hardening.e2e-spec.ts`,
`devices.e2e-spec.ts` (device keys), `sprint16` (service keys, MFA), `sprint20` (DSR guards, id numbers
never stored). Totals in the Sprint 21 record.

## 4. Review notes for the external auditor

- Every table carries forced row-level security; the restore drill asserts it on a restored copy.
- Privileged actions require a recent second factor (`requires_mfa` permissions: refunds, waivers,
  service keys, shadow closure, erasure).
- Compat endpoints run the new services (scopes, locks, workflow) and check permissions where the
  legacy contract has none (visitors, gate-pass decisions).
- Personal identifiers the platform does not need are dropped on arrival (Aadhaar numbers from the
  legacy visitor form, passwords and IMEI from the legacy login).
- Logging follows `docs/standards/logging-and-pii.md`: request ids, never personal values.

## 5. Open items for the external VAPT (Sprint 21 conditions)

1. Engage the CERT-In empanelled auditor with `vapt-scope.md`; staging with anonymised data.
2. Infrastructure tests (TLS, network rules, images) need the Azure subscription.
3. Mobile app builds pointed at the compat gateway for the MASVS checks.
