-- 0097: (1) the absence message as module templates, like the other modules' "Message templates";
-- (2) the lesson planner as the school knows it: a teacher uploads a lesson (date, classes, topic,
-- description, attachments), it goes through the approvers set for that teacher, class or department,
-- level by level, and ends acknowledged or rejected.

CREATE OR REPLACE FUNCTION app.attendance_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category, is_alert)
  SELECT p_school, 'absent_alert', ch.channel::comms_channel, 'Attendance: student marked absent', NULL,
         '{{student_name}} of {{section}} was marked absent on {{date}}. Please contact the class teacher if this is unexpected.',
         '["student_name","section","date"]'::jsonb, 'service', true
    FROM (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

CREATE TABLE lesson_uploads (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  on_date          DATE NOT NULL,
  -- what the classes were picked by: whole classes, or sections
  target_type      TEXT NOT NULL CHECK (target_type IN ('class', 'section')),
  topic            TEXT NOT NULL,
  description      TEXT,
  file_ids         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'rejected')),
  -- the level it waits at (1..levels) while pending
  current_level    INT NOT NULL DEFAULT 1,
  levels           INT NOT NULL DEFAULT 1,
  -- which rule gave the approvers: employee, class, department or default
  rule_scope       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  decided_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  deleted_by       BIGINT
);
CREATE INDEX lesson_uploads_school_idx ON lesson_uploads (school_id, academic_year_id, created_at DESC);
CREATE INDEX lesson_uploads_employee_idx ON lesson_uploads (employee_id, on_date);
CALL app.apply_tenant_rls('lesson_uploads');

CREATE TABLE lesson_upload_targets (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  lesson_id        BIGINT NOT NULL REFERENCES lesson_uploads(id) ON DELETE CASCADE,
  class_id         BIGINT REFERENCES classes(id),
  class_section_id BIGINT REFERENCES class_sections(id),
  CHECK ((class_id IS NULL) <> (class_section_id IS NULL))
);
CREATE INDEX lesson_upload_targets_lesson_idx ON lesson_upload_targets (lesson_id);
CALL app.apply_tenant_rls('lesson_upload_targets');

-- who approves whose lessons: a rule for an employee, a class, a department, or the school default
CREATE TABLE lesson_approver_rules (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  scope       TEXT NOT NULL CHECK (scope IN ('employee', 'class', 'department', 'default')),
  employee_id BIGINT REFERENCES employees(id),
  class_id    BIGINT REFERENCES classes(id),
  department  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT
);
CREATE UNIQUE INDEX lesson_approver_rules_key ON lesson_approver_rules
  (school_id, scope, COALESCE(employee_id, 0), COALESCE(class_id, 0), COALESCE(lower(department), ''));
CALL app.apply_tenant_rls('lesson_approver_rules');

CREATE TABLE lesson_approver_levels (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  rule_id              BIGINT NOT NULL REFERENCES lesson_approver_rules(id) ON DELETE CASCADE,
  level                INT NOT NULL CHECK (level BETWEEN 1 AND 3),
  kind                 TEXT NOT NULL CHECK (kind IN ('employee', 'role')),
  approver_employee_id BIGINT REFERENCES employees(id),
  role_code            TEXT,
  UNIQUE (rule_id, level),
  CHECK ((kind = 'employee' AND approver_employee_id IS NOT NULL) OR (kind = 'role' AND role_code IS NOT NULL))
);
CALL app.apply_tenant_rls('lesson_approver_levels');

-- the levels of one lesson, copied from the rule when it was uploaded
CREATE TABLE lesson_upload_approvals (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  lesson_id            BIGINT NOT NULL REFERENCES lesson_uploads(id) ON DELETE CASCADE,
  level                INT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('employee', 'role')),
  approver_employee_id BIGINT REFERENCES employees(id),
  role_code            TEXT,
  state                TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'acknowledged', 'rejected')),
  acted_by             BIGINT,
  acted_at             TIMESTAMPTZ,
  remark               TEXT,
  UNIQUE (lesson_id, level)
);
CALL app.apply_tenant_rls('lesson_upload_approvals');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('academics.lesson_plan.setup', 'academics', 'Set who approves lessons (by employee, class or department) and see every lesson', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'academics.lesson_plan.setup' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
