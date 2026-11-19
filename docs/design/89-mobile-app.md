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
  long-leave days) goes to the web page, where the file is attached.
- **Homework** (`homework.dart`): what is due first, then the last two weeks by day; in full with its files and "I
  have seen this" when the teacher asks for it.
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
