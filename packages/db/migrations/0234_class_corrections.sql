-- Wrong class (docs/design/37-admission-corrections.md, part 2).
-- "Correct class" moves the year's enrolment to another class-section from a date (the admission date
-- by default) once the school's approval levels approve (workflow `class_correction`). Attendance and
-- marks stay on the student. The fee lines from that date are made again at the new class's rates;
-- money already paid on them is set against the new dues and what is left stays as advance on the
-- receipt (given back on request through a refund).

CREATE TABLE class_corrections (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  student_id            BIGINT NOT NULL REFERENCES students(id),
  academic_year_id      BIGINT NOT NULL REFERENCES academic_years(id),
  from_section_id       BIGINT NOT NULL REFERENCES class_sections(id),
  to_section_id         BIGINT NOT NULL REFERENCES class_sections(id),
  effective_from        DATE NOT NULL,
  reason                TEXT NOT NULL,
  -- what the change would do, as seen when asked (fee lines, totals, advance)
  preview               JSONB NOT NULL,
  -- what it did when applied
  result                JSONB,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'withdrawn')),
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  requested_by          BIGINT REFERENCES users(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by            BIGINT REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT,
  apply_error           TEXT
);
CREATE UNIQUE INDEX class_corrections_one_open ON class_corrections (student_id) WHERE status = 'pending';
CREATE INDEX class_corrections_by_student ON class_corrections (student_id, requested_at DESC);
CALL app.apply_tenant_rls('class_corrections');
CREATE TRIGGER class_corrections_audit AFTER INSERT OR UPDATE OR DELETE ON class_corrections FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.class.correct', 'people', 'Ask to correct a student''s class (enrolment moved, fees made again at the new class; decided by the approval levels)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'people.class.correct' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
