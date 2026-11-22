# 94 — The staff app: the menu as on the website, and a Home like the students'

Status: built 22 Nov 2026 (phases A–E) · builds on docs 89 (the app) and 90 (the family app layout) · owner: Platform

## The ask

"User login with 9999999903 (the academic coordinator): all menu not show in the staff mobile app as in the staff
website — check and confirm; and the staff Home page the same as the student mobile app."

**Checked (22 Nov 2026):** the app's More list and the staff website take their screens from the same list
(`staffScreens` in `@edupro/menus`), but the website also counts the work waiting for the person (leave to approve,
team, admissions, purchase …) and shows those screens; the app's menu (`GET /me/menu?kind=staff`) passed no counts.
Missing in the app: the coordinator's Leave to approve and My team's attendance; the principal's those two plus
Leave & attendance reports, Admission approvals, Purchase orders; a teacher's Admission approvals; accounts'
Admission approvals and Assets in my care.

## Decisions (asked and answered, 22 Nov 2026)

| Question              | Answer                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Home shortcuts        | The school's default for staff + each person's own (screens a person cannot open are skipped)                                        |
| Bottom tabs           | The school chooses, like students: Home + three + More                                                                               |
| Cards under shortcuts | Work cards the school orders or hides: classes to mark, today's periods, marks to enter, approvals waiting, my leave, latest notices |
| Band                  | "Good evening, <first name>" with the four work figures (periods, to mark, to enter, approvals)                                      |

Decided without asking: the layout starts as the app is today (tabs Attendance, Classes, Messages; today's cards
first), so nothing changes for staff until the school publishes; one staff layout for the school (rights decide what
each person gets); the staff website's own Home and side menu stay as they are.

## Phases (each checked complete — plan and all tests — before the next)

- **A. The menu as on the website** — the API counts the work waiting for the person (`GET /me/staff-waiting`, the
  same counts the staff website reads, in one place) and `/me/menu?kind=staff` uses them; the staff website reads the
  same route; tests and a check that the app and the website list the same screens for every staff demo login.
- **B. The staff layout** — `@edupro/menus` staff layout (catalogue, the layout to start with, checks, the layout a
  person gets); migration 0413 (the layouts table takes `staff`); API: the office's draft, publish, discard
  (`platform/staff-app-layout`) and a person's layout and own shortcuts (`me/staff-layout`); API e2e.
- **C. Admin** — System settings → **Staff app layout**: tabs, Home shortcuts, Home cards; draft, preview, publish;
  accessibility.
- **D. The app** — the staff Home like the students' (greeting, figures, Shortcuts with All and Edit shortcuts, the
  cards in the school's order), the tabs from the layout, Edit shortcuts for staff, offline copy; widget tests
  (light, dark, Hindi, 2× text); the web preview rebuilt.
- **E. Close** — docs "As built", the full checks.

## As built

- **A (22 Nov 2026).** `StaffWaitingService` (`apps/api/src/modules/me/staff-waiting.service.ts`) counts the work
  waiting on a staff member — the same thirteen routes the staff website read, called in-process as the person
  (`InternalCalls`), each best effort — at `GET /me/staff-waiting` (`{unread, waiting}`); `/me/menu?kind=staff` passes
  them to `staffScreens`, and the staff website's frame reads the same route (one call instead of thirteen). Checked:
  the app and the website now list the same screens for all nine staff demo logins (the coordinator 39, the principal
  45). Tests: `apps/api/test/staff-menu.e2e-spec.ts` (a manager with a reportee gets My team's attendance, a colleague
  does not; the menu equals the shared list with the counts).
- **B (22 Nov 2026).** `@edupro/menus` `staff-layout.ts`: `StaffLayout` (tabs, shortcuts, cards), `STAFF_CARDS` (classes
  to mark, today's periods, marks to enter, approvals waiting, my leave, latest messages — each with the screen it
  needs), `DEFAULT_STAFF_LAYOUT` (tabs Attendance, Classes, Messages as the app had them; twelve common shortcuts; all
  six cards), `checkStaffLayout`, `myStaffLayout(permissions, waiting, layout, own)` (only what the person opens; the
  Classes tab only with daily work or marks; a tab they cannot open gives its place). Migration **0413**: the layouts
  table takes `staff`. API (`platform/staff-layout.*`, in the platform module with `StaffWaitingService`):
  `GET / PUT platform/staff-app-layout`, `POST …/publish`, `POST …/discard` (settings rights, audited);
  `GET me/staff-layout`, `PUT / DELETE me/staff-layout/shortcuts` (own shortcuts in `user_preferences`
  `staff.shortcuts`). Tests: `apps/api/test/staff-layout.e2e-spec.ts` (5).
