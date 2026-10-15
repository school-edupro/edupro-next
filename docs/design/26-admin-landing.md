# 26 · Admin landing page by role

The admin home (`/`) today shows three counters. It becomes a **role landing**: the widgets of the
user's role, each shown only when the user holds its permission, in the look of the legacy DPS
dashboard (profile, quick actions with search, news and office orders, birthdays, attendance trend,
holidays) plus the numbers each role works by. Benchmarks: Entab CampusCare, Fedena, Edunext,
MyClassboard — a "today" strip, work queues first, everything one click from the number.

## Decisions (product owner, 2026-10-15)

| Topic | Decision |
| --- | --- |
| Roles | Principal / School admin, Accounts / Fee desk, Front office / Gate, Module heads (Transport, Warden, Librarian, Clinic, Exam cell, HR). Teachers keep the staff app home |
| Layout | A default widget set per role; each user hides, shows and reorders widgets and pins quick actions; the admin sets the defaults per role |
| Birthday wish | In-app greeting (staff app / parent portal) and SMS / WhatsApp only when a ready birthday template exists; the widget shows who was wished |

## Widgets

| Key | Shows | Needs | Default for |
| --- | --- | --- | --- |
| `profile` | Name, role, school, session, last sign-in, today's date | — | all |
| `quick_actions` | The user's pinned actions (else the role's), search over every menu item the user may open | — | all |
| `news` | Latest notices and office orders | notices view | all |
| `birthdays_staff` / `birthdays_students` | Today (and the next 7 days), Wish | people view | admin, front office |
| `attendance_trend` | Last 7 days present / absent, today's %, staff present today | attendance view | admin |
| `holidays` | Upcoming and just past holidays of the school calendar | — | all |
| `approvals` | What waits on me, by module | — | all |
| `fees_today` | Collection today by mode, online payments, dues, cheques to clear, bounced, refunds waiting | fees view | admin, accounts |
| `admissions` | Enquiries / applications today and pending | admissions view | admin, front office |
| `front_office` | Visitors inside and waiting, appointments today, gate passes to hand over | engagement | front office |
| `helpdesk` | Open and late tickets by desk | helpdesk | admin, front office |
| `transport` / `hostel` / `library` / `clinic` / `exams` | The module's own work queue numbers | module view | that module's head |

## Model

- `dashboard_role_defaults (school_id, role_code, widgets jsonb, quick_actions jsonb)` — set by the admin.
- `user_dashboard (user_id, school_id, widgets jsonb, quick_actions jsonb)` — the user's own order and pins.
- `birthday_wishes (school_id, person_kind, person_id, on_date, wished_by, channel)` — one per person per day.
- API: `GET /dashboard` (the user's widgets in order, each with its data, permission-checked);
  `PUT /dashboard/layout`; `PUT /dashboard/defaults/:role`; `POST /dashboard/wish`.
- The quick-action catalogue is the admin menu (`components/Shell.tsx` NAV), filtered by permission.
