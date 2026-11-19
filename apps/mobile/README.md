# EduPro mobile app

One Flutter app for students, parents and staff (docs/design/89, ADR-015). Android and iOS; a web build is used only
for screen checks on a computer.

## Run

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000   # Android emulator → the local API
```

Build settings (`--dart-define`): `API_BASE_URL` (default `http://localhost:4000`), `PUSH=true` once the EduPro
Firebase project's files are in `android/app/google-services.json` and `ios/Runner/GoogleService-Info.plist`,
`SENTRY_DSN` for crash reports (no personal data is sent), `APP_VERSION`.

## Generated sources (never edit by hand)

```bash
pnpm --filter @edupro/api build && pnpm --filter @edupro/api openapi:export:dist
pnpm mobile:gen          # writes lib/api/endpoints.g.dart, lib/theme/tokens.g.dart, lib/l10n/menu_hindi.g.dart
```

- `lib/api/endpoints.g.dart`: a typed method for each API operation listed in `api-operations.txt`, from the API's
  OpenAPI description. Add an operation id to the list to use a new endpoint. CI fails when a listed operation is
  renamed, removed or changes its inputs.
- `lib/theme/tokens.g.dart`: the design system's tokens (`packages/ui/src/tokens`).
- `lib/l10n/menu_hindi.g.dart`: Hindi for the menus' words (`@edupro/menus` and the web apps' dictionaries).

## Check

```bash
flutter analyze && flutter test
```

## How it works

- Sign-in: the one-time code (`POST /auth/otp/start` with `app: 'mobile'`, then `POST /auth/mobile/verify`) gives a
  refresh token kept in the Keychain / Keystore and a one-hour access token; an app PIN (or fingerprint / face)
  opens the app afterwards. `lib/api/dio_transport.dart` renews the access token (one renewal at a time) and goes
  back to sign-in when the API signs the phone out.
- Profiles (`GET /me/profiles`): staff of a school, parent of each child, student; the switcher sends the profile's
  `X-School-Id` and, for a teacher who is also a parent, `X-Acting-As: family`.
- More (`GET /me/menu`): the web apps' own menus by the person's rights; a screen without a native one opens its web
  page inside the app with a one-time link (`POST /auth/mobile/web-handoff`).
- Family screens (`lib/family/`, phase B): a parent's child or a student — Home, attendance and leave, homework,
  timetable, calendar, date sheet, results and report cards, fees (paid online through the web fee page in the web
  view), messages and notices. They call the parent web app's own endpoints; each keeps its last copy on the phone
  (`family/data.dart`, wiped at sign-out) and shows it when there is no network.
- Staff screens (`lib/staff/`, phase C): My day, mark a class, my attendance and corrections, my leave, homework,
  marks, timetable, payslips, and the Approvals inbox (`GET /approvals/inbox`) in the bar.
- Writes that must not be lost go through the outbox (`lib/api/outbox.dart`): kept on the phone with no network and
  sent later with an `Idempotency-Key` (the API answers a repeat with the first answer). Other online writes that may be
  retried pass a key with `withCall(CallOptions(idempotencyKey: …), …)`.
- An API operation used by the app must have an id and a request class name of its own in the OpenAPI description;
  the generator stops when one is shared (rename the controller or DTO class).
