# ADR-008: Separate repository and folder from the legacy system

- Status: Accepted, 2026-09-26 (requested by the business: "ensure this project works in a separate folder")

## Context

The legacy PHP tree is a production FTP mirror containing about 20,000 files, dated backups, vendored libraries, secrets and at least two suspected backdoor files. Building the new product inside it would risk accidental deployment of new code to the PHP server, accidental inclusion of legacy files or secrets in the new repository, and confusion between the two systems.

## Decision

1. EduPro Next lives in its own folder, `edupro-next`, outside the FTP mirror, with its own git repository initialised on branch `main`.
2. Nothing in this repository imports, copies or links to files in the legacy tree. Legacy knowledge is carried over as documentation (the blueprint, project plan and sprint plan remain in the legacy tree; their decisions are restated here as ADRs) and as ETL source configuration that points at database dumps, never at legacy code.
3. The Mobilise Design System tokens were copied once into `packages/ui/src/tokens` from the supplied design-system package, not from the legacy tree.
4. `.gitignore` excludes dumps, `.env` files and generated artefacts; a secret scanner runs in CI.
5. The legacy system continues to receive only security fixes, tracked in its own change process.

## Consequences

- Clean history, clean dependency graph, no risk of deploying the new code through the old FTP path.
- Two places to look during the transition; the README of each points to the other.
