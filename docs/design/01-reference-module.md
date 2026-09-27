# Reference module: `academics/classes`

Every business module copies this structure. It is deliberately small (classes and class sections) so the pattern, not the domain, is what the reader learns.

## 1. Folder layout

```
apps/api/src/modules/academics/classes/
  classes.module.ts          Nest module: imports DbModule, AccessModule, AuditModule
  classes.controller.ts      routes, permissions, DTO validation, OpenAPI
  classes.service.ts         business rules, tenant-scoped queries, audit snapshots
  classes.dto.ts             zod schemas and inferred types (request and response)
  classes.repository.ts      SQL through db.withTenant(); no business rules
  classes.controller.spec.ts unit tests with mocked service
  classes.e2e-spec.ts        allow and deny per permission, RLS behaviour, year filter
packages/db/migrations/0005_reference_module_classes.sql   tables, indexes, RLS, triggers
```

## 2. Checklist for a new module

1. Migration: tables with the standard columns, `school_id` second, indexes per the rules, `ENABLE` and `FORCE ROW LEVEL SECURITY`, tenant policy, `updated_at` trigger, audit trigger if money or marks.
2. Permissions: declare `module.resource.view|create|edit|delete` (and specific actions) on handlers with `@RequirePermission()`. Add descriptions in `permission-descriptions.ts`.
3. DTOs: zod schemas; ids as strings; dates as `YYYY-MM-DD`; money as strings.
4. Repository: every query through `db.withTenant(ctx, ...)`; year-scoped tables always filter `academic_year_id = ctx.academicYearId`.
5. Service: load `before` image on update and delete; call `audit.snapshot(before, after)`; apply `ScopePolicy` where the module has scopes.
6. Controller: `@ApiTags`, `@RequirePermission`, `ZodValidationPipe`, pagination helper, problem details thrown as `DomainError`.
7. Tests: allow and deny for every permission; cross-tenant negative; year filter; validation errors; audit row written.
8. Client: run `pnpm api:openapi && pnpm client:generate`; front end uses the generated client only.
9. UI: page under `apps/admin/app/(shell)/academics/classes`, built from `@edupro/ui`, strings in `messages/en.json` and `messages/hi.json`.
10. Storybook story and visual snapshot for any new component.

## 3. Endpoints delivered by the reference module

| Method and path                                | Permission                       | Notes                                                                            |
| ---------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/v1/academics/classes`                | `academics.class.view`           | paginated, filter by status                                                      |
| `POST /api/v1/academics/classes`               | `academics.class.create`         | unique `code` per school                                                         |
| `PATCH /api/v1/academics/classes/{id}`         | `academics.class.edit`           | partial update, audit before and after                                           |
| `DELETE /api/v1/academics/classes/{id}`        | `academics.class.delete`         | soft delete; rejected if sections exist in the active year                       |
| `GET /api/v1/academics/classes/{id}/sections`  | `academics.class_section.view`   | year-scoped by `X-Academic-Year-Id`; Class Teacher scope filters to own sections |
| `POST /api/v1/academics/classes/{id}/sections` | `academics.class_section.create` | rejected when the year is locked for `academics`                                 |

## 4. Patterns illustrated

- **Tenant context**: `ClassesRepository` never receives a `school_id` parameter; the context comes from `withTenant` and RLS filters the rows. A test proves that a forged `school_id` in the payload is rejected by the policy's `WITH CHECK`.
- **Year context**: `class_sections` is year-scoped; the repository adds `academic_year_id = ctx.academicYearId` explicitly (RLS handles tenant, not year, by design).
- **Year lock**: `createSection()` calls `app.assert_year_open(year_id, 'academics')` before inserting.
- **Scopes**: `listSections()` applies `ScopePolicy.filter('class_section')` so a Class Teacher sees only assigned sections while an Exam Coordinator sees all.
- **Audit**: `updateClass()` reads the current row, applies the change, and records both images; the interceptor writes the audit row after commit.
- **Errors**: duplicate `code` raises `DomainError('conflict', 'Class code already exists')` which becomes a 409 problem details response.
- **OpenAPI and client**: the zod DTOs drive both validation and the generated client types.

## 5. Anti-patterns the reviewer rejects

- A `school_id` column exposed in a request DTO.
- A query built outside `withTenant`.
- Business rules in the controller or in a Next.js route handler.
- Hard-coded strings in UI components.
- A permission string typed in two places (use the constants file per module).
