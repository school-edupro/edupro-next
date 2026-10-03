-- 0064: appointment mails become designed HTML (school header, a details table, a coloured status line).
-- A confirmed appointment's mails (confirmed, new time, reminder) carry the gate QR inside the mail body
-- and the visitor ID card as a PDF attachment; the API makes both files when it confirms and records
-- them here. The email template of each message keeps the subject and works as the on / off switch.
ALTER TABLE appointments
  ADD COLUMN card_file_id BIGINT REFERENCES files(id),
  ADD COLUMN qr_file_id   BIGINT REFERENCES files(id);

CREATE OR REPLACE FUNCTION app.html_escape(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(COALESCE(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- one mail body: header band with the school, a title in the status colour, an opening line, a table of
-- label / value rows (jsonb array of [label, value]; empty values are left out), an optional inline image
-- (cid of an attached file) and a closing note. Tables and inline styles only, so mail programs keep it.
CREATE OR REPLACE FUNCTION app.mail_card_html(p_school TEXT, p_title TEXT, p_colour TEXT, p_intro TEXT, p_rows JSONB, p_image_cid TEXT, p_image_caption TEXT, p_note TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_rows TEXT := '';
  r JSONB;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    IF COALESCE(btrim(r ->> 1), '') <> '' THEN
      v_rows := v_rows || '<tr><td style="padding:8px 12px;border-bottom:1px solid #E5E9F0;color:#5B6676;font-size:13px;width:34%;vertical-align:top">'
        || app.html_escape(r ->> 0) || '</td><td style="padding:8px 12px;border-bottom:1px solid #E5E9F0;color:#0B1F3A;font-size:14px;font-weight:600;vertical-align:top">'
        || app.html_escape(r ->> 1) || '</td></tr>';
    END IF;
  END LOOP;
  RETURN '<!doctype html><html><body style="margin:0;padding:0;background:#F3F5F9">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:24px 0"><tr><td align="center">'
    || '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;font-family:Segoe UI,Arial,Helvetica,sans-serif">'
    || '<tr><td style="background:#00265D;color:#FFFFFF;padding:16px 24px;font-size:16px;font-weight:600">' || app.html_escape(p_school) || '</td></tr>'
    || '<tr><td style="padding:24px 24px 8px"><div style="font-size:20px;font-weight:700;color:' || p_colour || '">' || app.html_escape(p_title) || '</div>'
    || '<p style="margin:10px 0 0;color:#2B3545;font-size:15px;line-height:1.5">' || app.html_escape(p_intro) || '</p></td></tr>'
    || CASE WHEN v_rows <> '' THEN '<tr><td style="padding:12px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E9F0;border-radius:8px;border-collapse:separate">' || v_rows || '</table></td></tr>' ELSE '' END
    || CASE WHEN p_image_cid IS NOT NULL THEN '<tr><td align="center" style="padding:8px 24px 4px"><img src="cid:' || p_image_cid || '" width="190" height="190" alt="Gate pass QR code" style="display:block;border:1px solid #E5E9F0;border-radius:8px;padding:8px;background:#FFFFFF">'
        || '<div style="color:#5B6676;font-size:13px;margin-top:8px">' || app.html_escape(p_image_caption) || '</div></td></tr>' ELSE '' END
    || CASE WHEN COALESCE(btrim(p_note), '') <> '' THEN '<tr><td style="padding:8px 24px 4px;color:#2B3545;font-size:14px;line-height:1.5">' || app.html_escape(p_note) || '</td></tr>' ELSE '' END
    || '<tr><td style="padding:16px 24px 22px;color:#8791A0;font-size:12px;line-height:1.5">This is an automatic message from ' || app.html_escape(p_school) || '. Please do not reply to it.</td></tr>'
    || '</table></td></tr></table></body></html>';
END
$$;

-- the intimation for one appointment. SMS and WhatsApp go from their templates as before; the email is
-- the designed HTML with, for a confirmed appointment, the QR inline and the card PDF attached.
CREATE OR REPLACE FUNCTION app.appointment_notify(p_id BIGINT, p_event TEXT, p_reason TEXT DEFAULT NULL, p_link TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  a RECORD;
  s RECORD;
  t RECORD;
  v_vars JSONB;
  v_n INT := 0;
  v_code TEXT := 'appointment_' || p_event;
  v_host_mail TEXT;
  v_when TEXT;
  v_id BIGINT;
  v_subject TEXT;
  v_title TEXT;
  v_colour TEXT;
  v_intro TEXT;
  v_rows JSONB;
  v_files JSONB := '[]'::jsonb;
  v_pass BOOLEAN;
  k TEXT;
  v TEXT;
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
  SELECT notify_sms, notify_whatsapp, notify_email, instructions INTO s FROM appointment_settings WHERE school_id = app.current_school_id();
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

  v_rows := jsonb_build_array(
    jsonb_build_array('Appointment no.', a.number),
    jsonb_build_array('Name', a.visitor_name),
    jsonb_build_array('Student', a.student_name),
    jsonb_build_array('To meet', COALESCE(a.with_name, a.host_person, a.host_name)),
    jsonb_build_array('Date and time', v_when),
    jsonb_build_array('Where', a.place),
    jsonb_build_array('Purpose', a.purpose),
    jsonb_build_array('People', CASE WHEN a.party_size > 1 THEN a.party_size::text END),
    jsonb_build_array('Note from the school', p_reason));

  -- the requester's mail: only while the email template of this message is switched on
  SELECT id, subject INTO t FROM comms_templates
   WHERE school_id = app.current_school_id() AND code = v_code AND channel = 'email' AND status = 'active' AND deleted_at IS NULL;
  IF FOUND AND s.notify_email AND a.visitor_email IS NOT NULL AND btrim(a.visitor_email::text) <> '' THEN
    v_subject := COALESCE(t.subject, 'Appointment ' || a.number);
    FOR k, v IN SELECT key, value FROM jsonb_each_text(v_vars) LOOP
      v_subject := replace(v_subject, '{{' || k || '}}', COALESCE(v, ''));
    END LOOP;
    v_pass := p_event IN ('approved', 'rescheduled', 'reminder') AND a.qr_file_id IS NOT NULL;
    SELECT x.title, x.colour, x.intro INTO v_title, v_colour, v_intro FROM (VALUES
      ('requested', 'Request received', '#B26A00', 'We have received your appointment request. The school will confirm it shortly and send you the gate pass.'),
      ('approved', 'Appointment confirmed', '#1B7F4B', 'Your appointment is confirmed. Show the QR code below, or the attached visitor card, at the school gate on the day.'),
      ('rejected', 'Appointment not confirmed', '#B3261E', 'We are sorry, your appointment request could not be confirmed.'),
      ('rescheduled', 'Appointment moved to a new time', '#1B7F4B', 'Your appointment has a new time and is confirmed. Show the QR code below, or the attached visitor card, at the school gate on the day.'),
      ('cancelled', 'Appointment cancelled', '#5B6676', 'This appointment has been cancelled.'),
      ('reminder', 'Reminder: your appointment', '#00265D', 'This is a reminder of your appointment. Show the QR code below, or the attached visitor card, at the school gate.')
    ) AS x(event, title, colour, intro) WHERE x.event = p_event;
    IF v_pass THEN
      v_files := jsonb_build_array(jsonb_build_object('fileId', a.qr_file_id::text, 'name', 'appointment-qr.png', 'contentType', 'image/png'));
      IF a.card_file_id IS NOT NULL THEN
        v_files := v_files || jsonb_build_array(jsonb_build_object('fileId', a.card_file_id::text, 'name', 'visitor-card-' || a.number || '.pdf', 'contentType', 'application/pdf'));
      END IF;
    END IF;
    INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, format, status, variables, attachments)
    VALUES (app.current_school_id(), t.id, 'email', a.requested_by, lower(btrim(a.visitor_email::text)), left(v_subject, 200),
            app.mail_card_html(a.school_name, COALESCE(v_title, 'Appointment ' || a.number), COALESCE(v_colour, '#00265D'), COALESCE(v_intro, ''), v_rows,
              CASE WHEN v_pass THEN 'appointment-qr.png' END, 'Pass ' || COALESCE(a.pass_code, '') || ' · scan at the gate',
              CASE WHEN v_pass THEN s.instructions END),
            'html', 'queued', v_vars || jsonb_build_object('appointment', p_id), v_files)
    RETURNING id INTO v_id;
    PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
      'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
    v_n := v_n + 1;
  END IF;

  -- the person to be met hears about what lands in (or leaves) their calendar
  v_host_mail := COALESCE(a.with_email, a.host_email);
  IF s.notify_email AND p_event IN ('approved', 'rescheduled', 'cancelled') AND v_host_mail ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables)
    VALUES (app.current_school_id(), 'email', lower(v_host_mail),
            left('Appointment ' || a.number || ' ' || p_event || ': ' || COALESCE(a.visitor_name, a.student_name, '') || ', ' || v_when, 200),
            app.mail_card_html(a.school_name,
              CASE p_event WHEN 'approved' THEN 'An appointment with you is confirmed' WHEN 'rescheduled' THEN 'An appointment with you has a new time' ELSE 'An appointment with you is cancelled' END,
              CASE p_event WHEN 'cancelled' THEN '#5B6676' ELSE '#00265D' END,
              'The front desk has updated an appointment with you. It shows under My appointments.',
              v_rows || jsonb_build_array(jsonb_build_array('Coming from', a.visitor_org)), NULL, NULL, NULL),
            'html', 'queued', jsonb_build_object('appointment', p_id))
    RETURNING id INTO v_id;
    PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
      'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
    v_n := v_n + 1;
  END IF;
  RETURN v_n;
END
$$;
