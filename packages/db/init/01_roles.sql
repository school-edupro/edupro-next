-- Application roles. Runs once at cluster creation (docker-entrypoint-initdb.d) and in CI before migrations.
-- Passwords below are for local development only. Every other environment sets passwords out of band
-- (Key Vault) and this file is not used.
--
-- edupro_migrator : owns all objects, runs migrations and seeds. Created by the container as POSTGRES_USER.
-- edupro_app      : the API and workers. No ownership, no BYPASSRLS, so row-level security applies.
-- edupro_readonly : reporting and BI. Read-only on the reporting schema (created in a later sprint).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_app') THEN
    CREATE ROLE edupro_app LOGIN PASSWORD 'edupro_app_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edupro_readonly') THEN
    CREATE ROLE edupro_readonly LOGIN PASSWORD 'edupro_readonly_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE edupro TO edupro_app, edupro_readonly;
