-- 0202: careers emails and the application PDF (docs/design/34-recruitment.md, part 7). The emails to a
-- candidate (the sign-in code, application received, a stage scheduled, selected, not taken forward) are
-- designed HTML: the school's name band, a title, the code in a large box or the details as rows, a note,
-- and the school's address and contact at the foot. SMS and WhatsApp go from their templates as before;
-- the email's subject is the school's template subject, and switching the email template off stops it.
-- An application keeps the PDF made when it is sent, which the "received" email carries.
ALTER TABLE job_applications ADD COLUMN pdf_file_id BIGINT REFERENCES files(id);

CREATE OR REPLACE FUNCTION app.recruitment_mail_html(p_title TEXT, p_intro TEXT, p_code TEXT, p_rows JSONB, p_note TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  s RECORD;
  v_rows TEXT := '';
  v_foot TEXT;
  r JSONB;
BEGIN
  SELECT name,
         NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'line2'), ''),
                NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), ''),
                NULLIF(btrim(COALESCE(address->>'pincode', address->>'pin')), '')), '') AS address,
         NULLIF(btrim(contact->>'phone'), '') AS phone, NULLIF(btrim(contact->>'email'), '') AS email,
         NULLIF(btrim(contact->>'website'), '') AS website
    INTO s FROM schools WHERE id = app.current_school_id();
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    IF COALESCE(btrim(r ->> 1), '') <> '' THEN
      v_rows := v_rows || '<tr><td style="padding:9px 14px;border-bottom:1px solid #E5E9F0;color:#5B6676;font-size:13px;width:38%;vertical-align:top">'
        || app.html_escape(r ->> 0) || '</td><td style="padding:9px 14px;border-bottom:1px solid #E5E9F0;color:#0B1F3A;font-size:14px;font-weight:600;vertical-align:top">'
        || app.html_escape(r ->> 1) || '</td></tr>';
    END IF;
  END LOOP;
  v_foot := '<strong style="color:#0B1F3A">' || app.html_escape(s.name) || '</strong>'
    || CASE WHEN s.address IS NOT NULL THEN '<br>' || app.html_escape(s.address) ELSE '' END
    || CASE WHEN COALESCE(s.phone, s.email, s.website) IS NOT NULL THEN '<br>'
         || concat_ws(' &middot; ',
              CASE WHEN s.phone IS NOT NULL THEN 'Phone ' || app.html_escape(s.phone) END,
              CASE WHEN s.email IS NOT NULL THEN '<a href="mailto:' || app.html_escape(s.email) || '" style="color:#007A9B">' || app.html_escape(s.email) || '</a>' END,
              CASE WHEN s.website IS NOT NULL THEN app.html_escape(s.website) END)
       ELSE '' END;
  RETURN '<!doctype html><html><body style="margin:0;padding:0;background:#F3F5F9">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:24px 12px"><tr><td align="center">'
    || '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;font-family:Segoe UI,Arial,Helvetica,sans-serif">'
    || '<tr><td style="background:#00265D;color:#FFFFFF;padding:18px 24px;font-size:17px;font-weight:700">' || app.html_escape(s.name)
    || '<div style="font-size:12px;font-weight:400;color:#C9D6EA;margin-top:2px">Careers</div></td></tr>'
    || '<tr><td style="padding:24px 24px 6px"><div style="font-size:20px;font-weight:700;color:#00265D">' || app.html_escape(p_title) || '</div>'
    || CASE WHEN COALESCE(btrim(p_intro), '') <> '' THEN '<p style="margin:10px 0 0;color:#2B3545;font-size:15px;line-height:1.55">' || app.html_escape(p_intro) || '</p>' ELSE '' END
    || '</td></tr>'
    || CASE WHEN COALESCE(btrim(p_code), '') <> '' THEN
         '<tr><td align="center" style="padding:14px 24px"><div style="display:inline-block;padding:14px 28px;border:1px solid #CFE3EC;border-radius:10px;background:#EEF7FB;'
         || 'font-family:Consolas,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#00265D">' || app.html_escape(p_code) || '</div></td></tr>'
       ELSE '' END
    || CASE WHEN v_rows <> '' THEN '<tr><td style="padding:12px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E9F0;border-radius:8px;border-collapse:separate">' || v_rows || '</table></td></tr>' ELSE '' END
    || CASE WHEN COALESCE(btrim(p_note), '') <> '' THEN '<tr><td style="padding:8px 24px 6px;color:#2B3545;font-size:14px;line-height:1.55">' || app.html_escape(p_note) || '</td></tr>' ELSE '' END
    || '<tr><td style="padding:18px 24px 22px;border-top:1px solid #E5E9F0;color:#5B6676;font-size:12px;line-height:1.6">' || v_foot
    || '<br><span style="color:#8791A0">This is an automatic message. Please do not reply to it.</span></td></tr>'
    || '</table></td></tr></table></body></html>';
