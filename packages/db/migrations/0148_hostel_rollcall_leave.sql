-- Hostel module H2 (docs/design/25-hostel-module.md): roll-call by sessions, and hostel leave as two new
-- kinds of the gate pass: hostel_home (overnight or longer; a parent or escort collects; the warden hands
-- over, the gate lets out and back in) and hostel_outing (same day; straight to the gate, back by a time).
-- The pupil's hostel wardens approve. A scheduled tick (workers) flags late returns, tells the parent and
-- the head warden, and after some hours the principal / school admin.
-- ---- roll-call -------------------------------------------------------------------------------------------
-- Each hostel has its own sessions (Morning 06:30, Night 21:30 ...). A warden takes the roll of a session on
-- a day: one mark per pupil holding a bed then. A pupil out on hostel leave (checked out at the gate, not
-- back yet) is marked on_leave by the system.
CREATE TABLE hostel_rollcall_sessions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  hostel_id   BIGINT NOT NULL REFERENCES hostels(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  at_time     TIME NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hostel_id, name)
);
CALL app.apply_tenant_rls('hostel_rollcall_sessions');

CREATE TABLE hostel_rollcalls (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  session_id  BIGINT NOT NULL REFERENCES hostel_rollcall_sessions(id),
  on_date     DATE NOT NULL,
  taken_by    BIGINT,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, on_date)
);
CALL app.apply_tenant_rls('hostel_rollcalls');

CREATE TABLE hostel_rollcall_marks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  rollcall_id  BIGINT NOT NULL REFERENCES hostel_rollcalls(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  bed_id       BIGINT REFERENCES hostel_beds(id),
  status       TEXT NOT NULL CHECK (status IN ('present', 'absent', 'on_leave', 'sick')),
  note         TEXT,
  alerted_at   TIMESTAMPTZ,
  UNIQUE (rollcall_id, student_id)
);
CREATE INDEX hostel_rollcall_marks_student ON hostel_rollcall_marks (student_id);
CALL app.apply_tenant_rls('hostel_rollcall_marks');

-- the school's hostel rules for H2
CREATE TABLE hostel_settings (
  school_id               BIGINT PRIMARY KEY REFERENCES schools(id),
  -- minutes after the return time before a pupil on leave counts as late
  late_grace_minutes      INT NOT NULL DEFAULT 30 CHECK (late_grace_minutes BETWEEN 0 AND 1440),
  -- hours overdue after which the principal / admin is told as well
  escalate_after_hours    INT NOT NULL DEFAULT 6 CHECK (escalate_after_hours BETWEEN 1 AND 168),
  -- outing: the latest return time of the day when the parent gives none
  outing_return_by        TIME NOT NULL DEFAULT '19:00',
  -- tell the parent when the pupil is absent at a roll-call
  alert_parent_absent     BOOLEAN NOT NULL DEFAULT true,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              BIGINT
);
CALL app.apply_tenant_rls('hostel_settings');

-- ---- hostel leave on the gate pass ----------------------------------------------------------------------
ALTER TABLE gate_passes DROP CONSTRAINT IF EXISTS gate_passes_kind_check;
ALTER TABLE gate_passes
  ADD CONSTRAINT gate_passes_kind_check
    CHECK (kind IN ('early_leave', 'late_arrival', 'rgp', 'nrgp', 'hostel_home', 'hostel_outing')),
  -- minutes after return_by (and the grace) the pupil came back; NULL = on time or not back yet
  ADD COLUMN late_minutes  INT,
  -- the late alert went to the parent and the head warden; the principal / admin was told
  ADD COLUMN overdue_at    TIMESTAMPTZ,
  ADD COLUMN escalated_at  TIMESTAMPTZ;
