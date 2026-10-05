-- 0083: attendance, completed.
--   * a "Leave" code: an approved leave shows as leave, not as absent;
--   * the marking windows the school sets (class, bus morning, bus afternoon): a teacher marks inside the
--     window; after it the coordinator or admin marks, or reopens the day for the teacher;
--   * bus attendance marked by the teacher mapped to a route, morning (pick) and afternoon (drop).

ALTER TYPE attendance_code ADD VALUE IF NOT EXISTS 'LV';

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('attendance.bus.mark', 'attendance', 'Mark bus attendance of a route (morning and afternoon)', false),
  ('attendance.setup.manage', 'attendance', 'Attendance set-up: marking windows, route teachers, reopening a day', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.bus.mark' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator', 'class_teacher', 'subject_teacher', 'transport_incharge')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.setup.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.bus.view' FROM roles r WHERE r.school_id IS NULL AND r.code = 'transport_incharge'
ON CONFLICT DO NOTHING;

CREATE TABLE attendance_settings (
  school_id      BIGINT PRIMARY KEY REFERENCES schools(id),
  -- a teacher marks today's attendance between these times (school time); NULL = any time of the day
  class_from     TIME,
  class_to       TIME,
  bus_pick_from  TIME,
  bus_pick_to    TIME,
  bus_drop_from  TIME,
  bus_drop_to    TIME,
  -- a teacher may still mark this many days back without a reopening (0 = today only)
  back_days      INT NOT NULL DEFAULT 0 CHECK (back_days BETWEEN 0 AND 7),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT
);
CALL app.apply_tenant_rls('attendance_settings');

-- a day opened again for the teacher of a class or a route, until a time
CREATE TABLE attendance_reopens (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  scope             TEXT NOT NULL CHECK (scope IN ('class', 'bus')),
  class_section_id  BIGINT REFERENCES class_sections(id),
  route_id          BIGINT REFERENCES transport_routes(id),
  trip              TEXT CHECK (trip IN ('pick', 'drop')),
  on_date           DATE NOT NULL,
  open_until        TIMESTAMPTZ NOT NULL,
  reason            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  CHECK ((scope = 'class' AND class_section_id IS NOT NULL) OR (scope = 'bus' AND route_id IS NOT NULL AND trip IS NOT NULL))
);
CREATE INDEX attendance_reopens_find ON attendance_reopens (school_id, on_date, scope);
CALL app.apply_tenant_rls('attendance_reopens');

ALTER TABLE attendance_sessions ADD COLUMN marked_late BOOLEAN NOT NULL DEFAULT false;

-- ---- bus attendance by the route's teacher ----------------------------------------------------------
CREATE TABLE transport_route_teachers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  route_id     BIGINT NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  trip         TEXT NOT NULL CHECK (trip IN ('pick', 'drop')),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  UNIQUE (route_id, trip, employee_id)
);
CALL app.apply_tenant_rls('transport_route_teachers');

CREATE TABLE bus_roll_sessions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  route_id          BIGINT NOT NULL REFERENCES transport_routes(id),
  on_date           DATE NOT NULL,
  trip              TEXT NOT NULL CHECK (trip IN ('pick', 'drop')),
  marked_by         BIGINT,
  marked_at         TIMESTAMPTZ,
  marked_late       BOOLEAN NOT NULL DEFAULT false,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, on_date, trip)
);
CREATE INDEX bus_roll_sessions_by_date ON bus_roll_sessions (school_id, on_date);
CALL app.apply_tenant_rls('bus_roll_sessions');

CREATE TABLE bus_roll_marks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  session_id  BIGINT NOT NULL REFERENCES bus_roll_sessions(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  -- P on the bus, A not on the bus, LV on approved leave, GP gate pass (left early / comes late), OT other arrangement (parent brings or collects)
  code        TEXT NOT NULL CHECK (code IN ('P', 'A', 'LV', 'GP', 'OT')),
  remarks     TEXT,
  marked_by   BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX bus_roll_marks_by_student ON bus_roll_marks (student_id);
CALL app.apply_tenant_rls('bus_roll_marks');
