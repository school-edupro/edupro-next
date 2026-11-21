# 90 — Family app layout kept by the school

**Status:** built (21 Nov 2026, phases A–E; see "As built"). Builds on docs/design/89 (the mobile app) and the family menu in `@edupro/menus`.

## The ask

In the student (and parent) mobile app, more screens should reach the Home screen and the tabs, and the school should
arrange them from admin, as the best school ERP apps do. Today the bottom tabs, the eight Home shortcuts, the Home
cards and the parent's Academics list are written into the app; every other screen is only under **More**.

## Decisions (asked and answered, 21 Nov 2026)

| Question                  | Answer                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| What the school arranges  | Home shortcuts, Home cards, bottom tabs, the Academics tab list (all four)                          |
| Who decides the shortcuts | The school's default, and each person may pin, remove and reorder their own (reset to the school's) |
| How many layouts          | Two per school: students and parents                                                                |
| The website               | Its Home follows the same shortcuts and cards; its side menu stays complete                         |
| Where in admin            | A "Family app layout" section card on System settings (no new menu entry)                           |
| Going live                | Draft → phone-shaped preview → **Publish**; "Discard the draft" goes back to the published          |
| What a person may change  | Shortcuts only (tabs and cards stay as the school set)                                              |
| What a school starts with | Today's layout, so nothing changes for families until the office publishes                          |

## What the best school apps do (the benchmark)

The school turns features on and orders the Home dashboard per audience; each person may pin favourites; the bottom bar
keeps three to five places (the Android and iOS guidance); a screen a person may not open never shows, whatever the
layout says; the app keeps the last layout for offline use. This plan follows all five.

## The layout

One layout per school and audience (`student`, `parent`), each a draft and a published copy:

- **Bottom tabs** — Home first and More last are fixed; the school picks the **three** in between from the family
  screens or **Academics** (a tab that lists the screens of the Academics list). Today: students Homework, Timetable,
  Results; parents Academics, Fees, Messages.
- **Home shortcuts** — 4 to 12 tiles (four a row), in order, from every family screen (Library, Health, Certificates,
  School bus, Hostel, Assistant, Help …); the app adds an **All** tile that opens More. Today's eight are the start.
- **Home cards** — the cards under the shortcuts, on or off and in order: Attendance today, Today's classes, Homework
  due, Next exam, Latest notices, Coming up (holidays and events), Fees due, Library (books due back / ready). Today's
  set is the start.
- **Academics list** — the screens the Academics tab lists, in order (today: Attendance, Homework, Timetable, Date
  sheet, Results, Calendar). Used only when Academics is one of the tabs.

The catalogue (screens, cards, their names in English and Hindi and their icons) lives in `@edupro/menus`, read by the
API, admin, the website and (generated) the app. A person never sees a screen they cannot open (the menu's rights,
`familyScreens`): such a tab, tile or Academics row is dropped; a tab dropped this way gives its place to the next
screen of the school's shortcuts.

**Own shortcuts:** "Edit shortcuts" on Home (app and website) lets a person pin any screen they can open, remove and
reorder (4 to 12); "Reset to the school's" drops their own. Kept per person, school and audience
(`user_preferences`), so it follows them from phone to website.

## Admin

System settings → **Family app layout** (the settings right): Students | Parents; for each, the four parts as ordered
lists (add from a type-to-search list, remove, move up / down) with the checks (three tabs, 4–12 shortcuts, at least
one card, an Academics list of at least two screens when Academics is a tab); a phone-shaped preview beside it (the tab
bar, the shortcut grid, the cards by name) of the draft; **Publish** (what families get on their next refresh),
**Discard the draft**; Draft / Published since … / Changed by …; every save and publish in the audit trail.

## Calls

- `GET me/app-layout?kind=student|parent` — the published layout for me (rights applied) and my own shortcuts; the
  app caches it with the menu.
- `PUT me/app-layout/shortcuts`, `DELETE me/app-layout/shortcuts` — my own shortcuts; reset.
- `GET platform/family-app-layout` (both audiences: draft, published, catalogue), `PUT …/:audience` (save the
  draft), `POST …/:audience/publish`, `POST …/:audience/discard`.

