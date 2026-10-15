-- Hostel module H3 (docs/design/25-hostel-module.md): approved visitors and hostel visits, and the mess.
--  * Each boarder has an approved-visitor list. Parents add people in the portal and a warden approves; the
--    office may add directly. Parents and guardians on the school's record count as approved.
--  * A hostel visit is an entry of the visitor register (visitor_log) that names the pupil. A visitor not on
--    the list, or one who comes outside the hostel's visiting hours, waits at the gate until a warden allows
--    or refuses; the parent is told either way.
--  * The mess: meals of each hostel, a weekly menu with one-off changes for a date, who skipped a meal, and
--    the kitchen diet list (the hostel's diet of each pupil and the allergy on the student record).

-- ---- approved visitors -----------------------------------------------------------------------------------
CREATE TABLE hostel_visitors (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  relation      TEXT NOT NULL CHECK (length(btrim(relation)) BETWEEN 2 AND 60),
  mobile        TEXT NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  source        TEXT NOT NULL CHECK (source IN ('parent', 'office')),
  note          TEXT,
  added_by      BIGINT,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    BIGINT,
  decided_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX hostel_visitors_one ON hostel_visitors (student_id, mobile) WHERE status IN ('pending', 'approved');
CREATE INDEX hostel_visitors_pending ON hostel_visitors (school_id, status) WHERE status = 'pending';
CALL app.apply_tenant_rls('hostel_visitors');

-- the visitor's photo (small JPEG/PNG), shown to the gate and the warden
CREATE TABLE hostel_visitor_photos (
  visitor_id    BIGINT PRIMARY KEY REFERENCES hostel_visitors(id) ON DELETE CASCADE,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes         BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 100 AND 300000)
);
CALL app.apply_tenant_rls('hostel_visitor_photos');

-- when each hostel takes visitors (none set = any time); weekday 0 = Sunday
CREATE TABLE hostel_visit_hours (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  hostel_id   BIGINT NOT NULL REFERENCES hostels(id),
  weekday     INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  from_time   TIME NOT NULL,
  to_time     TIME NOT NULL CHECK (to_time > from_time),
  UNIQUE (hostel_id, weekday, from_time)
);
CALL app.apply_tenant_rls('hostel_visit_hours');

-- a hostel visit on the visitor register
ALTER TABLE visitor_log
  ADD COLUMN student_id         BIGINT REFERENCES students(id),
  ADD COLUMN hostel_id          BIGINT REFERENCES hostels(id),
  ADD COLUMN hostel_visitor_id  BIGINT REFERENCES hostel_visitors(id),
  -- what the gate found: on the list (or a parent on record) and within the visiting hours
  ADD COLUMN hostel_listed      BOOLEAN,
  ADD COLUMN hostel_in_hours    BOOLEAN,
  ADD COLUMN warden_decision    TEXT CHECK (warden_decision IN ('allowed', 'refused')),
  ADD COLUMN warden_by          BIGINT,
  ADD COLUMN warden_at          TIMESTAMPTZ,
  ADD COLUMN warden_note        TEXT;
CREATE INDEX visitor_log_hostel ON visitor_log (school_id, hostel_id, created_at DESC) WHERE hostel_id IS NOT NULL;

-- ---- the mess ----------------------------------------------------------------------------------------------
CREATE TABLE hostel_meals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  hostel_id   BIGINT NOT NULL REFERENCES hostels(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  at_time     TIME NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (hostel_id, name)
);
CALL app.apply_tenant_rls('hostel_meals');

-- the repeating week: what each meal serves on each weekday
CREATE TABLE hostel_menu (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  meal_id     BIGINT NOT NULL REFERENCES hostel_meals(id) ON DELETE CASCADE,
  weekday     INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  items       TEXT NOT NULL CHECK (length(btrim(items)) BETWEEN 1 AND 500),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (meal_id, weekday)
);
CALL app.apply_tenant_rls('hostel_menu');

-- a one-off change for a day (a festival lunch, a dinner moved)
CREATE TABLE hostel_menu_changes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  meal_id     BIGINT NOT NULL REFERENCES hostel_meals(id) ON DELETE CASCADE,
  on_date     DATE NOT NULL,
  items       TEXT NOT NULL CHECK (length(btrim(items)) BETWEEN 1 AND 500),
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (meal_id, on_date)
);
CALL app.apply_tenant_rls('hostel_menu_changes');

