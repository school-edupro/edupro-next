-- 0008_etl_schema.sql
-- ETL bookkeeping (docs/data/03-etl-framework.md section 3). Written by the ETL role outside the tenant
-- context; tenant data itself is loaded through the normal tables with RLS in force.

CREATE SCHEMA IF NOT EXISTS etl;

CREATE TYPE etl.run_status AS ENUM ('running', 'succeeded', 'failed', 'aborted');
CREATE TYPE etl.reconcile_status AS ENUM ('match', 'explained', 'unexplained');

CREATE TABLE etl.runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES public.schools(id),
  domain        TEXT NOT NULL,                       -- tenancy, identity, people, academics, fees, exams, ...
  source_label  TEXT NOT NULL,                       -- dump file name
  source_sha256 TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        etl.run_status NOT NULL DEFAULT 'running',
  counts        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"extracted": n, "loaded": n, "rejected": n}
  notes         TEXT
);
CREATE INDEX etl_runs_by_school ON etl.runs (school_id, domain, started_at DESC);

CREATE TABLE etl.legacy_map (
  school_id     BIGINT NOT NULL REFERENCES public.schools(id),
  legacy_table  TEXT NOT NULL,
  legacy_key    TEXT NOT NULL,                       -- natural or surrogate key as text, e.g. 'srno=123' or 'sadmission=R24560'
  legacy_year   TEXT NOT NULL DEFAULT '',            -- legacy FinancialYear when the row was per year, else ''
  target_table  TEXT NOT NULL,
  target_id     BIGINT NOT NULL,
  run_id        BIGINT REFERENCES etl.runs(id),
  loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, legacy_table, legacy_key, legacy_year)
);
CREATE INDEX etl_legacy_map_by_target ON etl.legacy_map (target_table, target_id);

CREATE TABLE etl.rejects (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        BIGINT NOT NULL REFERENCES etl.runs(id),
  school_id     BIGINT NOT NULL,
  legacy_table  TEXT NOT NULL,
  legacy_key    TEXT,
  column_name   TEXT,
  reason        TEXT NOT NULL,
  raw_value     TEXT,
  blocking      BOOLEAN NOT NULL DEFAULT false,      -- identity, money or marks rejects block cutover
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX etl_rejects_by_run ON etl.rejects (run_id, blocking);

CREATE TABLE etl.reconciliations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        BIGINT NOT NULL REFERENCES etl.runs(id),
  school_id     BIGINT NOT NULL,
  measure       TEXT NOT NULL,                       -- 'students.count.2025-26', 'fees.collected.FY2025-26'
  legacy_value  NUMERIC(18,2),
  target_value  NUMERIC(18,2),
  delta         NUMERIC(18,2) GENERATED ALWAYS AS (COALESCE(target_value, 0) - COALESCE(legacy_value, 0)) STORED,
  status        etl.reconcile_status NOT NULL DEFAULT 'unexplained',
  explanation   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX etl_reconciliations_by_run ON etl.reconciliations (run_id, status);

-- ETL role: application-style (RLS applies) with access to the bookkeeping schema. Password set out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_etl') THEN
    CREATE ROLE edupro_etl NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public, app, etl TO edupro_etl;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edupro_etl;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edupro_etl;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO edupro_etl;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA etl TO edupro_etl;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA etl TO edupro_etl;
REVOKE UPDATE, DELETE ON public.audit_logs FROM edupro_etl;
GRANT SELECT, INSERT ON public.audit_logs TO edupro_etl;
-- Migrations and the ETL run under the migrator policy or the tenant policies; nothing else reads etl.*.
