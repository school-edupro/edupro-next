-- Detail corrections (docs/design/37-admission-corrections.md, part 1).
-- A student's name parts, date of birth, gender and parents' names change only by a request the school's
-- approval levels decide (workflow `student_correction`); the old and new values are kept here. The
-- office still edits every other field directly (audited as before).
-- An application corrected by the office before Admit keeps each changed answer, old and new.

CREATE TABLE student_corrections (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  student_id            BIGINT NOT NULL REFERENCES students(id),
  -- { field_key: { from, to } } as the request saw the record
  changes               JSONB NOT NULL,
  reason                TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'withdrawn')),
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  requested_by          BIGINT REFERENCES users(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by            BIGINT REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT,
  -- why an approved change could not be written (the record changed meanwhile, a value no longer valid)
  apply_error           TEXT
);
-- one open request per student: a second waits for the first to be decided
CREATE UNIQUE INDEX student_corrections_one_open ON student_corrections (student_id) WHERE status = 'pending';
CREATE INDEX student_corrections_by_student ON student_corrections (student_id, requested_at DESC);
CALL app.apply_tenant_rls('student_corrections');
CREATE TRIGGER student_corrections_audit AFTER INSERT OR UPDATE OR DELETE ON student_corrections FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE application_answer_changes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  field_key       TEXT NOT NULL,
  label           TEXT NOT NULL,
  -- shown as text; a sensitive answer (Aadhaar and the like) is kept masked
  old_value       TEXT,
  new_value       TEXT,
  reason          TEXT NOT NULL,
  changed_by      BIGINT REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX application_answer_changes_by_app ON application_answer_changes (application_id, changed_at DESC);
CALL app.apply_tenant_rls('application_answer_changes');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.student.correct', 'people', 'Ask for a correction of a student''s name, date of birth, gender or parents'' names (decided by the approval levels)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'people.student.correct' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'front_office', 'clerk')
ON CONFLICT DO NOTHING;
