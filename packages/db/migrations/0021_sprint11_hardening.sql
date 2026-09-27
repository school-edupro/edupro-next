-- Sprint 11: hardening for M2.
-- Lesson plans with a three-level approval; timetable substitutions with conflict checks; per-student attendance
-- rules and per-route alert rules (RFID rules v2); alert throttling flag on templates; fee demand instalment
-- variant per student; DPDP privacy notices with acknowledgements; indexes for the hot read paths.

CREATE TYPE lesson_plan_status AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'returned');

-- ---------------------------------------------------------------------------
-- Lesson planner
-- ---------------------------------------------------------------------------
CREATE TABLE lesson_plans (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id     BIGINT NOT NULL REFERENCES academic_years(id),
  employee_id          BIGINT NOT NULL REFERENCES employees(id),
  class_section_id     BIGINT NOT NULL REFERENCES class_sections(id),
  subject_id           BIGINT NOT NULL REFERENCES subjects(id),
  week_start           DATE NOT NULL,                       -- Monday
  title                TEXT NOT NULL,
  objectives           TEXT,
  topics               JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ day: 1..6, topic, activities, resources, homework }]
  assessment           TEXT,
  status               lesson_plan_status NOT NULL DEFAULT 'draft',
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  submitted_at         TIMESTAMPTZ,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           BIGINT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           BIGINT,
  deleted_at           TIMESTAMPTZ,
  CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);
CREATE UNIQUE INDEX lesson_plans_unique ON lesson_plans (employee_id, class_section_id, subject_id, week_start) WHERE deleted_at IS NULL;
CREATE INDEX lesson_plans_status ON lesson_plans (school_id, status, week_start DESC);

-- ---------------------------------------------------------------------------
-- Timetable substitutions
-- ---------------------------------------------------------------------------
CREATE TABLE timetable_substitutions (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id       BIGINT NOT NULL REFERENCES academic_years(id),
  on_date                DATE NOT NULL,
  class_section_id       BIGINT NOT NULL REFERENCES class_sections(id),
  period_id              BIGINT NOT NULL REFERENCES timetable_periods(id),
  slot_id                BIGINT REFERENCES timetable_slots(id),
  absent_employee_id     BIGINT REFERENCES employees(id),
  substitute_employee_id BIGINT NOT NULL REFERENCES employees(id),
  subject_id             BIGINT REFERENCES subjects(id),
  reason                 TEXT,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             BIGINT,
  UNIQUE (on_date, class_section_id, period_id)
);
CREATE INDEX timetable_substitutions_day ON timetable_substitutions (school_id, on_date);
-- a substitute teaches one section per period per day
CREATE UNIQUE INDEX timetable_substitutions_substitute ON timetable_substitutions (on_date, period_id, substitute_employee_id);

-- ---------------------------------------------------------------------------
-- RFID rules v2: per-student overrides and per-route alert rules
-- ---------------------------------------------------------------------------
CREATE TABLE student_attendance_rules (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  student_id       BIGINT NOT NULL REFERENCES students(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  late_after       TIME,                                   -- NULL = school default
  alerts_muted     BOOLEAN NOT NULL DEFAULT false,         -- no absent or bus alerts for this student
  reason           TEXT,
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to         DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_year_id)
);

ALTER TABLE transport_routes ADD COLUMN alert_boarding BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE transport_routes ADD COLUMN alert_alighting BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE transport_routes ADD COLUMN late_after TIME;   -- boarding after this time is flagged late_boarding

-- Alert templates are throttled per recipient address (setting comms.alert_throttle_per_hour, default 6).
ALTER TABLE comms_templates ADD COLUMN is_alert BOOLEAN NOT NULL DEFAULT false;
UPDATE comms_templates SET is_alert = true WHERE code IN ('absent_alert', 'bus_boarded', 'bus_alighted', 'query_reply');

-- ---------------------------------------------------------------------------
-- Fee demand instalment variant: a student may pay in fewer or more instalments than the school's periods
-- ---------------------------------------------------------------------------
ALTER TABLE student_fee_profiles ADD COLUMN instalments_override INT CHECK (instalments_override IN (1, 2, 3, 4, 6, 12));

-- Returns the period that opens the instalment group a period belongs to when the year is split into n instalments.
CREATE OR REPLACE FUNCTION app.instalment_anchor(p_year_id BIGINT, p_sequence INT, p_instalments INT) RETURNS fee_periods
LANGUAGE sql STABLE AS $$
  SELECT fp.* FROM fee_periods fp
   WHERE fp.academic_year_id = p_year_id
     AND fp.sequence = ((p_sequence - 1) / (12 / p_instalments)) * (12 / p_instalments) + 1
