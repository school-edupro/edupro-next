# ADR-001: Technology stack

- Status: Accepted, 2026-09-26
- Deciders: Mobilise leadership (business decision), solution architect

## Context

The legacy School ERP is PHP 5 to 8 with MySQL, server-rendered pages, jQuery, per-school code forks and about 640 tables without foreign keys. The business has decided to rebuild it and named the stack: React with Next.js on the front end, Node.js on the backend, PostgreSQL as the database with business logic pushed toward database procedures.

## Decision

| Layer | Choice |
|---|---|
| Front end | Next.js 15 (App Router), React 18, TypeScript. Three applications in one monorepo: admin, parent, teacher (PWA), plus a public application for admission forms. Route handlers act only as a thin BFF for the OIDC session and tenant context. |
| API | NestJS 11 on Node.js 22 with the Fastify adapter, one deployable modular monolith, a module per business domain, OpenAPI generated from decorators, zod for DTO validation. |
| Database | PostgreSQL 16. Normalised, tenant-keyed schema; row-level security; declarative partitioning for large tables; PL/pgSQL procedures and functions for money and marks; JSONB for document-shaped data. |
| Data access | Prisma (PostgreSQL provider) for typed CRUD; Kysely or raw SQL for reports; `pg` for procedure calls inside explicit transactions. Migrations are plain SQL files applied in order, so RLS, policies, partitions and procedures are first-class. |
| Jobs | BullMQ on Redis in a separate `workers` application. |
| Identity | One Auth (OIDC). The ERP holds roles and permissions; the IdP holds credentials and MFA. |
| Files | S3-compatible object storage with signed URLs. |
| Secrets | Azure Key Vault. |
| Observability | pino, OpenTelemetry, Prometheus metrics, Sentry. |
| Monorepo | Turborepo with pnpm workspaces. |

## Consequences

- Positive: typed end to end (database to UI) through Prisma types and a generated API client; server components for read-heavy screens; one design system package; database-enforced tenant isolation.
- Negative: two runtimes to operate (Next.js and NestJS); the team must learn PL/pgSQL and RLS; the MySQL to PostgreSQL ETL must map types and collations.
- Alternatives rejected: MongoDB (the domain is a ledger; integrity and reporting suffer), MySQL (no row-level security, weaker partitioning and procedural language), domain logic inside Next.js route handlers (no place for long-running jobs, queues and device ingestion; see ADR-007).
