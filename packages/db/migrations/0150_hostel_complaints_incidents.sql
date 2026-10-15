-- Hostel module H4 (docs/design/25-hostel-module.md): the incident register, and hostel complaints as a
-- fourth helpdesk desk ('hostel'): heads owned by the warden role (the hostel's head warden is assigned) or a
-- named employee, the helpdesk's SLA, escalation, close / reopen and rating; the ticket names the hostel and
-- room (and the boarder when a parent raised it). The warden's sick-bay note is a clinic visit (no table).

ALTER TABLE query_categories DROP CONSTRAINT query_categories_desk_check;
ALTER TABLE query_categories ADD CONSTRAINT query_categories_desk_check CHECK (desk IN ('parent', 'staff', 'provider', 'hostel'));
ALTER TABLE parent_queries DROP CONSTRAINT parent_queries_desk_check;
ALTER TABLE parent_queries ADD CONSTRAINT parent_queries_desk_check CHECK (desk IN ('parent', 'staff', 'provider', 'hostel'));
ALTER TABLE parent_queries
  ADD COLUMN hostel_id       BIGINT REFERENCES hostels(id),
  ADD COLUMN hostel_room_id  BIGINT REFERENCES hostel_rooms(id),
  ADD CONSTRAINT parent_queries_hostel_where CHECK (desk <> 'hostel' OR hostel_id IS NOT NULL);
CREATE INDEX parent_queries_hostel ON parent_queries (school_id, hostel_id, status) WHERE desk = 'hostel';

CREATE OR REPLACE FUNCTION app.helpdesk_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k query_categories%ROWTYPE;
BEGIN
  IF NEW.kind = 'leave' OR NEW.legacy_hypercare_id IS NOT NULL OR NEW.legacy_ref IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO k FROM query_categories WHERE school_id = NEW.school_id AND desk = NEW.desk AND code = NEW.category_code;
    IF FOUND THEN
      IF k.owner_type = 'class_teacher' THEN
        NEW.assigned_role := 'class_teacher';
        NEW.assigned_user_id := COALESCE(NEW.assigned_user_id, (
          SELECT e.user_id FROM enrolments en
            JOIN teacher_assignments ta ON ta.class_section_id = en.class_section_id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL
            JOIN employees e ON e.id = ta.employee_id AND e.user_id IS NOT NULL AND e.deleted_at IS NULL
           WHERE en.student_id = NEW.student_id AND en.academic_year_id = NEW.academic_year_id AND en.status = 'active'
           ORDER BY ta.id LIMIT 1));
      ELSIF k.owner_type = 'employee' THEN
        NEW.assigned_role := NULL;
        NEW.assigned_user_id := k.owner_user_id;
      ELSIF k.owner_type = 'provider' THEN
        NEW.assigned_role := 'erp_support';
      ELSIF NEW.desk = 'hostel' AND k.route_to = 'warden' THEN
        -- a hostel complaint goes to the head warden of the hostel it is about (else any of its wardens,
        -- else the school admins)
        NEW.assigned_user_id := (app.hostel_warden_users(NEW.hostel_id, true))[1];
        NEW.assigned_role := CASE WHEN NEW.assigned_user_id IS NULL THEN 'school_admin' END;
      ELSE
        NEW.assigned_role := k.route_to;
      END IF;
    ELSIF NEW.desk = 'provider' THEN
      NEW.assigned_role := 'erp_support';
    END IF;
    IF NEW.desk = 'provider' AND NEW.provider_status IS NULL THEN NEW.provider_status := 'open'; END IF;
    NEW.level := 1;
    NEW.due_at := COALESCE(NEW.due_at, app.helpdesk_add_hours(NEW.opened_at, app.helpdesk_level_hours(NEW.desk, NEW.category_code, 1, NEW.priority)));
  ELSE
    -- the family / staff member wrote back after an answer: the clock restarts at the current level
    IF OLD.status = 'answered' AND NEW.status = 'open' AND NEW.breached_at IS NULL THEN
      NEW.due_at := app.helpdesk_add_hours(now(), app.helpdesk_level_hours(NEW.desk, NEW.category_code, NEW.level, NEW.priority));
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION app.helpdesk_escalate_due() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  q RECORD;
  nxt helpdesk_levels%ROWTYPE;
  s helpdesk_settings%ROWTYPE;
  v_emails TEXT[];
  v_users BIGINT[];
  v_html TEXT;
  v_head TEXT;
  v_n INT := 0;
BEGIN
  SELECT * INTO s FROM helpdesk_settings WHERE school_id = app.current_school_id();
  FOR q IN
    SELECT p.*, k.id AS head_id, COALESCE(k.name, p.category_code) AS head_name, st.display_name AS student_name,
           COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = p.raised_by_user_id LIMIT 1), u.display_name) AS raised_by
      FROM parent_queries p
      LEFT JOIN query_categories k ON k.school_id = p.school_id AND k.desk = p.desk AND k.code = p.category_code
      LEFT JOIN students st ON st.id = p.student_id
      LEFT JOIN users u ON u.id = p.raised_by_user_id
     WHERE p.kind <> 'leave' AND p.status IN ('open', 'in_progress') AND p.breached_at IS NULL AND p.due_at IS NOT NULL AND p.due_at < now()
     ORDER BY p.due_at
     LIMIT 500
  LOOP
    nxt := NULL;
    SELECT * INTO nxt FROM helpdesk_levels WHERE head_id = q.head_id AND level > q.level ORDER BY level LIMIT 1;
    -- the provider desk with no matrix of its own goes to the provider's senior person
    IF nxt.id IS NULL AND q.desk = 'provider' AND q.level = 1 AND s.provider_senior_email IS NOT NULL THEN
      nxt.level := 2; nxt.assign_type := 'email_only'; nxt.hours := NULL;
      nxt.emails := ARRAY[s.provider_senior_email::text] || CASE WHEN s.provider_email IS NOT NULL THEN ARRAY[s.provider_email::text] ELSE '{}'::text[] END;
    END IF;
    v_head := format('%s %s · %s', q.number, q.subject, q.head_name);
    IF nxt.level IS NULL THEN
      -- the last level ran out too: record the breach once and remind the last level
      UPDATE parent_queries SET breached_at = now(), updated_at = now() WHERE id = q.id;
      INSERT INTO query_events (school_id, query_id, kind, level, detail) VALUES (q.school_id, q.id, 'breached', q.level, jsonb_build_object('dueAt', q.due_at));
      v_n := v_n + 1;
      CONTINUE;
    END IF;
    v_users := '{}';
    v_emails := COALESCE(nxt.emails, '{}');
    IF nxt.assign_type = 'role' THEN
      SELECT COALESCE(array_agg(rp.user_id), '{}'), v_emails || COALESCE(array_agg(rp.email) FILTER (WHERE rp.email IS NOT NULL), '{}')
        INTO v_users, v_emails FROM app.helpdesk_role_people(nxt.role_code) rp;
    ELSIF nxt.assign_type = 'employee' THEN
      v_users := ARRAY[nxt.user_id];
      v_emails := v_emails || COALESCE(ARRAY[app.helpdesk_user_email(nxt.user_id)], '{}');
    END IF;
    UPDATE parent_queries
       SET level = nxt.level, escalated_at = now(), updated_at = now(),
           status = CASE WHEN status = 'open' THEN 'in_progress'::query_status ELSE status END,
           assigned_role = CASE nxt.assign_type WHEN 'role' THEN nxt.role_code WHEN 'employee' THEN NULL ELSE assigned_role END,
           assigned_user_id = CASE nxt.assign_type WHEN 'employee' THEN nxt.user_id WHEN 'role' THEN NULL ELSE assigned_user_id END,
           due_at = CASE WHEN nxt.hours IS NULL THEN NULL ELSE app.helpdesk_add_hours(now(), nxt.hours) END,
           breached_at = CASE WHEN nxt.hours IS NULL THEN now() ELSE NULL END
     WHERE id = q.id;
    INSERT INTO query_events (school_id, query_id, kind, level, detail)
    VALUES (q.school_id, q.id, 'escalated', nxt.level,
            jsonb_build_object('from', q.level, 'type', nxt.assign_type, 'role', nxt.role_code, 'userId', nxt.user_id::text, 'emails', to_jsonb(v_emails)));
    v_html := format(
      '<p>The %s below was not resolved in time and has been escalated to <strong>level %s</strong>%s.</p>'
      '<table cellpadding="4" style="border-collapse:collapse">'
      '<tr><td><strong>Number</strong></td><td>%s</td></tr><tr><td><strong>Query head</strong></td><td>%s</td></tr>'
      '<tr><td><strong>Subject</strong></td><td>%s</td></tr>%s<tr><td><strong>Raised by</strong></td><td>%s</td></tr>'
      '<tr><td><strong>Raised on</strong></td><td>%s</td></tr><tr><td><strong>Was due</strong></td><td>%s</td></tr></table>'
      '<p>%s</p><p>Open EduPro → Helpdesk → %s to answer it.</p>',
      CASE q.desk WHEN 'provider' THEN 'ticket to the ERP provider' WHEN 'staff' THEN 'staff query' WHEN 'hostel' THEN 'hostel complaint' ELSE 'parent query' END,
      nxt.level, CASE WHEN nxt.assign_type = 'email_only' THEN ' (for your information)' ELSE ' and assigned to you' END,
      replace(replace(q.number, '<', '&lt;'), '>', '&gt;'), replace(replace(q.head_name, '<', '&lt;'), '>', '&gt;'),
      replace(replace(q.subject, '<', '&lt;'), '>', '&gt;'),
      CASE WHEN q.student_name IS NOT NULL THEN format('<tr><td><strong>Student</strong></td><td>%s</td></tr>', replace(replace(q.student_name, '<', '&lt;'), '>', '&gt;')) ELSE '' END,
      replace(replace(COALESCE(q.raised_by, ''), '<', '&lt;'), '>', '&gt;'),
      to_char(q.opened_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'), to_char(q.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'),
      replace(replace(left(q.body, 1000), '<', '&lt;'), '>', '&gt;'), replace(replace(q.number, '<', '&lt;'), '>', '&gt;'));
    PERFORM app.helpdesk_notify(q.id, 'Escalated (level ' || nxt.level || '): ' || v_head, v_html, v_emails, v_users,
      'Query escalated to you', v_head, '/queries/' || q.id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;

CREATE OR REPLACE FUNCTION app.helpdesk_ensure_defaults() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.assert_context();
  INSERT INTO helpdesk_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'parent') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, x.route_to, x.ord, 'parent', CASE WHEN x.route_to = 'class_teacher' THEN 'class_teacher' ELSE 'role' END, 24
      FROM (VALUES ('academics', 'Academics and homework', 'class_teacher', 1), ('attendance', 'Attendance', 'class_teacher', 2),
                   ('fees', 'Fees and payments', 'accountant', 3), ('transport', 'Transport', 'school_admin', 4),
                   ('admin', 'Office and documents', 'school_admin', 5), ('other', 'Other', 'class_teacher', 9)) AS x(code, name, route_to, ord)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'staff') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, x.route_to, x.ord, 'staff', 'role', x.sla
      FROM (VALUES ('payroll', 'Salary and payroll', 'school_admin', 1, 48), ('hr', 'HR, leave balance and documents', 'school_admin', 2, 48),
                   ('it', 'IT, computer and login', 'school_admin', 3, 24), ('facilities', 'Facilities and maintenance', 'school_admin', 4, 48),
                   ('academic', 'Academic and timetable', 'academic_coordinator', 5, 48), ('other', 'Other', 'school_admin', 9, 48)) AS x(code, name, route_to, ord, sla)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'provider') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, 'erp_support', x.ord, 'provider', 'provider', NULL
      FROM (VALUES ('bug', 'Something is not working', 1), ('how_to', 'How do I…', 2), ('data_fix', 'Data correction', 3),
                   ('access', 'Login and access', 4), ('feature', 'New feature or change', 5), ('other', 'Other', 9)) AS x(code, name, ord)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'hostel') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, 'warden', x.ord, 'hostel', 'role', x.sla
      FROM (VALUES ('electrical', 'Electrical (lights, fan, switch)', 1, 24), ('plumbing', 'Plumbing and water', 2, 24),
                   ('furniture', 'Furniture and fittings', 3, 48), ('cleaning', 'Cleaning and housekeeping', 4, 24),
                   ('mess', 'Mess and food', 5, 24), ('other', 'Other', 9, 48)) AS x(code, name, ord, sla)
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;

