-- Library, part 3 (docs/design/36-library.md): the custom report of the book list. A named layout of a
-- report's columns (in their order), its extra sheets and options (the library: one row per copy or per
-- title) kept for the school; any report may use it by its name (`report`). The candidates' layouts
-- (0205) stay where they are. Each user's last choice of a report is a user preference.
CREATE TABLE report_layouts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  report           TEXT NOT NULL CHECK (report ~ '^[a-z0-9_.]{2,60}$'),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  columns          TEXT[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 400),
  sheets           TEXT[] NOT NULL DEFAULT '{}',
  options          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       BIGINT REFERENCES users(id),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX report_layouts_name ON report_layouts (school_id, report, lower(name));
CALL app.apply_tenant_rls('report_layouts');
