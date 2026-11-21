# 89 — EduPro mobile app (one app for students, parents and staff)

Status: **planned 19 Nov 2026** — decisions below; build in phases A–E on "go". Decision record:
[ADR-015](../adr/ADR-015-mobile-app-flutter.md).

## 1. The ask

One mobile app for Android and iOS that every user signs in to once and that works by who they are — student,
parent or staff — with every feature of the parent/student and staff web apps, and, for staff, the approvals the
admin app shows in its header (an Approvals icon with a count, approve or reject in the app).

## 2. What EduPro has today (survey 19 Nov 2026)

- **Web apps**: `apps/parent` (parents **and students** — `audienceOf()` in `components/FamilyShell.tsx` gives
  students their own menu; a sibling switch sets the `edupro_child` cookie) and `apps/teacher` (staff; menu in
  `packages/bff/src/staff-menu.ts`). Parent routes: attendance, timetable, calendar, homework, documents, results,
  date sheet, fees (bill, pay, receipt, tax certificate), messages, notices, queries, teachers, directory,
  appointments, gate passes, consents, certificates, health, transport, hostel, library, profile, assistant. Staff
  routes: attendance (and corrections, bus attendance, my attendance), daily work, lesson plans, syllabus, remarks,
  marks and verification, exam register, leave (mine, approvals, reports), payslips, tax, ACR, certificates, team,
  resignation, no-dues, office orders, admission / consent / exit / profile approvals, purchase, hostel, messages,
  queries, appointments, gate passes, health, library, documents and more.
- **Sign-in**: One Auth (OIDC, code + PKCE, in `packages/bff`) and EduPro's own **OTP** — public
  `POST /api/v1/auth/otp/start` and `/verify` (mobile or e-mail; an admission number signs in its primary guardian)
  return `{ accessToken, expiresAt, deviceToken }`; the API accepts the token as `Authorization: Bearer`
  (`apps/api/src/common/auth/jwt-auth.guard.ts`). The token lasts **12 hours and has no refresh**; the One Auth
  refresh token is stored but never used. The web apps keep the token in an encrypted cookie behind the BFF.
- **One person, many roles**: `GET /me` returns the memberships (school, person type), permissions and years;
  `user_school_memberships` is unique on (school, user, person type), so a teacher can also be a parent in the
  same school. The web apps are separate per audience; nothing switches between staff and parent today.
- **Push**: FCM HTTP v1 through **each school's own Firebase project**, for **web push only** (`push_devices` keyed
  by school, user, app `parent|teacher`); events: messages, attendance, fees, transport, queries, notices,
  homework, approvals. In-app inbox: `GET /comms/inbox`, `/comms/inbox/unread`.
- **Approvals**: no single API — `apps/admin/lib/approvals.ts` adds up about 25 endpoints (profile changes,
  workflows, purchase indents / requisitions / statements / orders / receipts / issues / assets / counts / stores /
  condemnations / vendors / revaluations, fee adjustments and requests, withdrawals, transfers, gate passes,
  recruitment, ACR, admissions, student leave, staff leave, regularisations, transport, file movement, lessons).
  The staff app shows its own approval screens with counts (`StaffWaiting` in `apps/teacher/app/(app)/layout.tsx`).
- **Payments**: the API returns a checkout (an auto-posted form for PayU / CCAvenue / SBIePay, Atom's script, or
  Razorpay); the gateway returns to the parent app's `/api/payments/return`, which redirects to `/fees?paid=`.
- **Offline**: both web apps are PWAs (manifest, service worker: shell cache, network-first pages, `/offline`);
  no offline writes.
- **API client**: `packages/api-client` (TypeScript, openapi-fetch) is not used yet; `pnpm api:openapi` exports the
  OpenAPI spec. `packages/ui` is web-only CSS.
- **Old native apps**: the legacy apps talk to the compat API (`apps/api/src/modules/compat`), which stays until
  the new app has replaced them.

## 3. Benchmark