- **C (22 Nov 2026).** Admin: **System settings → App layouts → Arrange the staff app**
  (`/system/settings/staff-app-layout`, `StaffLayoutEditor.tsx`, `lib/staff-layout.ts` repeating the API's checks):
  the status (published or not, the draft changed), Save draft, Publish (asks first; saves first), Discard the draft,
  Start again from the standard layout, an unsaved-changes guard; Bottom tabs (Home and More fixed, three between,
  Classes offered), Home shortcuts (4–12) and Home work cards (in order), reusing the family editor's ordered list;
  a preview of the staff Home (greeting, the four figures, the tiles with All, the cards, the tab bar). Checked in a
  browser on Alpha (Save caught, nothing saved) with axe; added to the admin accessibility list.
- **D (22 Nov 2026).** The app (`apps/mobile/lib/staff/layout.dart`): `staffLayoutProvider` (`me/staff-layout`, kept
  for offline use; the app as it was when none has come), `staffTabs` (Home, the three, More: Attendance opens the
  Attendance tab, Classes the Classes tab, a screen with only a web page a tab with an Open button), `openStaffScreen`
  (the app's own screen, else the staff website's page in the app). The staff Home (`my_day.dart`) is the students':
  "Good morning, <first name>", the four figures, Shortcuts (the school's or the person's own) with All and Edit,
  then the work cards in the school's order — classes to mark, today's periods, marks to enter, approvals waiting (the
  first three, See all), my leave (the balances, Open My leave), latest messages (the newest three, See all). Edit
  shortcuts serves staff too (`me/staff-layout/shortcuts`); the layout is read again when the app comes back. The
  fixed staff tabs (`tabsFor`) are gone. Tests: `apps/mobile/test/staff_test.dart` (the tabs, the Home, Edit
  shortcuts, a web-only tab; light, dark, Hindi and 2× text), `app_flow_test.dart`; 213 app tests pass.
- **E (22 Nov 2026).** Closed: the four type-checks, lint and formatting, the API's layout, menu, mobile and chatbot
  suites (32), the database security and permission-coverage tests, the app (213 tests, analyze, the generated calls)
  and the local secret scan pass. The staff website's own Home and side menu are unchanged (its menu now counts work
  with the same route as the app).

## Part 2: the staff menu (asked 22 Nov 2026)

"Website menu and app More — Hidden from families: 0 screens: add this section in the staff mobile and web app."

| Question                | Answer                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| A hidden screen         | Left out of the menus, More, tabs, shortcuts, Home tiles and cards; its page still opens from a link |
| The website's phone bar | Follows the staff app's tabs + Menu (as the families' website)                                       |

Decided without asking (as for families): the school orders the groups, moves screens between them and renames them
(English and Hindi); Home stays first; hiding is per screen or per group; rights stay with Access → Roles; nothing
changes until the school publishes.

Phases: **F** the model and the API · **G** admin's section · **H** the staff website (side menu, phone bar + Menu,
the Classes page, Home tiles) and the app's More · **I** close.

- **F (22 Nov 2026).** `staff-layout.ts`: `StaffLayout.menu` / `hidden`, `defaultStaffMenu`, `staffMenuOf` (the
  school's groups made whole), `staffHiddenScreens`, `staffGroupLabel`, the checks (every group once, every screen in
  one group, names 1–40 letters, hidden screens known); `myStaffLayout` leaves hidden screens out of the tabs,
  shortcuts, cards and the screens to pin, and gives the `menu` (the school's order and names, the person's screens)
  and `hidden`. API: the draft and publish carry `menu` and `hidden`; the catalogue gives the groups' standard names;
  `me/staff-layout` also returns `waiting` and `unread` (one call for the staff website's frame); `/me/menu?kind=staff`
  follows the published menu. Tests: `staff-layout.e2e-spec.ts` (6).
- **G (22 Nov 2026).** Admin: Staff app layout gains **Website menu and app More** — the family page's editor made
  reusable (`MenuEditor` in `FamilyLayoutEditor.tsx`: ids, standard names, whom and where) — "Hidden from staff: N
  screens", groups moved up / down, renamed in English and Hindi, hidden as a group; each screen moved, moved to another
  group, hidden or shown. Hidden screens are marked in the tabs, shortcuts and cards lists and left out of the preview;
  the save sends the menu and the hidden screens. Checked in a browser on Alpha (save caught, nothing saved) with axe;
  the family page keeps its words.
- **H (22 Nov 2026).** Staff website: `lib/staff-layout.ts` reads `me/staff-layout` once per page (React `cache`)
  and `staffGroups` gives the menu groups — the school's published menu (its order, names, the Hindi name in Hindi,
  hidden screens left out), else the menu as built. The frame (`StaffShell`) shows that side menu; with a published
  layout its phone bar is the app's — Home, the three tabs (Classes opens the new **Classes** page: the "My classes"
  screens as tiles) and **Menu**, the side menu as a full-height panel (`PhoneMenu`, as the families' website). The
  Home tiles follow the same groups. A hidden screen's page still opens from a link. Never published: as built (Alpha
  unchanged). The "Menu" word in the phone bar now has the caption size of the other tab words (also on the families'
  website). App: More already follows `/me/menu` (order, names, Hindi names); tests added in `staff_test.dart`.
  Checked in a browser on a test school with a published layout (desktop, phone, the Menu panel, Classes, Hindi; axe
  clean) and on Alpha (as built).
- **I (22 Nov 2026).** Closed: the four type-checks, lint and formatting of every part-2 file, the API's staff
  layout, staff menu, family layout and mobile suites (39), the database security and permission-coverage tests, the
  app (215 tests, analyze), the staff website's accessibility pages (desktop and phone, now with `/classes`) and the
  local secret scan pass. The test school used for the browser check is switched off again; Alpha has no published
  staff layout, so its staff see the menus as before until the office publishes one (System → Settings → App layouts
  → Arrange the staff app).
