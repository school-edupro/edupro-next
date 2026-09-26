-- 0002_rls.sql
-- Tenant context functions, row-level security policies and grants (ADR-002).
--
-- Context is transaction-local: the API runs
--   SELECT set_config('app.school_id', '<id>', true), set_config('app.user_id', '<id>', true),
--          set_config('app.allowed_school_ids', '{<id>,<id>}', true), set_config('app.request_id', '<uuid>', true);
-- as the first statement of every transaction. set_config(..., true) behaves like SET LOCAL.

-- ---------------------------------------------------------------------------
-- Roles used by policies (created by init/01_roles.sql with LOGIN; ensured here without LOGIN so
-- migrations are self-sufficient on a fresh cluster)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_app') THEN
    CREATE ROLE edupro_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_readonly') THEN
    CREATE ROLE edupro_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Context functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_school_id() RETURNS BIGINT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.school_id', true), '')::BIGINT
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS BIGINT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::BIGINT
$$;

CREATE OR REPLACE FUNCTION app.allowed_school_ids() RETURNS BIGINT[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.allowed_school_ids', true), '')::BIGINT[], '{}'::BIGINT[])
$$;

CREATE OR REPLACE FUNCTION app.current_request_id() RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.request_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app.current_academic_year_id() RETURNS BIGINT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.academic_year_id', true), '')::BIGINT
$$;

CREATE OR REPLACE FUNCTION app.is_context_set() RETURNS BOOLEAN
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT app.current_school_id() IS NOT NULL
$$;

-- Raise a uniform error when a write is attempted without context.
CREATE OR REPLACE FUNCTION app.assert_context() RETURNS VOID
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF app.current_school_id() IS NULL THEN
    RAISE EXCEPTION 'tenant.context_missing'
      USING ERRCODE = 'P0001', DETAIL = 'app.school_id is not set on this transaction';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Policy helper: apply the standard tenant policy plus a migrator maintenance policy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE app.apply_tenant_rls(p_table TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || '_tenant_isolation', p_table);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO PUBLIC
       USING (school_id = app.current_school_id())
       WITH CHECK (school_id = app.current_school_id())',
    p_table || '_tenant_isolation', p_table
  );
  -- Migrations and seeds run as the owner and need unrestricted access. The API never connects as the owner
  -- (apps/api refuses to start when current_user is edupro_migrator or has BYPASSRLS).
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || '_migrator', p_table);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO edupro_migrator USING (true) WITH CHECK (true)',
    p_table || '_migrator', p_table
  );
END
$$;

-- Standard tenant tables from 0001
CALL app.apply_tenant_rls('campuses');
CALL app.apply_tenant_rls('academic_years');
CALL app.apply_tenant_rls('financial_years');
CALL app.apply_tenant_rls('school_settings');
CALL app.apply_tenant_rls('user_school_memberships');
-- A user may read their own memberships across schools (needed to build allowed_school_ids at login).
-- Db.withAuthLookup() resolves the user, then sets app.user_id inside the same transaction.
CREATE POLICY user_school_memberships_self ON user_school_memberships FOR SELECT TO PUBLIC
  USING (user_id = app.current_user_id());
CALL app.apply_tenant_rls('user_roles');
CALL app.apply_tenant_rls('user_role_scopes');
CALL app.apply_tenant_rls('delegations');
CALL app.apply_tenant_rls('receipt_sequences');
CALL app.apply_tenant_rls('files');
CALL app.apply_tenant_rls('jobs_outbox');

-- ---------------------------------------------------------------------------
-- Membership-filtered global tables
-- ---------------------------------------------------------------------------
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
CREATE POLICY schools_membership ON schools FOR SELECT TO PUBLIC
  USING (id = ANY (app.allowed_school_ids()));
CREATE POLICY schools_update_current ON schools FOR UPDATE TO PUBLIC
  USING (id = app.current_school_id()) WITH CHECK (id = app.current_school_id());
