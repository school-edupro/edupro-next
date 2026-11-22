# 94 — The staff app: the menu as on the website, and a Home like the students'

Status: planned 22 Nov 2026 · builds on docs 89 (the app) and 90 (the family app layout) · owner: Platform

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
