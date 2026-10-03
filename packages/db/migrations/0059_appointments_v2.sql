-- 0059: appointments v2. Fixed slots per person or desk (visiting days and hours set by the admin), three
-- ways in (a parent in the app, an outside visitor from the school's QR code after a mobile OTP, the front
-- desk for walk-ins and calls), one front-desk queue that approves, rejects or reschedules with an
-- intimation by SMS / WhatsApp / email, a calendar and dashboard, and a pass code that becomes the
-- visitor-log entry at the gate.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('engagement.appointment_setup.manage', 'engagement', 'Appointment set-up: who can be met, visiting hours, slots, visitor details, messages', false),
  ('engagement.appointment.checkin', 'engagement', 'Check appointment visitors in and out at the gate', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.appointment_setup.manage'), ('engagement.appointment.checkin')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
-- whoever decides appointments or keeps the visitor log may also check visitors in
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'engagement.appointment.checkin' FROM role_permissions rp
 WHERE rp.permission_code IN ('engagement.appointment.decide', 'engagement.visitor.manage')
ON CONFLICT DO NOTHING;

-- ---- set-up -------------------------------------------------------------------------------------------
CREATE TABLE appointment_settings (
  school_id        BIGINT PRIMARY KEY REFERENCES schools(id),
  public_enabled   BOOLEAN NOT NULL DEFAULT true,              -- outside visitors may book from the QR code
  auto_approve     BOOLEAN NOT NULL DEFAULT false,             -- a free slot is confirmed without the front desk
  min_notice_hours INT NOT NULL DEFAULT 2 CHECK (min_notice_hours BETWEEN 0 AND 168),
  max_days_ahead   INT NOT NULL DEFAULT 14 CHECK (max_days_ahead BETWEEN 1 AND 90),
  max_party        INT NOT NULL DEFAULT 4 CHECK (max_party BETWEEN 1 AND 20),
  ask_organisation TEXT NOT NULL DEFAULT 'optional' CHECK (ask_organisation IN ('off', 'optional', 'required')),
  ask_id_proof     TEXT NOT NULL DEFAULT 'required' CHECK (ask_id_proof IN ('off', 'optional', 'required')),
  ask_photo        TEXT NOT NULL DEFAULT 'required' CHECK (ask_photo IN ('off', 'optional', 'required')),
  id_proof_kinds   TEXT[] NOT NULL DEFAULT ARRAY['Aadhaar', 'Driving licence', 'PAN', 'Voter ID', 'Passport'],
  purposes         TEXT[] NOT NULL DEFAULT ARRAY['Admission enquiry', 'Fees and accounts', 'Meet a teacher', 'Vendor or supplier', 'Official visit', 'Other'],
  notify_sms       BOOLEAN NOT NULL DEFAULT true,
  notify_whatsapp  BOOLEAN NOT NULL DEFAULT true,
  notify_email     BOOLEAN NOT NULL DEFAULT true,
  reminder_hours   INT NOT NULL DEFAULT 2 CHECK (reminder_hours BETWEEN 0 AND 72),      -- 0 = no reminder
  no_show_minutes  INT NOT NULL DEFAULT 60 CHECK (no_show_minutes BETWEEN 10 AND 600),
  closed_dates     DATE[] NOT NULL DEFAULT '{}',               -- besides the school holidays
  instructions     TEXT,                                        -- shown on the booking page and the pass
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT
);
CALL app.apply_tenant_rls('appointment_settings');

-- who can be met: a desk (Admissions, Accounts...), a named person, or "the child's class teacher"
CREATE TABLE appointment_hosts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'desk' CHECK (kind IN ('desk', 'person', 'class_teacher')),
  employee_id  BIGINT REFERENCES employees(id),
  location     TEXT,
  open_public  BOOLEAN NOT NULL DEFAULT true,
  open_parent  BOOLEAN NOT NULL DEFAULT true,
  slot_minutes INT NOT NULL DEFAULT 20 CHECK (slot_minutes BETWEEN 5 AND 240),
  capacity     INT NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 50),   -- bookings one slot takes
  sort_order   INT NOT NULL DEFAULT 0,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  UNIQUE (school_id, name),
  CHECK (kind <> 'person' OR employee_id IS NOT NULL),
  CHECK (kind <> 'class_teacher' OR NOT open_public)           -- an outsider has no child in the school
);
CALL app.apply_tenant_rls('appointment_hosts');

