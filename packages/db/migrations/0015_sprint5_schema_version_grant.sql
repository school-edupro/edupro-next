-- 0015_sprint5_schema_version_grant.sql
-- Sprint 5: the application role reads the applied migration list for the start-up schema check (S5-05).
GRANT USAGE ON SCHEMA app TO edupro_app;
GRANT SELECT ON app.schema_migrations TO edupro_app;
