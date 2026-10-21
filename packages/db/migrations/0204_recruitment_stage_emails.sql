-- Recruitment part 9 (docs/design/34-recruitment.md): which stages tell the candidate by email.
-- Each screening stage has two switches: an email when the stage is scheduled (date, time, venue) and an
-- email of its result (cleared, with the next stage; or not through). SMS and WhatsApp keep following the
-- school's notices (Recruitment set-up → Notices to candidates). A stage cleared is a new email
-- (recruitment_passed). Both switches start on, so nothing told today stops.

ALTER TABLE recruitment_stages
  ADD COLUMN email_scheduled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN email_result    BOOLEAN NOT NULL DEFAULT true;

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
       '["name","number","post","school"]'),
      ('recruitment_passed', 'Careers: stage cleared', 'Through {{stage}} for {{post}}',
       'Dear {{name}}, you have cleared {{stage}} for {{post}} at {{school}}. Next: {{next}}. The school will tell you when. Application {{number}}.',
       '["name","stage","next","post","school","number"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
   -- a stage cleared is told by email only (the stage's switch in Recruitment set-up)
   WHERE t.code <> 'recruitment_passed' OR ch.channel = 'email'
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

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
  v_stage BIGINT := CASE WHEN COALESCE(p_extra->>'stageId', '') ~ '^\d{1,18}$' THEN (p_extra->>'stageId')::bigint END;
  v_mail BOOLEAN := true;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO recruitment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM recruitment_settings WHERE school_id = app.current_school_id();
  v_on := CASE p_event WHEN 'applied' THEN s.notify_applied WHEN 'scheduled' THEN s.notify_scheduled
                       WHEN 'selected' THEN s.notify_selected WHEN 'not_selected' THEN s.notify_rejected
                       WHEN 'returned' THEN true WHEN 'reminder' THEN true WHEN 'corrected' THEN true
                       WHEN 'reopened' THEN true WHEN 'passed' THEN true ELSE false END;
  IF NOT v_on THEN RETURN 0; END IF;
  -- the stage's own switches (0204): an email when it is scheduled, an email of its result
  IF v_stage IS NOT NULL AND p_event IN ('scheduled', 'passed', 'not_selected') THEN
    SELECT CASE WHEN p_event = 'scheduled' THEN st.email_scheduled ELSE st.email_result END
      INTO v_mail FROM recruitment_stages st WHERE st.id = v_stage;
    v_mail := COALESCE(v_mail, true);
  END IF;
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
            || (COALESCE(p_extra, '{}') - 'attachments' - 'stageId');
  IF p_event = 'passed' THEN
    -- email only
    NULL;
  ELSIF s.by_sms AND app.send_template(v_code, 'sms', a.mobile, v_vars) IS NOT NULL THEN
    v_n := v_n + 1;
  END IF;
  IF p_event <> 'passed' AND s.by_whatsapp AND app.send_template(v_code, 'whatsapp', a.mobile, v_vars) IS NOT NULL THEN
    v_n := v_n + 1;
  END IF;
  IF s.by_email AND v_mail THEN
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
    ELSIF p_event = 'passed' THEN
      v_title := 'Through ' || COALESCE(p_extra->>'stage', 'this stage');
      v_intro := 'Dear ' || a.name || ', you have cleared ' || lower(COALESCE(p_extra->>'stage', 'this stage'))
                 || ' for ' || a.post || '. Well done.';
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Stage cleared', p_extra->>'stage'),
                  jsonb_build_array('Next', p_extra->>'next'));
      v_note := 'The school will tell you the date, time and venue of the next stage. You can see where your application stands on the careers page, under My applications.';
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
