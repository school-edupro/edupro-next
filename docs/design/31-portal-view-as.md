# 31 · Open a portal as someone (view as / act as)

Benchmark: PowerSchool, Entab, Teachmint and Fedena let the office "log in as" a parent, student or
teacher from the profile to see exactly what they see. Here it is built on the audited impersonation
sessions of S5-02 (migration 0014), extended in **0183**.

## Decisions (18 Oct 2026)

- **What:** from a student's page, open the **parent portal** as the student or as each parent; from an
  employee's page, open the **teacher app** as that employee. (Switching one's own account between apps
  was not asked for.)
- **Two rights:** `access.portal.view_as` (School Admin, Group Admin) and `access.portal.act_as`
  (School Admin). A school can give either to its own roles (e.g. a Principal role) in Access → Roles.
- **Each time:** a reason (at least 5 letters) and 15, 30 or 60 minutes. Recorded in
  `impersonation_sessions` (mode, app, person), `login_events` and the audit log.
- **No login yet:** the dialog offers **Make login** (`app.student_create_login`,
  `app.guardian_create_login` like the sign-in by code, `app.employee_create_login`); a parent needs a
  mobile or an email. Nobody gets a hidden account.
- **Never opened:** another administrator (anyone holding the portal or impersonation rights) or oneself.

## How it works

1. Admin: `GET access/portal-as/student/:id` or `/employee/:id` gives the people, their logins and the
   modes the admin may use. `POST access/portal-as/login` makes a login.
2. `POST access/portal-as` (person, mode `view` | `act`, reason, minutes) starts the session and a
   **one-time code** (`portal_handoffs`: sha-256 only, 60 seconds, used once, for that app) and returns
   `…/api/auth/handoff?code=…` on the parent or teacher app.
3. The portal's `GET /api/auth/handoff` hands the code to `POST access/portal-as/handoff` (public,
   `app.portal_handoff_take`) for the session token and writes its own session (`viewAs`).
4. Every request runs as the person; the guard re-checks the session (`app.impersonation_check` now gives
   mode and app) and `impersonationRefusal` (`common/auth/impersonation-rules.ts`) refuses:
   - **view:** every change, except PDFs and printouts on request, the assistant, and ending;
   - **act:** payments and the person's sign-in settings;
   - **always:** registering this browser for the person's push messages.
5. The portals show a bar (`ViewAsBar`): whose portal, by whom, until when, view only or acting, **End**.
   End (or Sign out) calls `POST access/portal-as/end` and signs out there.

## Tests

`apps/api/test/portal-as.e2e-spec.ts`: listing and rights, Make login (parent without contact refused),
the code once and only for its app, view only refusing changes and push devices, End, acting refusing
payments while other work passes, administrators never opened.

## Staff app frame and role home (18 Oct 2026)

Opening the teacher app as a warden showed every tile, most greyed out, and "16 permissions". Now:

- Signed-in staff screens sit in `apps/teacher/app/(app)` under `StaffShell` (the parent portal's frame:
  sidebar, header with school / session / language / messages / sign-out, phone tab bar).
- `lib/staff-menu.ts` lists every staff screen once with the right it needs; the sidebar, the tab bar
  and the home show only what the person may open (nothing greyed). "Answers to approve" shows for class
  teachers and for anyone with answers waiting.
- Home: designation and roles (`/me/card`), **Today** figures for what the person does (hostel roll-calls,
  pupils away, to hand over, hostel and student leave to decide, answers to approve, gate passes waiting,
  new messages), then the screens by group. Notices and Calendar tiles (never built) are gone.
