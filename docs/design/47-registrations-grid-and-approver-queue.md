# 47 — Registrations as the admissions grid, the approver's queue, alerts and time limits (plan, 26 Oct 2026)

Two admin screens list the same registrations:

- **Admissions list** (`/admissions/list`, docs/design/39 part 7): the report engine's grid — status tabs
  with counts, a column picker over every registration, fee, admission and form-answer field, filters on
  any field, saved views, Excel / PDF of what is seen, save as a report.
- **Registrations** (`/admissions/registrations`): a plain table of 50 a page with six filters (session,
  class, waiting at, category, status, search) and the process columns (waiting at, "Level 1 of 2", merit,
  list no.). No columns to choose, no export, no tabs, no saved view.

The approval process (Admission set-up → Stages and processes): the school's stages; a process = stages
in order, each with levels 1, 2, 3… decided by anyone with the decide permission, a role, a designation
or named employees; processes given to classes. A registration enters stage 1 level 1 when its fee is
paid; the people of the level decide on the registration page; approval moves it to the next level,
then the next stage, to Selection → offer → admission fee → Admit.

Gaps against Entab, Edunext and NoPaperForms: an approver has no "waiting for me" list and is not told
when a registration reaches the level; a level has no time limit; decisions go one at a time; the
registrations list cannot be shaped or exported.

## Decisions (asked and answered, 26 Oct 2026)

| #   | Question       | Decision                                                                                                                                                                                |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | List shape     | **Same grid + process**: Registrations uses the Admissions list grid plus process columns (Waiting at, Level, Who decides, Waiting since); a row opens the registration's decision page |
| 2   | Process tools  | **Waiting for me** tab, **bulk decide**, **stage board view** (days waiting / overdue comes with decision 4)                                                                            |
| 3   | Approver alert | **Email + in-app**: an item in the header's approvals count each time; one email a day listing what waits for the person                                                                |
| 4   | Time limit     | **Days + reminder**: each level may set days to decide; a reminder the day before, overdue after (red, its own filter); no automatic move                                               |

Defaults taken (change on request): Admissions list stays as it is (the report of every registration,
drafts too); Registrations shows submitted ones only (as now) with tabs Waiting for me · In process ·
Unfinished · Admitted · Closed · All; its saved view is its own (`admissions.registrations`); "Waiting
since" is when the registration reached its current level; the daily email goes at 8:00 school time
and only to people with something waiting; bulk decide offers only what one decision can do for every
ticked row (approve, reject, hold with a remark) — marks, corrections and offers stay one by one;
a set-up manager sees every registration under Waiting for me only when ticking "include all".

## Parts

**Part 1 — The process fields in the Admissions dataset (API, packages/db; built 26 Oct 2026, migrations 0256–0257).**
`applications.level_since TIMESTAMPTZ` (set whenever the stage or level changes; filled for those in
process from their last decision or registration). Dataset fields `level` ("1 of 2"), `level_name`,
`deciders` (names of the people who may decide now), `waiting_since`, `days_waiting`, `due_on`,
`overdue` — usable as columns and filters in both grids and the report builder. Who may decide is worked
out once per page for the levels on it (the same rule as the registration page's `canAct`).

**Part 2 — Registrations as the grid (admin; built 26 Oct 2026).** `/admissions/registrations` renders the grid of
`/admissions/list` with its own default view (Registration no., Candidate, Class, Category, Status,
Waiting at, Level, Who decides, Waiting since, Merit) and its own saved view; tabs with counts as above;
Excel / PDF of the view; the row opens `/admissions/registrations/<id>`. The page's buttons (Tests and
interviews, Selection) stay.

**Part 3 — Waiting for me, bulk decide, the board (API + admin; built 26 Oct 2026).** The Waiting for me tab: rows at a
level this user may decide, its count in the header's approvals menu ("Registrations to decide") and on
the admissions dashboard. Tick rows at the same stage and level → Approve / Reject / Hold with one
remark; each row is decided as if opened (rights, notices to the family, next level), a row that
cannot be decided is reported, not stopped. Board view: a column per stage (levels as bands inside),
cards with candidate, class, waiting days, who decides; a card opens the registration; Waiting for me
and the filters apply.

**Part 4 — Alerts and time limits (API, workers, set-up; built 26 Oct 2026).** In the process editor each level gains
"Days to decide" (blank: no limit). When a registration reaches a level, its people get an in-app item
(the approvals count) and, once a day, an email listing what waits for them with the overdue ones on
top; the day before the limit a reminder line; past it the row is overdue (red in the list and board,
filter "Overdue"). The daily job runs in the workers' maintenance queue — the user restarts workers.

As built: who may decide at a level is `app.admission_level_users(level)` (the level's people who hold
the decide right; set-up managers decide anywhere but are not listed); `admission_waiting` (0256, made to
match the list in 0257) holds every registration waiting with its level, `level_since` and `due_at`;
`applications.level_since` is set by a trigger whenever the stage, level or process changes. The
dashboard's figures now open the new list filtered by session and status (`?session=&status=`), and a
line above them says how many wait for the user. The morning email is the workers' job
`admissions.level_digest` (02:30 UTC), one per person a day (`admission_level_digests`).
