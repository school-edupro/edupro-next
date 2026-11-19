# ADR-015: One Flutter mobile app for students, parents and staff

- Status: Accepted, 2026-11-19 (the business's choice; design in `docs/design/89-mobile-app.md`)

## Context

Students and parents use `apps/parent`, staff use `apps/teacher` — both Next.js PWAs — and the older native apps
use the compat API. Schools want one store app that every user signs in to once and that works by who they are,
with the whole web feature set and, for staff, the approvals the admin app shows.

## Decision

1. One app, **Flutter** (Dart), for Android and iOS, in `apps/mobile` of this repository; one "EduPro" listing in
   each store for every school.
2. Daily-use screens are native; every other feature opens the existing web page inside the app through a
   one-time sign-in hand-off, and moves native over time.
3. The app calls the same NestJS API as the web apps (ADR-007): a **Dart client generated from the API's OpenAPI**
   is the only way it calls the API. The API adds mobile sessions (rotating refresh tokens bound to the device),
   profiles, menus, an approvals inbox, the web hand-off and push for the app's devices.
4. Texts (en / hi) and the theme are generated from the web apps' message files and `packages/ui` tokens.
5. Push for the app goes through one EduPro Firebase project; schools' own projects keep serving web push.

## Consequences

- No code is shared with the TypeScript front ends; generation keeps the client, texts and theme in step, and CI
  fails when the generated client is stale.
- Dart is a second front-end language to maintain.
- The compat API stays until the old native apps' users have moved.
- Alternatives considered: React Native + Expo (shares TypeScript; recommended in the plan but not chosen),
  wrapping the web apps (store rejection risk, weak offline), separate Kotlin and Swift apps (twice the cost).
