-- 0056: Helpdesk — parent queries, staff queries and ERP provider tickets in one place (2026-10-02).
--
-- parent_queries becomes the ticket table for three desks (parent | staff | provider); leave requests
-- stay as they are (kind = 'leave', their own module, no SLA). query_categories become the query heads
-- of each desk with an owner (class teacher / role / employee / ERP provider) and SLA hours; an
-- escalation matrix per head moves an unresolved ticket up level by level after its working hours run
-- out, reassigning it and mailing / pushing the next level. The SLA clock counts the school's working
-- days and hours and skips holidays. Hypercare issues are merged into the provider desk.

-- ---- permissions and the ERP support role ------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('helpdesk.settings.manage', 'helpdesk', 'Helpdesk set-up: query heads, owners, SLA, escalation matrix, working hours, ERP provider', false),
  ('helpdesk.ticket.viewall', 'helpdesk', 'See every ticket of every desk and the helpdesk dashboard', false),
  ('helpdesk.ticket.raise', 'helpdesk', 'Raise a staff query or a ticket to the ERP provider', false),
  ('helpdesk.ticket.respond', 'helpdesk', 'Reply to, reassign and close the tickets assigned to me or my role', false),
  ('helpdesk.provider.respond', 'helpdesk', 'ERP provider support: see and answer every ticket raised to the provider', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'erp_support', 'ERP Support (provider)', 'module', true, 'ERP provider support person: answers the school''s tickets to the provider')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('helpdesk.settings.manage'), ('helpdesk.ticket.viewall'), ('helpdesk.ticket.raise'), ('helpdesk.ticket.respond'), ('helpdesk.provider.respond')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
