# Contributing

## Branching

Trunk-based. Short-lived branches named `feat/<epic>-<short>`, `fix/<short>`, `chore/<short>`. Squash-merge into `main` after review. `main` deploys to staging automatically.

## Definition of done (every story)

- [ ] Reviewed by a second engineer
- [ ] Unit tests written and passing; procedure fixtures added for any PL/pgSQL change
- [ ] OpenAPI updated (automatic from decorators) and `packages/api-client` regenerated
- [ ] Every new handler declares `@RequirePermission()` or `@Public()`; allow and deny tests added to the authorisation matrix
- [ ] New tenant tables have `school_id`, RLS enabled and forced, policy defined, and a row in `packages/db/test/rls.test.ts`
- [ ] Audit events emitted for create, update, delete and privileged actions
- [ ] UI built from `@edupro/ui` only; token lint passes; strings externalised for i18n
- [ ] Accessibility checks passing (axe in Storybook and Playwright)
- [ ] SAST, SCA and secret scan clean
- [ ] Documentation and help text updated
- [ ] Demoed on staging and accepted by the product owner

## Commit messages

Conventional commits: `feat(fees): post receipt through sp_post_receipt`. Reference the epic (WP number) and the legacy file or rule replaced where relevant, for traceability to the blueprint.

## Never

- Add a per-school `if`. Use `school_settings`, templates or workflow definitions.
- Query a tenant table without the tenant context. Use `db.withTenant()`.
- Write money or marks outside a procedure.
- Commit a secret, a dump, or a file from the legacy tree.
