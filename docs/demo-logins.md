# Demo data and role logins

`pnpm --filter @edupro/db seed:demo` fills the local database with two schools and one developer login per
role. It runs after `pnpm db:migrate` and `pnpm --filter @edupro/db seed:dev`, is safe to rerun (people
data is created only once), and refuses to run when `NODE_ENV=production`.

## What the seed creates

| Data                   | Alpha Public School (Pune)                                                                                       | Beta Public School (Nagpur) |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Academic years         | 2025-26 closed, 2026-27 active, 2027-28 planned                                                                  | same                        |
| Classes and sections   | I to X, sections A and B (20 sections, capacity 40)                                                              | I to V, section A           |
| Students               | 161 with guardians (every sixth student shares a guardian, so siblings exist), enrolments with roll numbers      | 30                          |
| Employees              | 20 with designations, departments, postings and reporting lines to the Principal, Vice Principal and Coordinator | 8                           |
| Notification templates | fee reminder (SMS with DLT ids), absent alert (WhatsApp), welcome (email), notice (push)                         | none                        |
| Delivery log           | 24 messages in every status (delivered, sent, failed, queued)                                                    | none                        |
| Settings               | holidays list, late-fee mode, security lead email                                                                | holidays, late-fee mode     |
| Security history       | one ended impersonation session, one closed break-glass window with its report, sample audit rows                | none                        |
| Delegation             | the Academic Coordinator covers for the class teacher of VI-A for a week                                         | none                        |

## Sign in as a role

Open http://localhost:3000/login (admin), http://localhost:3001/login (parent app) or
http://localhost:3002/login (teacher app) and pick a subject in **Sign in as** (development bypass).

| Subject           | Person              | Role                                           | What to check                                                                                                                  |
| ----------------- | ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `dev-admin`       | Dev Admin           | School Admin in Alpha and Beta                 | Every screen; switch school in the header; no audit export (segregation of duties)                                             |
| `dev-group`       | Gita Group Admin    | Group Admin in both                            | Same plus impersonation: Members page shows **Act as** with a reason field; banner and **End impersonation**                   |
| `dev-principal`   | Meena Iyer          | School Admin of Alpha, employee E001           | Employees page shows her as the reporting line of most staff; Security page lists her closed break-glass window                |
| `dev-coordinator` | Rajesh Kulkarni     | Academic Coordinator                           | Students and enrolments editable, no access administration, no settings                                                        |
| `dev-teacher`     | Anita Deshmukh      | Class Teacher of VI-A (scoped)                 | Students list shows only VI-A (8 students); search hides other students; a delegation from the coordinator is active this week |
| `dev-subject`     | Suresh Nair         | Subject Teacher VI-A and VI-B (scoped)         | Sections and students limited to VI-A and VI-B; cannot edit                                                                    |
| `dev-auditor`     | Priya Auditor       | Auditor                                        | Read everything, Audit log with **Export** (needs MFA, satisfied by the dev bypass), no forms                                  |
| `dev-support`     | Sam Support         | Support Engineer in both schools               | Jobs, security page, platform views; no people data                                                                            |
| `dev-clerk`       | Kavita Front Office | Front Office (school role created by the seed) | Admit students, link guardians, enrol, search, exports, send notifications; nothing under Access or System                     |
| `dev-parent`      | Suresh Sharma       | Guardian of Aarav (VI-A) and Diya (IV-A)       | Parent app home; admin app shows an empty navigation (no admin permissions)                                                    |
| `dev-student`     | Aarav Sharma        | Student                                        | Parent or student app home; nothing in the admin app                                                                           |
| `dev-nobody`      | Nobody Member       | No roles                                       | Deny by default: empty navigation, every direct URL answers "permission denied"                                                |

Add `;auth_time=<unix seconds>` to a subject (for example `dev-admin;auth_time=1700000000`) in an API
`Authorization: Bearer dev:...` header to simulate a stale multi-factor sign-in; the API then answers
`mfa-required` on privileged actions and the admin app shows the step-up page.

## Resetting

```bash
scripts/local-stack.sh start
pnpm db:migrate
pnpm --filter @edupro/db seed:dev
pnpm --filter @edupro/db seed:demo
```

To start from an empty database, drop and recreate it (see `docs/sprint-0-checklist.md`), then run the
three commands above.