-- every staff role may raise and answer what is assigned to it
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('helpdesk.ticket.raise'), ('helpdesk.ticket.respond'), ('platform.files.upload'), ('platform.files.view')) AS p(code)
 WHERE r.code NOT IN ('parent', 'student', 'erp_support', 'auditor', 'support_engineer') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('helpdesk.ticket.respond'), ('helpdesk.provider.respond'), ('platform.files.upload'), ('platform.files.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'erp_support'
ON CONFLICT DO NOTHING;
-- families attach files to their queries and replies
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, p.code FROM role_permissions rp
  CROSS JOIN (VALUES ('platform.files.upload'), ('platform.files.view')) AS p(code)
 WHERE rp.permission_code = 'engagement.query.create'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'helpdesk.ticket.viewall' FROM roles r WHERE r.code = 'auditor'
ON CONFLICT DO NOTHING;

-- ---- query heads ---------------------------------------------------------------------------------------
ALTER TABLE query_categories
  ADD COLUMN desk          TEXT NOT NULL DEFAULT 'parent' CHECK (desk IN ('parent', 'staff', 'provider')),
  ADD COLUMN owner_type    TEXT NOT NULL DEFAULT 'role' CHECK (owner_type IN ('class_teacher', 'role', 'employee', 'provider')),
  ADD COLUMN owner_user_id BIGINT REFERENCES users(id),
  ADD COLUMN sla_hours     NUMERIC(6,1) CHECK (sla_hours IS NULL OR sla_hours > 0),
  ADD COLUMN description   TEXT,
  ADD COLUMN updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE query_categories SET owner_type = CASE WHEN route_to = 'class_teacher' THEN 'class_teacher' ELSE 'role' END, sla_hours = 24;
ALTER TABLE query_categories DROP CONSTRAINT query_categories_school_id_code_key;
ALTER TABLE query_categories ADD CONSTRAINT query_categories_desk_code UNIQUE (school_id, desk, code);

-- level 1 is the head's owner; levels 2.. take over when the previous level's hours run out
CREATE TABLE helpdesk_levels (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  head_id     BIGINT NOT NULL REFERENCES query_categories(id) ON DELETE CASCADE,
  level       INT NOT NULL CHECK (level BETWEEN 2 AND 6),
  hours       NUMERIC(6,1) NOT NULL DEFAULT 24 CHECK (hours > 0),   -- working hours at this level
  assign_type TEXT NOT NULL CHECK (assign_type IN ('role', 'employee', 'email_only')),
  role_code   TEXT,
  user_id     BIGINT REFERENCES users(id),
  emails      TEXT[] NOT NULL DEFAULT '{}',                         -- also mailed on reaching this level
  UNIQUE (head_id, level),
  CHECK (assign_type <> 'role' OR role_code IS NOT NULL),
  CHECK (assign_type <> 'employee' OR user_id IS NOT NULL),
  CHECK (assign_type <> 'email_only' OR cardinality(emails) > 0)
);
CALL app.apply_tenant_rls('helpdesk_levels');

CREATE TABLE helpdesk_settings (
  school_id             BIGINT PRIMARY KEY REFERENCES schools(id),
  working_days          INT[] NOT NULL DEFAULT '{1,2,3,4,5,6}',  -- ISO weekdays, Monday = 1
  day_start             TIME NOT NULL DEFAULT '08:00',
  day_end               TIME NOT NULL DEFAULT '16:00',
  reopen_days           INT NOT NULL DEFAULT 7 CHECK (reopen_days BETWEEN 0 AND 60),
  provider_name         TEXT,
  provider_email        CITEXT,
  provider_senior_name  TEXT,
  provider_senior_email CITEXT,
  provider_sla          JSONB NOT NULL DEFAULT '{"urgent": 4, "high": 24, "normal": 72, "low": 168}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            BIGINT,
  CHECK (day_end > day_start)
);
CALL app.apply_tenant_rls('helpdesk_settings');

-- ---- tickets -------------------------------------------------------------------------------------------
ALTER TABLE parent_queries
  ADD COLUMN desk               TEXT NOT NULL DEFAULT 'parent' CHECK (desk IN ('parent', 'staff', 'provider')),
  ADD COLUMN employee_id        BIGINT REFERENCES employees(id),     -- staff desk: who raised it
  ADD COLUMN priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN module             TEXT,                                -- provider desk: ERP module
  ADD COLUMN provider_status    TEXT CHECK (provider_status IN ('open', 'triaged', 'in_progress', 'fixed', 'verified', 'closed')),
  ADD COLUMN channel            TEXT,
  ADD COLUMN level              INT NOT NULL DEFAULT 1,
  ADD COLUMN due_at             TIMESTAMPTZ,
  ADD COLUMN escalated_at       TIMESTAMPTZ,
  ADD COLUMN breached_at        TIMESTAMPTZ,
  ADD COLUMN reopened_count     INT NOT NULL DEFAULT 0,
  ADD COLUMN resolution         TEXT,
  ADD COLUMN workaround         TEXT,
  ADD COLUMN legacy_hypercare_id BIGINT;
ALTER TABLE parent_queries ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE parent_queries ADD CONSTRAINT parent_queries_parent_has_student CHECK (desk <> 'parent' OR student_id IS NOT NULL);
CREATE INDEX parent_queries_desk ON parent_queries (school_id, desk, status, opened_at DESC);
CREATE INDEX parent_queries_due ON parent_queries (due_at) WHERE status IN ('open', 'in_progress') AND breached_at IS NULL;

ALTER TYPE author_kind ADD VALUE IF NOT EXISTS 'provider';

CREATE TABLE query_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  query_id      BIGINT NOT NULL REFERENCES parent_queries(id) ON DELETE CASCADE,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id BIGINT REFERENCES users(id),
  kind          TEXT NOT NULL,      -- created assigned replied note escalated breached closed reopened rated
  level         INT,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX query_events_by_query ON query_events (query_id, at);
CALL app.apply_tenant_rls('query_events');

-- ---- the SLA clock: add working hours (school days and hours, holidays skipped) -----------------------
CREATE OR REPLACE FUNCTION app.helpdesk_add_hours(p_from TIMESTAMPTZ, p_hours NUMERIC)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_days INT[];
  v_start TIME;
  v_end TIME;
  v_left NUMERIC := p_hours * 60;   -- minutes still to count
  v_t TIMESTAMP;                    -- India local time
  v_d DATE;
  v_s TIMESTAMP;
  v_e TIMESTAMP;
  v_avail NUMERIC;
  v_working BOOLEAN;
  i INT := 0;
BEGIN
  IF p_hours IS NULL OR p_from IS NULL THEN RETURN NULL; END IF;
  SELECT working_days, day_start, day_end INTO v_days, v_start, v_end FROM helpdesk_settings WHERE school_id = app.current_school_id();
  v_days := COALESCE(v_days, '{1,2,3,4,5,6}');
  v_start := COALESCE(v_start, '08:00');
  v_end := COALESCE(v_end, '16:00');
  v_t := p_from AT TIME ZONE 'Asia/Kolkata';
  WHILE i < 800 LOOP
    i := i + 1;
    v_d := v_t::date;
    v_working := EXTRACT(isodow FROM v_d)::int = ANY (v_days);
    IF EXISTS (SELECT 1 FROM holidays h WHERE v_d BETWEEN h.starts_on AND h.ends_on AND h.kind = 'working_day') THEN
      v_working := true;
    ELSIF EXISTS (SELECT 1 FROM holidays h WHERE v_d BETWEEN h.starts_on AND h.ends_on AND h.kind IN ('holiday', 'vacation') AND h.applies_to IN ('everyone', 'employees')) THEN
      v_working := false;
    END IF;
    IF v_working THEN
      v_s := v_d + v_start;
      v_e := v_d + v_end;
      IF v_t < v_s THEN v_t := v_s; END IF;
      IF v_t < v_e THEN
        v_avail := EXTRACT(epoch FROM (v_e - v_t)) / 60;
        IF v_avail >= v_left THEN
          RETURN (v_t + make_interval(secs => v_left * 60)) AT TIME ZONE 'Asia/Kolkata';
        END IF;
        v_left := v_left - v_avail;
      END IF;
    END IF;
    v_t := (v_d + 1)::timestamp;
  END LOOP;
  RETURN (v_t AT TIME ZONE 'Asia/Kolkata');
END
$$;

-- hours a ticket may spend at its current level
CREATE OR REPLACE FUNCTION app.helpdesk_level_hours(p_desk TEXT, p_code TEXT, p_level INT, p_priority TEXT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_level = 1 AND p_desk = 'provider' THEN
      COALESCE((SELECT (provider_sla ->> p_priority)::numeric FROM helpdesk_settings WHERE school_id = app.current_school_id()),
               (('{"urgent": 4, "high": 24, "normal": 72, "low": 168}'::jsonb) ->> p_priority)::numeric)
    WHEN p_level = 1 THEN (SELECT sla_hours FROM query_categories WHERE school_id = app.current_school_id() AND desk = p_desk AND code = p_code)
    ELSE (SELECT l.hours FROM helpdesk_levels l JOIN query_categories k ON k.id = l.head_id
           WHERE k.school_id = app.current_school_id() AND k.desk = p_desk AND k.code = p_code AND l.level = p_level)
  END
$$;

-- ---- notifications: mail and app push for the people of a level ----------------------------------------
CREATE OR REPLACE FUNCTION app.helpdesk_notify(p_query BIGINT, p_subject TEXT, p_html TEXT, p_emails TEXT[], p_user_ids BIGINT[], p_push_title TEXT, p_push_body TEXT, p_link TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT := 0;
  v_id BIGINT;
  v_addr TEXT;
  v_push BOOLEAN;
  r RECORD;
BEGIN
  FOR v_addr IN SELECT DISTINCT lower(btrim(a)) FROM unnest(COALESCE(p_emails, '{}')) AS a WHERE btrim(a) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' LOOP
    INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables)
    VALUES (app.current_school_id(), 'email', v_addr, left(p_subject, 200), p_html, 'html', 'queued', jsonb_build_object('helpdesk_query', p_query))
    RETURNING id INTO v_id;
    PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
      'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
    v_n := v_n + 1;
  END LOOP;
  -- app push only when Firebase is set up and the admin left "queries" on
  SELECT (p.active AND p.secret IS NOT NULL AND COALESCE((SELECT 'queries' = ANY (s.push_events) FROM comms_settings s LIMIT 1), true))
    INTO v_push FROM comms_providers p WHERE p.channel = 'push' AND p.provider = 'fcm';
  IF COALESCE(v_push, false) AND p_push_title IS NOT NULL THEN
    FOR r IN SELECT d.user_id, d.token FROM push_devices d WHERE d.user_id = ANY (COALESCE(p_user_ids, '{}')) AND d.revoked_at IS NULL LOOP
      INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, subject, body, status, variables)
      VALUES (app.current_school_id(), 'push', r.user_id, r.token, left(p_push_title, 200), left(p_push_body, 1000), 'queued',
              jsonb_build_object('link', p_link, 'event', 'queries', 'helpdesk_query', p_query))
      RETURNING id INTO v_id;
      PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
        'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
      v_n := v_n + 1;
    END LOOP;
  END IF;
  RETURN v_n;
END
$$;

-- the people behind a role in this school (active role holders) and their mail addresses
CREATE OR REPLACE FUNCTION app.helpdesk_role_people(p_role TEXT)
RETURNS TABLE (user_id BIGINT, email TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT u.id, COALESCE((SELECT e.email::text FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.email::text)
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
   WHERE ur.school_id = app.current_school_id() AND r.code = p_role AND ur.revoked_at IS NULL
     AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) AND u.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION app.helpdesk_user_email(p_user BIGINT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT e.email::text FROM employees e WHERE e.user_id = p_user AND e.deleted_at IS NULL LIMIT 1),
                  (SELECT u.email::text FROM users u WHERE u.id = p_user))
$$;

-- ---- routing on create, the clock restarting, and the timeline -----------------------------------------
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
CREATE TRIGGER parent_queries_helpdesk_before BEFORE INSERT OR UPDATE ON parent_queries
  FOR EACH ROW EXECUTE FUNCTION app.helpdesk_before_write();

CREATE OR REPLACE FUNCTION app.helpdesk_after_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'leave' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO query_events (school_id, query_id, actor_user_id, kind, level, detail)
    VALUES (NEW.school_id, NEW.id, NEW.raised_by_user_id, 'created', 1,
            jsonb_build_object('role', NEW.assigned_role, 'userId', NEW.assigned_user_id::text, 'dueAt', NEW.due_at));
    RETURN NEW;
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    INSERT INTO query_events (school_id, query_id, actor_user_id, kind, level) VALUES (NEW.school_id, NEW.id, app.current_user_id(), 'closed', NEW.level);
  ELSIF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    INSERT INTO query_events (school_id, query_id, actor_user_id, kind, level) VALUES (NEW.school_id, NEW.id, app.current_user_id(), 'reopened', NEW.level);
  END IF;
  IF NEW.level = OLD.level AND (NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id OR NEW.assigned_role IS DISTINCT FROM OLD.assigned_role) THEN
    INSERT INTO query_events (school_id, query_id, actor_user_id, kind, level, detail)
    VALUES (NEW.school_id, NEW.id, app.current_user_id(), 'assigned', NEW.level, jsonb_build_object('role', NEW.assigned_role, 'userId', NEW.assigned_user_id::text));
  END IF;
  IF NEW.rating IS NOT NULL AND OLD.rating IS DISTINCT FROM NEW.rating THEN
    INSERT INTO query_events (school_id, query_id, actor_user_id, kind, level, detail) VALUES (NEW.school_id, NEW.id, app.current_user_id(), 'rated', NEW.level, jsonb_build_object('rating', NEW.rating));
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER parent_queries_helpdesk_after AFTER INSERT OR UPDATE ON parent_queries
  FOR EACH ROW EXECUTE FUNCTION app.helpdesk_after_write();

CREATE OR REPLACE FUNCTION app.helpdesk_after_reply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO query_events (school_id, query_id, actor_user_id, kind, level, detail)
  SELECT NEW.school_id, NEW.query_id, NEW.author_user_id, CASE WHEN NEW.is_internal THEN 'note' ELSE 'replied' END, q.level,
         jsonb_build_object('files', jsonb_array_length(NEW.file_ids))
    FROM parent_queries q WHERE q.id = NEW.query_id AND q.kind <> 'leave';
  RETURN NEW;
END
$$;
CREATE TRIGGER query_responses_helpdesk AFTER INSERT ON query_responses
  FOR EACH ROW EXECUTE FUNCTION app.helpdesk_after_reply();

-- ---- escalation: every unresolved ticket past its due time moves up a level ----------------------------
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
      CASE q.desk WHEN 'provider' THEN 'ticket to the ERP provider' WHEN 'staff' THEN 'staff query' ELSE 'parent query' END,
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

-- ---- default heads for the staff and provider desks, settings for every school ------------------------
INSERT INTO helpdesk_settings (school_id) SELECT id FROM schools ON CONFLICT DO NOTHING;
INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
SELECT s.id, x.code, x.name, x.route_to, x.ord, 'staff', 'role', x.sla
  FROM schools s CROSS JOIN (VALUES
    ('payroll', 'Salary and payroll', 'school_admin', 1, 48),
    ('hr', 'HR, leave balance and documents', 'school_admin', 2, 48),
    ('it', 'IT, computer and login', 'school_admin', 3, 24),
    ('facilities', 'Facilities and maintenance', 'school_admin', 4, 48),
    ('academic', 'Academic and timetable', 'academic_coordinator', 5, 48),
    ('other', 'Other', 'school_admin', 9, 48)) AS x(code, name, route_to, ord, sla)
ON CONFLICT DO NOTHING;
INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
SELECT s.id, x.code, x.name, 'erp_support', x.ord, 'provider', 'provider', NULL
  FROM schools s CROSS JOIN (VALUES
    ('bug', 'Something is not working', 1),
    ('how_to', 'How do I…', 2),
    ('data_fix', 'Data correction', 3),
    ('access', 'Login and access', 4),
    ('feature', 'New feature or change', 5),
    ('other', 'Other', 9)) AS x(code, name, ord)
ON CONFLICT DO NOTHING;
-- the parent heads every school uses when it has none of its own yet
INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
SELECT s.id, x.code, x.name, x.route_to, x.ord, 'parent', CASE WHEN x.route_to = 'class_teacher' THEN 'class_teacher' ELSE 'role' END, 24
  FROM schools s CROSS JOIN (VALUES
    ('academics', 'Academics and homework', 'class_teacher', 1),
    ('attendance', 'Attendance', 'class_teacher', 2),
    ('fees', 'Fees and payments', 'accountant', 3),
    ('transport', 'Transport', 'school_admin', 4),
    ('admin', 'Office and documents', 'school_admin', 5),
    ('other', 'Other', 'class_teacher', 9)) AS x(code, name, route_to, ord)
 WHERE NOT EXISTS (SELECT 1 FROM query_categories k WHERE k.school_id = s.id AND k.desk = 'parent')
ON CONFLICT DO NOTHING;

-- ---- hypercare issues become provider tickets ------------------------------------------------------------
INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, student_id, raised_by_user_id, subject, body,
                            status, assigned_role, assigned_user_id, opened_at, first_response_at, closed_at, updated_at, request_id,
                            desk, priority, module, provider_status, channel, due_at, resolution, workaround, legacy_hypercare_id)
