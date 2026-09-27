# ADR-010: Reporting marts as tenant tables refreshed by jobs

Date: 2026-09-27 (Sprint 12). Status: accepted.

## Context

The AI layer (docs/design/07-ai-layer.md) needs dashboards, an approved query catalogue and later narrated
reports over department data. Computing them from the transactional tables on every request is slow at
school scale and leaks implementation detail into the assistant's tools. PostgreSQL materialised views cannot
carry row-level security policies, and a single cross-school materialised view would need application-side
filtering, which ADR-002 forbids for tenant data.

## Decision

1. Marts live in schema `mart` as ordinary tables with a `school_id` column and the same forced RLS policy as
   every tenant table (`app.apply_tenant_rls_in('mart', ...)`).
2. `app.refresh_marts()` rebuilds every mart for the current school inside the caller's tenant transaction
   (SECURITY INVOKER): delete the school's rows, re-insert from the base tables, log rows and duration in
   `mart.refresh_log`.
3. The workers run `insights.refresh` every 15 minutes for every active school, each under its own tenant
   context. The list of schools comes from `app.mart_schools()`, a SECURITY DEFINER function that returns
   school ids only; it joins the ADR-006/ADR-009 exception list.
4. The API reads marts only through modules that carry a permission (`insights.dashboard.view`); on-demand
   refresh needs `insights.mart.refresh`.
5. Every dashboard number is computed by SQL over the marts (or a live count that is explicitly labelled);
   nothing is estimated by a model. Narration (Sprint 16) cites the mart query that produced each figure.

## Consequences

- Dashboards are at most 15 minutes old; the page shows freshness per mart and an alert when a mart is stale,
  and any user with the refresh permission can rebuild on demand.
- Refresh cost grows with school size (attendance is bounded to 400 days); heavier history marts (exams,
  report cards) will move to incremental refresh in Sprint 17.
- The query catalogue (Sprint 14) targets the marts, so a catalogue entry never touches personal columns the
  mart does not expose.
