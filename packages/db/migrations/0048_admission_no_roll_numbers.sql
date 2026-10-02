-- Admission number: changed only by school administrators, with a reason; every change is kept.
-- Roll numbers: class teachers renumber their own section; coordinators and admins any section.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.admission_no.change', 'people', 'Change a student''s admission number (a reason is kept with the old and new number)', false),
  ('people.roll_no.manage',      'people', 'Renumber roll numbers of a section (class teachers: their own section)', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin') AND p.code = 'people.admission_no.change'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator', 'class_teacher')
   AND p.code = 'people.roll_no.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE admission_no_changes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  student_id  BIGINT NOT NULL REFERENCES students(id),
  old_no      TEXT NOT NULL,
  new_no      TEXT NOT NULL,
  reason      TEXT NOT NULL,
  changed_by  BIGINT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('admission_no_changes');
CREATE INDEX admission_no_changes_by_old ON admission_no_changes (school_id, lower(old_no));