CREATE POLICY schools_migrator ON schools FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

ALTER TABLE school_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY school_groups_membership ON school_groups FOR SELECT TO PUBLIC
  USING (EXISTS (SELECT 1 FROM schools s WHERE s.group_id = school_groups.id AND s.id = ANY (app.allowed_school_ids())));
CREATE POLICY school_groups_migrator ON school_groups FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- users: visible when the caller shares an allowed school with them, or it is the caller
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_shared_membership ON users FOR SELECT TO PUBLIC
  USING (
    id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM user_school_memberships m
      WHERE m.user_id = users.id AND m.school_id = ANY (app.allowed_school_ids()) AND m.deleted_at IS NULL
    )
  );
-- Authentication-time lookup: before any school is selected the API resolves the caller by One Auth subject.
-- Db.withAuthLookup() sets app.auth_sub for that single transaction.
CREATE POLICY users_auth_lookup ON users FOR SELECT TO PUBLIC
  USING (oneauth_sub = NULLIF(current_setting('app.auth_sub', true), ''));
-- Provisioning inserts a user row (invitation flow, Sprint 5). The API is the control here; RLS cannot know
-- who may be invited. Updates are limited to the caller's own row or users of the current school.
CREATE POLICY users_insert ON users FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE POLICY users_update ON users FOR UPDATE TO PUBLIC
  USING (
    id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM user_school_memberships m WHERE m.user_id = users.id AND m.school_id = app.current_school_id())
  );
CREATE POLICY users_migrator ON users FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events FORCE ROW LEVEL SECURITY;
CREATE POLICY login_events_select ON login_events FOR SELECT TO PUBLIC
  USING (school_id = ANY (app.allowed_school_ids()) OR user_id = app.current_user_id());
CREATE POLICY login_events_insert ON login_events FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE POLICY login_events_migrator ON login_events FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Template plus tenant tables: roles, role_permissions, sod_rules
-- ---------------------------------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_visible ON roles FOR SELECT TO PUBLIC
  USING (school_id IS NULL OR school_id = app.current_school_id());
CREATE POLICY roles_write_own ON roles FOR INSERT TO PUBLIC WITH CHECK (school_id = app.current_school_id());
CREATE POLICY roles_update_own ON roles FOR UPDATE TO PUBLIC
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());
CREATE POLICY roles_delete_own ON roles FOR DELETE TO PUBLIC USING (school_id = app.current_school_id() AND is_system = false);
CREATE POLICY roles_migrator ON roles FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_visible ON role_permissions FOR SELECT TO PUBLIC
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND (r.school_id IS NULL OR r.school_id = app.current_school_id())));
CREATE POLICY role_permissions_write_own ON role_permissions FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.school_id = app.current_school_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.school_id = app.current_school_id()));
CREATE POLICY role_permissions_migrator ON role_permissions FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

ALTER TABLE sod_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sod_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY sod_rules_visible ON sod_rules FOR SELECT TO PUBLIC
  USING (school_id IS NULL OR school_id = app.current_school_id());
CREATE POLICY sod_rules_write_own ON sod_rules FOR ALL TO PUBLIC
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());
CREATE POLICY sod_rules_migrator ON sod_rules FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- permissions is a global catalogue: readable by all, maintained by the API's startup sync (insert/update only)
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY permissions_read ON permissions FOR SELECT TO PUBLIC USING (true);
CREATE POLICY permissions_sync ON permissions FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE POLICY permissions_sync_update ON permissions FOR UPDATE TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY permissions_migrator ON permissions FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, app TO edupro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edupro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edupro_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO edupro_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA app TO edupro_app;
REVOKE DELETE ON permissions FROM edupro_app;
-- Routines are executable by PUBLIC by default; maintenance procedures are for the migrator only.
REVOKE EXECUTE ON PROCEDURE app.apply_tenant_rls(TEXT) FROM PUBLIC, edupro_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edupro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO edupro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO edupro_app;
