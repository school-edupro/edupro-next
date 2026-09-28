-- Master-data framework: every master (fee heads, periods, classes, routes, exam types ...) is served
-- through one registry (packages/db/src/masters.ts) with paging, filters, Excel/PDF/CSV export,
-- Excel/CSV bulk upload (validate then commit), bulk field update and, where it makes sense, a clone
-- from one year to the next. This migration adds the upload log; the masters themselves keep their
-- tables, permissions and school_id row-level security.

CREATE TABLE master_imports (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  master         TEXT NOT NULL,                       -- registry id, e.g. fee_heads
  file_name      TEXT,
  status         import_status NOT NULL,              -- validated | committed | failed
  total_rows     INT NOT NULL DEFAULT 0,
  ok_rows        INT NOT NULL DEFAULT 0,
  rejected_rows  INT NOT NULL DEFAULT 0,
  report         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ row, column, message }]
  payload        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- validated rows, replayed by commit
  inserted_rows  INT NOT NULL DEFAULT 0,
  updated_rows   INT NOT NULL DEFAULT 0,
  requested_by   BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at   TIMESTAMPTZ,
  request_id     UUID
);
CREATE INDEX master_imports_school_master_idx ON master_imports (school_id, master, created_at DESC);
CALL app.apply_tenant_rls('master_imports');

-- Banks: the cheque / DD bank picker (legacy "Bank Master"). Account numbers are deliberately not stored.
CREATE TABLE banks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  branch        TEXT,
  ifsc          TEXT,
  account_label TEXT,
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('banks');

-- Natural keys the upload upserts on (the other masters already had them).
CREATE UNIQUE INDEX IF NOT EXISTS holidays_natural_key ON holidays (school_id, academic_year_id, name, starts_on);
CREATE UNIQUE INDEX IF NOT EXISTS transport_drivers_natural_key ON transport_drivers (school_id, name, COALESCE(mobile, '')) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS grade_bands_natural_key ON grade_bands (scale_id, grade);
