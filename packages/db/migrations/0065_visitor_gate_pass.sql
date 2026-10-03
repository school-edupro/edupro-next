-- 0065: the visitor gate pass. A walk-in visitor (no appointment, so no date or slot) is registered at
-- the gate by the guard, or registers on their own phone from the gate QR and waits for the guard to let
-- them in. The entry keeps who came, from where, how many, the ID proof (kind and last four only), a live
-- photo, the vehicle, what equipment or material they carry, whom they meet and why. The person to be met
-- is told by mail as the visitor comes in. An appointment visitor checked in at the gate is in the same
-- register, so "inside now" is one list.
ALTER TABLE visitor_log
  ADD COLUMN number           TEXT,
  ADD COLUMN pass_code        TEXT,
  ADD COLUMN source           TEXT NOT NULL DEFAULT 'gate' CHECK (source IN ('gate', 'self', 'appointment')),
  ADD COLUMN state            TEXT NOT NULL DEFAULT 'inside' CHECK (state IN ('waiting', 'inside', 'left', 'cancelled')),
  ADD COLUMN visitor_type     TEXT,
  ADD COLUMN party_size       INT NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 50),
  ADD COLUMN id_proof_last4   TEXT CHECK (id_proof_last4 IS NULL OR id_proof_last4 ~ '^[A-Za-z0-9]{4}$'),
  ADD COLUMN email            CITEXT,
  ADD COLUMN vehicle_no       TEXT,
  ADD COLUMN equipment        TEXT,
  ADD COLUMN host_id          BIGINT REFERENCES appointment_hosts(id),
  ADD COLUMN with_employee_id BIGINT REFERENCES employees(id),
  ADD COLUMN gate             TEXT,
  ADD COLUMN exit_gate        TEXT,
  ADD COLUMN exit_note        TEXT,
  ADD COLUMN applicant_id     BIGINT REFERENCES applicants(id),
  ADD COLUMN appointment_id   BIGINT REFERENCES appointments(id),
  ADD COLUMN out_by           BIGINT REFERENCES users(id);
-- a visitor who registered on their own phone has no "in" time until the guard lets them in
ALTER TABLE visitor_log ALTER COLUMN in_at DROP NOT NULL;
ALTER TABLE visitor_log ALTER COLUMN in_at DROP DEFAULT;

UPDATE visitor_log v SET
  state = CASE WHEN v.out_at IS NULL THEN 'inside' ELSE 'left' END,
  number = 'V-' || to_char(v.created_at AT TIME ZONE 'Asia/Kolkata', 'YYMM') || '-' || lpad(v.id::text, 4, '0');
UPDATE visitor_log v SET source = 'appointment', appointment_id = a.id, host_id = a.host_id, with_employee_id = a.with_employee_id,
       party_size = a.party_size, id_proof_last4 = a.id_proof_last4, email = a.visitor_email, pass_code = a.pass_code
  FROM appointments a WHERE a.visitor_log_id = v.id;

INSERT INTO appointment_counters (school_id, period, last)
SELECT school_id, 'V' || to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYMM'), max(id)::int FROM visitor_log GROUP BY 1, 2
ON CONFLICT DO NOTHING;

-- every entry gets its number (V-<yymm>-<serial>), its in time when it starts inside, and a pass code
CREATE OR REPLACE FUNCTION app.visitor_log_defaults() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_period TEXT := 'V' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM');
  v_n INT;
BEGIN
  IF NEW.number IS NULL THEN
    INSERT INTO appointment_counters (school_id, period, last) VALUES (NEW.school_id, v_period, 1)
    ON CONFLICT (school_id, period) DO UPDATE SET last = appointment_counters.last + 1
    RETURNING last INTO v_n;
    NEW.number := 'V-' || substr(v_period, 2) || '-' || lpad(v_n::text, 4, '0');
  END IF;
  IF NEW.state = 'inside' AND NEW.in_at IS NULL THEN NEW.in_at := now(); END IF;
  IF NEW.pass_code IS NULL THEN
    NEW.pass_code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=01OIl', 'XYZ23456'), 1, 10));
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER visitor_log_defaults BEFORE INSERT ON visitor_log
  FOR EACH ROW EXECUTE FUNCTION app.visitor_log_defaults();