SELECT i.school_id,
       COALESCE((SELECT y.id FROM academic_years y WHERE y.school_id = i.school_id AND y.status = 'active' ORDER BY y.start_date DESC LIMIT 1),
                (SELECT y.id FROM academic_years y WHERE y.school_id = i.school_id ORDER BY y.start_date DESC LIMIT 1)),
       i.number, 'query', 'bug', NULL,
       COALESCE(i.reporter_user, (SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.school_id = i.school_id AND r.code = 'school_admin' ORDER BY ur.id LIMIT 1)),
       i.title, COALESCE(NULLIF(i.detail, ''), i.title),
       (CASE i.status WHEN 'open' THEN 'open' WHEN 'triaged' THEN 'in_progress' WHEN 'in_progress' THEN 'in_progress' WHEN 'fixed' THEN 'answered' ELSE 'closed' END)::query_status,
       COALESCE(i.assigned_role, 'erp_support'), i.assigned_user, i.created_at, i.first_response_at, i.closed_at, i.updated_at, i.request_id,
       'provider', CASE i.severity WHEN 's1' THEN 'urgent' WHEN 's2' THEN 'high' WHEN 's3' THEN 'normal' ELSE 'low' END,
       i.module, i.status, i.channel, i.due_at, i.resolution, i.workaround, i.id
  FROM hypercare_issues i
 WHERE NOT EXISTS (SELECT 1 FROM parent_queries p WHERE p.legacy_hypercare_id = i.id)
   AND EXISTS (SELECT 1 FROM academic_years y WHERE y.school_id = i.school_id);
INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, created_at)
SELECT u.school_id, p.id, u.author, 'staff', u.body, u.created_at
  FROM hypercare_updates u JOIN parent_queries p ON p.legacy_hypercare_id = u.issue_id
 WHERE u.body IS NOT NULL AND btrim(u.body) <> '';
INSERT INTO query_events (school_id, query_id, at, actor_user_id, kind, level, detail)
SELECT p.school_id, p.id, p.opened_at, p.raised_by_user_id, 'created', 1, jsonb_build_object('from', 'hypercare')
  FROM parent_queries p WHERE p.legacy_hypercare_id IS NOT NULL;

-- ---- the old employee queries become staff tickets (their own numbers kept) ------------------------------
INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, raised_by_user_id, subject, body,
                            status, assigned_role, opened_at, first_response_at, closed_at, updated_at, desk, employee_id, resolution, legacy_ref, request_id)
SELECT q.school_id,
       COALESCE((SELECT y.id FROM academic_years y WHERE y.school_id = q.school_id AND y.status = 'active' ORDER BY y.start_date DESC LIMIT 1),
                (SELECT y.id FROM academic_years y WHERE y.school_id = q.school_id ORDER BY y.start_date DESC LIMIT 1)),
       'S/EQ/' || lpad(q.id::text, 4, '0'), 'query',
       CASE q.category WHEN 'leave' THEN 'hr' WHEN 'grievance' THEN 'hr' WHEN 'payroll' THEN 'payroll' WHEN 'facilities' THEN 'facilities' ELSE 'other' END,
       e.user_id, q.subject, q.detail,
       (CASE WHEN q.status = 'pending' THEN 'open' ELSE 'closed' END)::query_status, 'school_admin',
       q.created_at, CASE WHEN q.answer IS NOT NULL THEN q.updated_at END, CASE WHEN q.status <> 'pending' THEN q.updated_at END, q.updated_at,
       'staff', q.employee_id, q.answer, 'employee_queries:' || q.id, q.request_id
  FROM employee_queries q JOIN employees e ON e.id = q.employee_id
 WHERE e.user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM academic_years y WHERE y.school_id = q.school_id)
   AND NOT EXISTS (SELECT 1 FROM parent_queries p WHERE p.legacy_ref = 'employee_queries:' || q.id);
INSERT INTO query_responses (school_id, query_id, author_kind, body, created_at)
SELECT p.school_id, p.id, 'staff', p.resolution, p.updated_at
  FROM parent_queries p WHERE p.legacy_ref LIKE 'employee_queries:%' AND p.resolution IS NOT NULL;
