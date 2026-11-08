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

## 6. Re-audit and CI repair, 8 Nov 2026

GitHub Actions had never passed (218 runs since 3 Oct 2026), so the audit gate in CI had never run:
`pnpm/action-setup` refused the run because the pnpm version was given twice (the action's `version: 9`
and `packageManager: pnpm@9.12.0`). With that removed, the next steps were run in a clean copy against
an empty database before pushing; what they found and what was done:

| Where                 | Finding                                                                                                                                              | Done                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| CI, all jobs          | pnpm version given twice                                                                                                                             | the action reads `packageManager`; `PNPM_VERSION` removed                                                   |
| Images (API, workers) | the Dockerfiles copied a fixed list of workspace packages and missed `@edupro/ai` and `@edupro/etl`; `deploy` was given the API and all its packages | `pnpm fetch` from the lockfile, then the whole workspace; build `@edupro/api...`; `deploy` of the API alone |
| Image (admin)         | missed `@edupro/bff`; copied a `public/` folder that does not exist                                                                                  | same pattern; the folder is made before the copy                                                            |
| `@edupro/db` build    | `src/prisma.ts` needs the generated Prisma client, which a clean install does not make                                                               | `build` and `typecheck` run `prisma generate` first                                                         |
| API e2e steps         | Jest never exits (the suites' pools and Redis connections): a CI step would run until the 6-hour limit                                               | `forceExit` in `test/jest-e2e.config.cjs`                                                                   |
| `redteam`, `sprint15` | mark today's attendance: refused on a Sunday (weekly off), so CI failed every Sunday                                                                 | their test school has no weekly off                                                                         |
| `turbo test`          | `DATABASE_MIGRATOR_URL` was not passed to the test tasks (turbo passes only listed variables)                                                        | listed in `turbo.json`                                                                                      |
| Deploy staging        | the roll-out logs in to Azure, which is not set up                                                                                                   | the roll-out job runs once the repository has the `AZURE_RESOURCE_GROUP` variable; the images still build   |
| `.dockerignore`       | `.env` and the real-data folder were not excluded from a local image build                                                                           | excluded                                                                                                    |

Dependency audit (`pnpm audit --audit-level=high`, the CI gate, dev tools included): **9 critical and 17
high** before; after, **0 critical, 0 high** (the one exception accepted that day, zod 3, was fixed
the same evening by the zod 4 upgrade below; `pnpm.auditConfig` is gone).

| Package                                        | Finding                                                                                                                               | Severity | Remediation                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next` 15.5.26 (all four apps)                 | unauthenticated remote code execution through image optimisation; Server Actions denial of service; `sharp`, `source-map-js` under it | critical | `^15.5.29` (with `eslint-config-next`)                                                                                                                                                                        |
| `storybook` / `@storybook/*` 8.6.15            | missing origin validation, dev-server code injection, WebSocket hijacking                                                             | critical | `^8.6.19` (dev only)                                                                                                                                                                                          |
| `vitest` 2.1.9 (`tinypool`, `vite` 5)          | UI-server file read and execution; prototype-pollution RCE in tinypool                                                                | critical | Vitest `^4.1.12` (no tinypool); the UI's Vite `^6.4.5` (dev only)                                                                                                                                             |
| `handlebars`, `shell-quote`                    | JavaScript / command injection (under `ts-jest`, `concurrently`)                                                                      | critical | overrides `^4.7.10`, `^1.12.0` (dev only)                                                                                                                                                                     |
| `@azure/msal-node` 6 (under `@azure/identity`) | authorization-code flow may disclose parameters                                                                                       | high     | `@azure/identity` `^4.14.1` (msal-node 7.1)                                                                                                                                                                   |
| `follow-redirects`, `joi`                      | credential headers across redirects; quadratic e-mail split                                                                           | high     | overrides `^1.16.2`, `^17.13.9` / `^18.3.1` (dev only)                                                                                                                                                        |
| `systeminformation`                            | Windows command injection (the API's host metrics)                                                                                    | high     | override `^5.33.19`                                                                                                                                                                                           |
| `@grpc/grpc-js`, `re2js` (under `firebase`)    | auth context; quadratic lookbehind                                                                                                    | high     | overrides `^1.14.7`, `^2.9.1`                                                                                                                                                                                 |
| `zod` 3.25.76                                  | memory exhaustion validating oversized constrained collections (CVE-2023-54404)                                                       | high     | **fixed**: zod `^4.6.7` in the API and the workers (nestjs-zod 5.5.0 already takes zod 4); the `ignoreCves` entry is removed and the gate passes without it. JSON bodies stay capped at 1 MB (`app.setup.ts`) |

Checked after the upgrades, in a clean copy on an empty database: lint, typecheck, the 339 migrations from
zero, `db:test`, `turbo test` (ai, storage, etl, db, workers, API unit), permission coverage, red team
(7/7), the assistant evaluation, `test:scripts`, the token lint, the Storybook build and its 27
interaction tests, the audit gate, `pnpm build`, and the three image recipes run step by step outside
Docker (the API's packaged modules load). Moderate and low findings (22 and 6) are left for the next pass.

### zod 4 upgrade (8 Nov 2026)

What zod 4 changes and what was done so the API behaves as before:

| zod 4 change                                                                                                 | Done                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default messages reworded ("Invalid input: expected string, received undefined" for zod 3's "Required")      | `apps/api/src/common/validation/zod-messages.ts`: a global error map with zod 3's sentences (the screens show them as "field: message"); a message written on a schema still wins                          |
| issue codes renamed                                                                                          | the `errors[]` shape is unchanged (`path`, `message`, `code`); `code` now carries zod 4's names, e.g. `invalid_format` for `invalid_string`, `invalid_value` for `invalid_enum_value` (no screen reads it) |
| `.partial()` fills each field's `.default()` in when the field is absent: an update would reset saved values | `patchOf()` (`common/validation/patch-of.ts`) for every update body, 27 schemas; a field left out stays out                                                                                                |
| `.default()` is no longer parsed: an object's `.default({})` skips its own field defaults                    | `.prefault({})` (consent form audience and settings, report builder options)                                                                                                                               |
| `z.record` with an enum key wants every key; one-argument `z.record` removed                                 | `z.partialRecord` (ACR assessors, employee list kinds, exit notice days); the Razorpay webhook payload names its key type                                                                                  |
| a `z.unknown()` key is required (4.4)                                                                        | a setting's `value` stays optional (each key's own schema decides)                                                                                                                                         |
| `.pick` / `.omit` / `.partial` on a refined object throw when the file loads                                 | none in the code (all 98 schema files load)                                                                                                                                                                |

Checked: lint, typecheck, the API unit tests (with new tests for both helpers), the workers tests, the
OpenAPI document (1,875 paths), all 157 API e2e suites (1,171 tests: two activity-log cases fail on a
Sunday only, as the test logs today and the compliance count leaves Sundays out), the live API's
validation errors, and `pnpm audit --audit-level=high` with no exception.