$$;

-- Re-create the generator: after the normal run, an instalment override moves every unpaid row of the year to
-- the due date of its instalment anchor, so the family sees n due dates instead of twelve or four.
CREATE OR REPLACE FUNCTION app.apply_instalment_override(p_student_id BIGINT, p_academic_year_id BIGINT, p_run_id BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
  v_moved INT := 0;
  d RECORD;
  a fee_periods%ROWTYPE;
BEGIN
  SELECT instalments_override INTO v_n FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  IF v_n IS NULL THEN RETURN 0; END IF;
  FOR d IN
    SELECT fd.id, fp.sequence FROM fee_demands fd JOIN fee_periods fp ON fp.id = fd.period_id
     WHERE fd.student_id = p_student_id AND fd.academic_year_id = p_academic_year_id AND fd.run_id = p_run_id
  LOOP
    a := app.instalment_anchor(p_academic_year_id, d.sequence, v_n);
    IF a.id IS NOT NULL THEN
      UPDATE fee_demands SET due_on = a.due_on WHERE id = d.id AND due_on <> a.due_on;
      IF FOUND THEN v_moved := v_moved + 1; END IF;
    END IF;
  END LOOP;
  RETURN v_moved;
END
$$;

-- ---------------------------------------------------------------------------
-- DPDP privacy notices and acknowledgements
-- ---------------------------------------------------------------------------
CREATE TABLE privacy_notices (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  version      INT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  body_hi      TEXT,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  UNIQUE (school_id, version)
);

CREATE TABLE privacy_acknowledgements (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  user_id         BIGINT NOT NULL REFERENCES users(id),
  notice_version  INT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL DEFAULT 'parent_app',
  ip              INET,
  UNIQUE (user_id, notice_version)
);

-- ---------------------------------------------------------------------------
-- Performance: indexes for the hot read paths measured in Sprint 11
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS enrolments_by_year_section ON enrolments (academic_year_id, class_section_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS enrolments_by_student_year ON enrolments (student_id, academic_year_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS attendance_marks_by_session ON attendance_marks (session_id);
CREATE INDEX IF NOT EXISTS rfid_events_by_student_day ON rfid_events (student_id, occurred_at DESC) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comms_messages_by_address_time ON comms_messages (school_id, recipient_address, created_at DESC);
CREATE INDEX IF NOT EXISTS comms_messages_provider_ref ON comms_messages (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS student_guardians_by_guardian ON student_guardians (guardian_id);
CREATE INDEX IF NOT EXISTS guardians_by_user ON guardians (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS parent_queries_by_user ON parent_queries (raised_by_user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS bus_attendance_by_student_time ON bus_attendance (student_id, occurred_at DESC) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS punch_logs_by_employee_time ON punch_logs (employee_id, punched_at) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_steps_pending_assignees ON workflow_steps USING gin (assignee_user_ids) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Row-level security and permissions
-- ---------------------------------------------------------------------------
CALL app.apply_tenant_rls('lesson_plans');
CALL app.apply_tenant_rls('timetable_substitutions');
CALL app.apply_tenant_rls('student_attendance_rules');
CALL app.apply_tenant_rls('privacy_notices');
CALL app.apply_tenant_rls('privacy_acknowledgements');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('academics.lesson_plan.view',     'academics',  'View lesson plans', false),
  ('academics.lesson_plan.manage',   'academics',  'Write and submit my lesson plans', false),
  ('academics.substitution.view',    'academics',  'View timetable substitutions', false),
  ('academics.substitution.manage',  'academics',  'Arrange substitutions for absent teachers', false),
  ('attendance.rule.manage',         'attendance', 'Set per-student attendance rules (late time, muted alerts)', false),
  ('platform.privacy.manage',        'platform',   'Publish privacy notice versions', false),
  ('compat.teacher.write',           'compat',     'Write homework, attendance and notices through the compatibility API', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('academics.lesson_plan.view', 'academics.lesson_plan.manage', 'academics.substitution.view', 'academics.substitution.manage', 'attendance.rule.manage', 'platform.privacy.manage', 'compat.teacher.write')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('academics.lesson_plan.view', 'academics.lesson_plan.manage', 'academics.substitution.view', 'academics.substitution.manage', 'attendance.rule.manage', 'compat.teacher.write')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('academics.lesson_plan.view', 'academics.lesson_plan.manage', 'academics.substitution.view', 'compat.teacher.write')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('academics.lesson_plan.view', 'academics.substitution.view')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
  AND p.code IN ('academics.substitution.view')
ON CONFLICT DO NOTHING;