CREATE TABLE appointment_host_hours (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  host_id   BIGINT NOT NULL REFERENCES appointment_hosts(id) ON DELETE CASCADE,
  weekday   INT NOT NULL CHECK (weekday BETWEEN 1 AND 7),      -- ISO weekday, Monday = 1
  starts    TIME NOT NULL,
  ends      TIME NOT NULL,
  CHECK (ends > starts)
);
CREATE INDEX appointment_host_hours_by_host ON appointment_host_hours (host_id, weekday);
CALL app.apply_tenant_rls('appointment_host_hours');

-- ---- appointments -------------------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN number            TEXT,
  ADD COLUMN source            TEXT NOT NULL DEFAULT 'parent' CHECK (source IN ('parent', 'public', 'front_desk')),
  ADD COLUMN state             TEXT NOT NULL DEFAULT 'requested'
                               CHECK (state IN ('requested', 'approved', 'rejected', 'cancelled', 'checked_in', 'completed', 'no_show')),
  ADD COLUMN host_id           BIGINT REFERENCES appointment_hosts(id),
  ADD COLUMN starts_at         TIMESTAMPTZ,
  ADD COLUMN ends_at           TIMESTAMPTZ,
  ADD COLUMN visitor_name      TEXT,
  ADD COLUMN visitor_mobile    TEXT,
  ADD COLUMN visitor_email     CITEXT,
  ADD COLUMN visitor_org       TEXT,
  ADD COLUMN party_size        INT NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 20),
  ADD COLUMN id_proof_kind     TEXT,
  ADD COLUMN id_proof_last4    TEXT CHECK (id_proof_last4 IS NULL OR id_proof_last4 ~ '^[A-Za-z0-9]{4}$'),  -- never the full number
  ADD COLUMN applicant_id      BIGINT REFERENCES applicants(id),    -- the OTP-verified outside visitor
  ADD COLUMN pass_code         TEXT,
  ADD COLUMN decided_by        BIGINT REFERENCES users(id),
  ADD COLUMN decided_at        TIMESTAMPTZ,
  ADD COLUMN reschedule_count  INT NOT NULL DEFAULT 0,
  ADD COLUMN previous_starts_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason     TEXT,
  ADD COLUMN checked_in_at     TIMESTAMPTZ,
  ADD COLUMN checked_out_at    TIMESTAMPTZ,
  ADD COLUMN visitor_log_id    BIGINT REFERENCES visitor_log(id),
  ADD COLUMN reminder_sent_at  TIMESTAMPTZ,
  ADD COLUMN booked_by         BIGINT REFERENCES users(id);         -- front desk person who booked it
ALTER TABLE appointments ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN with_kind DROP NOT NULL;

-- the earlier requests keep their decision; a confirmed one keeps its time
UPDATE appointments SET
  state = CASE status::text WHEN 'pending' THEN 'requested' WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'cancelled' END,
  starts_at = confirmed_at,
  ends_at = confirmed_at + interval '20 minutes',
  number = 'APT-' || to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYMM') || '-' || lpad(id::text, 4, '0'),
  visitor_name = (SELECT u.display_name FROM users u WHERE u.id = appointments.requested_by),
  visitor_mobile = (SELECT u.mobile FROM users u WHERE u.id = appointments.requested_by),
  visitor_email = (SELECT u.email FROM users u WHERE u.id = appointments.requested_by);

