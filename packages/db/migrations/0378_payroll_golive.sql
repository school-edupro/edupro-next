-- 0378: payroll go-live (docs/design/86, phase G; PAYROLL_GOLIVE_SPEC.md). Moving from the old payroll module: its
-- database read through a server-held connection into a holding area; the people (profiles, structures, loans,
-- nominees, declarations, earlier employers, payees and recurring deductions) and the current and last financial year's
-- locked runs brought as read-only history, prepared by the payroll admin and committed by a second person; parity — the
-- old locked months replayed through EduPro's engine, every employee × head × month to the paisa, each difference open
-- until a person explains it; two parallel months (the old module pays, EduPro stops at Approved); the sign-off by the
-- payroll checker and the principal; the switch, with a rollback until EduPro's first live month is locked.

CREATE TABLE payroll_cutover (
  school_id        BIGINT PRIMARY KEY REFERENCES schools(id),
  -- SETUP → BROUGHT (people and history here) → PARALLEL → SIGNED → SWITCHED
  status           TEXT NOT NULL DEFAULT 'SETUP' CHECK (status IN ('SETUP', 'BROUGHT', 'PARALLEL', 'SIGNED', 'SWITCHED')),
  -- the history brought starts here (the last financial year's 1 April)
  history_from     DATE NOT NULL CHECK (extract(day FROM history_from) = 1),
  -- the two months both systems run (the old one pays)
  parallel_months  DATE[] NOT NULL DEFAULT '{}',
  -- the first month EduPro pays; the old module is read-only from it
  switch_month     DATE CHECK (switch_month IS NULL OR extract(day FROM switch_month) = 1),
  read_requested_at TIMESTAMPTZ,
  read_started_at  TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  read_id          BIGINT,
  read_counts      JSONB,
  read_error       TEXT,
  -- what the payroll admin prepared: the counts, the problems and a checksum of the rows read
  prepared         JSONB,
  prepared_by      BIGINT REFERENCES users(id),
  prepared_at      TIMESTAMPTZ,
  committed_by     BIGINT REFERENCES users(id),
  committed_at     TIMESTAMPTZ,
  signoff_id       BIGINT,
  switched_by      BIGINT REFERENCES users(id),
  switched_at      TIMESTAMPTZ,
  first_live_lock_at TIMESTAMPTZ,
  rollback_reason  TEXT CHECK (rollback_reason IS NULL OR length(rollback_reason) BETWEEN 10 AND 300),
  rolled_back_by   BIGINT REFERENCES users(id),
  rolled_back_at   TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('payroll_cutover');
CREATE TRIGGER payroll_cutover_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_cutover
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the old module's rows as read (encrypted PAN and bank copies are never read)
CREATE TABLE payroll_legacy_rows (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  tbl       TEXT NOT NULL CHECK (tbl ~ '^[a-z_]{3,40}$'),
  legacy_id TEXT NOT NULL CHECK (length(legacy_id) BETWEEN 1 AND 200),
  payload   JSONB NOT NULL,
  read_id   BIGINT NOT NULL,
  PRIMARY KEY (school_id, tbl, legacy_id)
);
CALL app.apply_tenant_rls('payroll_legacy_rows');

-- what each old row became here: brought again, it updates the same row
CREATE TABLE payroll_legacy_map (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  tbl       TEXT NOT NULL CHECK (tbl ~ '^[a-z_]{3,40}$'),
  legacy_id TEXT NOT NULL CHECK (length(legacy_id) BETWEEN 1 AND 200),
  entity    TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  PRIMARY KEY (school_id, tbl, legacy_id)
);
CALL app.apply_tenant_rls('payroll_legacy_map');

-- the old module's runs brought as history: read-only here (their payslips reprint, their year counts)
ALTER TABLE payroll_runs ADD COLUMN imported BOOLEAN NOT NULL DEFAULT false;

-- ---- parity --------------------------------------------------------------------------------------------------------
CREATE TABLE payroll_parity_batches (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  -- REPLAY: the old locked months worked out again here; PARALLEL: EduPro's approved runs against the old ones
  kind           TEXT NOT NULL CHECK (kind IN ('REPLAY', 'PARALLEL')),
  months         DATE[] NOT NULL,
  engine_version TEXT NOT NULL,
  counts         JSONB NOT NULL DEFAULT '{}',
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('payroll_parity_batches');

CREATE TABLE payroll_parity_results (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  batch_id    BIGINT NOT NULL REFERENCES payroll_parity_batches(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  month       DATE NOT NULL,
  -- a pay head's code, or GROSS, DEDUCTIONS, NET, TDS, ER_EPF, ER_EPS, EDLI, PF_ADMIN, ESI_ER, NPS_ER, LWF_ER, CALC
  component   TEXT NOT NULL CHECK (component ~ '^[A-Z][A-Z0-9_]{0,29}$'),
  legacy      NUMERIC(14, 2),
  ours        NUMERIC(14, 2),
  diff        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL CHECK (status IN ('MATCH', 'OPEN', 'EXPLAINED')),
  -- what the system found (a calculation refused, an input missing)
  note        TEXT,
  UNIQUE (batch_id, employee_id, month, component)
);
CREATE INDEX payroll_parity_results_open ON payroll_parity_results (batch_id, status);
CALL app.apply_tenant_rls('payroll_parity_results');

-- a person's explanation of a difference; it survives a re-run while the difference stays the same
CREATE TABLE payroll_parity_explanations (
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  kind           TEXT NOT NULL CHECK (kind IN ('REPLAY', 'PARALLEL')),
  employee_id    BIGINT NOT NULL REFERENCES employees(id),
  month          DATE NOT NULL,
  component      TEXT NOT NULL,
  code           TEXT NOT NULL CHECK (code IN ('ROUNDING', 'LEGACY_DEFECT', 'LABOUR_CODE', 'SETUP_GAP', 'MISSING_INPUT', 'OTHER')),
  diff           NUMERIC(14, 2) NOT NULL,
  note           TEXT NOT NULL CHECK (length(note) BETWEEN 10 AND 500),
  evidence_file_id BIGINT REFERENCES files(id),
  explained_by   BIGINT REFERENCES users(id),
  explained_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, kind, employee_id, month, component)
);
CALL app.apply_tenant_rls('payroll_parity_explanations');
CREATE TRIGGER payroll_parity_explanations_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_parity_explanations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the sign-off --------------------------------------------------------------------------------------------------
CREATE TABLE payroll_golive_signoffs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  batch_id         BIGINT NOT NULL REFERENCES payroll_parity_batches(id),
  months           DATE[] NOT NULL,
  scoreboard       JSONB NOT NULL,
  engine_version   TEXT NOT NULL,
  -- SHA-256 of the batch's results as signed
  checksum         TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  signed_by        BIGINT NOT NULL REFERENCES users(id),
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  countersigned_by BIGINT REFERENCES users(id),
  countersigned_at TIMESTAMPTZ,
  CHECK (countersigned_by IS NULL OR countersigned_by <> signed_by)
);
CALL app.apply_tenant_rls('payroll_golive_signoffs');
CREATE TRIGGER payroll_golive_signoffs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_golive_signoffs
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('payroll.golive.countersign', 'payroll',
   'Countersign the payroll go-live: the parallel months compared and every difference explained', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payroll.golive.countersign' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('principal', 'school_admin', 'group_admin')
ON CONFLICT DO NOTHING;
