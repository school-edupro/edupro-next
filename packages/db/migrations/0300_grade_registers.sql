-- Grade registers like the school's legacy Grade Register (docs/design/69, part 2): the indicator grades
-- of some classes for some exams, as a class sheet or student-wise. Like mark registers (0296) a register
-- keeps every saved version in one chain (chain_id = its first version's id): a draft changes in place,
-- a locked one is pinned (saving it makes the next version), the bin, versions and the people given
-- rights belong to the chain. The same rights as mark registers: exams.registers.manage sees and changes
-- every register, exams.registers.assign gives people rights; anyone else only the registers given to
-- them here. Access type: 'all' (every indicator of the register) or 'mapping' (a teacher sees only the
-- areas of their Indicator assignment; part 3).

CREATE TABLE grade_registers (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  chain_id          BIGINT NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  previous_id       BIGINT REFERENCES grade_registers(id),
  name              TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 150),
  class_ids         BIGINT[] NOT NULL CHECK (cardinality(class_ids) BETWEEN 1 AND 30),
  def               JSONB NOT NULL,
  access_type       TEXT NOT NULL DEFAULT 'all' CHECK (access_type IN ('all', 'mapping')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'superseded')),
  created_by        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by         BIGINT,
  locked_at         TIMESTAMPTZ,
  deleted_by        BIGINT,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX grade_registers_by_year ON grade_registers (academic_year_id, status) WHERE deleted_at IS NULL;
CREATE INDEX grade_registers_chain ON grade_registers (chain_id);

-- a new version joins its previous version's chain; a new register starts its own
CREATE OR REPLACE FUNCTION app.grade_registers_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.chain_id IS NULL THEN
    NEW.chain_id := COALESCE((SELECT chain_id FROM grade_registers WHERE id = NEW.previous_id), NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grade_registers_chain BEFORE INSERT ON grade_registers
  FOR EACH ROW EXECUTE FUNCTION app.grade_registers_chain();
CREATE TRIGGER grade_registers_audit AFTER INSERT OR UPDATE OR DELETE ON grade_registers
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('grade_registers');

CREATE TABLE grade_register_access (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  chain_id    BIGINT NOT NULL,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  can_run     BOOLEAN NOT NULL DEFAULT true,
  can_edit    BOOLEAN NOT NULL DEFAULT false,
  can_delete  BOOLEAN NOT NULL DEFAULT false,
  can_assign  BOOLEAN NOT NULL DEFAULT false,
  granted_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (can_run OR can_edit OR can_delete OR can_assign),
  UNIQUE (chain_id, user_id)
);
CREATE INDEX grade_register_access_user ON grade_register_access (user_id);
CREATE TRIGGER grade_register_access_audit AFTER INSERT OR UPDATE OR DELETE ON grade_register_access
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('grade_register_access');

-- one Roles screen governs both, as in the legacy
UPDATE permissions SET description = 'Build, change, lock and delete every mark and grade register, and give people rights on them'
 WHERE code = 'exams.registers.manage';
UPDATE permissions SET description = 'Give people Run / Edit / Delete rights on any mark or grade register'
 WHERE code = 'exams.registers.assign';