ALTER TABLE appointments ALTER COLUMN number SET NOT NULL;
ALTER TABLE appointments ADD CONSTRAINT appointments_number_unique UNIQUE (school_id, number);
ALTER TABLE appointments ADD CONSTRAINT appointments_who CHECK (student_id IS NOT NULL OR visitor_name IS NOT NULL);
CREATE UNIQUE INDEX appointments_pass_code ON appointments (school_id, pass_code) WHERE pass_code IS NOT NULL;
CREATE INDEX appointments_by_day ON appointments (school_id, starts_at) WHERE starts_at IS NOT NULL;
CREATE INDEX appointments_by_state ON appointments (school_id, state, created_at DESC);
CREATE INDEX appointments_by_applicant ON appointments (applicant_id) WHERE applicant_id IS NOT NULL;
-- the slot a booking holds (requested, approved or already arrived)
CREATE INDEX appointments_slot ON appointments (host_id, starts_at) WHERE state IN ('requested', 'approved', 'checked_in');

-- the visitor's photo, made small in the browser before it is sent (shown on the pass and at the gate)
CREATE TABLE appointment_photos (
  appointment_id BIGINT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  content_type   TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes          BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 100 AND 300000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('appointment_photos');

CREATE TABLE appointment_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  BIGINT REFERENCES users(id),
  kind           TEXT NOT NULL,   -- requested approved rejected rescheduled cancelled checked_in checked_out no_show reminded
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX appointment_events_by_appointment ON appointment_events (appointment_id, at);
CALL app.apply_tenant_rls('appointment_events');

-- numbers: APT-<yymm>-<serial>, per school and month
CREATE TABLE appointment_counters (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  period    TEXT NOT NULL,
  last      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, period)
);
CALL app.apply_tenant_rls('appointment_counters');
INSERT INTO appointment_counters (school_id, period, last)
SELECT school_id, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYMM'), max(id)::int FROM appointments GROUP BY 1, 2
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.next_appointment_no() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_period TEXT := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM');
  v_n INT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO appointment_counters (school_id, period, last) VALUES (app.current_school_id(), v_period, 1)
  ON CONFLICT (school_id, period) DO UPDATE SET last = appointment_counters.last + 1
  RETURNING last INTO v_n;
  RETURN 'APT-' || v_period || '-' || lpad(v_n::text, 4, '0');
END
$$;

