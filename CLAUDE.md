# EduPro Next — guide for Claude sessions

School ERP rebuild of the legacy PHP "schoolerpalpha" (Mobilise App Lab; owner Kamal Kishor Sharma, CFO).
Claude acts as senior developer + architect + business analyst. Plans live in the legacy folder
`~/Documents/FTP/schoolerpalpha/` (`MERN_MIGRATION_BLUEPRINT.md`, `SCHOOL_ERP_PROJECT_PLAN.md`,
`SCHOOL_ERP_SPRINT_PLAN.md`); design notes in `docs/design/` (latest 19 student 360 + report builder,
20 portal profile + approvals); sprint records `docs/sprints/`; demo logins `docs/demo-logins.md`.

## Working agreement (from the user)

- New requirement → **plan first and ask questions, no development**; build only after the go-ahead.
- Benchmark against the best Indian school ERPs (Entab, Fedena, Teachmint, MyClassboard, PowerSchool).
- Every phase: implement → API e2e + a11y + **browser check of the real buttons** → commit (message ends
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) → short report.
- Every drop-down is a typeahead (`<input list>` + `<datalist>`, `RefDatalist`/`CascadeAddress`);
  state follows country, city follows state.
- UI = Mobilise Design System (navy/cyan, Poppins / Source Sans 3); lint forbids raw hex/px — use tokens.
- Never enter tokens/keys/passwords. Never push: `origin` (github.com/school-edupro/edupro-next) is the
  user's to push from Terminal.

## Stack and layout

pnpm monorepo. `apps/api` NestJS + Fastify (`/api/v1`, RLS via `db.tenant`); `apps/admin` (:3000),
`apps/parent` (:3001), `apps/teacher` (:3002), `apps/public` (:3003) Next.js 15 / React 19;
`apps/workers` BullMQ (exports, PDFs via Playwright, jobs); `packages/db` (migrations, SQL helpers,
seeds, shared logic consumed from `dist`), `packages/ui` (components + `src/app.css`), `packages/bff`,
`packages/ai`. PostgreSQL 16 with forced RLS (`app.apply_tenant_rls`), Redis.

## Running locally (user-space toolchain, no Homebrew/Docker)

```bash
cd ~/Documents/edupro-next
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"; set -a; source .env; set +a; unset NODE_ENV
scripts/local-stack.sh start          # Postgres (~/.local/pgsql) + Redis
pnpm --filter @edupro/db migrate
RATE_LIMIT_PER_MINUTE=1000000 pnpm --filter @edupro/api dev   # :4000
pnpm --filter @edupro/admin dev ; pnpm --filter @edupro/parent dev ; pnpm --filter @edupro/teacher dev
pnpm --filter @edupro/workers dev     # REQUIRED for any Excel/PDF export
pnpm --filter @edupro/db seed:demo    # Alpha + Beta demo data;  then seed:beta (API must be up)
```

- No `psql`: run SQL with a temporary node script in `packages/db` using `DATABASE_MIGRATOR_URL`
  (the app role is RLS-blind). No GNU `timeout`: use `perl -e 'alarm N; exec @ARGV' …`.
- After changing `packages/db/src` → `pnpm --filter @edupro/db build`, then **restart API and workers**
  (watchers ignore `dist`). Never `pnpm build` while `next dev` runs.
- Dev sign-in: login pages have a "Sign in as" picker (`Bearer dev:<sub>` for API scripts with
  `x-school-id`). Alpha: dev-admin, dev-principal, dev-coordinator, dev-teacher (VI-A), dev-subject,
  dev-auditor, dev-clerk, dev-accounts, dev-parent (Aarav VI-A + Diya), dev-student, dev-nobody.
  Beta: dev-beta-principal/-coordinator/-teacher (III-A)/-subject/-auditor/-clerk/-accounts/
  -parent (Rohan Verma, 2 kids III-A)/-student/-nobody. School ids: 1 ALPHA, 2 BETA.

## Tests

- API e2e: `cd apps/api && perl -e 'alarm 1500; exec @ARGV' npx jest --config test/jest-e2e.config.cjs
--testPathIgnorePatterns performance redteam pentest-fees > log 2>&1` (Jest hangs after the pass
  line → `pkill -f "jest.js --config test/jest-e2e.config.cjs"`; never two e2e runs at once; redirect
  to a file, a `| tail` pipe shows nothing). Last full run 2026-10-01: 38 suites / 272 passed.
- Workers `npx vitest run` (22); db `npx vitest run` (unit + RLS).
- a11y: `cd apps/admin && npx playwright test --project a11y -g "<name>"` (list in `e2e/a11y.spec.ts`;
  `pnpm … -- --grep` is ignored). Dialogs fade in → wait 400 ms before contrast checks.

## Gotchas that cost time

- Permission codes must be `module.resource.action`; one `@RequirePermission` per handler.
- Never nest `db.tenant` inside a tenant callback (returns nothing); a `.catch()` inside a tenant
  transaction still aborts it.
- A migration applied locally cannot be edited (checksum) — add a new one.
- Server actions: `back()` adds a nonce `r=` so the redirect differs from the current URL; Playwright
  must wait for a URL different from before the click. A Next page module may export only the page.
- Admin `uploadAll` uses `new Headers` (doubled Content-Type → 415). API sends CORP → images go
  through `/api/files/:id/view` (admin) or `/api/photo/...` (parent).
- exceljs can't read workbooks re-saved with cell notes (readFile strips notes via jszip).
- `.ep-kicker` is uppercase → case-insensitive text matching in browser tests.
- In the in-app browser pane, pointer clicks are flaky; drive with JS `.click()` / `form.submit()`.

## Where things stand (2026-10-01)

Sprints 0–23 done; Release 1 frozen (M4/M5 reported with conditions). Then post-freeze work:
school profile + masters (0034), years reopen (0035), student 360 profile / quick add / Excel update /
report builder (0036–0039), students list + per-user views + parent photos + profile printout (0040),
portal profile + field policy + routed/partial/bulk approvals (0041, `aa52894`), Beta demo logins and
data `seed:beta` (`15d0f99`); parent/student portal frame and home dashboard (`adcbcd0`); sub-caste
list, city/bank from masters, portal photo upload with approval, admin full-profile photos (0042–0043).
Migrations: 43.

Open follow-ups: SMS/WhatsApp notice on approval decisions (needs a template); fee/attendance columns in the report builder; legacy student data clean-up and import
(dry run: `~/Documents/student_data/Student_Import_Check_2026-09-30.xlsx`); Release 2 (S24 HR core)
per the sprint plan — confirm with the user before starting.