END
$$;

-- one designed email, when the school's email template of that notice is on; its subject is the template's
CREATE OR REPLACE FUNCTION app.recruitment_mail(p_code TEXT, p_to TEXT, p_vars JSONB, p_title TEXT, p_intro TEXT,
                                                p_box TEXT, p_rows JSONB, p_note TEXT, p_attachments JSONB DEFAULT '[]'::jsonb)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  t RECORD;
  v_subject TEXT;
  v_id BIGINT;
  k TEXT;
  v TEXT;
BEGIN
  IF p_to IS NULL OR btrim(p_to) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN NULL; END IF;
  SELECT id, subject INTO t FROM comms_templates
   WHERE school_id = app.current_school_id() AND code = p_code AND channel = 'email' AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_subject := COALESCE(t.subject, p_title);
  FOR k, v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    v_subject := replace(v_subject, '{{' || k || '}}', COALESCE(v, ''));
  END LOOP;
  INSERT INTO comms_messages (school_id, template_id, channel, recipient_address, subject, body, format, status, variables, attachments)
  VALUES (app.current_school_id(), t.id, 'email', lower(btrim(p_to)), left(v_subject, 200),
          app.recruitment_mail_html(p_title, p_intro, p_box, p_rows, p_note), 'html', 'queued',
          COALESCE(p_vars, '{}'::jsonb), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION app.recruitment_otp_send(p_channel TEXT, p_to TEXT, p_code TEXT, p_minutes INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_vars JSONB;
  v_school TEXT;
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.recruitment_seed_templates(app.current_school_id());
  SELECT name INTO v_school FROM schools WHERE id = app.current_school_id();
  v_vars := jsonb_build_object('otp', p_code, 'minutes', p_minutes::text, 'school', v_school);
  IF p_channel = 'email' THEN
    IF app.recruitment_mail('recruitment_otp', p_to, v_vars, 'Your sign-in code',
         'Use this code to sign in to the careers page of ' || v_school || '.', p_code, '[]'::jsonb,
         'The code works for ' || p_minutes::text || ' minutes. Do not share it with anyone. If you did not ask for it, '
           || 'ignore this email: nobody can sign in without the code.') IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  ELSE
    IF app.send_template('recruitment_otp', 'sms', p_to, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
    IF app.send_template('recruitment_otp', 'whatsapp', p_to, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END IF;
  RETURN v_n;
END
$$;

-- a notice to the candidate of one application, by the channels the school set, when that notice is on;
-- the email is the designed one (p_extra.attachments: files it carries, e.g. the application PDF)
CREATE OR REPLACE FUNCTION app.recruitment_notify(p_application BIGINT, p_event TEXT, p_extra JSONB DEFAULT '{}')
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  a RECORD;
  s RECORD;
  v_on BOOLEAN;
  v_vars JSONB;
  v_n INT := 0;
  v_code TEXT := 'recruitment_' || p_event;
  v_venue TEXT := NULLIF(btrim(regexp_replace(COALESCE(p_extra->>'venue', ''), '^,\s*', '')), '');
  v_title TEXT;
  v_intro TEXT;
  v_rows JSONB;
  v_note TEXT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO recruitment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM recruitment_settings WHERE school_id = app.current_school_id();
  v_on := CASE p_event WHEN 'applied' THEN s.notify_applied WHEN 'scheduled' THEN s.notify_scheduled
                       WHEN 'selected' THEN s.notify_selected WHEN 'not_selected' THEN s.notify_rejected ELSE false END;
  IF NOT v_on THEN RETURN 0; END IF;
  SELECT ja.number, ja.submitted_at, v.title AS post, v.code AS post_code, sc.name AS school,
         COALESCE(NULLIF(trim(concat_ws(' ', ja.snapshot->'values'->>'first_name', ja.snapshot->'values'->>'last_name')), ''), c.name, 'Candidate') AS name,
         COALESCE(ja.snapshot->'values'->>'mobile', c.mobile) AS mobile,
         COALESCE(ja.snapshot->'values'->>'email', c.email::text) AS email
    INTO a
    FROM job_applications ja
    JOIN vacancies v ON v.id = ja.vacancy_id
    JOIN candidates c ON c.id = ja.candidate_id
    JOIN schools sc ON sc.id = ja.school_id
   WHERE ja.id = p_application;
  IF NOT FOUND THEN RETURN 0; END IF;
  PERFORM app.recruitment_seed_templates(app.current_school_id());
  v_vars := jsonb_build_object('name', a.name, 'number', a.number, 'post', a.post, 'school', a.school)
            || (COALESCE(p_extra, '{}') - 'attachments');
  IF s.by_sms AND app.send_template(v_code, 'sms', a.mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.by_whatsapp AND app.send_template(v_code, 'whatsapp', a.mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.by_email THEN
    v_rows := jsonb_build_array(jsonb_build_array('Post', a.post), jsonb_build_array('Application no.', a.number));
    IF p_event = 'applied' THEN
      v_title := 'Application received';
      v_intro := 'Dear ' || a.name || ', thank you for applying. Your application has reached the school.';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Received on',
                  to_char(a.submitted_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY, FMHH12:MI am')));
      v_note := CASE WHEN jsonb_array_length(COALESCE(p_extra->'attachments', '[]'::jsonb)) > 0
                     THEN 'A copy of your application is attached. ' ELSE '' END
                || 'The school will write to you if you are shortlisted. You can see where your application stands on the careers page, under My applications.';
    ELSIF p_event = 'scheduled' THEN
      v_title := COALESCE(p_extra->>'stage', 'Your next step') || ' scheduled';
      v_intro := 'Dear ' || a.name || ', your ' || lower(COALESCE(p_extra->>'stage', 'next step')) || ' for ' || a.post || ' is fixed.';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Date', p_extra->>'date'), jsonb_build_array('Time', p_extra->>'time'),
                  jsonb_build_array('Venue', v_venue));
      v_note := 'Please come a little early and bring your original certificates and a photo ID.';
    ELSIF p_event = 'selected' THEN
      v_title := 'You are selected';
      v_intro := 'Dear ' || a.name || ', we are happy to tell you that you are selected for ' || a.post || '.';
      v_note := 'The school will contact you about joining.';
    ELSE
      v_title := 'About your application';
      v_intro := 'Dear ' || a.name || ', thank you for your interest in ' || a.post || '. We are unable to take your application forward this time.';
      v_note := 'We wish you well.';
    END IF;
    IF app.recruitment_mail(v_code, a.email, v_vars, v_title, v_intro, NULL, v_rows, v_note,
                            COALESCE(p_extra->'attachments', '[]'::jsonb)) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END IF;
  RETURN v_n;
END
$$;