-- ---- message templates --------------------------------------------------------------------------------
-- The school edits the wording, adds its DLT ids (SMS) and approved WhatsApp template names under
-- Communication > Templates. A channel is used only while its template is active.
CREATE OR REPLACE FUNCTION app.appointment_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name,
         CASE WHEN ch.channel = 'email' THEN t.subject END, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('appointment_otp', 'Appointment: one-time code', 'Your code for {{school}}',
       '{{otp}} is your one-time code for {{school}}. It is valid for {{minutes}} minutes. Do not share it.',
       '["otp","school","minutes"]'),
      ('appointment_requested', 'Appointment: request received', 'Appointment request {{number}} received',
       'Dear {{name}}, your appointment request {{number}} with {{host}} on {{date}} at {{time}} is received. {{school}} will confirm it shortly.',
       '["name","number","host","date","time","school"]'),
      ('appointment_approved', 'Appointment: confirmed', 'Appointment {{number}} confirmed',
       'Dear {{name}}, your appointment {{number}} with {{host}} is confirmed for {{date}} at {{time}}{{place}}. Show this pass at the gate: {{link}} - {{school}}',
       '["name","number","host","date","time","place","link","school"]'),
      ('appointment_rejected', 'Appointment: not confirmed', 'Appointment {{number}} could not be confirmed',
       'Dear {{name}}, your appointment request {{number}} with {{host}} on {{date}} could not be confirmed. {{reason}} - {{school}}',
       '["name","number","host","date","reason","school"]'),
      ('appointment_rescheduled', 'Appointment: new time', 'Appointment {{number}} moved to {{date}} {{time}}',
       'Dear {{name}}, your appointment {{number}} with {{host}} is moved to {{date}} at {{time}}{{place}}. {{reason}} Pass: {{link}} - {{school}}',
       '["name","number","host","date","time","place","reason","link","school"]'),
      ('appointment_cancelled', 'Appointment: cancelled', 'Appointment {{number}} cancelled',
       'Dear {{name}}, your appointment {{number}} with {{host}} on {{date}} at {{time}} is cancelled. {{reason}} - {{school}}',
       '["name","number","host","date","time","reason","school"]'),
      ('appointment_reminder', 'Appointment: reminder', 'Reminder: appointment {{number}} today at {{time}}',
       'Reminder: your appointment {{number}} with {{host}} is on {{date}} at {{time}}{{place}}. Pass: {{link}} - {{school}}',
       '["name","number","host","date","time","place","link","school"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
   WHERE NOT (t.code = 'appointment_otp' AND ch.channel = 'email')
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- a new school gets its settings, a starting list of desks with visiting hours and the templates the
-- first time appointments are used; the API calls this before reading the set-up
CREATE OR REPLACE FUNCTION app.appointment_ensure_defaults() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_host BIGINT;
  r RECORD;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO appointment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM appointment_hosts WHERE school_id = app.current_school_id()) THEN
    FOR r IN SELECT * FROM (VALUES
        ('Front office', 'desk', true, true, 15, 2, 1, '09:00'::time, '13:00'::time, ARRAY[1, 2, 3, 4, 5, 6]),
        ('Admissions desk', 'desk', true, true, 20, 1, 2, '09:30'::time, '12:30'::time, ARRAY[1, 2, 3, 4, 5, 6]),
        ('Accounts office', 'desk', true, true, 15, 1, 3, '09:30'::time, '12:30'::time, ARRAY[1, 2, 3, 4, 5]),
        ('Principal', 'desk', true, true, 20, 1, 4, '10:00'::time, '12:00'::time, ARRAY[2, 4]),
        ('Class teacher', 'class_teacher', false, true, 15, 1, 5, '14:00'::time, '15:00'::time, ARRAY[1, 2, 3, 4, 5])
      ) AS x(name, kind, open_public, open_parent, slot_minutes, capacity, ord, starts, ends, days)
    LOOP
      INSERT INTO appointment_hosts (school_id, name, kind, open_public, open_parent, slot_minutes, capacity, sort_order)
      VALUES (app.current_school_id(), r.name, r.kind, r.open_public, r.open_parent, r.slot_minutes, r.capacity, r.ord)
      RETURNING id INTO v_host;
      INSERT INTO appointment_host_hours (school_id, host_id, weekday, starts, ends)
      SELECT app.current_school_id(), v_host, d, r.starts, r.ends FROM unnest(r.days) AS d;
    END LOOP;
  END IF;
  PERFORM app.appointment_seed_templates(app.current_school_id());
END
$$;