-- existing schools get the hostel heads now (new schools on first use)
INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
SELECT s.id, x.code, x.name, 'warden', x.ord, 'hostel', 'role', x.sla
  FROM schools s
  CROSS JOIN (VALUES ('electrical', 'Electrical (lights, fan, switch)', 1, 24), ('plumbing', 'Plumbing and water', 2, 24),
                     ('furniture', 'Furniture and fittings', 3, 48), ('cleaning', 'Cleaning and housekeeping', 4, 24),
                     ('mess', 'Mess and food', 5, 24), ('other', 'Other', 9, 48)) AS x(code, name, ord, sla)
 WHERE EXISTS (SELECT 1 FROM query_categories q WHERE q.school_id = s.id)
ON CONFLICT DO NOTHING;

-- ---- incident register ------------------------------------------------------------------------------------
CREATE TABLE hostel_incidents (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  student_id         BIGINT NOT NULL REFERENCES students(id),
  hostel_id          BIGINT NOT NULL REFERENCES hostels(id),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  category           TEXT NOT NULL CHECK (category IN ('discipline', 'health', 'safety', 'property', 'other')),
  severity           TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'serious')),
  what               TEXT NOT NULL CHECK (length(btrim(what)) BETWEEN 5 AND 1000),
  action             TEXT,
  -- shown to the family in the portal and sent to the parent
  tell_parent        BOOLEAN NOT NULL DEFAULT false,
  parent_told_at     TIMESTAMPTZ,
  principal_told_at  TIMESTAMPTZ,
  recorded_by        BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hostel_incidents_student ON hostel_incidents (student_id, occurred_at DESC);
