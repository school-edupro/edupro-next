-- 0095: the employee's daily activity log. Every employee writes what they did in the day as time
-- slots (from, to, category, what was done); the day starts with what the system already knows (the
-- timetable periods and substitutions). Submitting is enough; the head reviews by exception and may
-- send a log back. The school sets the categories, the cut-off time and how many days back a log may
-- be filled.

CREATE TABLE activity_categories (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('activity_categories');

CREATE TABLE activity_settings (
  school_id   BIGINT PRIMARY KEY REFERENCES schools(id),
  -- a log submitted after this time of its day is marked late
  cutoff_time TIME NOT NULL DEFAULT '18:00',
  -- a day may be filled this many days later
  back_days   INT NOT NULL DEFAULT 2 CHECK (back_days BETWEEN 0 AND 30),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CALL app.apply_tenant_rls('activity_settings');

CREATE TABLE activity_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  on_date       DATE NOT NULL,
  state         TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'reviewed', 'returned')),
  tomorrow_plan TEXT,
  pending_note  TEXT,
  submitted_at  TIMESTAMPTZ,
  late          BOOLEAN NOT NULL DEFAULT false,
  reviewed_by   BIGINT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, on_date)
);
CREATE INDEX activity_logs_day_idx ON activity_logs (school_id, on_date);
CALL app.apply_tenant_rls('activity_logs');

CREATE TABLE activity_entries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  log_id      BIGINT NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
  from_time   TIME NOT NULL,
  to_time     TIME NOT NULL,
  category_id BIGINT NOT NULL REFERENCES activity_categories(id),
  description TEXT NOT NULL,
  -- where the row came from: typed, or offered from the timetable or a substitution
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'timetable', 'substitution')),
  CHECK (to_time > from_time)
);
CREATE INDEX activity_entries_log_idx ON activity_entries (log_id);
CALL app.apply_tenant_rls('activity_entries');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('staff.activity.fill', 'staff', 'Write my daily activity log', false),
  ('staff.activity.review', 'staff', 'See and review the daily activity logs of employees', false),
  ('staff.activity.setup', 'staff', 'Set the activity categories and the rules of the daily log', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'staff.activity.fill' FROM roles r
 WHERE r.school_id IS NULL AND r.code NOT IN ('parent', 'student', 'auditor', 'support_engineer', 'erp_support')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('staff.activity.review'), ('staff.activity.setup')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'staff.activity.review' FROM roles r WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
ON CONFLICT DO NOTHING;