-- ---- sending ------------------------------------------------------------------------------------------
-- one message from a template: {{name}} placeholders filled from p_vars; nothing is sent when the
-- template is missing or switched off, so a school turns a channel off by making its template inactive
CREATE OR REPLACE FUNCTION app.send_template(p_code TEXT, p_channel TEXT, p_address TEXT, p_vars JSONB, p_user BIGINT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  t RECORD;
  v_body TEXT;
  v_subject TEXT;
  v_id BIGINT;
  k TEXT;
  v TEXT;
BEGIN
  IF p_address IS NULL OR btrim(p_address) = '' THEN RETURN NULL; END IF;
  SELECT id, subject, body, format INTO t FROM comms_templates
   WHERE school_id = app.current_school_id() AND code = p_code AND channel = p_channel::comms_channel AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_body := t.body;
  v_subject := t.subject;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    IF t.format = 'html' THEN
      v := replace(replace(replace(v, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    END IF;
    v_body := replace(v_body, '{{' || k || '}}', COALESCE(v, ''));
    v_subject := replace(v_subject, '{{' || k || '}}', COALESCE(v, ''));
  END LOOP;
  INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, format, status, variables)
  VALUES (app.current_school_id(), t.id, p_channel::comms_channel, p_user, btrim(p_address), left(v_subject, 200),
          btrim(regexp_replace(v_body, '\s{2,}', ' ', 'g')), t.format, 'queued', COALESCE(p_vars, '{}'::jsonb))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN v_id;
END
$$;

-- the one-time code of the public pages (booking an appointment, admissions) by SMS and WhatsApp
CREATE OR REPLACE FUNCTION app.public_otp_send(p_mobile TEXT, p_code TEXT, p_minutes INT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_vars JSONB;
  v_n INT := 0;
  s RECORD;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.appointment_seed_templates(app.current_school_id());
  SELECT COALESCE(a.notify_sms, true) AS sms, COALESCE(a.notify_whatsapp, true) AS wa INTO s
    FROM (SELECT 1) one LEFT JOIN appointment_settings a ON a.school_id = app.current_school_id();
  v_vars := jsonb_build_object('otp', p_code, 'minutes', p_minutes::text,
                               'school', (SELECT name FROM schools WHERE id = app.current_school_id()));
  IF s.sms AND app.send_template('appointment_otp', 'sms', p_mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.wa AND app.send_template('appointment_otp', 'whatsapp', p_mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  RETURN v_n;
END
$$;

-- the intimation for one appointment: requested, approved, rejected, rescheduled, cancelled, reminder.
-- The requester gets SMS / WhatsApp / email as the settings allow; the person to be met gets an email.
CREATE OR REPLACE FUNCTION app.appointment_notify(p_id BIGINT, p_event TEXT, p_reason TEXT DEFAULT NULL, p_link TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  a RECORD;
  s RECORD;
  v_vars JSONB;
  v_n INT := 0;
  v_code TEXT := 'appointment_' || p_event;
  v_host_mail TEXT;
  v_when TEXT;
  v_id BIGINT;
BEGIN
  SELECT ap.*, h.name AS host_name, COALESCE(ap.location, h.location) AS place, e.display_name AS with_name, e.email::text AS with_email,
         he.display_name AS host_person, he.email::text AS host_email, st.display_name AS student_name, sc.name AS school_name
    INTO a
    FROM appointments ap
    JOIN schools sc ON sc.id = ap.school_id
    LEFT JOIN appointment_hosts h ON h.id = ap.host_id
    LEFT JOIN employees e ON e.id = ap.with_employee_id
    LEFT JOIN employees he ON he.id = h.employee_id
    LEFT JOIN students st ON st.id = ap.student_id
   WHERE ap.id = p_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  INSERT INTO appointment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  SELECT notify_sms, notify_whatsapp, notify_email INTO s FROM appointment_settings WHERE school_id = app.current_school_id();
  v_when := COALESCE(to_char(a.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), '');
  v_vars := jsonb_build_object(
    'name', COALESCE(a.visitor_name, 'Sir / Madam'),
    'number', a.number,
    'host', COALESCE(a.with_name, a.host_person, a.host_name, 'the school'),
    'date', COALESCE(to_char(a.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY'), ''),
    'time', COALESCE(to_char(a.starts_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), ''),
    'place', CASE WHEN a.place IS NOT NULL AND btrim(a.place) <> '' THEN ' at ' || a.place ELSE '' END,
    'reason', COALESCE(p_reason, ''),
    'link', COALESCE(p_link, ''),
    'school', a.school_name);
  IF s.notify_sms AND app.send_template(v_code, 'sms', a.visitor_mobile, v_vars, a.requested_by) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.notify_whatsapp AND app.send_template(v_code, 'whatsapp', a.visitor_mobile, v_vars, a.requested_by) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.notify_email AND app.send_template(v_code, 'email', a.visitor_email::text, v_vars, a.requested_by) IS NOT NULL THEN v_n := v_n + 1; END IF;

  -- the person to be met hears about what lands in (or leaves) their calendar
  v_host_mail := COALESCE(a.with_email, a.host_email);
  IF s.notify_email AND p_event IN ('approved', 'rescheduled', 'cancelled') AND v_host_mail ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables)
    VALUES (app.current_school_id(), 'email', lower(v_host_mail),
            left('Appointment ' || a.number || ' ' || p_event || ': ' || COALESCE(a.visitor_name, a.student_name, '') || ', ' || v_when, 200),
            'Appointment ' || a.number || ' is ' || p_event || '.' || E'\n' ||
            'Visitor: ' || COALESCE(a.visitor_name, '') || COALESCE(' (' || a.visitor_org || ')', '') ||
            COALESCE(E'\nStudent: ' || a.student_name, '') || E'\n' ||
            'When: ' || v_when || COALESCE(E'\nWhere: ' || a.place, '') || E'\n' ||
            'Purpose: ' || a.purpose || COALESCE(E'\nNote: ' || NULLIF(p_reason, ''), ''),
            'text', 'queued', jsonb_build_object('appointment', p_id))
    RETURNING id INTO v_id;
    PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
      'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
    v_n := v_n + 1;
  END IF;
  RETURN v_n;
END
$$;

-- every five minutes (workers): reminders before the visit, visits nobody came to become no-shows, and
-- the one-time codes are wiped from the message log once they have expired
CREATE OR REPLACE FUNCTION app.appointment_tick(p_base_url TEXT DEFAULT NULL) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  s RECORD;
  r RECORD;
  v_n INT := 0;
  v_code TEXT;
BEGIN
  PERFORM app.assert_context();
  SELECT reminder_hours, no_show_minutes INTO s FROM appointment_settings WHERE school_id = app.current_school_id();
  IF FOUND THEN
    SELECT code INTO v_code FROM schools WHERE id = app.current_school_id();
    IF s.reminder_hours > 0 THEN
      FOR r IN SELECT id, pass_code FROM appointments
                WHERE state = 'approved' AND reminder_sent_at IS NULL AND starts_at > now()
                  AND starts_at <= now() + make_interval(hours => s.reminder_hours)
                  AND decided_at < starts_at - make_interval(hours => s.reminder_hours)   -- not the ones just confirmed
                FOR UPDATE SKIP LOCKED LOOP
        UPDATE appointments SET reminder_sent_at = now() WHERE id = r.id;
        PERFORM app.appointment_notify(r.id, 'reminder', NULL,
          CASE WHEN p_base_url IS NOT NULL AND r.pass_code IS NOT NULL THEN p_base_url || '/' || lower(v_code) || '/pass/' || r.pass_code END);
        INSERT INTO appointment_events (school_id, appointment_id, kind) VALUES (app.current_school_id(), r.id, 'reminded');
        v_n := v_n + 1;
      END LOOP;
    END IF;
    FOR r IN UPDATE appointments SET state = 'no_show', updated_at = now()
              WHERE state = 'approved' AND starts_at < now() - make_interval(mins => s.no_show_minutes)
              RETURNING id LOOP
      INSERT INTO appointment_events (school_id, appointment_id, kind) VALUES (app.current_school_id(), r.id, 'no_show');
      v_n := v_n + 1;
    END LOOP;
    -- a request nobody decided before its time has passed is closed, so the slot list stays clean
    FOR r IN UPDATE appointments SET state = 'cancelled', status = 'cancelled', cancel_reason = 'Not confirmed before the requested time', updated_at = now()
              WHERE state = 'requested' AND starts_at IS NOT NULL AND starts_at < now()
              RETURNING id LOOP
      INSERT INTO appointment_events (school_id, appointment_id, kind, detail)
      VALUES (app.current_school_id(), r.id, 'cancelled', jsonb_build_object('reason', 'expired'));
      v_n := v_n + 1;
    END LOOP;
  END IF;
  UPDATE comms_messages m SET body = regexp_replace(m.body, '\d{6}', '******'), variables = m.variables - 'otp'
    FROM comms_templates t
   WHERE t.id = m.template_id AND t.code = 'appointment_otp' AND m.created_at < now() - interval '15 minutes' AND m.variables ? 'otp';
  RETURN v_n;
END
$$;

-- every existing school starts with the settings and the templates (its desks come with the first use)
SELECT app.appointment_seed_templates(id) FROM schools;
INSERT INTO appointment_settings (school_id) SELECT id FROM schools ON CONFLICT DO NOTHING;
