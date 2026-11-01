-- Mark registers like the school's Term Mark Register (docs/design/68). A register keeps every saved
-- version in one chain (chain_id = its first version's id): the bin, the versions list and the people
-- given rights belong to the chain. Managers (exams.registers.manage: school admin, group admin, exam
-- office, as the legacy's Admin and Exam Incharge) see and change every register; anyone else sees
-- only the registers given to them here, with Run / Edit / Delete / Assign per register.

ALTER TABLE mark_schemes
  ADD COLUMN chain_id   BIGINT,
  ADD COLUMN updated_by BIGINT,
  ADD COLUMN deleted_by BIGINT;

WITH RECURSIVE ch AS (
  SELECT id, id AS root FROM mark_schemes WHERE previous_id IS NULL
  UNION ALL
  SELECT m.id, ch.root FROM mark_schemes m JOIN ch ON m.previous_id = ch.id
)
UPDATE mark_schemes m SET chain_id = ch.root FROM ch WHERE ch.id = m.id;
UPDATE mark_schemes SET chain_id = id WHERE chain_id IS NULL;
ALTER TABLE mark_schemes ALTER COLUMN chain_id SET NOT NULL;
CREATE INDEX mark_schemes_chain ON mark_schemes (chain_id);

-- a new version joins its previous version's chain; a new register starts its own
CREATE OR REPLACE FUNCTION app.mark_schemes_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.chain_id IS NULL THEN
    NEW.chain_id := COALESCE((SELECT chain_id FROM mark_schemes WHERE id = NEW.previous_id), NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mark_schemes_chain BEFORE INSERT ON mark_schemes
  FOR EACH ROW EXECUTE FUNCTION app.mark_schemes_chain();

CREATE TABLE mark_scheme_access (
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
CREATE INDEX mark_scheme_access_user ON mark_scheme_access (user_id);
CREATE TRIGGER mark_scheme_access_audit AFTER INSERT OR UPDATE OR DELETE ON mark_scheme_access
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('mark_scheme_access');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.registers.manage', 'exams', 'Build, change, lock and delete every mark register, and give people rights on them', false),
  ('exams.registers.assign', 'exams', 'Give people Run / Edit / Delete rights on any mark register', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('exams.registers.manage'), ('exams.registers.assign')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'exam_office')
ON CONFLICT DO NOTHING;