## Phases (each checked complete — plan and all tests — before the next)

- **A. Catalogue, data and API** — the catalogue in `@edupro/menus`; migration 0407 (`family_app_layouts`: school,
  audience, draft and published JSON, who and when); today's layout as each school's start; the calls above with the
  rights applied; API e2e (start, draft vs published, publish, discard, rights filter, own shortcuts, school
  boundary, checks).
- **B. Admin** — the System settings card and the editor with its preview; a11y; a flow check on a test school.
- **C. App** — tabs, Home shortcuts (with All), Home cards and the Academics tab from the layout; Edit shortcuts;
  kept for offline; today's layout when none has come yet; widget tests (light, dark, Hindi, 2× text).
- **D. Website Home** — the shortcuts as its tiles (Edit shortcuts there too), the cards in the school's order; the
  side menu unchanged; family a11y.
- **E. Docs and the full checks** — this doc's "As built", doc 89, the pre-push checks.

## Not in this plan

Layouts per class group, a person's own tabs or cards, the staff app, the website's side menu order, branding
(colours, logo) — each can follow later.

## As built (21 Nov 2026)

- **A. Catalogue, data, API.** `packages/menus/src/family-layout.ts`: `FAMILY_CARDS` (eight cards, each with the
  screen it needs), `familyLayoutScreens`, `DEFAULT_FAMILY_LAYOUT` (the app as it was), `checkFamilyLayout`,
  `myFamilyLayout` (rights applied; a tab the person cannot open gives its place to the next shortcut, then the menu).
  Migration **0407** `family_app_layouts` (school, audience; draft, published, who and when). Calls in
  `apps/api/src/modules/platform/family-layout.*`: `GET me/app-layout?kind=` (also `published`: whether the school
  has published one), `PUT` / `DELETE me/app-layout/shortcuts?kind=` (own shortcuts as `user_preferences`
  `family.shortcuts.<audience>`), `GET platform/family-app-layout`, `PUT …/:audience`, `POST …/:audience/publish`,
  `POST …/:audience/discard` (settings view / edit rights; audit `platform.family_layout.*`). Tests:
  `apps/api/test/family-layout.e2e-spec.ts`.
- **B. Admin.** System settings → **Family app layout** (`/system/settings/family-app-layout?for=student|parent`):
  the status (published when and by whom, or not yet; draft changed), the four ordered lists with type-to-search Add,
  move up / down, remove and the checks as you edit, a phone-shaped preview (band, shortcut grid with All, the cards,
  the tab bar), Save draft, Publish (Save and publish with unsaved edits; confirm), Discard the draft, Start again from
  the app as it was. The admin app does not use `@edupro/menus`: `apps/admin/lib/family-layout.ts` repeats the checks
  for the as-you-edit messages (the API checks again on save) — keep the two alike.
- **C. App.** `apps/mobile/lib/family/layout.dart`: the layout (kept for offline; the app as it was when none has come),
  the screens' icons and short names, **Edit shortcuts** (pin, remove, reorder, 4–12, Back to the school's). The tabs
  (`familyTabs` in home_shell.dart: Home, the three, More; Academics lists the layout's screens), Home's shortcuts (the
  person's own or the school's, then **All** → More) and Home's cards in the layout's order, with three new cards:
  Coming up (holidays and events of the next 30 days), Fees due (to pay now), Library books (out now and when due).
- **D. Website Home.** Once the school publishes (or the person keeps their own shortcuts): a Shortcuts section (with
  All services and Edit shortcuts → `/home/shortcuts`) in place of Quick actions, and only the layout's cards in its
  order (Today's classes and Next exam are new blocks there). Before the school publishes, the website's Home stays
  exactly as it was. The side menu and All services are unchanged.
- **Card → block on the website:** attendance_today, homework_due, fees_due, library, next_exam → glances in "Today at
  a glance"; coming_up → the Next holiday glance and the Coming up card; notices → Latest notices; classes_today →
  Today's classes.
