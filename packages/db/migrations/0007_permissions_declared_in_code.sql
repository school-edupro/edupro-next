-- 0007_permissions_declared_in_code.sql
-- The startup sync marks permissions as orphaned when they exist in the database but not in code. Seeded
-- permissions for modules that have no handlers yet (Sprint 0) must not be flagged. Track which codes have
-- ever been declared by code; only those can become orphaned when they disappear from code.

ALTER TABLE permissions ADD COLUMN declared_in_code BOOLEAN NOT NULL DEFAULT false;

-- Repair any rows flagged by the pre-0007 sync logic.
UPDATE permissions SET orphaned = false WHERE orphaned = true AND declared_in_code = false;
