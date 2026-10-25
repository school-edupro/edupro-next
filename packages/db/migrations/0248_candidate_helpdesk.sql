-- Questions from families registering for admission (docs/design/43, part 4): a fifth helpdesk desk,
-- 'candidate'. The family raises it in the admission portal ("Ask the school") about one of its
-- registrations; there is no user behind it, so the ticket names the applicant (and the registration)
-- instead. Heads, owners, the SLA clock, escalation, close / reopen and rating are the helpdesk's own.

ALTER TABLE query_categories DROP CONSTRAINT query_categories_desk_check;
ALTER TABLE query_categories ADD CONSTRAINT query_categories_desk_check
  CHECK (desk IN ('parent', 'staff', 'provider', 'hostel', 'candidate'));
ALTER TABLE parent_queries DROP CONSTRAINT parent_queries_desk_check;
ALTER TABLE parent_queries ADD CONSTRAINT parent_queries_desk_check
  CHECK (desk IN ('parent', 'staff', 'provider', 'hostel', 'candidate'));

ALTER TABLE parent_queries
  ALTER COLUMN raised_by_user_id DROP NOT NULL,
  ADD COLUMN applicant_id   BIGINT REFERENCES applicants(id),
  ADD COLUMN application_id BIGINT REFERENCES applications(id),
  ADD CONSTRAINT parent_queries_raised_by CHECK (raised_by_user_id IS NOT NULL OR applicant_id IS NOT NULL),
  ADD CONSTRAINT parent_queries_candidate_who CHECK (desk <> 'candidate' OR applicant_id IS NOT NULL);
CREATE INDEX parent_queries_applicant ON parent_queries (applicant_id, opened_at DESC) WHERE applicant_id IS NOT NULL;
CREATE INDEX parent_queries_application ON parent_queries (application_id) WHERE application_id IS NOT NULL;

-- the family writes as itself
ALTER TYPE author_kind ADD VALUE IF NOT EXISTS 'candidate';

-- an answer to the family's question is unread in its Messages until it opens the question
ALTER TABLE applicant_inbox_reads DROP CONSTRAINT applicant_inbox_reads_kind_check;
ALTER TABLE applicant_inbox_reads ADD CONSTRAINT applicant_inbox_reads_kind_check
  CHECK (kind IN ('notice', 'message', 'query'));

-- the escalation mail names the family and calls it an admission query
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
           COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = p.raised_by_user_id LIMIT 1), u.display_name,
                    (SELECT ap.name FROM applicants ap WHERE ap.id = p.applicant_id)) AS raised_by
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
      CASE q.desk WHEN 'provider' THEN 'ticket to the ERP provider' WHEN 'staff' THEN 'staff query' WHEN 'hostel' THEN 'hostel complaint' WHEN 'candidate' THEN 'admission query' ELSE 'parent query' END,
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


-- the default heads include the admission desk
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
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'candidate') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, x.route_to, x.ord, 'candidate', 'role', x.sla
      FROM (VALUES ('fees', 'Fee and payment', 'accountant', 1, 24), ('documents', 'Documents', 'school_admin', 2, 24),
                   ('form', 'Form and technical', 'school_admin', 3, 24), ('test', 'Test and interview', 'academic_coordinator', 4, 24),
                   ('other', 'Other', 'school_admin', 9, 24)) AS x(code, name, route_to, ord, sla)
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


-- the admission desk's heads: existing schools now, new schools on first use
INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
SELECT s.id, x.code, x.name, x.route_to, x.ord, 'candidate', 'role', x.sla
  FROM schools s
  CROSS JOIN (VALUES ('fees', 'Fee and payment', 'accountant', 1, 24), ('documents', 'Documents', 'school_admin', 2, 24),
                     ('form', 'Form and technical', 'school_admin', 3, 24), ('test', 'Test and interview', 'academic_coordinator', 4, 24),
                     ('other', 'Other', 'school_admin', 9, 24)) AS x(code, name, route_to, ord, sla)
 WHERE EXISTS (SELECT 1 FROM query_categories q WHERE q.school_id = s.id)
ON CONFLICT DO NOTHING;
