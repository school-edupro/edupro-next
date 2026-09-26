# @edupro/etl

Legacy MySQL to PostgreSQL migration toolkit (design: `docs/data/03-etl-framework.md`).

- `src/transforms.ts`: pure transforms from the mapping catalogue, each returning `ok(value)` or `reject(reason, raw, blocking)`.
- `src/legacy-map.ts`: identity memory (`etl.legacy_map`) with in-memory and PostgreSQL implementations.
- `src/pipeline.ts`: `Source`, `Step`, `Loader` contracts and `runStep()` with run bookkeeping, reject capture and legacy-map updates.
- `src/sources/mysql.ts`: streaming extractor over a restored dump (`mysql2`); `src/sources/memory.ts`: fixture source.
- Domain scripts (tenancy, identity, people, fees, exams, ...) arrive with their modules from Sprint 4.

```bash
pnpm --filter @edupro/etl test
```

Rules: never default a bad value silently; money and marks load through procedures; every load runs inside a tenant transaction on the `edupro_etl` role; a cutover is blocked while any blocking reject exists.
