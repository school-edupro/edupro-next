# Landing page by role — test cases

Scope: the admin landing page at `localhost:3000/` (widgets by role, quick actions, _Arrange my page_,
birthdays and the wish), the school's settings at **System → Landing pages** (widgets, titles, size,
days and rows, quick menu with names, icons and outside links, lock, copy, push to users, back to
built-in, preview, the school's own roles) and the Mobilise design rules. Migrations 0151 and 0152.

- **Auto** = the API e2e test `apps/api/test/dashboard.e2e-spec.ts` (12 tests) and the axe check in
  `apps/admin/e2e/a11y.spec.ts` (`/`, `/system/landing`, `/system/landing/preview`).
- **UI** = walked through in the in-app browser on 16 Oct 2026 as dev-admin (School Admin, Alpha Public
  School). Result: ✔ passed, ✘ failed (then fixed and passed again, see the end), — not run in the UI.
- Roles: Admin (school_admin), Accountant (accountant), Front desk (front_desk), Nobody (no role),
  Bursar (accountant + the school's own role _Bursar Desk_).

## L1 · The page by role

| ID    | Steps                                                             | Expected                                                                                                                             | Auto | UI        |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------- |
| L1-01 | Admin opens `/`                                                   | Light navy-50 band: date · session as kicker, "Good Morning/Afternoon/Evening, Dev", role · school; widgets of School Admin in order | ✔    | ✔         |
| L1-02 | Accountant opens `/`                                              | Accountant's widgets: Profile, Fee Collection Today, Quick Actions, Dues and Defaulters, …                                           | ✔    | ✔ preview |
| L1-03 | A widget whose permission the role lacks (Clinic for Accountant)  | Never sent by the API, not on the page                                                                                               | ✔    | ✔         |
| L1-04 | User with no landing role                                         | The common page: Profile, Quick Actions, Waiting for Me, News, Holidays                                                              | ✔    | —         |
| L1-05 | Every widget's link (Fee reports, Calendar, Helpdesk, Punches…)   | Opens the module page                                                                                                                | —    | ✔         |
| L1-06 | Accountant (no insights right) sees Fee Collection Today and Dues | Collected today, last 7 days, balance, cheques, refunds, by-mode bars, defaulters                                                    | ✔    | ✘ → ✔     |
| L1-07 | Nobody asks `/dashboard/w/fees_today`                             | 404                                                                                                                                  | ✔    | —         |

## L2 · Quick actions

| ID    | Steps                                                   | Expected                                                                                       | Auto | UI  |
| ----- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---- | --- |
| L2-01 | No quick menu set for the role                          | The first eight pages of the user's menu                                                       | ✔    | ✔   |
| L2-02 | Type "visit" in _Search pages…_                         | Visitors, Clinic visits, Hostel visitors, Hostel visitor at the gate; each opens its page      | —    | ✔   |
| L2-03 | Search with no match                                    | "No page matches …"                                                                            | —    | ✔   |
| L2-04 | Role menu with a renamed tile (Cashier → "Collect fee") | Tile shows "Collect fee"                                                                       | ✔    | ✔   |
| L2-05 | Role menu with a school link (https)                    | Tile "School website", link icon, opens in a new tab, screen reader hears "opens in a new tab" | ✔    | ✔   |
| L2-06 | A page in the role's menu the user cannot open          | Left out for that user                                                                         | ✔    | —   |

## L3 · Arrange my page (each user)

| ID    | Steps                                                                   | Expected                                                             | Auto | UI  |
| ----- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ---- | --- |
| L3-01 | Move Holidays up, untick Staff Attendance, pin Visitors, _Save my page_ | "Your page is saved."; new order, widget hidden, Visitors tile added | ✔    | ✔   |
| L3-02 | _Back to the role's page_                                               | Role's order and pins again                                          | ✔    | ✔   |
| L3-03 | Save an unknown widget key                                              | Dropped                                                              | ✔    | —   |
| L3-04 | Pin a school link of the role, then the school removes it               | Tile disappears; an outside link the role never had is never shown   | ✔    | —   |
| L3-05 | ↑ ↓ buttons and their names                                             | Visible, named "Move Holidays up" etc.                               | —    | ✔   |

## L4 · System → Landing pages: widgets

| ID    | Steps                                                                  | Expected                                                                                                                      | Auto | UI  |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| L4-01 | Open the page as Admin                                                 | Built-in roles as tabs; the school's own roles in a second row; facts: people holding, own arrangements, built-in/own, locked | ✔    | ✔   |
| L4-02 | Accountant (no _platform.dashboard.manage_) opens settings / saves     | 403                                                                                                                           | ✔    | —   |
| L4-03 | Rename Fee Collection Today to "Today's Collection", News rows 5, save | "Saved for Accountant."; the role's page shows the new title and 5 notices                                                    | ✔    | ✔   |
| L4-04 | Size Wide → Normal                                                     | Widget takes one column                                                                                                       | ✔    | —   |
| L4-05 | Birthdays days ahead 25                                                | Birthdays up to 25 days ahead listed, heading "Next 25 Days"                                                                  | ✔    | —   |
| L4-06 | Rows 50 / days 40 (out of range)                                       | Refused (400)                                                                                                                 | ✔    | —   |
| L4-07 | Leave a title empty or the same as standard                            | Not stored; standard title shown                                                                                              | ✔    | —   |
| L4-08 | Unknown role in the address                                            | 404 "No landing page for this role"                                                                                           | ✔    | —   |

## L5 · Quick menu editor

| ID    | Steps                                                             | Expected                                        | Auto     | UI  |
| ----- | ----------------------------------------------------------------- | ----------------------------------------------- | -------- | --- |
| L5-01 | Add pages by typing (Cashier, Reports centre, Bank deposit slips) | Added in order                                  | —        | ✔   |
| L5-02 | Add the same page twice                                           | "That one is already in the menu."              | ✔ dedupe | ✔   |
| L5-03 | Add a link `http://…`                                             | "A link must start with https://" (API 400 too) | ✔        | ✔   |
| L5-04 | Add a link with no name                                           | "Give the link a name." (API 400 too)           | ✔        | —   |
| L5-05 | Move the link up, rename Cashier "Collect fee", save              | Saved in that order with the name               | ✔        | ✔   |
| L5-06 | More than 24 items                                                | "Up to 24 quick actions."                       | —        | —   |

## L6 · Lock, push, copy, back to built-in

| ID    | Steps                                           | Expected                                                                                             | Auto | UI                         |
| ----- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- | -------------------------- |
| L6-01 | Tick _Lock this page_, save                     | Facts show "locked"; users of the role see "Page set by the school" instead of Arrange               | ✔    | ✔ saved (user view by API) |
| L6-02 | A user of a locked role saves their own page    | 409 "The school has set this page for your role"                                                     | ✔    | —                          |
| L6-03 | A user of a locked role with an own arrangement | Not used while locked                                                                                | ✔    | —                          |
| L6-04 | _Push to all users_                             | Dialog states how many own arrangements are removed and that it cannot be undone; _Cancel_ closes it | ✔    | ✔ (cancelled)              |
| L6-05 | Confirm _Push to users_                         | Own arrangements of the role's holders removed; count shown                                          | ✔    | —                          |
| L6-06 | Front Desk → _Copy from_ Accountant → Copy      | "Copied to Front Desk…"; same widgets, titles, quick menu, lock                                      | ✔    | ✔                          |
| L6-07 | Copy a role onto itself / from an unknown role  | 400 / 404                                                                                            | ✔    | —                          |
| L6-08 | _Back to built-in_ → confirm                    | "… is back to the built-in page."; facts "built-in page"                                             | ✔    | ✔                          |

## L7 · Preview and the school's own roles

| ID    | Steps                                                              | Expected                                                                                                                | Auto | UI                              |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------- |
| L7-01 | _Preview as Accountant_                                            | "Landing Page of Accountant": the role's widgets, titles, quick menu, school link; figures read with the admin's rights | ✔    | ✔                               |
| L7-02 | Preview a portal role (parent)                                     | 404                                                                                                                     | ✔    | —                               |
| L7-03 | Accountant opens a preview                                         | 403                                                                                                                     | ✔    | —                               |
| L7-04 | A role made under Access (Bursar Desk)                             | Listed under "The school's roles"; parent, student and teacher roles never listed                                       | ✔    | — (Alpha has no own staff role) |
| L7-05 | Bursar holds Accountant + Bursar Desk, nothing set for Bursar Desk | Lands on Accountant                                                                                                     | ✔    | —                               |
| L7-06 | Set a landing for Bursar Desk                                      | Bursar lands on Bursar Desk                                                                                             | ✔    | —                               |

## L8 · Birthdays and the wish

| ID    | Steps                                    | Expected                                                                                               | Auto | UI                            |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- | ----------------------------- |
| L8-01 | Student Birthdays                        | Today with initials and _Wish_; "Next 7 Days" with days to go                                          | ✔    | ✔                             |
| L8-02 | Wish a pupil whose birthday is in 3 days | 409 "It is not … birthday today"                                                                       | ✔    | —                             |
| L8-03 | Wish today's pupil                       | Recorded; channels said (app; SMS/WhatsApp only with a ready `birthday_wish` template); badge "Wished" | ✔    | — (no messages sent on Alpha) |
| L8-04 | Wish again the same day                  | 409 "already been wished today"                                                                        | ✔    | —                             |
| L8-05 | Accountant wishes                        | 403 (no _people.birthday.wish_)                                                                        | ✔    | —                             |

## L9 · Mobilise design rules and accessibility

| ID    | Check                                | Expected                                                                            | Auto | UI  |
| ----- | ------------------------------------ | ----------------------------------------------------------------------------------- | ---- | --- |
| L9-01 | Dark surfaces                        | Only the sidebar is dark; greeting band navy-50; no gradient                        | —    | ✔   |
| L9-02 | Cards                                | White, hairline border, no shadow; title h4 Poppins with cyan line icon; link right | —    | ✔   |
| L9-03 | KPI tiles                            | h2 numerals, caption labels; status colours only for status                         | —    | ✔   |
| L9-04 | Dates                                | Neutral navy-50 chips; today in navy; no colour by notice type                      | —    | ✔   |
| L9-05 | Headings                             | Title Case on the landing page ("Today at a Glance")                                | ✔    | ✔   |
| L9-06 | Tokens only                          | No raw hex or px (UI lint)                                                          | ✔    | —   |
| L9-07 | axe: `/`, `/system/landing`, preview | No serious or critical violation                                                    | ✔    | —   |
| L9-08 | Phone width 375                      | No sideways scroll; stats two per row; table scrolls inside its box                 | —    | ✔   |

## Found and fixed during the run

1. **L1-06** The Accountant's fee widgets were empty: the figures came only from the principal's
   insights, which the Accountant role cannot open. The landing API now gives the fee part to anyone who
   sees fees (`GET /dashboard/w/fees_today`).
2. **L9-07** The cyan kicker on the navy-50 band was below 4.5:1 contrast; on that band the kicker is
   navy 700.
3. **L9-08** On a phone the stat tiles stacked one per row; now two per row with smaller numerals.

Test data made in the browser run (Accountant and Front Desk settings, dev-admin's own arrangement) was
removed afterwards; the API test uses its own school.
