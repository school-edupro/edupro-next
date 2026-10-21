-- 0203: corrections of a job application (docs/design/34-recruitment.md, part 8). A decision on an
-- application can be undone and an application moved to another stage (forward: the stages between are
-- skipped; back: an earlier stage opens again), always with a reason and kept in its history. Who may do
-- it is set in Recruitment set-up: the person who recorded a result, within the hours set, and the roles
-- and named employees set, at any time. The office may send an application back to the candidate to
-- correct the parts it marks, with a remark and a last date; the candidate is reminded a day before, and
-- the corrected application comes back where it was. Undoing a decision the candidate was told of sends a
-- correction email.
ALTER TABLE recruitment_settings
  ADD COLUMN undo_hours        INT NOT NULL DEFAULT 24 CHECK (undo_hours BETWEEN 0 AND 720),
  ADD COLUMN undo_roles        TEXT[] NOT NULL DEFAULT '{school_admin}',
  ADD COLUMN undo_employee_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN correction_days   INT NOT NULL DEFAULT 7 CHECK (correction_days BETWEEN 1 AND 60);

ALTER TABLE job_applications DROP CONSTRAINT job_applications_status_check;
ALTER TABLE job_applications ADD CONSTRAINT job_applications_status_check CHECK (status IN
  ('submitted', 'screening', 'selected', 'rejected', 'on_hold', 'withdrawn', 'joined', 'returned'));
-- the request for a correction: {remark, steps[], dueOn, at, byName, byUser, prevStatus, remindedAt, resentAt, changed[]}
ALTER TABLE job_applications ADD COLUMN correction JSONB;

ALTER TABLE application_stage_results DROP CONSTRAINT application_stage_results_result_check;
ALTER TABLE application_stage_results ADD CONSTRAINT application_stage_results_result_check
  CHECK (result IN ('pass', 'fail', 'hold', 'skipped'));