CREATE INDEX hostel_incidents_hostel ON hostel_incidents (school_id, hostel_id, occurred_at DESC);
CALL app.apply_tenant_rls('hostel_incidents');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('hostel.incident.manage', 'hostel', 'Record hostel incidents (discipline, health, safety, property) and tell the parent', false),
  ('hostel.incident.view', 'hostel', 'Read the hostel incident register', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN (VALUES ('group_admin', 'hostel.incident.manage'), ('group_admin', 'hostel.incident.view'),
               ('school_admin', 'hostel.incident.manage'), ('school_admin', 'hostel.incident.view'),
               ('warden', 'hostel.incident.manage'), ('warden', 'hostel.incident.view')) AS p(role, code) ON p.role = r.code
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
       '["visitor","relation","who","hostel","time","outcome","school"]'),
      ('hostel_incident_parent', 'Hostel incident: told to the parent',
       'An incident about {{who}} at {{hostel}} on {{when}} ({{category}}): {{what}}. Please contact the warden. - {{school}}',
       '["who","hostel","when","category","what","school"]'),
      ('hostel_incident_serious', 'Hostel incident: serious (principal)',
       'Serious incident at {{hostel}} on {{when}}: {{who}}, {{category}}: {{what}}. Open EduPro for details. - {{school}}',
       '["who","hostel","when","category","what","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- wardens answer the hostel desk (and raise complaints) like any member of staff on the helpdesk
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('helpdesk.ticket.raise'), ('helpdesk.ticket.respond'), ('platform.files.upload'), ('platform.files.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'warden'
ON CONFLICT DO NOTHING;