- **CampusCare (Entab)** — one app for parents, students, teachers and management, role-based after sign-in
  ([mobile apps](https://entab.in/mobile-apps.html), [App Store](https://apps.apple.com/app/id1034721587)).
- **Alpha Campus** and others ship separate parent/student and staff apps, OTP sign-in for parents
  ([alphacampus.in](https://alphacampus.in/)); Teachmint is mobile-first with a parent portal
  ([SourceForge](https://www.sourceforge.net/software/product/Teachmint)).
- What the best do, and EduPro adopts: one sign-in, a profile switcher (each child, staff and parent), a "today"
  home, push for what needs action, one-tap approvals, fees paid in the app with the receipt, documents as PDF,
  works on a weak network. EduPro adds: staff approvals of every kind in one inbox, Hindi and English, and the whole
  web feature set inside the app from day one.

## 4. Decisions (19 Nov 2026)

| Question      | Answer                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Technology    | **Flutter** (Dart), one codebase for Android and iOS. Not the recommended option (React Native shared TypeScript); consequences in §6. |
| All features  | **Native daily screens; the rest as the existing web pages inside the app**, signed in, moved native over time.                        |
| Store         | **One EduPro app** for every school; the school found from the sign-in, its name and logo inside.                                      |
| First release | **Everyone together** — students, parents and staff in release 1.                                                                      |

## 5. The app

### 5.1 Sign-in and profiles

- **Sign-in**: mobile number (or e-mail, or a pupil's admission number) → one-time code → the app keeps a
  **refresh token** in the phone's secure storage (Keychain / Android Keystore) and asks for a **PIN or
  fingerprint / face** on the next open. Schools that use One Auth: "Sign in with One Auth" opens the system
  browser (OIDC code + PKCE, AppAuth) and returns to the app.
- **Profiles**: after sign-in the app reads the person's memberships: **Staff** at a school, **Parent** (one profile
  a child), **Student**. One profile opens straight away; with several, a switcher at the top (the avatar)
  changes profile without signing in again — a teacher who is also a parent switches in one tap. A person in two
  schools sees both. The last profile used opens next time.
- **Sessions**: the school can see a person's signed-in devices and sign one out (lost phone); the person can too.

### 5.2 What each profile shows (native screens, release 1)

- **Parent** — bottom tabs: **Home** (today: attendance, homework due, new notices, fees due, the next exam),
  **Academics** (homework, timetable, date sheet, results and report cards as PDF), **Fees** (dues, pay, receipts,
  tax certificate), **Messages** (school messages, notices, queries), **More** (every other feature).
- **Student** — **Home**, **Homework**, **Timetable**, **Results**, **More** (family-only items such as payments,
  consents and meetings hidden, as on the web).
- **Staff** — **My day** (timetable, classes to mark, tasks waiting), **Attendance** (mark a class — works offline
  and sends when back online; my attendance), **Classes** (daily work / homework, marks entry), **Messages**,
  **More**. The header carries **Approvals** with a count, as in the admin app: one inbox of everything this person
  may approve (§5.4), Approve / Reject with a reason, the full detail one tap away.
- **More** — the person's whole menu (the same permission-gated menus as the web apps, served by the API); an
  item without a native screen opens its web page inside the app (§5.5).
- **Everywhere** — Hindi and English (the person's language), large text, screen-reader labels, dark mode,
  pull-to-refresh, the school's name and logo.

### 5.3 Push notifications

- One **EduPro Firebase project** for the app (an app's push tokens belong to one project): FCM for Android, and for
  iOS through FCM with an APNs key. The schools' own Firebase projects keep serving web push.
- `push_devices` gains the app `mobile` and the platform; the workers send through the EduPro project for `mobile`
  devices. Each notification carries a link that opens the right screen and profile (a child's attendance, the
  approval waiting). The person chooses which kinds they receive.

### 5.4 Approvals inbox (staff)

- A new **`GET /approvals/inbox`** in the API: every kind the admin page shows today, gathered on the server by the
  person's permissions, each as one shape — kind, title, who asked, when, amount or dates, school — with counts by
  kind; **`POST /approvals/{kind}/{id}/decision`** (approve / reject, a reason) calls the existing endpoint of that
  kind, so the rules, segregation of duties, multi-factor checks and audit stay where they are. The admin page and
  the staff web app can later read the same inbox.
- A push to the approver when something new waits; the count shows on the Approvals icon.

### 5.5 Web pages inside the app

- A signed-in **web view** opens any parent / staff web page the app has no native screen for: the app asks the API
  for a one-time code (`POST /auth/mobile/web-handoff`, 60 s, single use, bound to the device) and opens the web
  app's `/api/mobile-handoff?code=…&to=/page`, which sets the web session and goes to the page. The web apps get a
  **mobile mode** (no header or menu of their own; back goes to the app). Links out of the web view to other
  EduPro pages stay inside; others open the phone's browser.
- **Fee payments** run in the web view: the gateway's page opens, the app watches for the return to `/fees?paid=`
  and shows the native receipt. Native gateway SDKs (Razorpay first) may follow.

### 5.6 Offline and weak networks

- Every screen shows the last copy it had (with "updated at") and refreshes when the network is back.
- **Writes that must not be lost** — a class's attendance, my attendance check-in — are kept on the phone and sent
  when back online, each with an idempotency key so a resend never doubles it.

## 6. Technology (Flutter)

| Need                   | Choice                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App                    | **Flutter** (current stable), Dart, Material 3 with EduPro's theme; Android 8+ and iOS 16+                                                                                                  |
| State, routing         | Riverpod; go_router (deep links from push and web view)                                                                                                                                     |
| API                    | **A Dart client generated from the API's OpenAPI** (`pnpm api:openapi` → `openapi-generator` dart-dio) in CI, so the app and API never drift; dio with the bearer and school / year headers |
| Secure storage, unlock | flutter_secure_storage (Keychain / Keystore); local_auth (fingerprint / face); app PIN                                                                                                      |
| Offline                | drift (SQLite) for cached reads and the queue of writes                                                                                                                                     |
| Push                   | firebase_messaging; flutter_local_notifications                                                                                                                                             |
| Web view, payments     | flutter_inappwebview (cookie hand-off, return-URL watch)                                                                                                                                    |
| Files                  | image_picker / camera (homework, documents), a PDF viewer (pdfrx), share and download                                                                                                       |
| Texts                  | ARB files generated from the web apps' `messages/en.json` and `hi.json` (a script), plus the app's own                                                                                      |
| Look                   | a Dart theme generated from `packages/ui` tokens (navy / cyan, Poppins / Source Sans 3)                                                                                                     |
| Quality                | flutter analyze, unit and widget tests, integration tests (Patrol) on emulators in CI; Sentry for crashes                                                                                   |
| Builds                 | GitHub Actions (tests) + Codemagic or fastlane on macOS runners (store builds); Shorebird for over-the-air Dart fixes (optional)                                                            |

**Consequences of Flutter** (instead of the recommended React Native): nothing is shared in code with the
TypeScript web apps, so the API client, texts and theme are **generated** from the same sources rather than
imported; the app needs Dart skills alongside TypeScript; over-the-air fixes need Shorebird rather than being
built in. In return: very smooth screens on low-cost Android phones, one widget set on both platforms.

**Where it lives**: `apps/mobile` in this repository (a Flutter project; not a pnpm workspace package) so the API,
the OpenAPI spec and the app change in one commit.

## 7. API work

- **Mobile sessions**: `POST /auth/mobile/refresh` (rotating refresh tokens, 60 days of inactivity, bound to the
  device; reuse of an old one signs that device out), `POST /auth/mobile/sign-out`, `GET/DELETE /auth/mobile/devices`
  (mine; the school's for an admin). A table of mobile sessions (hashed tokens, device name, platform, last seen).
- **Profiles**: `GET /me/profiles` — each school × kind (staff / parent with each child / student) with names,
  photos and what the profile may open.
- **Menus**: `GET /me/menu?profile=…` — the same permission-gated menus the web apps build (`portal-menu.ts`,
  `staff-menu.ts`), moved to one shared definition the API serves.
- **Approvals inbox** (§5.4), **web hand-off** (§5.5), **push for `mobile` devices** (§5.3).
- **Idempotency** on attendance writes; **mobile return URLs** for payments.
- Everything through the existing guards: tenant isolation, permissions, segregation of duties, audit.

## 8. Security and privacy

- Tokens only in secure storage; the app locks after a while away (PIN / biometric); no personal data in logs or
  crash reports; screenshots blocked on fee and payslip screens (Android).
- Certificate checks on the API host; a rooted / jailbroken phone gets a warning.
- DPDP: the consent notices as on the web; Play "data safety" and Apple privacy labels filled from what the app
  really collects; an in-app "delete my account" request (Apple requires it).

## 9. Phases (each gated: the plan items, analyze, tests, a check on Android and iOS, accessibility)

- **A — Foundations**: the API work for mobile sessions, profiles, menus, push for `mobile` and the web hand-off;
  the OpenAPI export and Dart client in CI; `apps/mobile` with the theme, texts, sign-in (OTP, PIN / biometric,
  One Auth), the profile switcher, the More menu with web pages, push registration, crash reporting.
- **B — Parent and student**: Home, attendance, homework, notices and messages, timetable and calendar, results
  and report cards, fees with payment and receipts.
- **C — Staff**: My day, class attendance (offline), my attendance, daily work / homework, marks entry, leave
  (apply, approve), payslips, and the **Approvals** inbox (the API inbox, push, the header count).
- **D — Polish**: notification preferences, devices and sign-out, performance on low-end Android, accessibility
  and Hindi review, every More item checked in the web view, the old apps' users moved (compat API kept until then).
- **E — Release**: internal test builds (Play internal testing, TestFlight), a pilot school, store listings and
  reviews, then all schools.

## 10. What is needed from the school / company (before phase A can finish)

- **Store accounts** in the company's name: Apple Developer Program (organisation, needs a D-U-N-S number) and a
  Google Play Console account; the app name, icon and bundle id (e.g. `in.edupro.app`).
- **Firebase**: one EduPro project for the app (owner: the company), an APNs key from the Apple account.
- **This Mac**: the Flutter SDK (can sit in the user folder), Android Studio with an emulator, and **Xcode** from the
  App Store for iOS builds — Xcode and the Android SDK need the user to install / agree to their licences.
- A crash-reporting account (Sentry) and, if over-the-air fixes are wanted, Shorebird.

## 11. Open points

- One Auth on mobile: which schools use it, and its redirect URI for the app.
- Native payment SDKs (Razorpay first?) after the web-view checkout.
- Transport live tracking on a map, if the buses report GPS (today: bus attendance only).

## As built — phase A, foundations (19 Nov 2026)

**API**

- **Mobile sessions** (migration 0400, `identity/mobile-auth.*`): `mobile_sessions` and `mobile_web_handoffs` behind
  SECURITY DEFINER functions (forced RLS, the migrator policy only). `POST /auth/otp/start` takes `app: 'mobile'`;
  `POST /auth/mobile/verify` (the code), `/one-auth` (a One Auth token), `/second-factor/verify` (One Auth + the code;
  the session counts as multi-factor) return `{accessToken, expiresAt, refreshToken, sessionId}`. Access tokens are
  the `otp.` HS256 tokens with `app: 'mobile'` and `msid` (the session), one hour; the auth guard refuses a token
  whose session is closed (a one-minute cache, cleared on sign-out). `POST /auth/mobile/refresh` rotates the refresh
  token (keyed hash stored; the previous one kept): the old one within 15 s answers `auth.mobile_superseded` (two
  renewals at once), later it is a stolen token — `auth.mobile_reused`, the phone signed out. 60 days unused ends a
  session. `GET /auth/mobile/devices`, `POST /auth/mobile/sign-out`, `POST /auth/mobile/devices/:id/sign-out`
  (one's own phones only). verify / refresh / redeem are on the public allow-list with their reasons.
- **Acting as the family**: header `X-Acting-As: family` (request context `actingAs`); `ViewerService.resolve` reads a
  person who is staff and also a guardian / student in the school as the family. The parent web app's BFF always
  sends it, so a teacher who is also a parent now sees their child on the parent portal too.
- **Profiles** `GET /me/profiles` (staff of each school, parent of each child, student; `actingAs` when also staff)
  and **menus** `GET /me/menu?kind=staff|parent|student` from the new package **`@edupro/menus`** (the staff menu
  moved from `packages/bff/src/staff-menu.ts`, which re-exports it, and the parent / student menu from the parent
  app's `FamilyShell` and `portal-menu.ts`; one definition for the web apps, the API and the app), with each screen's
  icon (`screenIcon`, `familyIcon`).
- **Web pages inside the app**: `POST /auth/mobile/web-handoff {app, to}` → a 60-second single-use link
  `…/api/auth/mobile?code=` (the BFF's new `mobile` handler, in the parent and staff apps) → the web app redeems it
  (`/web-handoff/redeem`) for its own session (`otp.` token naming the phone's session, so it ends with the phone)
  marked `mobile`: the `(app)` layouts then show the page without the app's header, menu and tab bar. A parent's page
  goes through `/api/child?id=…&back=…` to pick the child.
- **Push for phones** (migration 0401): `push_devices.app` may be `mobile` with `platform`; `PushService.send` queues
  pushes to phones even without the school's own Firebase (not when the school switched push off), marked
  `variables.app = 'mobile'`; the workers send them through `MOBILE_FCM_SERVICE_ACCOUNT_FILE` (the EduPro project;
  console in development) with Android / APNs settings. The helpdesk's SQL path still needs the school's Firebase
  (phase D).
- `POST /me/sign-in` has a typed body (app `mobile`); the code sign-in DTOs were renamed (`OtpStartDto` …) because
  another module's `StartDto` overwrote them in the OpenAPI description; `openapi:export` now exits when written, and
  `openapi:export:dist` exports from the build in 2 s.

**App** (`apps/mobile`, Flutter 3.50 / Dart 3.14, `package:material_ui`)

- Riverpod, go_router, dio, flutter_secure_storage, local_auth, flutter_inappwebview, shared_preferences,
  device_info_plus, google_fonts, firebase_messaging (off until `PUSH=true`), sentry_flutter (off without a DSN).
- Sign-in (login → code → app PIN), unlock (PIN or fingerprint / face), sessions renewed one at a time and signed out
  when the API says so; profiles with the switcher in the bar; Home (a welcome — the native daily screens come in
  phases B and C); More (the menu, in English or Hindi) opening web pages; Settings (language, sign out).
- **Generated** by `scripts/mobile/generate.mjs` (`pnpm mobile:gen`): `lib/api/endpoints.g.dart` (typed methods and
  request classes for the operations in `api-operations.txt`, from `apps/api/openapi.json`), `lib/theme/tokens.g.dart`
  (the design tokens), `lib/l10n/menu_hindi.g.dart` (Hindi for the menus from the web apps' dictionaries). The app's
  own words are in `lib/l10n/strings.dart` (English and Hindi) rather than ARB files.
- Android: label EduPro, `FlutterFragmentActivity` (local_auth), internet / biometric / notification permissions;
  iOS: display name, Face ID text. Package id `in.edupro.edupro` until the store accounts fix the final one.
- **CI**: the build job exports the OpenAPI description and fails on stale generated sources; a new job runs
  `flutter analyze` and `flutter test` (subosito/flutter-action, Flutter 3.50.0).

**Tests**: API e2e `mobile.e2e-spec.ts` (5: code sign-in, rotation, superseded and reused tokens; phones listed and
signed out, not another person's; profiles, menus and acting as the parent; web hand-off once, per app, ending with the
phone; a push queued to a phone without the school's Firebase); the permission allow-list; workers' FCM test for the
phone format; Flutter (10: the transport's renewal, single-flight, sign-out and errors; PIN hashing; the generated
client; the screens from sign-in through PIN, profile switch, More in Hindi, sign-out). Checked in a browser on a test
school: the app's web build signs in with the code, sets the PIN, switches to the parent profile and lists its menu;
the hand-off links open the parent and staff pages without their frame (axe clean) and end when the phone signs out.

**Not done in phase A (needs the company / this Mac)**: running on Android and iOS (Android Studio with an emulator and
Xcode are not installed), push through the EduPro Firebase project (no project or APNs key yet), crash reports (no
Sentry DSN), the final package id and store listings. The web build cannot show the web pages inside the app (the web
apps forbid framing — correct; phones open them in a WebView, not a frame).

## As built — phase B, parent and student (19 Nov 2026)

**App** (`apps/mobile/lib/family/`)

- **Tabs** (§5.2): a parent's child — Home, Academics, Fees, Messages, More; a student — Home, Homework, Timetable,
  Results, More (no fees). One parent profile is one child, so every screen shows that child only (the API's answers
  list the family's children; the app picks the profile's).
- **Home** (`today.dart`): the figures first, two a row — attendance this month (present / days), homework due today
  and tomorrow, fees to pay now (a student: the next exam), unread messages — then today's attendance, the homework
  due, the next exam (from the date sheet) and the three latest notices. Each part loads on its own.
- **Attendance** (`attendance.dart`): the month as a calendar (each day's status read out by the screen reader),
  the summary, the child's leave applications; **apply for leave** (the kind — type to search —, the days, the
  reason) and cancel one still waiting. A leave that needs a certificate (the school's rule: always, or more than the
  long-leave days) goes to the web page, where the file is attached. _(Replaced 19 Nov 2026: see "Attendance as on
  the website" below; the certificate is now taken from the phone.)_
- **Homework** (`homework.dart`): what is due first, then the last two weeks by day; in full with its files and "I
  have seen this" when the teacher asks for it. _(Replaced 19 Nov 2026: see "Homework as on the website" below.)_
- **Timetable** (a day at a time, today first), **calendar** (holidays and events by month), **date sheet**.
- **Results** (`results.dart`): each released card with its marks, grade, rank and result; the report card as the
  school prints it, and its **PDF** (the API makes it in the background; the app waits up to a minute and shows it).
  A card held back — or held until the fees are paid — says so.
- **Fees** (`fees.dart`): to pay now and the year's balance, the instalments with their status and late fee, the
  receipts (PDF), the fee bill, the certificate for tax (web page). **Pay online** opens the parent web app's fee page
  in the app's web view (the school's gateway, as on the web); the app sees the gateway's return to `/fees?paid=`,
  closes the page and shows the outcome on the refreshed statement.
- **Messages** (`messages.dart`): the school's messages about the child, 20 a page (marked read when opened), the
  notices (pinned first; in full with files and "I have seen this"), and the queries to the school (web page).
- **Files**: report cards, receipts, bills and attachments open in the app (PDF pages or the picture) with Save /
  Share (the phone's share sheet); attachments are numbered View and Download icons, without file names.
- **No network** (§5.6): every screen keeps its last copy on the phone (per profile) and shows it with "No
  connection. This is the copy from …" when the API cannot be reached; an API refusal is never hidden behind a copy.
  The copies are wiped at sign-out (also when the API signs the phone out). Pull down to refresh everywhere.
- **Hindi and English**, dates and money in Indian style (₹1,23,456.50). Dark mode: filled buttons now have navy text
  on cyan (white on cyan was 3.1:1). Status words are body text on their tint with a coloured dot (the status colours
  alone are under 4.5:1 for small text).

**API**

- No new endpoints: the app calls the parent web app's own (attendance, leave, daily work, acknowledgements, notices,
  inbox, timetable, calendar, date sheets, results and report cards, fees and receipts), listed in
  `api-operations.txt`.
- **Unique names in the OpenAPI description**: the staff leave module's controllers are now `StaffLeaveController`
  and `StaffAttendanceController` (two operations each had the ids `LeaveController_mine`, `AttendanceController_mine`
  …), and the inbox's body class is `CommsInboxReadDto` (the admission portal's `InboxReadDto` overwrote it in the
  description). 52 request classes still share names across modules; the generator now refuses an operation id used
  twice and a request body whose class name is defined in more than one module, so a clash is fixed (renamed) when the
  app first uses it, not discovered on a phone.
- The app's file reader also follows an attachment's `{file, download: {url}}` and fetches signed links itself
  (`ApiTransport.download`).

**Tests**: API e2e `mobile-family.e2e-spec.ts` (6) — a parent and a student signed in on phones (their own session
tokens) call every endpoint the screens use, exactly as the app does, and every field the app reads is there: this
child's attendance only, homework with its file link and acknowledgement, a notice in full and acknowledged, the inbox
page, leave rules / apply / cancel, timetable, calendar, results, date sheets, fees, and the web pages for paying, the
tax certificate, queries and a leave with a file. Flutter (24): the family screens against a made-up school (Home's
figures, attendance and leave, the certificate rule, homework, results and the report card PDF, fees and receipts,
messages and notices, a student's tabs, the copy shown with no network, the copies wiped at sign-out, money and dates);
accessibility guidelines (tap targets, labels, text contrast) on every screen in light, dark and Hindi; every screen
at twice the text size without overflow. The related API suites (attendance, leave, comms, daily academics, login,
portal: 17 files, 142 tests), permission coverage, lint and types pass. Checked in a browser on a test school: the
app's web build signs the made-up parent in and every screen reads the real API without an error; the web pages the
app opens (fees, tax certificate, queries, leave) come up signed in for the right child without the web app's frame.

**Not done in phase B**: as in phase A, no run on Android / iOS devices yet (no Android Studio / Xcode on this Mac),
so the payment's return inside a real WebView and the share sheet are checked on a phone in phase E's internal test
builds; native gateway SDKs (Razorpay) stay for later (§5.5).

## As built — phase C, staff and the approvals inbox (19 Nov 2026)

**App** (`apps/mobile/lib/staff/`)

- **Tabs** (§5.2): My day, Attendance, Classes, Messages, More; the bar carries **Approvals** with the count.
- **My day** (`my_day.dart`): the figures first — periods today, classes still to mark, marks to enter, approvals
  waiting — then today's periods (with substitutions), the day sections the person marks that have no attendance yet
  (their own class-teacher sections only, not every section they may see), and the marks waiting. Today's rolls are
  fetched here so they can be marked later with no network.
- **Mark a class** (`class_attendance.dart`): the class from the person's assignments (day attendance where they may
  mark it, or a subject they teach), the day (up to today), the roll with Present / Absent / Late at a tap and the other
  codes in a menu, "All present"; a pupil on approved leave stays on leave. **Saved through the outbox**: sent at once
  with a key, or — with no network — kept on the phone and sent when the network is back (§5.6).
- **My attendance** (`my_attendance.dart`): the month from the school's punch machines and the corrections asked for;
  **ask for a correction** (in / out time or what the day should be, and why) and withdraw one waiting. EduPro has no
  check-in from a phone — staff days come only from the biometric punches — so the planned "my attendance check-in"
  write is not there; the correction request is the staff member's own write.
- **My leave** (`my_leave.dart`): balances, requests (withdraw one waiting, ask to cancel one approved), **apply** with
  the kind (type to search), half day, dates and reason; when the school asks to confirm (a leave over a holiday, a
  split with loss of pay) the person reads its words and goes ahead. A kind that needs a document goes to the web page.
- **Classes** (`classes.dart`): **post homework / classwork / an assignment** for a class and subject with a due date,
  "ask families to say they have seen it", and photos (camera) or files (PDF, pictures) uploaded the way the web does
  (register, send the bytes, complete); **marks entry** (`marks.dart`: the exams with sheets waiting, a sheet's box a
  pupil or Absent, the maximum checked, saved, then sent for checking; a subject entered in parts goes to the web
  page); **my timetable** a day at a time; **my payslips** by financial year, each opening as its password-protected PDF
  with the password hint.
- **Approvals** (`approvals.dart`): every kind waiting for the person, the oldest first, filtered by kind; an item opens
  with what it is, who asked, when and the amount, "Open the full page" (a staff page inside the app; an admin page in
  the browser), and Approve / Reject (Acknowledge, Sign or Send back where that is the kind's word) with the reason the
  kind needs. A kind that needs more than a yes or no says so and opens its page.
- **More**: an item with a native screen opens it (family and staff alike), the rest open their web page.
- **Outbox** (`lib/api/outbox.dart`, `ui/outbox_view.dart`): writes recorded from the generated client, kept in order
  on the phone, sent with their own `Idempotency-Key` and school; retried every minute, when the app comes back and on
  "Send now"; a refusal is kept with its reason until removed; signing out warns about unsent work and clears it.
- Online writes that may be retried after a lost answer (homework post, leave application, correction request) carry a
  key too. Texts in English and Hindi; accessibility checked in light, dark and Hindi and at twice the text size (the
  count badge became white with navy figures; every type-to-search arrow is named for screen readers).

**API**

- **Idempotency keys** (migration 0402 `api_idempotency`, definer functions; `common/http/idempotency.ts`): a route
  marked `@Idempotent()` given `Idempotency-Key` runs once per person and key — a repeat gets the first answer
  (`Idempotent-Replayed: true`, no second audit row or alert), the key with another request is refused (422), a repeat
  while the first runs is told to try again (409 `idempotency.in_progress`), a failed request frees its key; kept two
  days. Marked: class attendance, homework post, staff leave application, attendance correction request.
- **Approvals inbox** (`modules/approvals`): `GET /approvals/inbox` gathers **33 kinds, 27 of them decided in the inbox** — the admin Approvals page's 26 (fee adjustments and requests, staff leave and its cancellations each as two)
  (workflow steps, profile changes, purchase indents / orders / requisitions / comparative statements / receipts /
  issues / counts / rate corrections / condemnations / vendors / assets, fee adjustments and requests, withdrawals,
  transfers, gate passes, vacancies, ACRs, transport, file movement, lessons, student leave, staff leave and its
  cancellations, attendance corrections, registrations) and the staff app's own (staff profile changes, exits, no-dues,
  consent answers, hostel visits) — in one shape (kind, id, title, detail, who, when, amount, page, how it is decided).
  `POST /approvals/{kind}/{id}/decision` sends a decision to that kind's own route. Both call the existing routes
  **in-process as the person** (`InternalCalls`, Fastify inject with their sign-in; not rate-limited), so permissions,
  scope, segregation of duties, second factor, validation and audit stay exactly where they are; the inbox writes no
  audit row of its own. Kinds that are not a yes / no (inspection line by line, clearances, accepting a transfer, an ACR,
  no-dues, condemnations) are listed and opened on their page. A list that fails shows as "unavailable", not as nothing.
- More request classes renamed for unique OpenAPI names (`StaffLeaveApplyDto`, `StaffLeaveWithdrawDto`,
  `StaffLeaveReasonDto`), caught by the generator's check.

**Tests**: API e2e `idempotency` (3: replay without a second marking, alert or audit row; key reused; bad key; per
person; a failed request frees its key), `approvals-inbox` (6: an administrator's inbox reads every list route; a class
teacher sees and decides a pupil's leave in the one shape, with one audit row; the reason rule; the kind's own refusals
passed on; own-page and unknown kinds; every kind's list and decision routes exist and accept the inbox's request —
checked against a known bad body), `mobile-staff` (5: a teacher's phone session reads every endpoint the staff screens
use; marks and homework sent twice done once; the approvals inbox from the phone). Flutter 44 (outbox 7: kept, in order,
same key, refusals kept, in-progress retried, cleared at sign-out; the transport's per-call headers; staff 12: My day's
figures and sections, marking, offline marking sent later, approvals with the reason, leave with the bridge
confirmation, a correction, marks over the maximum and sent for checking, homework with a key, payslips, More opening the
native screen, accessibility in light / dark / Hindi, twice the text size). Full API e2e 196 files: all pass but one
consent-forms test that passes on its own (timing under load). Lint, types, unit 88, permissions, database 151, script
checks. Checked in a browser on a test school: a made-up teacher signs in on the web build and every staff screen reads
the real API without an error.

**Not done in phase C**: a push to the approver when something new waits (needs the EduPro Firebase project — phase D
with push), devices (as before). Found on the way and left for separate work: the admin Approvals page reads
`createdAt` for workflow items (the API sends `requestedAt`), checks other permissions than the fee and withdrawal list
routes need, and counts pages rather than totals for some kinds; fee requests routed through approval levels are decided
on `/workflow/steps`, which does not ask for the second factor their own route asks for.

## As built — approvals fixes after phase C (19 Nov 2026)

The problems found in phase C (above, "Found on the way") are fixed.

- **Second factor for fee steps** (`WorkflowService.act`, `stepUp`): a step of a fee request riding the approval levels
  — entity types `fee_*` (waivers and their undoing, receipt cancellations and cheque bounces, date corrections and
  the other fee requests, fee profile changes, opening balances, refunds) and `misc_fee_request` — asks what its own
  route asks (`fees.adjustment.approve` / `fees.refund.approve`, step-up): a recent second factor (403 `mfa-required`,
  the admin sends the person to step-up) and never while impersonating. Checked in `act()`, so the general step
  routes, the approvals inbox and any other caller are covered. The freshness rule is shared with the permission
  guard (`common/access/fresh-mfa.ts`). Admission refunds (`admission_refund`) are not a fee type and keep their rule.
- **Counts are totals**: each kind of the inbox counts what waits in all from its list route (`ApprovalSource.total`),
  while the items stop at the route's page. Routes that had no count now give one: purchase counts and rate
  corrections (`waitingForMe`), gate passes and transport requests (`waiting`), attendance corrections (`total`);
  staff leave and its cancellations are read separately (`kind=leave` / `kind=cancellation`) with their own `total`.
  `total` is the kinds' counts added up; `GET /approvals/inbox?view=counts` gives the counts without items.
- **Rights match the list routes**: the fee adjustment and fee request lists (and the adjustments register) open to
  those who decide them (`fees.adjustment.approve`) as well as those who raise them; the withdrawal kind is asked of
  those who clear (`people.withdrawal.clear`) and see withdrawals (`people.withdrawal.view`, the list's and the
  page's right) — `ApprovalSource.needsAll`; hostel visits likewise need `hostel.visit.view` with `.decide`, and read
  the list's own fields (`rows`, `pupil`, `visitorName`, `createdAt`: before, nothing showed). A kind asked only of
  those holding its rights that is still refused is logged as a warning.
- **Admin Approvals page, header count and dashboard** read `GET /approvals/inbox` (`apps/admin/lib/approvals.ts`):
  one source of truth with the mobile app, so the "since" of workflow steps is their `requestedAt`. Each item carries
  `adminHref` (its page in the admin app) and `staffUrl` (a staff app page as a full address); the staff app's own
  kinds (exits, no-dues, consent answers, hostel visits) now show too, opening in the staff app. A kind without a
  list page for everyone (assets handed to you; vacancies for those without `people.recruitment.view`) has no
  "Open" button and shows every item, each opening its own page — no group link to the first item. A long group
  says "Showing 10 of N"; kinds that could not be read are named.

**Tests**: API e2e `fee-approval` (+1: a fee step refused without a second factor or with one two days old, approve
and reject, directly and through the inbox; nothing decided; then approved with a fresh one) and `approvals-inbox`
(+1: a person holding exactly the rights the inbox asks each kind by is refused by no list; the counts add up and
`view=counts`); unit `approvals.service.spec` (a kind counted by its route's total; counts alone) and
`workflow-step-up.spec` (which entity types ask for the second factor).

## As built — phase D, polish (19 Nov 2026)

**Notifications**

- **The person chooses** (§5.3): Settings → Notifications lists the kinds of push the profile's school sends that the
  profile hears of (a family: homework, attendance and leave, notices, fees, bus, messages, query replies; staff:
  approvals, notices, attendance and leave, messages, query replies) and switches each off or on — kept per school on
  the server (`GET`/`PUT /comms/push/events`, the person's preference `push.off`), so every phone of the person follows
  it. `PushService.send` and the help-desk's SQL push leave out people who switched that kind off.
- **A tap opens the right place**: a push to a phone now carries `event`, `schoolId` and, where the sender knows it,
  `studentId` beside `link`. The app's `/open` route switches to the profile it is about (the child; the school's staff
  profile for an approval) and opens the native screen, else the web page; a staff member's approval push opens the
  Approvals inbox. Links outside EduPro are not followed. Shared links use the same route.
- **The approver hears of it** (§5.4): the approval engine now tells the next level's approvers when a request moves up
  (it told only the first level for flows without auto-skip: admission level 2, consent forms, lesson plans, fee
  approvals, message approval, certificate requests); a pupil's leave tells the approvers of its waiting level and, once
  decided, the family (it told nobody); a gate pass pushes to its approvers besides SMS / WhatsApp.
- **Pushes that never arrived, fixed**: a template on the push channel (certificate requests, staff leave's "app"
  messages) went to the person's mobile number as if it were a device — it now goes to their phones and browsers
  through the push sender, with a link to its page (leave waiting → leave approvals, a decision → my leave, a
  certificate → the certificates page) and the kind `approvals` for messages waiting on a decision (they counted as
  "attendance"); the help-desk's SQL push sent phone tokens through the school's own Firebase (migration 0403: phones
  are marked for the EduPro project and get it without a school Firebase).
- The push token stays the classic FCM token: firebase_messaging 17's `register()` gives an installation id the
  workers' FCM v1 messages do not target, and there is no EduPro Firebase project yet to change and test both together.

**Phones, updates, the old apps**

- Settings → **Phones signed in**: the person's phones (this one marked), when last used, the app version; another one
  is signed out from here (the school can do the same).
- **Update check**: `GET /auth/mobile/app-version?platform=&version=` (public) answers from the API's
  `MOBILE_MIN_VERSION`, `MOBILE_LATEST_VERSION` and `MOBILE_STORE_URL_ANDROID` / `_IOS`; a build below the minimum stops
  at "Update EduPro" with the store link (a failing check never stops the app). The app now reads its own version from
  the platform (the pubspec's) unless the build gives `APP_VERSION` — it said 0.1.0 before, which the check would have
  stopped.
- **The old apps' users**: the school writes what the old apps' update prompt says (`compat.app_update_message`, e.g.
  "Install the new EduPro app" with its link; with `compat.app_version_*` / `compat.app_force_below` it shows as a
  prompt or a forced update), and **`GET /platform/old-apps`** shows how many people signed in through the old apps in
  the last 7 and 30 days, by the user type they sent, beside the EduPro app's users — the school retires the compat API
  when the first reaches nought (ADR-015). The prompt goes live once the store listing exists (phase E).

**Every More item, Hindi, accessibility, slow phones**

- **Every web page the app opens from More** (48: a parent's, a school administrator's and a teacher's menus) opened
  through the phone's one-time link in a browser: each comes up signed in, without the web app's own frame, without an
  error page and without serious or critical axe findings. It found the staff app's My profile failing (500) for a
  sign-in with no staff record — it now says the sign-in is not linked to a staff record.
- **Hindi**: the app's 246 texts compared with the web apps' dictionaries; 33 aligned to the web's words (फ़ीस, अवकाश,
  अतिदेय, विलंब, शैक्षणिक …); three differ on purpose ("Open" on a button is the verb; "Seen" stays neutral for
  homework and notices; "Fee bill" spelt as the Fees tab).
- **Slow phones**: the screens' last copies are kept a file each on a phone (they were all in the preferences file,
  which Android reads whole); the brand fonts (Poppins, Source Sans 3; SIL Open Font License, licences beside them,
  1.9 MB) ship in the app, so a first launch offline looks the same and nothing is fetched from Google at run time
  (`google_fonts` removed). No measurement on a low-end Android phone yet (no Android Studio on this Mac).
- Accessibility guidelines checked on the new screens (Notifications, Phones) in light and dark.

**Tests**: API e2e `mobile-notifications` (7: a kind switched off and on; a pupil's leave to its approver and the
decision to the family; a gate pass to its approver; a request moving to its next level; a push-channel template to the
phone, not to a mobile number, and refused plainly without a device; the help-desk's push to phones and switched off;
the version check, the old apps' words and who still uses them); `certificate-requests` and `leave-requests` now check
their app messages reach the phone (they checked the undeliverable rows); workers 60 (the phone's push data). Flutter
56 (links and profiles, an approval push opening the inbox, notifications, phones, the update gate, the file store,
accessibility). Full API e2e 201 files: the files that failed in the full run pass on their own and on a second run of
their batches (load). Lint, types, unit 92, permissions, database 151. Checked in a browser on a test school: a made-up
teacher's Settings, Notifications (switches saved) and Phones read the real API without an error.

**Not done in phase D (needs the company / this Mac)**: measuring on a low-end Android phone, pushes end to end (the
EduPro Firebase project), the store links (the listings). Phase E: internal test builds, a pilot school, the store
listings and reviews, then all schools.

## As built — the redesign, look B "navy band" (19 Nov 2026)

The user found the first look plain and asked for a new design for the student/parent/staff app, with the school's
logo on the sign-in screen and "Powered by Mobilise" with Mobilise's logo at its foot. Three looks were drawn on a
design canvas (sign-in and home each); the user chose **B · navy band** and approved its other screens (code, PIN,
student home, staff My day, a list, a detail) before the app was rebuilt.

**The look**: a navy band at the top of every screen and a light sheet with 24 px rounded corners over it
(`BandScaffold` for sign-in, code and PIN; `BandSheet` for the tabs and every pushed page, `FamilyPage`); on Home the
band goes on with the date and a greeting and the figures card sits half over it (`HomeBand`, `FigureGrid(raised)`:
one white card, cells with lines between, a coloured dot for a status). Buttons are cyan with navy words (4.8:1);
the bottom bar is navy with a cyan pill on the open tab and the unread count on Messages; the profile bar on the band
has round buttons for approvals (staff) and settings. Home adds the **shortcuts**, four a row as on the design's look A
(Attendance, Homework, Timetable, Results, Calendar, Date sheet, Notices, and Queries when the parent's menu has it,
else Messages; an icon on a light tile, its name under it), and **today's classes** (the
section's periods for today, the one on now tagged, the ones over ticked; staff: the teacher's periods with
substitutions tagged). Staff classes still to mark are tinted cards with **Mark now**.

**The school's logo**: after a sign-in the phone keeps the school of the profile in use (`schoolBrandProvider`, in
the phone's preferences): its name and its public logo (`GET /public/schools/{code}/logo`, asked once; a school with
no logo is asked again only for another school; logos over 512 KB are not kept). The sign-in, code and PIN screens
show it from then on, also after signing out; a phone that has never signed in shows the EduPro mark and "Your school,
on your phone". The code screen of a first sign-in does not name the school: a number typed in must not tell a
stranger which school it belongs to (so the school's logo appears once the phone has signed in, not after the number
is typed). `/me/profiles` already carried `schoolCode`; no API change.

**"Powered by" + Mobilise's logo** at the foot of the sign-in, code and PIN sheets (`PoweredBy`, the PNG from
`packages/ui/assets`, on a white chip in dark mode; a wrap, so large text puts the logo under the words).

**Sign-in**: the code is six boxes over one real field (autofill, keyboard and screen reader use the field); a full
code is sent on its own. **PIN**: a number pad with dots; choosing is 4 to 6 digits then **Next**, then the same
again (it saves on the last digit; "Choose another PIN" starts over); unlocking opens on the PIN's last digit (the
length is kept beside the PIN; a PIN set before that has an **Open** button), with the fingerprint / face key on the
pad when the phone has one. A computer's keyboard types into the pad too (the web build).

**Checks**: `flutter analyze` clean; 65 tests (new: the remembered school and its logo, the old-PIN Open button, the
PIN steps, today's classes, sign-in/code/PIN accessibility in light and dark — tap targets, labels, contrast; the
existing family and staff accessibility and large-text checks pass on the new screens). A headless run of the web
build on the test schools (parent, student, staff) matched the design; with a test logo the unlock screen showed the
school's crest and name.

## As built — Fees in the app, with no web page (19 Nov 2026)

The user asked for the parent app's Fees to be the web app's `/fees` page, with no web page called. Decided with the
user: **the gateway's own page opens inside the app** (card, UPI and net-banking details must be typed on the
gateway's page: RBI and card-security rules), and **the fee bill and tax certificate as app screens with View and
Download of their PDF**.

**On the screen** (`family/fees.dart`): the child, class and session with the pay plan, hostel, transport and
discounts; Due now (late fee included), School fee, Hostel fee (a hosteller) and Other fees as figures; sections as
chips that wrap — **School fee / Hostel fee** (instalments ticked the oldest first, everything due today ticked to
start; rows kept off online payment say "Paid at the school fee counter only"; the gateways with their convenience
charge; the total; Pay), **Other fees** (trips, activities, forms: last date, amount, seats, Pay online in full, the
gateway chosen when there are several), **Receipts** (school/hostel tag, bounced, refunded, cancelled, cleared or
settled; View and Download; the online payments with their status), **Fee bill** (All / Regular / Hostel; the
particulars, fee heads, each fee's instalments, receipts and the summary with the balance in words; its PDF) and the
**tax certificate** (`family/fee_papers.dart`: financial year, the receipts that count, total in words; its PDF). The
same rules as the web pay panel (`family/fee_pay.dart`: `openRows`, `firstUpTo`, `feeFor`, `chargeOn`).

**Paying** (`fee_pay.dart`): the app starts the payment itself (`POST /payments/intents/mine` or `/mine/misc` with
`app: mobile`) and opens `CheckoutScreen`: a few lines of its own HTML that hand over to the gateway (the auto-posted
form for PayU / CCAvenue / SBI ePay, Razorpay's checkout, Atom's script — only from Atom's addresses; values
escaped), opened from the school's registered web address so a gateway that checks where a payment comes from sees
the same one as from the website. The gateway still returns to the parent web app's registered return endpoint
(`/api/payments/return`, a server route: no page); for a phone payment the intent's return address is
`/api/payments/mobile-done?student=…` (`PaymentsService.familyReturn`), which the checkout view watches for and
closes on, reading `paid`; that route only answers a plain line if it is ever loaded (public, no session). UPI app
links from a gateway's page open outside the app. In development (mock mode) the app shows the development gateway's
two answers itself (`POST /payments/payu/mock`, refused outside mock mode). After a payment the ledger, other fees and
online payments are fetched again; a paid one opens Receipts.

**API**: `app: 'web' | 'mobile'` on the two family intent bodies; `GET /fees/mine/tax-certificate/file` (the PDF:
the school's letterhead as the store papers print it, the facts, the receipts that count, the total, a box for the
authorised signatory, the certify line). The old "Pay" and "Tax certificate" web pages are no longer opened by the
app (`WebPageScreen` lost its return watcher).

**Checks**: API e2e (`collect-and-pay`: a phone payment's return address and the gateway's registered return; the
tax certificate PDF, own child only); app tests 73 (the pay rules, the escaping of the hand-over page, the end
address; Fees end to end with the development gateway, other fees, receipts, bill and tax certificate; light, dark,
Hindi accessibility and double-size text on every Fees part); a headless pass of the web build on a test school.
Live payment waits for the schools' gateway accounts (the fee module's phase 2).

## As built — Profile, receipts by fee type, students' Fees (19 Nov 2026)

**Profile in the app, with no web page** (`family/profile.dart`; More → Profile for a parent's child or a student):
the photo (from the API; Add / Change photo from the camera or gallery, JPG / PNG / WebP up to 5 MB, uploaded as a
`personal` file and sent as a change), class and roll, admission number, class teacher, how complete the profile
is, the profile PDF (View / Download), the parents with their photos (a parent's profile), the update window, the
changes asked for (folded until tapped, as on the website: "n waiting · n decided · Show history"; Withdraw on one's
own pending request), every section with its values and what waits for approval, **Update** per section (only the
editable fields: "Saved at once" or "Needs approval"; type-to-search lists with the address cascades; dates from a
calendar; the proofs the school asks for, from the phone's files; a reason; only the fields changed are sent), **Your
data** (the data-protection requests and their report; a new access, correction or grievance request, about oneself
or a child) and **Your consents** (Allow / Withdraw; the required ones cannot be withdrawn). The same API calls and
rules as the web pages (`appliesTo`, `optionsFor`, `shownValue` mirror apps/parent/app/(app)/profile/types.ts).

**Photos and the profile PDF (19 Nov 2026).** A school file's signed link names the API's own address
(`API_BASE_URL`); the app fetches it through the address it uses for the API (`viaApiBase` in
`api/dio_transport.dart`), so the photos load wherever the app reaches the API (a phone, the web preview). The
profile PDF is made **at once by the API** (`GET engagement/mine/profile/:studentId/print/file`,
`modules/engagement/student-profile-pdf.ts`, pdf-lib): the letterhead (logo, address, affiliation and contact),
"Student Profile · Parent / Student copy" with when it was downloaded and how complete the profile is, the student's,
father's and mother's photos (PNG / JPEG; a WebP photo leaves its box empty) with the key facts, every section with
only the fields this portal shows, the documents on file, the remarks, the declaration with three signature lines,
and "Page x of y". It no longer waits for the background workers; each download is kept in the audit trail
(`engagement.profile.print`). The website uses the same route (`/profile/pdf?child=`: View opens it, Download saves
it; the Home card's Download profile too). The queued print (`POST …/print`) stays for other callers.

**Receipts by fee type** (web Fees → Receipts and the app): School fee, Hostel fee (a hosteller, or one with hostel
receipts) and Other fees (the MF series, until now not shown to parents), each with its count and what was received
(cancelled and bounced not counted, refunds off); other-fee receipts have their own family routes
(`GET /fees/misc-fees/mine/receipts/:id/view|file`, the fee receipt's sheet, parent copy).

**Students see their own Fees**, view only, in the app and on the student website (`@edupro/menus`: Dues and receipts
no longer parent-only); paying stays the parent's right (`payments.family.pay`); a student's Home grid shows Fees in
place of Results (a student tab).

**Portal frame**: the parent and teacher web layouts leave out their header and menu only inside the app's web view
(session handed over by the app AND the user agent marked `EduProApp/<version>`), not for a handed-over session in
an ordinary browser. The app's web preview (Flutter web) cannot mark its frames, so pages still opened as web pages
show the portal's frame there; on a phone they do not.

## As built — Attendance as on the website (19 Nov 2026)

**Attendance in the app, with no web page** (`family/attendance.dart`; Academics → Attendance or Home's tile, for a
parent's child or a student), the same three views as apps/parent/app/(app)/attendance:

- **Month**: Previous / Next month; the figures (school days, present, absent, on leave, late or part of the day,
  and the percentage: 90 and above green, 75 and above amber, below that red); a ring of present / leave / absent
  with the percentage; the calendar (each day's colour and code; the screen reader reads the date and the word) and
  its key; **Day by day, with gate in and out times** folded until tapped (newest first, the status, In / Out from
  the gate); the **School bus** of the month (`GET attendance/bus-roll/mine`: "n/m trips on the bus", each day's
  morning and afternoon and the route).
- **Year**: the session's figures; bars month by month (present, leave, absent stacked, the percentage over each;
  the list below has the same numbers for the screen reader); **Month by month** (days, present, absent, leave,
  late, the percentage); a month opens in the Month view (`GET attendance/desk/mine/year`).
- **Leave**: Apply for leave; the approval rule ("up to n days by the class teacher; a longer one also goes to the
  coordinator and the principal"); **Leave applied in this session**: kind and days, number, days, long leave,
  reason, the certificate (View / Download, `GET attendance/leaves/mine/:id/files/:fileId`), the school's note,
  ended early, the status ("With: Class teacher" while it waits), **Cancel this leave** (waiting, or not begun) or
  **Child is back: end the leave today** (approved and under way).
- **Apply for leave** (also from Month and Year): the kind (type to search), first and last day, reason, and the
  **certificate or letter from the phone** (PDF or photo, 5 MB each, several; uploaded as files and sent as
  `fileIds`); the certificate rules per kind are listed and a leave that needs one is not sent without it. The web
  page is no longer opened for it.

## As built — My teachers (19 Nov 2026)

**My teachers in the app, with no web page** (`family/teachers.dart`; More → My teachers, for a parent's child or a
student), as apps/parent/app/(app)/teachers: the child and class; "The class teacher and the teacher of each
subject."; a card per teacher, the class teacher first (`GET academics/my-teachers`): the photo
(`GET academics/my-teachers/:employeeId/photo`, fetched through the app's API address) or the initials, the name,
the role (Class teacher / Co-class teacher / Subject teacher), the subjects, the designation, and the contact the
school shows. In full: the number and e-mail are buttons that call or write from the phone. In part: shown as they
are, with the note to raise a query or book an appointment from the Help desk. Hidden: not shown.

## As built — Homework as on the website (19 Nov 2026)

**Homework in the app as apps/parent/app/(app)/homework**, so earlier homework can be opened (a student's Homework
tab; Academics → Homework for a parent):

- **Homework and classwork**: a day at a time — Previous / Next (no day after today), **Today**, **Day: …** (any
  earlier day from the calendar), and the days that had work (up to seven, from the chosen day and the 13 before
  it, as the website). Each subject with its homework, then its classwork; "Nothing has been published for today
  yet." / "Nothing was posted on this day." (`GET academics/daily-work` from the day minus 13 to the day;
  assignments left out).
- **Assignments** (the tab shows how many are still to do): **Given from** / **To** from the calendar and Clear;
  **To do** (no due date or due today or later, the nearest first) and **Past the due date**, each with its subject
  and the day it was given (`GET academics/daily-work?kind=assignment`).
- Each piece of work as the website shows it: its kind, title and text, the due date (today amber, past red with
  "overdue"), the files (View / Download), who posted it and when it was published, and **I have seen this** when
  the teacher asks for it. Home's "Homework due" and its full view are unchanged.

## As built — Timetable, shared papers and date sheet as on the website (19 Nov 2026)

- **Timetable** (`family/timetable.dart`): **Week** first, as apps/parent/app/(app)/timetable — a row per period
  (name and time) and a column per school day (slides sideways on a phone; today's column marked), each with the
  subject, teacher and room, breaks as "—"; "n school days a week"; "The timetable has not been published yet."
  **Day** keeps the one-day view for a quick look.
- **Session plan and date sheets** (`family/documents.dart`, menu `/documents`, no web page): as
  apps/parent/app/(app)/documents — the kinds that have papers (All, Session plan, Curriculum, Date sheet, Other);
  **For the class** (only the child's class) and **From the school** (magazine, almanac); each paper with its
  kind, title, the school's remark, the files (View / Download, `GET academics/documents/:id/files/:fileId`), who
  shared it, the class and when, and **I have seen this** when the school asks (`POST academics/acks`,
  `type: document`).
- **Exam date sheet** (`family/date_sheet.dart`): as apps/parent/app/(app)/date-sheet — "The papers of each exam:
  date, day and time."; **Next paper** on top; each exam still to come with its papers (date and day, subject,
  time) and the school's note; **Earlier exams (n)** folded until tapped; "No date sheet yet." / "No exam coming up."

## As built — Health and Certificates as on the website (19 Nov 2026)

- **Health** (`family/health.dart`, menu `/health`, no web page): as apps/parent/app/(app)/health — "Clinic visits
  and health cards", how many and latest first; All / Clinic visits / Health check-up cards, From / To from the
  calendar, a search (complaint, treatment or remark), Clear; ten a page (`GET clinic/mine/list`). A visit: the date
  and time, the complaint, the outcome (Back to class, Resting in the clinic, Sent home, Referred), the treatment and
  medicine given; in full (`GET clinic/mine/visits/:id`): the facts, complaint and examination, treatment, the
  medicines, what the school asks of you (sent home / referred) or the advice, the doctor. A health card: the camp,
  "Please see a doctor" or "Health card", height, weight, BMI, blood group; in full (`GET clinic/mine/cards/:id/detail`)
  section by section with the remarks for the parents, and its PDF (View / Download, `GET clinic/mine/cards/:id`).
- **Certificates** (`family/certificates.dart`, menu `/certificates`, no web page): as
  apps/parent/app/(app)/certificates — the figures (Ready, In progress, To pay, You can ask for); **Your
  certificates** (the register's and the earlier achievement certificates, awards marked) with View / Download of
  the PDF (made by `POST certificate-requests/mine/certificates/:id/pdf` or `engagement/mine/certificates/:id/pdf`,
  then fetched when its export is ready; the app waits up to a minute); **Requests** with where each is (Asked →
  Approved → Fee → Being made → Ready), Pay the fee (opens Fees) or Withdraw, the closed ones folded; **Ask for a
  certificate**: each type with who decides, what for and its fee, the form opening under it (purpose — a list when
  the school gives one —, copies, a note), `POST certificate-requests/mine`.
- The certificate request's body type in the API is now `CertificateRequestDto` (it shared the name
  `CreateRequestDto` with the comms module, which the app's generator refuses); the request is unchanged.

## As built — Messages, Notices, Calendar and School directory as on the website (20 Nov 2026)

- **Messages** (`family/messages.dart`): "Messages from school" with its line; each message with when, the child
  and the channels (SMS + WhatsApp + Email) and its first words; in full: the subject, the text, **Open the email**
  (the e-mail as the school formatted it, shown in the app with scripts off), the attachments (View / Download) and
  how it reached the family on each channel (Delivered, Sent, Queued, Failed, Read on WhatsApp). Opening marks it
  read. (The website's "turn on notifications" is the app's own push.)
- **Notices** (`NoticesList`): "Notices and circulars", how many, latest first, and how many to acknowledge; All /
  Notices / Circulars, From / To, words in the notice, Clear (`GET academics/notices?kind=&q=&studentId=&size=200`,
  dates kept on the phone as the website does); a card each with the date block, Pinned / kind / Acknowledge, the
  first lines, for whom, how many attachments and who published it; in full with the kind, the long date, the tags
  and for whom.
- **Calendar** (`family/calendar.dart`): the session read once (`GET academics/calendar`); **Calendar**: Previous /
  Today / Next, the next holiday, the month grid (a day coloured by holiday, vacation, exam, working day or event;
  Sunday in red; a tap lists the day), the key, the day's list and the month's; **Holiday list**: how many this
  session and how many days, upcoming and earlier with the days each; **Events**: upcoming and earlier.
- **School directory** (`family/directory.dart`, menu `/directory`, no web page): "Whom to contact at the school,
  and when."; under each heading the name, designation and note, the number (a tap calls), the e-mail (a tap
  writes) and the timings (`GET academics/directory`).

## As built — Library as on the website (20 Nov 2026)

**Library in the app, with no web page** (`family/library.dart`, menu `/library`): the child and class; six figures
(books out, overdue, read this session, read this month, returned on time, late fines) and a line of the average
days kept and fines due; ready to collect; books on loan (due day, fine so far, times renewed) and the dues; the
reservations (waiting with the place in line, ready with until when; Cancel, asked first; ended ones folded);
**Find a book** (`LibraryCatalogueScreen`: search by title, author, subject or ISBN, 20 a page, where it is or when
it is due back, Reserve when every copy is out); the history folded ("Read before · n books": taken from / to,
status, a search, Excel (download) and PDF (View / Download) of the filtered rows, pages); six months of borrowing as
small bars and the most read; the digital library (http/https links only). Calls: `library/portal/borrowers/student/
:id`, `…/history` (and `/export?format=xlsx|pdf`), `library/portal/catalogue` (sent with its query by the transport:
the generated call has none), `library/portal/reservations` and `/:id/cancel`, `library/mine/digital`.

## As built — School bus as on the website (20 Nov 2026)

**School bus in the app, with no web page** (`family/transport.dart`, menu `/transport`): six figures (route, bus,
monthly charge, valid until, trips this month, bus taps today); **Live bus** (route, stop and pick-up time, a
replacement bus with its driver to call, the bus number, last seen, speed, how far from the child's stop, Open in
maps; or no position yet / runs from / no bus mapped; left out when the school does not share it); the **transport
card** (service, slab, charge, valid until, pick and drop lines, the in-charge to call, the coming period, the
request waiting with Cancel, asked first; Apply for transport or Change or stop when the school takes family
requests); transport history and the requests folded; **today on the bus** (morning and afternoon, today's taps,
the week folded). **Apply** (`BusApplyForm`): change or withdrawal for a child who rides, service, route then
stoppage (type to search), drop at another stoppage, from / to month, the slab and monthly charge worked out as on
the website, a note. Calls: `attendance/bus/mine`, `transport/requests/mine` (+ `/options`, `/:id/cancel`, POST),
`transport/gps/mine`, and the month's bus roll. The server's English-only labels are rebuilt in the app so Hindi
works.

## As built — Hostel as on the website (20 Nov 2026)

**Hostel in the app** (`family/hostel.dart`, menu `/hostel`): the hostel and four figures (room / bed, where the
child is now, approved visitors, open complaints); the summary (since when, room-mates, back by — red when late —,
last roll-call, next home leave or outing, wardens with Call and WhatsApp, today's meals, quick actions); six parts:
**Leave and outings** (passes with status and lateness, earlier folded), **Visitors** (parents on record, added
visitors with photo; Add — name, relation, mobile, a photo under 300 KB sent as the website does —; Remove, asked
first), **Mess** (the week back and forward, diet and allergies, each day folded but today, specials; rate the meals
with five stars and a comment), **Complaints** (raise with a type-to-search head; open ones, closed folded with the
resolution), **From the hostel** (incidents and action taken), **Leaving the hostel** (requests and withdrawals,
Take back asked first, the clearance certificate View / Download, the ask form when nothing waits); a child who
does not board or has left sees that, with the certificate. **Gate passes** (ask for home leave or an outing, open a pass) open the app's own gate-pass screens (below).

## As built — Gate passes as on the website (20 Nov 2026)

**Gate passes in the app, with no web page** (`family/gate_pass.dart`, menu `/gate-passes`, and Hostel's Ask for home
leave / an outing and Open): **List** ("Early leave and late arrival", how many, latest first; All / Still to come /
Over or closed, a search by pass number, reason or who collects; ten a page) or a **Calendar** month; each pass with
its date and time, kind, state (Waiting for the school, Approved: collect at the front desk / from the hostel
warden, Handed over, Out, Back, Not approved, Cancelled), reason, number, who takes the child, the approver it
waits on and the gate times; Details and Cancel (asked first). **Request a gate pass** (`GatePassForm`): leaving
early, arriving late, and for a boarder home leave or an outing; the day and time; back in the hostel on (home
leave) and back by (an outing no later than the hostel's hour); the reason; who takes the child (a parent on record
or someone else with name, relation and a 10-digit mobile). **A pass in full** (`GatePassDetail`): the state, the
pass card PDF with its QR code (View / Download; the API's QR drawing is an SVG the app does not draw itself), how it
is used (the one-time code), the details, Cancel, and the approval steps. Calls: `gate-passes/mine` (list, POST),
`/options`, `/:id`, `/:id/card`, `/:id/cancel`.

**Library as tabs (21 Nov 2026).** Under the child, the help line and the six figures, the Library's parts are tabs as
the Calendar's: **Books on loan** (ready to collect, the books, the dues), **Reservations (n open)** (earlier ones
folded), **Find a book** (the catalogue itself, under the same figures and tabs), **History** (the filters, the rows,
Excel and PDF, the six months and the most read) and **Digital library**. "Read this session" opens History.

## As built — Queries as on the website (21 Nov 2026)

**Queries in the app, with no web page** (`family/queries.dart`, menu `/queries`, Home's Queries shortcut and the
icon on Messages): **the list** ("Queries, complaints and leave", how many, latest first; status — All, Not closed,
Open, In progress, Answered, Closed —, type — Query, Complaint, Leave request —, a search by number or subject, ten
a page), each with its subject, number, type, about, child, day, status, the leave decision and the stars given;
**New request** (`QueryForm`: query or complaint, about (type to search), subject, details, up to five PDFs or
photos of 5 MB; leave is applied for under Attendance); **Quick feedback** (area, five stars, a comment);
**a query in full** (`QueryDetail`: what was written with its files, the school's answers and yours, Reply with
files while it is open, the resolution, Reopen with a reason and files within the school's window, and the rating —
five stars and a comment — once answered). Calls: `engagement/mine/queries` (list, POST, `/:id`, `/:id/responses`,
`/:id/reopen`, `/:id/rate`, `/:id/timeline`, `/:id/files/:fileId`), `engagement/mine/categories`,
`engagement/feedback`. The API's appointment cancel body is now `AppointmentCancelDto` (it shared `CancelDto` with
other modules, which the app's generator refuses); the request is unchanged.

## As built — Appointments as on the website (21 Nov 2026)

**Appointments in the app, with no web page** (`family/appointments.dart`, menu `/appointments`): **the list**
("Meet the school", how many, latest first; List or a Calendar month; All / Still to come / Over or closed, a search
by number, purpose or whom; ten a page), each with its date and time, whom to meet, the status, the purpose, the
number, the child, the desk and the place; Details (and the gate pass) and Cancel, asked first. **Book**
(`AppointmentForm`, the website's steps): whom to meet with the visiting hours and place, a day with how many times
are free, a free time, the purpose and the school's instructions (`appointments/mine/hosts`, `/days`, `/slots`, POST
`{studentId, hostId, startsAt, purpose}`; a time just taken reloads the free times). **One appointment**
(`AppointmentDetail`): the status, once confirmed the gate pass card PDF (View / Download; the QR and barcode are SVG
drawings the app does not draw), the details, Cancel, and the history folded. Times are shown in India time whatever
the phone's zone, as on the website.
