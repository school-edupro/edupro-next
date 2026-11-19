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
