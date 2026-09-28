# ADR-011: Payment gateway adapters behind one notification path

Status: accepted (Sprint 13, 2026-09-28)

## Context

Schools in the group use different gateways (PayU, Razorpay, CCAvenue), and a school may switch. The legacy
`PaymentGateway/` code chose the gateway per site from a database and left signature verification to each
implementation (the Razorpay one had a `TODO: verify signature`). Sprint 9 wired PayU with mandatory,
constant-time response verification and an idempotent webhook; Sprint 13 adds two providers.

## Decision

- Each provider is a small pure module (`adapters/razorpay.ts`, `adapters/ccavenue.ts`, `payu.ts`) that builds
  requests and verifies responses with node's crypto and no SDK; network calls (Razorpay orders and refunds)
  go through an injectable `fetch` so tests run offline.
- Every return and webhook is reduced to one `Notification` shape and decided by one method
  (`applyNotification`): cross-tenant lookup by our transaction id or the provider's order id (two
  SECURITY DEFINER functions returning ids only, ADR-009), signature, amount, idempotency, success handler.
- The gateway is a **school setting** (`payments.gateway`) with a deployment default (`PAYMENT_PROVIDER`);
  credentials are environment variables per deployment, not per school, until the group needs per-school
  merchant accounts (then they move to a credentials table encrypted with Key Vault keys).
- The development gateway (`mock`) keeps the PayU field set so every app's existing flow works unchanged;
  it is refused in production together with development secrets.

## Consequences

- Adding a provider means one adapter module, one or two public routes on the allow-list of
  `permission-coverage.spec.ts`, and a mapping into `Notification`; nothing in receipts, refunds or
  settlements changes.
- A forged notification never blocks a genuine one: rejected notifications do not consume the idempotency
  key (the Sprint 13 e2e found the earlier behaviour).
- CCAvenue has no server callback by default, so its outcome depends on the browser return; the settlement
  file closes the loop the next day.
- Razorpay webhooks need the raw request body; the API keeps it beside the parsed JSON for every JSON
  request (a few hundred bytes per request, no other effect).
