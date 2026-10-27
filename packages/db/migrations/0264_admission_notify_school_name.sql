-- 0264: the admission notices name the school: every caller passed {{school}} empty, so the SMS and
-- WhatsApp read "offered admission to Class I at ." (found on the offer preview, docs/design/56).
CREATE OR REPLACE FUNCTION app.admission_notify(p_code TEXT, p_mobile TEXT, p_email TEXT, p_vars JSONB,
                                                p_title TEXT, p_intro TEXT, p_box TEXT, p_rows JSONB, p_note TEXT,
                                                p_attachments JSONB DEFAULT '[]'::jsonb)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.admission_seed_templates(app.current_school_id());
  -- the callers leave {{school}} empty: the school's own name (the SMS read "... at .")
  IF COALESCE(p_vars ->> 'school', '') = '' THEN
    p_vars := COALESCE(p_vars, '{}'::jsonb) || jsonb_build_object('school', (SELECT name FROM schools WHERE id = app.current_school_id()));
  END IF;
  IF app.admission_mail(p_code, p_email, p_vars, p_title, p_intro, p_box, p_rows, p_note, p_attachments) IS NOT NULL THEN
    v_n := v_n + 1;
  END IF;
  IF COALESCE(p_mobile, '') ~ '^[6-9][0-9]{9}$' THEN
    IF app.send_template(p_code, 'sms', p_mobile, p_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
    IF app.send_template(p_code, 'whatsapp', p_mobile, p_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END IF;
  RETURN v_n;
END
$$;
