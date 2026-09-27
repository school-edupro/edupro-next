# Demo data and role logins

`pnpm --filter @edupro/db seed:demo` fills the local database with two schools and one developer login per
role. It runs after `pnpm db:migrate` and `pnpm --filter @edupro/db seed:dev`, is safe to rerun (people
data is created only once), and refuses to run when `NODE_ENV=production`.

## What the seed creates

| Data                   | Alpha Public School (Pune)                                                                                                                                                                                           | Beta Public School (Nagpur) |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Academic years         | 2025-26 closed, 2026-27 active, 2027-28 planned                                                                                                                                                                      | same                        |
| Classes and sections   | I to X, sections A and B (20 sections, capacity 40)                                                                                                                                                                  | I to V, section A           |
| Students               | 161 with guardians (every sixth student shares a guardian, so siblings exist), enrolments with roll numbers                                                                                                          | 30                          |
| Employees              | 20 with designations, departments, postings and reporting lines to the Principal, Vice Principal and Coordinator                                                                                                     | 8                           |
| Notification templates | fee reminder (SMS with DLT ids), absent alert (WhatsApp), welcome (email), notice (push)                                                                                                                             | none                        |
| Delivery log           | 24 messages in every status (delivered, sent, failed, queued)                                                                                                                                                        | none                        |
| Settings               | holidays list, late-fee mode, security lead email                                                                                                                                                                    | holidays, late-fee mode     |
| Security history       | one ended impersonation session, one closed break-glass window with its report, sample audit rows                                                                                                                    | none                        |
| Delegation             | the Academic Coordinator covers for the class teacher of VI-A for a week                                                                                                                                             | none                        |
| Subjects (Sprint 6)    | 10 subjects; classes I to V study 7 (EVS, Art, Music…), VI to X study 8 (Science, Social Science, Computer Science elective in IX and X)                                                                             | 7 subjects, primary set     |
| Teacher assignments    | a class teacher for every section (Anita Deshmukh for VI-A), the coordinator on VI to X, the Vice Principal as indicator on IX and X, five subject teachers on VI-A and VI-B (Suresh Nair takes Mathematics in both) | a class teacher per section |
| Timetable              | 9 periods (assembly, 7 teaching, break); a full Monday to Saturday timetable for all 20 sections with rooms; Saturday is a half day                                                                                  | same for 5 sections         |
| Status history         | a "created" entry for every student; one student of X-B left (reason and actor recorded)                                                                                                                             | created entries             |
| Imports                | one committed roll (class VI admissions) and one validated employee file with a rejected mobile number                                                                                                               | none                        |

## Sign in as a role

Open http://localhost:3000/login (admin), http://localhost:3001/login (parent app) or
http://localhost:3002/login (teacher app) and pick a subject in **Sign in as** (development bypass).

| Subject           | Person              | Role                                           | What to check                                                                                                                                                                        |
| ----------------- | ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dev-admin`       | Dev Admin           | School Admin in Alpha and Beta                 | Every screen; switch school in the header; no audit export (segregation of duties)                                                                                                   |
| `dev-group`       | Gita Group Admin    | Group Admin in both                            | Same plus impersonation: Members page shows **Act as** with a reason field; banner and **End impersonation**                                                                         |
| `dev-principal`   | Meena Iyer          | School Admin of Alpha, employee E001           | Employees page shows her as the reporting line of most staff; Security page lists her closed break-glass window                                                                      |
| `dev-coordinator` | Rajesh Kulkarni     | Academic Coordinator                           | Students and enrolments editable; Subjects, Teacher assignments, Timetable and Bulk import are editable; no access administration, no settings                                       |
| `dev-teacher`     | Anita Deshmukh      | Class Teacher of VI-A (scoped)                 | Students list shows only VI-A (8 students); Teacher assignments and Timetable show VI-A only; teacher app **My classes** shows her week; a delegation from the coordinator is active |
| `dev-subject`     | Suresh Nair         | Subject Teacher VI-A and VI-B (scoped)         | Sections, students, assignments and timetables limited to VI-A and VI-B; teacher app shows Mathematics in both sections; cannot edit                                                 |
| `dev-auditor`     | Priya Auditor       | Auditor                                        | Read everything, Audit log with **Export** (needs MFA, satisfied by the dev bypass), no forms                                                                                        |
| `dev-support`     | Sam Support         | Support Engineer in both schools               | Jobs, security page, platform views; no people data                                                                                                                                  |
| `dev-clerk`       | Kavita Front Office | Front Office (school role created by the seed) | Admit students, link guardians, enrol, search, exports, send notifications; nothing under Access, Academics setup or System                                                          |
| `dev-parent`      | Suresh Sharma       | Guardian of Aarav (VI-A) and Diya (IV-A)       | Parent app home; admin app shows an empty navigation (no admin permissions)                                                                                                          |
| `dev-student`     | Aarav Sharma        | Student                                        | Parent or student app home; nothing in the admin app                                                                                                                                 |
| `dev-nobody`      | Nobody Member       | No roles                                       | Deny by default: empty navigation, every direct URL answers "permission denied"                                                                                                      |

### Sprint 6 walk-through

1. As `dev-admin`: **Academics → Teacher assignments**, assign any teacher as Subject teacher of VII-A; open **Access → Assignments** and see the role and the VII-A scope that appeared for them (if the employee has a login). End the assignment: the role is revoked.
2. As `dev-admin`: **Academics → Timetable**, pick VI-B and set a slot on a day and period where Suresh Nair already teaches VI-A: the save is refused with "already taking another section".
3. As `dev-teacher` in the teacher app (http://localhost:3002): **My classes** shows VI-A and the week; in the admin app the Timetable page only offers VI-A.
4. As `dev-clerk`: **People → Bulk import**, download the students template, add a few rows (use `VI-A` in the `section` column) and validate; the report lists problems per row; commit only when clean. Then open a student and read **Status history**.

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
