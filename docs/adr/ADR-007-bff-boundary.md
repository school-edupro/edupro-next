# ADR-007: Next.js is a thin BFF; domain logic lives in the NestJS API

- Status: Accepted, 2026-09-26 (confirmed by the business: "NestJS separate")

## Context

Next.js can host server-side logic in route handlers and server actions. The ERP also needs long-running jobs, queues, device ingestion, a compatibility API for the existing native apps, and procedure orchestration that outlive an HTTP request.

## Decision

1. Each Next.js application (admin, parent, teacher, public) owns only: OIDC login and logout with One Auth, an encrypted session cookie, tenant and year context cookies, server-side rendering that calls the API with the user's token and context headers, file proxying for signed URLs, and static assets.
2. Route handlers and server actions never talk to PostgreSQL and never contain business rules. The only outbound dependency is the API base URL.
3. The NestJS API is the single system of record for domain behaviour, authorisation and audit. Mobile apps, workers, the public app and any partner integration use the same API.
4. The generated client in `packages/api-client` is the only way front ends call the API; hand-written fetches are rejected in review.
5. Server components fetch through the client with the token from the session; client components fetch through a same-origin `/api/proxy/*` route that injects the token, so the access token never reaches the browser.

## Consequences

- Clear ownership, independent deploys and scaling for UI and API; the API is testable without a browser.
- Two deployables to run; a proxy hop for client-side fetches (kept cheap with keep-alive).
- If the business later prefers one deployable, the NestJS application can be mounted behind a custom Next.js server without changing module code.