CREATE INDEX gate_passes_hostel_out ON gate_passes (school_id, return_by)
  WHERE state = 'out' AND kind IN ('hostel_home', 'hostel_outing');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('hostel.rollcall.mark', 'hostel', 'Take the roll-call of a hostel session', false),
  ('hostel.leave.view', 'hostel', 'See hostel leave and outings: out now, overdue, history', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN (VALUES ('group_admin', 'hostel.rollcall.mark'), ('group_admin', 'hostel.leave.view'),
               ('school_admin', 'hostel.rollcall.mark'), ('school_admin', 'hostel.leave.view'),
               ('warden', 'hostel.rollcall.mark'), ('warden', 'hostel.leave.view'),
               -- the warden hands a pupil on home leave to the parent or escort (photo, code)
               ('warden', 'engagement.gate_pass.handover')) AS p(role, code) ON p.role = r.code
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
       '["who","hostel","number","due","hours","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION app.module_seed_templates(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code LIKE 'gate\_pass\_%' THEN PERFORM app.gate_pass_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'helpdesk\_%' THEN PERFORM app.helpdesk_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'clinic\_%' THEN PERFORM app.clinic_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'transport\_%' THEN PERFORM app.transport_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'hostel\_%' THEN PERFORM app.hostel_seed_templates(app.current_school_id());
  END IF;
END
$$;

-- The hostel a pupil holds a bed in on a day.
CREATE OR REPLACE FUNCTION app.hostel_of(p_student BIGINT, p_on DATE DEFAULT CURRENT_DATE) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT r.hostel_id FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
   WHERE a.student_id = p_student AND a.from_date <= p_on AND (a.to_date IS NULL OR a.to_date >= p_on)
   ORDER BY a.from_date DESC LIMIT 1
$$;

-- The users who are wardens of a hostel (head wardens first when p_head_only finds any).
CREATE OR REPLACE FUNCTION app.hostel_warden_users(p_hostel BIGINT, p_head_only BOOLEAN DEFAULT false) RETURNS BIGINT[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    CASE WHEN p_head_only THEN
      NULLIF(ARRAY(SELECT e.user_id FROM hostel_wardens w JOIN employees e ON e.id = w.employee_id
                    WHERE w.hostel_id = p_hostel AND w.is_head AND e.user_id IS NOT NULL AND e.deleted_at IS NULL), '{}')
    END,
    ARRAY(SELECT e.user_id FROM hostel_wardens w JOIN employees e ON e.id = w.employee_id
           WHERE w.hostel_id = p_hostel AND e.user_id IS NOT NULL AND e.deleted_at IS NULL))
$$;

-- Late returns of the school (run by the workers every few minutes, in the school's context): a pupil out on
-- hostel leave past return_by + grace is flagged once (parent and head warden told); past the escalation
-- hours the principal and school admins are told once more. Returns the number of passes acted on.
CREATE OR REPLACE FUNCTION app.hostel_leave_tick() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_set hostel_settings%ROWTYPE;
  v_school TEXT;
  v_n INT := 0;
  p RECORD;
  v_vars JSONB;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_set FROM hostel_settings WHERE school_id = app.current_school_id();
  IF NOT FOUND THEN
    v_set.late_grace_minutes := 30;
    v_set.escalate_after_hours := 6;
  END IF;
  SELECT name INTO v_school FROM schools WHERE id = app.current_school_id();
  FOR p IN
    SELECT g.id, g.student_id, g.return_by, g.overdue_at, g.escalated_at, COALESCE(g.pass_no, g.id::text) AS number,
           s.display_name AS who, h.id AS hostel_id, h.name AS hostel,
           to_char(g.return_by AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI') AS due,
           floor(extract(epoch FROM now() - g.return_by) / 3600)::int AS hours
      FROM gate_passes g JOIN students s ON s.id = g.student_id
      LEFT JOIN hostels h ON h.id = app.hostel_of(g.student_id, (g.return_by AT TIME ZONE 'Asia/Kolkata')::date)
     WHERE g.state = 'out' AND g.kind IN ('hostel_home', 'hostel_outing') AND g.return_by IS NOT NULL
       AND g.return_by + make_interval(mins => v_set.late_grace_minutes) < now()
       AND (g.overdue_at IS NULL OR (g.escalated_at IS NULL AND g.return_by + make_interval(hours => v_set.escalate_after_hours) < now()))
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    v_vars := jsonb_build_object('who', p.who, 'hostel', COALESCE(p.hostel, ''), 'due', p.due, 'number', p.number,
                                 'hours', GREATEST(p.hours, 0)::text, 'school', COALESCE(v_school, ''),
                                 'warden', COALESCE((SELECT concat_ws(' ', e.display_name, e.mobile) FROM hostel_wardens w
                                                       JOIN employees e ON e.id = w.employee_id
                                                      WHERE w.hostel_id = p.hostel_id ORDER BY w.is_head DESC, e.id LIMIT 1), ''));
    IF p.overdue_at IS NULL THEN
      PERFORM app.template_to_mobiles('hostel_leave_overdue', ARRAY(
        SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
         WHERE sg.student_id = p.student_id AND sg.receives_notifications AND g.mobile IS NOT NULL), v_vars);
      IF p.hostel_id IS NOT NULL THEN
        PERFORM app.template_to_users('hostel_leave_overdue_staff', app.hostel_warden_users(p.hostel_id, true), v_vars);
      END IF;
      UPDATE gate_passes SET overdue_at = now(), updated_at = now() WHERE id = p.id;
      v_n := v_n + 1;
    END IF;
    IF p.escalated_at IS NULL AND p.return_by + make_interval(hours => v_set.escalate_after_hours) < now() THEN
      PERFORM app.template_to_users('hostel_leave_overdue_staff', ARRAY(
        SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.school_id = app.current_school_id() AND r.code = 'school_admin' AND ur.revoked_at IS NULL
           AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
        UNION
        SELECT e.user_id FROM employees e
         WHERE lower(btrim(e.designation)) = 'principal' AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL), v_vars);
      UPDATE gate_passes SET escalated_at = now(), updated_at = now() WHERE id = p.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END
$$;
