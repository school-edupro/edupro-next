# ADR-009: Background jobs through a transactional outbox; notifications and exports as jobs

|          |                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------- |
| Status   | Accepted (Sprint 3, 2026-09-27)                                                                     |
| Deciders | Architecture                                                                                        |
| Related  | ADR-002 (row-level security), ADR-005 (audit), ADR-006 (procedures and SECURITY DEFINER exceptions) |

## Context

The legacy system sends SMS and generates reports inside the web request (`cron_*` tables and ad-hoc PHP), so a
provider outage or a slow report blocks the user and loses work on a crash. The new platform needs background
work that is reliable (a job exists if and only if the business change committed), tenant-safe (jobs run under
the same row-level security as requests) and observable (failed work is visible and retryable by the school).

## Decision

1. **Producers write to `jobs_outbox` inside their own transaction** through `app.enqueue_job(queue, payload)`
   (`OutboxService.enqueue` in the API). The payload is a `JobEnvelope { schoolId, userId, requestId, kind, payload }`.
   Nothing publishes to Redis from a request.
2. **The workers process publishes the outbox to BullMQ.** `app.claim_outbox_batch` leases pending rows
   (`FOR UPDATE SKIP LOCKED`, `locked_until`), the publisher adds each to its queue with the deterministic id
   `outbox-<id>` (a crash between add and complete cannot enqueue twice), then `app.complete_outbox` marks them
   published. `app.fail_outbox` backs off and, after the attempt limit, parks the row as `failed`: the school's
   dead-letter list, readable at `GET /platform/jobs/outbox?status=failed` and retryable with
   `POST /platform/jobs/outbox/:id/retry`.
3. **The three outbox routines and `app.expire_exports` are SECURITY DEFINER.** They are cross-tenant by nature,
   touch only `jobs_outbox`, `exports` and `files`, expose no payload filters, and are executable by
   `edupro_app` only. They join `app.invite_user` as the recorded exceptions to ADR-006.
4. **Workers run every job under the envelope's tenant context** (`tenantForJob`), so RLS applies. Maintenance
   jobs carry a system envelope and use the definer routines.
5. **Notifications (WP11):** `comms_templates` (code, channel, body, declared variables, DLT template and
   entity ids, sender id) and `comms_messages` (the delivery log). The API renders the template, writes the
   message and its job in one transaction; the worker delivers through one `ChannelAdapter` interface
   (console for development and tests, SMTP, generic HTTP gateway for SMS, WhatsApp and push) and records
   provider id, attempts and errors. Logs carry message ids and masked addresses, never bodies.
6. **Exports (S3-03):** `exports` rows plus a job; the worker runs a dataset query from the shared registry
   (`packages/db/src/datasets.ts`) under the requester's context and scope filter, renders xlsx (exceljs), csv,
   or pdf (Chromium through Playwright), stores the file through `@edupro/storage` and registers it in `files`.
   The API issues signed download URLs; a maintenance job expires files after `EXPORTS_TTL_DAYS`.
7. **Audit rows are written inside the service transaction** (`AuditService.stage`), which is stronger than
   routing them through the outbox: the row commits with the change or not at all. The post-commit interceptor
   remains a safety net for services that have not been converted.

## Consequences

- One more process (workers) in every environment; it shares the storage configuration with the API.
- Redis holds queue state only; the outbox row is the source of truth for "was this work requested".
- Provider adapters are swapped by configuration; the console adapters are refused in production.
- The dead-letter list is per school and never exposes payloads (they may contain personal data).
