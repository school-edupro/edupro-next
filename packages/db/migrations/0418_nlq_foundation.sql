-- 0418: data questions in the chatbot (docs/design/103, phase A): the ground the nlq views stand on.
--  * edupro_nlq        — the role a generated query runs as (the app switches to it with SET LOCAL ROLE for that one
--                        query): it may read the nlq views and nothing else (grants in 0419).
--  * edupro_nlq_owner  — owns the nlq views and may read the base tables they use. Not the migrator, so the tenant
--                        policies (school_id = app.current_school_id()) still bind it.
--  * app.nlq_context   — the school a data question is answered for, written by the app (app.nlq_begin) in the
--                        question's own transaction, which is rolled back afterwards. The views keep their spine to
--                        app.nlq_school_id() as well as to row-level security, because app.school_id is a session
--                        setting any role could change from inside a query with set_config.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_nlq') THEN
    CREATE ROLE edupro_nlq NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_nlq_owner') THEN
    CREATE ROLE edupro_nlq_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

-- the app may switch to edupro_nlq for a query; the migrator may give views to edupro_nlq_owner
GRANT edupro_nlq TO edupro_app;
GRANT edupro_nlq_owner TO CURRENT_USER;

CREATE SCHEMA nlq;
REVOKE ALL ON SCHEMA nlq FROM PUBLIC;
GRANT USAGE ON SCHEMA nlq TO edupro_nlq, edupro_nlq_owner, edupro_app;
GRANT USAGE ON SCHEMA app, mart TO edupro_nlq_owner;
GRANT USAGE ON SCHEMA app TO edupro_nlq;

-- the school of the question being answered (one row per backend, only inside that question's transaction)
CREATE TABLE app.nlq_context (
  pid        INT PRIMARY KEY,
  started    TIMESTAMPTZ NOT NULL,
  school_id  BIGINT NOT NULL,
  user_id    BIGINT
);
ALTER TABLE app.nlq_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.nlq_context FORCE ROW LEVEL SECURITY;
CREATE POLICY nlq_context_migrator ON app.nlq_context FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- Called by the app, as itself, before it switches to edupro_nlq: the school must be the one its context is set to.
CREATE FUNCTION app.nlq_begin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_school BIGINT := app.current_school_id();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'nlq: no school in this transaction' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.nlq_context (pid, started, school_id, user_id)
  VALUES (pg_backend_pid(), now(), v_school, app.current_user_id())
  ON CONFLICT (pid) DO UPDATE SET started = EXCLUDED.started, school_id = EXCLUDED.school_id, user_id = EXCLUDED.user_id;
END
$$;

-- The school the nlq views answer for: set by app.nlq_begin in this very transaction, else none (the views are empty).
CREATE FUNCTION app.nlq_school_id()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT c.school_id FROM app.nlq_context c WHERE c.pid = pg_backend_pid() AND c.started = now()
$$;

REVOKE ALL ON FUNCTION app.nlq_begin() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.nlq_school_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.nlq_begin() TO edupro_app;
GRANT EXECUTE ON FUNCTION app.nlq_school_id() TO edupro_nlq_owner, edupro_nlq;