-- a decision keeps who made it and what it changed, so it can be undone; an undone one is marked
ALTER TABLE job_application_events
  ADD COLUMN by_user    BIGINT,
  ADD COLUMN detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN revoked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION app.recruitment_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name,
         CASE WHEN ch.channel = 'email' THEN t.subject END, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('recruitment_otp', 'Careers: one-time code', 'Your code for {{school}} careers',
       '{{otp}} is your one-time code for the {{school}} careers page. It is valid for {{minutes}} minutes. Do not share it.',
       '["otp","school","minutes"]'),
      ('recruitment_applied', 'Careers: application received', 'Application {{number}} received',
       'Dear {{name}}, your application {{number}} for {{post}} at {{school}} is received. We will contact you if you are shortlisted.',
       '["name","number","post","school"]'),
      ('recruitment_scheduled', 'Careers: stage scheduled', '{{stage}} for {{post}} on {{date}}',
       'Dear {{name}}, your {{stage}} for {{post}} at {{school}} is on {{date}} at {{time}}{{venue}}. Application {{number}}.',
       '["name","stage","post","school","date","time","venue","number"]'),
      ('recruitment_selected', 'Careers: selected', 'Selected for {{post}}',
       'Dear {{name}}, we are glad to tell you that you are selected for {{post}} at {{school}}. The office will contact you about joining. Application {{number}}.',
       '["name","post","school","number"]'),
      ('recruitment_not_selected', 'Careers: not taken forward', 'Your application for {{post}}',
       'Dear {{name}}, thank you for applying for {{post}} at {{school}}. We are not taking your application {{number}} forward this time. We wish you well.',
       '["name","post","school","number"]'),
      ('recruitment_returned', 'Careers: correction asked', 'Please correct your application {{number}}',
       'Dear {{name}}, {{school}} asks you to correct your application {{number}} for {{post}} by {{due}}: {{remark}}. Sign in on the careers page to correct it.',
       '["name","number","post","school","due","remark","parts","link"]'),
      ('recruitment_reminder', 'Careers: correction reminder', 'Reminder: correct your application {{number}} by {{due}}',
       'Dear {{name}}, your application {{number}} for {{post}} at {{school}} waits for your corrections by {{due}}. Sign in on the careers page to correct it.',
       '["name","number","post","school","due","link"]'),
      ('recruitment_corrected', 'Careers: corrected application received', 'Corrected application {{number}} received',
       'Dear {{name}}, your corrected application {{number}} for {{post}} at {{school}} is received.',
       '["name","number","post","school"]'),
      ('recruitment_reopened', 'Careers: under review again', 'Your application {{number}} is under review again',
       'Dear {{name}}, please ignore our earlier message about your application {{number}} for {{post}} at {{school}}: it is under review again.',
       '["name","number","post","school"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- the email body gains a button (a link to the careers page)
DROP FUNCTION app.recruitment_mail(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB);
DROP FUNCTION app.recruitment_mail_html(TEXT, TEXT, TEXT, JSONB, TEXT);
CREATE FUNCTION app.recruitment_mail_html(p_title TEXT, p_intro TEXT, p_code TEXT, p_rows JSONB, p_note TEXT, p_link TEXT DEFAULT NULL,
                                          p_link_label TEXT DEFAULT NULL)
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
    || CASE WHEN p_link ~ '^https?://' THEN '<tr><td style="padding:10px 24px 8px"><a href="' || app.html_escape(p_link)
         || '" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#00265D;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none">'
         || app.html_escape(COALESCE(p_link_label, 'Open')) || '</a></td></tr>' ELSE '' END
    || '<tr><td style="padding:18px 24px 22px;border-top:1px solid #E5E9F0;color:#5B6676;font-size:12px;line-height:1.6">' || v_foot
    || '<br><span style="color:#8791A0">This is an automatic message. Please do not reply to it.</span></td></tr>'
    || '</table></td></tr></table></body></html>';
END
$$;

CREATE FUNCTION app.recruitment_mail(p_code TEXT, p_to TEXT, p_vars JSONB, p_title TEXT, p_intro TEXT,
                                     p_box TEXT, p_rows JSONB, p_note TEXT, p_attachments JSONB DEFAULT '[]'::jsonb,
                                     p_link TEXT DEFAULT NULL, p_link_label TEXT DEFAULT NULL)
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
          app.recruitment_mail_html(p_title, p_intro, p_box, p_rows, p_note, p_link, p_link_label), 'html', 'queued',
          COALESCE(p_vars, '{}'::jsonb), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN v_id;
END
$$;

-- a notice to the candidate of one application, by the channels the school set. The notices of a decision
-- go when the school has that notice on; the ones of a correction (asked, reminder, received) and the
-- correction of a decision undone always go, as they need the candidate or put a wrong message right
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
  v_link TEXT := NULLIF(p_extra->>'link', '');
  v_title TEXT;
  v_intro TEXT;
  v_rows JSONB;
  v_note TEXT;
  v_label TEXT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO recruitment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM recruitment_settings WHERE school_id = app.current_school_id();
  v_on := CASE p_event WHEN 'applied' THEN s.notify_applied WHEN 'scheduled' THEN s.notify_scheduled
                       WHEN 'selected' THEN s.notify_selected WHEN 'not_selected' THEN s.notify_rejected
                       WHEN 'returned' THEN true WHEN 'reminder' THEN true WHEN 'corrected' THEN true
                       WHEN 'reopened' THEN true ELSE false END;
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
    ELSIF p_event = 'not_selected' THEN
      v_title := 'About your application';
      v_intro := 'Dear ' || a.name || ', thank you for your interest in ' || a.post || '. We are unable to take your application forward this time.';
      v_note := 'We wish you well.';
    ELSIF p_event = 'returned' THEN
      v_title := 'Please correct your application';
      v_intro := 'Dear ' || a.name || ', the school has looked at your application for ' || a.post
                 || ' and asks you to correct the parts below before it goes further.';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('What to correct', p_extra->>'parts'),
                  jsonb_build_array('Why', p_extra->>'remark'), jsonb_build_array('Correct by', p_extra->>'due'));
      v_note := 'Sign in on the careers page with your mobile or email, open My applications and choose "Correct and send again". '
                || 'Only the parts named can be changed.';
      v_label := 'Correct my application';
    ELSIF p_event = 'reminder' THEN
      v_title := 'Reminder: correct your application';
      v_intro := 'Dear ' || a.name || ', your application for ' || a.post || ' is waiting for your corrections.';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('What to correct', p_extra->>'parts'),
                  jsonb_build_array('Correct by', p_extra->>'due'));
      v_note := 'If it is not corrected by then, the school decides on it as it stands.';
      v_label := 'Correct my application';
    ELSIF p_event = 'corrected' THEN
      v_title := 'Corrected application received';
      v_intro := 'Dear ' || a.name || ', thank you. Your corrected application for ' || a.post || ' has reached the school.';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Received on',
                  to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY, FMHH12:MI am')));
      v_note := CASE WHEN jsonb_array_length(COALESCE(p_extra->'attachments', '[]'::jsonb)) > 0
                     THEN 'A copy of your application as it now stands is attached. ' ELSE '' END
                || 'You can see where it stands on the careers page, under My applications.';
    ELSE
      v_title := 'Your application is under review again';
      v_intro := 'Dear ' || a.name || ', please ignore our earlier message about your application for ' || a.post
                 || ': it was sent by mistake. Your application is under review again.';
      v_note := 'You can see where it stands on the careers page, under My applications.';
    END IF;
    IF app.recruitment_mail(v_code, a.email, v_vars, v_title, v_intro, NULL, v_rows, v_note,
                            COALESCE(p_extra->'attachments', '[]'::jsonb), v_link, v_label) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END IF;
  RETURN v_n;
END
$$;

-- a day before the last date of a correction, the candidate is reminded once (the workers run it hourly)
CREATE OR REPLACE FUNCTION app.recruitment_tick(p_base TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_school TEXT;
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  SELECT lower(code) INTO v_school FROM schools WHERE id = app.current_school_id();
  FOR r IN
    SELECT id, correction FROM job_applications
     WHERE status = 'returned' AND correction ? 'dueOn' AND NOT (correction ? 'remindedAt')
       AND (correction->>'dueOn')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
  LOOP
    PERFORM app.recruitment_notify(r.id, 'reminder', jsonb_build_object(
      'due', to_char((r.correction->>'dueOn')::date, 'DD-MM-YYYY'),
      'parts', COALESCE(r.correction->>'partsText', ''),
      'link', rtrim(p_base, '/') || '/' || v_school || '/careers/mine'));
    UPDATE job_applications SET correction = correction || jsonb_build_object('remindedAt', now()) WHERE id = r.id;
    INSERT INTO job_application_events (school_id, application_id, what, note)
    VALUES (app.current_school_id(), r.id, 'reminded', 'Reminded to correct by ' || to_char((r.correction->>'dueOn')::date, 'DD-MM-YYYY'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;
