# @edupro/api-client

Typed HTTP client for the EduPro Next API, generated from OpenAPI.

```bash
pnpm api:openapi        # apps/api writes openapi.json (needs DATABASE_URL to boot the module graph)
pnpm client:generate    # writes src/generated/schema.d.ts (git-ignored)
```

`src/generated/` is not committed; CI regenerates it and fails if the committed front ends no longer type-check against the current API. Until the first generation, `src/generated/schema.d.ts` does not exist and this package does not build; that is expected on a fresh clone before `pnpm client:generate`.