-- a meal marked on a day, and who skipped it (everyone else holding a bed and not away had it)
CREATE TABLE hostel_meal_marks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  meal_id     BIGINT NOT NULL REFERENCES hostel_meals(id) ON DELETE CASCADE,
  on_date     DATE NOT NULL,
  served      INT NOT NULL DEFAULT 0,
  taken_by    BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meal_id, on_date)
);
CALL app.apply_tenant_rls('hostel_meal_marks');

CREATE TABLE hostel_meal_skips (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  mark_id     BIGINT NOT NULL REFERENCES hostel_meal_marks(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  reason      TEXT,
  UNIQUE (mark_id, student_id)
);
CALL app.apply_tenant_rls('hostel_meal_skips');

-- the diet the hostel keeps for a pupil
CREATE TABLE hostel_diets (
  student_id       BIGINT PRIMARY KEY REFERENCES students(id),
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  diet             TEXT NOT NULL DEFAULT 'veg' CHECK (diet IN ('veg', 'non_veg', 'eggetarian', 'jain', 'vegan')),
  no_onion_garlic  BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT
);
CALL app.apply_tenant_rls('hostel_diets');

-- ---- rights and messages ------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('hostel.visit.view', 'hostel', 'See hostel visits and approved-visitor lists', false),
  ('hostel.visit.decide', 'hostel', 'Approve visitors to a boarder''s list and allow or refuse a waiting visit', false),
  ('hostel.visit.gate', 'hostel', 'Register a hostel visitor at the gate against the pupil''s list', false),
  ('hostel.mess.manage', 'hostel', 'Meals, menu, meal attendance and diets of the hostel', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN (VALUES ('group_admin', 'hostel.visit.view'), ('group_admin', 'hostel.visit.decide'), ('group_admin', 'hostel.visit.gate'), ('group_admin', 'hostel.mess.manage'),
               ('school_admin', 'hostel.visit.view'), ('school_admin', 'hostel.visit.decide'), ('school_admin', 'hostel.visit.gate'), ('school_admin', 'hostel.mess.manage'),
               ('warden', 'hostel.visit.view'), ('warden', 'hostel.visit.decide'), ('warden', 'hostel.mess.manage'),
               ('gate_security', 'hostel.visit.gate'), ('front_desk', 'hostel.visit.gate')) AS p(role, code) ON p.role = r.code
 WHERE r.school_id IS NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.hostel_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name, NULL, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('hostel_absent', 'Hostel: absent at roll-call (parent)',
       '{{who}} was not present at the {{session}} roll-call of {{hostel}} on {{date}}. Please call the warden {{warden}}. - {{school}}',
       '["who","session","hostel","date","warden","school"]'),
      ('hostel_absent_warden', 'Hostel: absent without leave (warden)',
       '{{who}} ({{room}}) was absent at the {{session}} roll-call on {{date}} with no leave on record. - {{school}}',
       '["who","room","session","date","school"]'),
      ('hostel_leave_overdue', 'Hostel leave: not back on time (parent)',
       '{{who}} was due back at {{hostel}} by {{due}} and has not returned. Please contact the warden {{warden}}. - {{school}}',
       '["who","hostel","due","warden","school"]'),
      ('hostel_leave_overdue_staff', 'Hostel leave: overdue (warden, principal)',
       '{{who}} ({{hostel}}) is overdue from hostel leave {{number}}: due back {{due}}, {{hours}} h late. - {{school}}',
       '["who","hostel","number","due","hours","school"]'),
      ('hostel_visit_waiting', 'Hostel visit: waiting for the warden',
       '{{visitor}} ({{relation}}) is at the gate to meet {{who}} of {{hostel}}: {{why}}. Allow or refuse in EduPro. - {{school}}',
       '["visitor","relation","who","hostel","why","school"]'),
      ('hostel_visit_parent', 'Hostel visit: told to the parent',
       '{{visitor}} ({{relation}}) came to meet {{who}} at {{hostel}} at {{time}}: {{outcome}}. - {{school}}',
       '["visitor","relation","who","hostel","time","outcome","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- within the hostel's visiting hours now (India time)? no hours set = any time
CREATE OR REPLACE FUNCTION app.hostel_in_visit_hours(p_hostel BIGINT, p_at TIMESTAMPTZ DEFAULT now()) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM hostel_visit_hours WHERE hostel_id = p_hostel)
      OR EXISTS (SELECT 1 FROM hostel_visit_hours h
                  WHERE h.hostel_id = p_hostel
                    AND h.weekday = extract(dow FROM p_at AT TIME ZONE 'Asia/Kolkata')::int
                    AND (p_at AT TIME ZONE 'Asia/Kolkata')::time BETWEEN h.from_time AND h.to_time)
$$;
