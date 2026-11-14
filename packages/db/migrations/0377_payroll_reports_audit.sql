-- 0377: payroll reports and audit (docs/design/86, phase F; PAYROLL_REPORTS_SPEC.md). A record keeps the staff type,
-- pay cell and category as they were when it was paid (the reports never read today's values for a past month); saved
-- report presets (one's own, or shared by a checker); the school's own bonus rule for a year and its postings (schools
-- are outside the Code on Wages' bonus chapter, s.41(1)(e)); the audit right and a read-only Payroll auditor role.

-- ---- the record as paid ------------------------------------------------------------------------------------------
ALTER TABLE payroll_records
  ADD COLUMN staff_type TEXT,
  ADD COLUMN pay_cell   INT,
  ADD COLUMN category   TEXT;

CREATE OR REPLACE FUNCTION app.payroll_record_as_paid() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.staff_type IS NULL THEN
    SELECT employee_type::text INTO NEW.staff_type FROM employees WHERE id = NEW.employee_id;
  END IF;
  IF NEW.pay_cell IS NULL OR NEW.category IS NULL THEN
    SELECT COALESCE(NEW.pay_cell, p.pay_cell), COALESCE(NEW.category, p.category)
      INTO NEW.pay_cell, NEW.category
      FROM payroll_profiles p WHERE p.employee_id = NEW.employee_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_records_as_paid BEFORE INSERT ON payroll_records
  FOR EACH ROW EXECUTE FUNCTION app.payroll_record_as_paid();
-- the records already made: as they are now (the nearest there is)
UPDATE payroll_records r SET staff_type = e.employee_type::text
  FROM employees e WHERE e.id = r.employee_id AND r.staff_type IS NULL;
UPDATE payroll_records r SET pay_cell = p.pay_cell, category = p.category
  FROM payroll_profiles p WHERE p.employee_id = r.employee_id AND r.pay_cell IS NULL AND r.category IS NULL;

-- ---- report presets ------------------------------------------------------------------------------------------------
CREATE TABLE payroll_report_presets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  report_key  TEXT NOT NULL CHECK (report_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  columns     TEXT[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 200),
  -- the user it belongs to; NULL = shared with every payroll user (made by a checker)
  owner_id    BIGINT REFERENCES users(id),
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  BIGINT REFERENCES users(id)
);
CREATE UNIQUE INDEX payroll_report_presets_name ON payroll_report_presets
  (school_id, report_key, COALESCE(owner_id, 0), lower(name)) WHERE deleted_at IS NULL;
CALL app.apply_tenant_rls('payroll_report_presets');
CREATE TRIGGER payroll_report_presets_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_report_presets
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the bonus: the school's own rule for a year, and what was posted ---------------------------------------------------
CREATE TABLE payroll_bonus_rules (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  fy           TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  -- PERCENT of the year's basic + DA; FIXED a sum for each eligible employee (by the months worked when prorated);
  -- STATUTORY the Code on Wages' formula (a rate of the wage up to the cap, for staff whose wage is within the limit)
  kind         TEXT NOT NULL CHECK (kind IN ('PERCENT', 'FIXED', 'STATUTORY')),
  rate         NUMERIC(7, 4) CHECK (rate IS NULL OR rate BETWEEN 0 AND 1),
  amount       NUMERIC(14, 2) CHECK (amount IS NULL OR amount >= 0),
  prorate      BOOLEAN NOT NULL DEFAULT true,
  min_months   INT NOT NULL DEFAULT 0 CHECK (min_months BETWEEN 0 AND 12),
  min_days     NUMERIC(6, 1) NOT NULL DEFAULT 0 CHECK (min_days BETWEEN 0 AND 366),
  -- a month counts only while its basic + DA is within this (NULL: no limit); the wage counted at most the cap
  max_wage     NUMERIC(14, 2) CHECK (max_wage IS NULL OR max_wage > 0),
  wage_cap     NUMERIC(14, 2) CHECK (wage_cap IS NULL OR wage_cap > 0),
  note         TEXT CHECK (note IS NULL OR length(note) <= 300),
  updated_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, fy),
  CHECK (kind <> 'FIXED' OR amount IS NOT NULL),
  CHECK (kind = 'FIXED' OR rate IS NOT NULL)
);
CALL app.apply_tenant_rls('payroll_bonus_rules');
CREATE TRIGGER payroll_bonus_rules_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_bonus_rules
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE payroll_bonus_postings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  fy          TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  month       DATE NOT NULL CHECK (extract(day FROM month) = 1),
  rule        JSONB NOT NULL,
  posted      INT NOT NULL,
  total       NUMERIC(14, 2) NOT NULL,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('payroll_bonus_postings');
CREATE TRIGGER payroll_bonus_postings_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_bonus_postings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the audit trail and the auditor ----------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('payroll.audit.view', 'payroll',
   'See the payroll audit trail and build the auditor pack: every payroll change, reveal, download and report run', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'payroll_auditor', 'Payroll auditor', 'module', true,
   'Reads payroll for an audit: runs, registers, reports, the audit trail and the auditor pack; changes nothing')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('payroll.audit.view'), ('payroll.run.view'), ('payroll.setup.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'payroll_auditor'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payroll.audit.view' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('payroll_checker', 'school_admin', 'group_admin')
ON CONFLICT DO NOTHING;
