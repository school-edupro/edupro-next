-- 0003_audit.sql
-- Append-only, monthly-partitioned audit log with a generic row-change trigger (ADR-005).

CREATE TABLE audit_logs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  school_id        BIGINT NOT NULL,
  actor_type       actor_type NOT NULL,
  actor_user_id    BIGINT,
  impersonated_by  BIGINT,
  action           TEXT NOT NULL,                 -- insert | update | delete | <domain action such as receipt.reverse>
  entity_type      TEXT NOT NULL,                 -- table or aggregate name
  entity_id        TEXT,
  before           JSONB,
  after            JSONB,
  diff             JSONB,
  permission_code  TEXT,
  request_id       UUID,
  ip               INET,
  user_agent       TEXT,
  source           audit_source NOT NULL DEFAULT 'api',
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX audit_logs_by_entity ON audit_logs (school_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_by_actor  ON audit_logs (school_id, actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_by_request ON audit_logs (request_id) WHERE request_id IS NOT NULL;

-- Safety net so an insert never fails for lack of a partition; the job in app.ensure_audit_partitions keeps
-- real monthly partitions ahead of time and the default should stay empty.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Partitions are reachable only through the parent. Privileges and RLS are checked on the parent for
-- queries through it; direct access to a partition would bypass both, so the application role gets nothing
-- on partitions themselves (the default privileges from 0002 would otherwise grant full access).
REVOKE ALL ON audit_logs_default FROM edupro_app, edupro_readonly;

-- ---------------------------------------------------------------------------
-- Partition management (run as the migrator by the monthly maintenance job)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE app.ensure_audit_partitions(p_months_ahead INT DEFAULT 2)
LANGUAGE plpgsql AS $$
DECLARE
  v_month DATE := date_trunc('month', now())::DATE;
  v_name  TEXT;
  i       INT;
BEGIN
  FOR i IN 0..p_months_ahead LOOP
    v_name := format('audit_logs_%s', to_char(v_month + (i || ' month')::INTERVAL, 'YYYYMM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        v_name,
        v_month + (i || ' month')::INTERVAL,
        v_month + ((i + 1) || ' month')::INTERVAL
      );
      EXECUTE format('REVOKE ALL ON %I FROM edupro_app, edupro_readonly', v_name);
    END IF;
  END LOOP;
END
$$;
REVOKE EXECUTE ON PROCEDURE app.ensure_audit_partitions(INT) FROM PUBLIC, edupro_app;

-- Detach partitions older than the retention window into the archive schema (never deleted here).
CREATE OR REPLACE PROCEDURE app.archive_audit_partitions(p_retention_months INT DEFAULT 84)
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_cutoff TEXT := to_char(date_trunc('month', now()) - (p_retention_months || ' month')::INTERVAL, 'YYYYMM');
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs' AND c.relname ~ '^audit_logs_[0-9]{6}$'
      AND substring(c.relname FROM 12) < v_cutoff
  LOOP
    EXECUTE format('ALTER TABLE audit_logs DETACH PARTITION %I', r.relname);
    EXECUTE format('ALTER TABLE %I SET SCHEMA archive', r.relname);
  END LOOP;
END
$$;

REVOKE EXECUTE ON PROCEDURE app.archive_audit_partitions(INT) FROM PUBLIC, edupro_app;

CALL app.ensure_audit_partitions(2);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.append_only'
    USING ERRCODE = 'P0003', DETAIL = 'audit_logs rows cannot be updated or deleted';
END
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security: tenant-scoped select and insert only
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO PUBLIC
  USING (school_id = ANY (app.allowed_school_ids()));
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO PUBLIC
  WITH CHECK (school_id = app.current_school_id());
CREATE POLICY audit_logs_migrator ON audit_logs FOR SELECT TO edupro_migrator USING (true);

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM edupro_app;
GRANT SELECT, INSERT ON audit_logs TO edupro_app;

-- ---------------------------------------------------------------------------
-- Generic row-change trigger for money and marks tables.
-- Usage: CREATE TRIGGER x AFTER INSERT OR UPDATE OR DELETE ON receipts
--          FOR EACH ROW EXECUTE FUNCTION app.audit_row_change('bank_account_no,aadhaar_no');
-- The optional argument lists columns to mask in the stored images.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.mask_json(p_doc JSONB, p_columns TEXT[]) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_col TEXT;
  v_doc JSONB := p_doc;
BEGIN
  IF v_doc IS NULL OR p_columns IS NULL THEN
    RETURN v_doc;
  END IF;
  FOREACH v_col IN ARRAY p_columns LOOP
    IF v_doc ? v_col THEN
      v_doc := jsonb_set(v_doc, ARRAY[v_col], '"***"'::JSONB, false);
    END IF;
  END LOOP;
  RETURN v_doc;
END
$$;

CREATE OR REPLACE FUNCTION app.audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old     JSONB;
  v_new     JSONB;
  v_mask    TEXT[] := CASE WHEN TG_NARGS > 0 THEN string_to_array(TG_ARGV[0], ',') ELSE NULL END;
  v_school  BIGINT;
  v_entity  TEXT;
  v_actor   actor_type;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  v_school := COALESCE((v_new ->> 'school_id')::BIGINT, (v_old ->> 'school_id')::BIGINT, app.current_school_id());
  v_entity := COALESCE(v_new ->> 'id', v_old ->> 'id');
  v_actor  := CASE
                WHEN app.current_user_id() IS NULL THEN 'system_job'::actor_type
                WHEN NULLIF(current_setting('app.impersonated_by', true), '') IS NOT NULL THEN 'impersonated_user'::actor_type
                ELSE 'user'::actor_type
              END;

  INSERT INTO audit_logs (
    school_id, actor_type, actor_user_id, impersonated_by, action, entity_type, entity_id,
    before, after, request_id, source
  ) VALUES (
    v_school,
    v_actor,
    app.current_user_id(),
    NULLIF(current_setting('app.impersonated_by', true), '')::BIGINT,
    lower(TG_OP),
    TG_TABLE_NAME,
    v_entity,
    app.mask_json(v_old, v_mask),
    app.mask_json(v_new, v_mask),
    app.current_request_id(),
    'trigger'
  );

  RETURN COALESCE(NEW, OLD);
END
$$;