UPDATE visitor_log SET pass_code = upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=01OIl', 'XYZ23456'), 1, 10))
 WHERE pass_code IS NULL;
ALTER TABLE visitor_log ALTER COLUMN number SET NOT NULL;
ALTER TABLE visitor_log ADD CONSTRAINT visitor_log_number_unique UNIQUE (school_id, number);
CREATE INDEX visitor_log_by_state ON visitor_log (school_id, state, created_at DESC);
CREATE INDEX visitor_log_by_mobile ON visitor_log (school_id, mobile, created_at DESC) WHERE mobile IS NOT NULL;

CREATE TABLE visitor_photos (
  visitor_log_id BIGINT PRIMARY KEY REFERENCES visitor_log(id) ON DELETE CASCADE,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  content_type   TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes          BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 100 AND 300000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('visitor_photos');

-- the lists the gate picks from, and whether a visitor may register on their own phone
ALTER TABLE appointment_settings
  ADD COLUMN visitor_types        TEXT[] NOT NULL DEFAULT ARRAY['Parent', 'Vendor or supplier', 'Contractor or worker', 'Official', 'Courier or delivery', 'Interview candidate', 'Other'],
  ADD COLUMN gates                TEXT[] NOT NULL DEFAULT ARRAY['Main gate'],
  ADD COLUMN visitor_self_enabled BOOLEAN NOT NULL DEFAULT true;

-- the person to be met is told that the visitor has come in
CREATE OR REPLACE FUNCTION app.visitor_notify(p_id BIGINT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v RECORD;
  v_mail TEXT;
  v_id BIGINT;
BEGIN
  SELECT vl.*, h.name AS host_name, e.display_name AS with_name, e.email::text AS with_email,
         he.display_name AS host_person, he.email::text AS host_email, sc.name AS school_name,
         COALESCE((SELECT s.notify_email FROM appointment_settings s WHERE s.school_id = vl.school_id), true) AS notify_email
    INTO v
    FROM visitor_log vl
    JOIN schools sc ON sc.id = vl.school_id
    LEFT JOIN appointment_hosts h ON h.id = vl.host_id
    LEFT JOIN employees e ON e.id = vl.with_employee_id
    LEFT JOIN employees he ON he.id = h.employee_id
   WHERE vl.id = p_id;
  IF NOT FOUND OR NOT v.notify_email THEN RETURN 0; END IF;
  v_mail := COALESCE(v.with_email, v.host_email);
  IF v_mail IS NULL OR v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN 0; END IF;
  INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables)
  VALUES (app.current_school_id(), 'email', lower(v_mail),
          left('Visitor at the gate for you: ' || v.visitor_name || ' (' || v.number || ')', 200),
          app.mail_card_html(v.school_name, 'A visitor has come to meet you', '#00265D',
            'The gate has let this visitor in to meet you.',
            jsonb_build_array(
              jsonb_build_array('Visitor', v.visitor_name),
              jsonb_build_array('Type', v.visitor_type),
              jsonb_build_array('Coming from', v.organisation),
              jsonb_build_array('Mobile', v.mobile),
              jsonb_build_array('People', CASE WHEN v.party_size > 1 THEN v.party_size::text END),
              jsonb_build_array('Purpose', v.purpose),
              jsonb_build_array('Carrying', v.equipment),
              jsonb_build_array('Vehicle', v.vehicle_no),
              jsonb_build_array('Came in', to_char(v.in_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')),
              jsonb_build_array('Gate', v.gate),
              jsonb_build_array('Pass no.', v.number)),
            NULL, NULL, NULL),
          'html', 'queued', jsonb_build_object('visitor', p_id))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN 1;
END
$$;
