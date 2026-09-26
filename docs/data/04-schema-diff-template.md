# Per-school schema diff report (template)

Blocked until the production schema dumps arrive (Sprint 0 task S0-08). Run `scripts/schema-diff.sh <dump-a.sql> <dump-b.sql>` (Sprint 2) to produce one report per school pair against the reference school.

## Header

| | |
|---|---|
| Reference school | |
| Compared school | |
| Dump dates | |
| Tables in reference | |
| Tables in compared | |
| Tables only in reference | |
| Tables only in compared | |

## Column differences (tables present in both)

| Table | Column | Reference type | Compared type | Nullability | Default | Impact on ETL |
|---|---|---|---|---|---|---|

## Tables only in one school

| Table | School | Rows | Used by legacy code (yes/no, file) | Decision (migrate, archive, drop) |
|---|---|---|---|---|

## Known drift to expect (from the blueprint)

- `FinancialYear`, `isTrash`, `Status` columns added by scripts at different times; some schools lack them on some tables (506 legacy files probe for them at runtime).
- `Status` stored as `TINYINT` in some schools and `VARCHAR('Active')` in others.
- `EANDE_*` per-campus exam copies may reference extra tables (`reportcard_*` variants).
- Character sets differ (`utf8` vs `utf8mb4`) and collations vary per table.
- Typo tables (`library_langugage_master`, `inventroy_master`) exist in some schools only.

## Sign-off

| Role | Name | Date |
|---|---|---|
| Data engineer | | |
| Architect | | |
