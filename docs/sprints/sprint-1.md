# Sprint 1: Baseline understood

|                |                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- |
| Window         | Weeks 3 to 4 of the programme (plan `SCHOOL_ERP_SPRINT_PLAN.md`, S1)                        |
| Goal           | Every workstream has its baseline artefact so Sprints 2 to 5 can build without re-discovery |
| Started        | 2026-09-26                                                                                  |
| Exit (M0 gate) | decisions signed off, schema diff delivered, pilot school kickoff complete                  |

## Scope and status

| Track      | Deliverable                                                                                                                                                | Status        | Where                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| Platform   | Threat model for platform and identity (STRIDE)                                                                                                            | Done          | `docs/design/03-threat-model-platform-identity.md`                                                          |
| Platform   | Logging and PII standard, implemented in the API logger and audit masking                                                                                  | Done          | `docs/standards/logging-and-pii.md`, `apps/api/src/config/logging.ts`, `packages/db/src/audit-masks.ts`     |
| Platform   | Environment plan (local, test, staging, uat, production)                                                                                                   | Done          | `docs/design/04-environment-plan.md`                                                                        |
| Experience | Design-system batch v0: Checkbox, Radio, Switch, Tabs, Dialog, Toast, Drawer, Breadcrumbs, Alert, KpiTile; Storybook with accessibility addon; build in CI | Done          | `packages/ui/src/components`, `packages/ui/.storybook`                                                      |
| Data       | MySQL to PostgreSQL type and convention mapping catalogue                                                                                                  | Done          | `docs/data/01-type-mapping-mysql-to-postgres.md`                                                            |
| Data       | Data inventory and DPDP classification                                                                                                                     | Done          | `docs/data/02-data-inventory-dpdp.md`                                                                       |
| Data       | ETL framework design and `packages/etl` skeleton with tested transforms                                                                                    | Done          | `docs/data/03-etl-framework.md`, `packages/etl`                                                             |
| Data       | Per-school schema diff report                                                                                                                              | Blocked       | Needs the production schema dumps (S0-08); the report template is in `docs/data/04-schema-diff-template.md` |
| Quality    | Test strategy                                                                                                                                              | Done          | `docs/quality/test-strategy.md`                                                                             |
| Product    | Playbook drafts: fees; exams and grading; people and admissions, each with open questions for school staff                                                 | Done (drafts) | `docs/playbooks/`                                                                                           |
| Product    | Backlog refined for Sprints 2 to 5 (epics, stories, acceptance criteria) plus CSV for the tracker                                                          | Done          | `docs/backlog/sprints-2-to-5.md`, `docs/backlog/sprints-2-to-5.csv`                                         |
| Programme  | Pilot school kickoff; decisions signed off; One Auth capability check                                                                                      | Pending       | Needs the business (S0-10, S0-13)                                                                           |

## Carried over from Sprint 0

S0-06 legacy hotfixes, S0-07 secret rotation, S0-08 bootstrap files and schema dumps, S0-09 Key Vault, S0-10 pilot school, S0-11 fee workshop, S0-12 Figma library, S0-13 One Auth capabilities, S0-14 tracker import (the CSV in `docs/backlog` is ready for it).

## Pulled forward already

The walking skeleton planned for Sprint 2 (tenancy, RLS, RBAC, audit, reference module, admin shell, CI) exists and passes its tests since Sprint 0. Sprint 2 therefore starts on role administration, scopes, delegation, MFA step-up, files and the notification and export services.
