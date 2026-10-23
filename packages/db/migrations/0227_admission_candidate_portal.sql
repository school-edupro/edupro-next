-- Online admission, part 3 (docs/design/39): the candidate portal on the school's public site. A
-- candidate signs in with a mobile, an email or a registration number (a code by the channels the school
-- set), fills the class's form tab by tab, pays the registration fee and gets the registration number,
-- the receipt and the form as a PDF. The office can register a walk-in parent and take the fee at the desk.

ALTER TABLE applicants ALTER COLUMN mobile DROP NOT NULL;
CREATE INDEX applicants_by_email ON applicants (school_id, lower(email::text)) WHERE email IS NOT NULL;

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'registered';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'sent_back';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'offered';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'fee_paid';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE applications ALTER COLUMN child_dob DROP NOT NULL;
ALTER TABLE applications
  ADD COLUMN category_id              BIGINT REFERENCES admission_fee_categories(id),
  ADD COLUMN registration_fee         NUMERIC(12, 2),
  ADD COLUMN registration_receipt_id  BIGINT REFERENCES misc_receipts(id),
  ADD COLUMN registered_at            TIMESTAMPTZ,
  ADD COLUMN progress                 INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ADD COLUMN pdf_file_id              BIGINT REFERENCES files(id),
  ADD COLUMN entered_by               BIGINT REFERENCES users(id),
  ADD COLUMN candidate_name           TEXT,
  ADD COLUMN contact_mobile           TEXT,
  ADD COLUMN contact_email            TEXT;
CREATE INDEX IF NOT EXISTS applications_by_applicant_created ON applications (applicant_id, created_at DESC);

-- corrections the office asks for (observations sent to the candidate; part 4 adds the stage)
CREATE TABLE admission_corrections (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id        BIGINT,
  level           INT,
  fields          TEXT[] NOT NULL DEFAULT '{}',
  remark          TEXT NOT NULL,
  due_on          DATE,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resubmitted', 'cancelled')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reminded_at     TIMESTAMPTZ,
  resubmitted_at  TIMESTAMPTZ
);
CREATE INDEX admission_corrections_app ON admission_corrections (application_id, status);
CALL app.apply_tenant_rls('admission_corrections');

-- ---- designed emails (the school's name band, a title, a code box or rows, a note, the school's foot) ----
CREATE OR REPLACE FUNCTION app.school_mail_html(p_band TEXT, p_title TEXT, p_intro TEXT, p_code TEXT, p_rows JSONB, p_note TEXT)
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
    || '<div style="font-size:12px;font-weight:400;color:#C9D6EA;margin-top:2px">' || app.html_escape(p_band) || '</div></td></tr>'
    || '<tr><td style="padding:24px 24px 6px"><div style="font-size:20px;font-weight:700;color:#00265D">' || app.html_escape(p_title) || '</div>'
    || CASE WHEN COALESCE(btrim(p_intro), '') <> '' THEN '<p style="margin:10px 0 0;color:#2B3545;font-size:15px;line-height:1.55">' || app.html_escape(p_intro) || '</p>' ELSE '' END
    || '</td></tr>'
    || CASE WHEN COALESCE(btrim(p_code), '') <> '' THEN
         '<tr><td align="center" style="padding:14px 24px"><div style="display:inline-block;padding:14px 28px;border:1px solid #CFE3EC;border-radius:10px;background:#EEF7FB;'
         || 'font-family:Consolas,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#00265D">' || app.html_escape(p_code) || '</div></td></tr>'
       ELSE '' END
    || CASE WHEN v_rows <> '' THEN '<tr><td style="padding:12px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E9F0;border-radius:8px;border-collapse:separate">' || v_rows || '</table></td></tr>' ELSE '' END
    || CASE WHEN COALESCE(btrim(p_note), '') <> '' THEN '<tr><td style="padding:8px 24px 6px;color:#2B3545;font-size:14px;line-height:1.55">' || app.html_escape(p_note) || '</td></tr>' ELSE '' END
    || '<tr><td style="padding:18px 24px 22px;border-top:1px solid #E5E9F0;color:#5B6676;font-size:12px;line-height:1.6">' || v_foot
    || '<br><span style="color:#8791A0">This is an automatic message. Please do not reply to it.</span></td></tr>'
    || '</table></td></tr></table></body></html>';
END
$$;

-- the notices of the admission process: SMS / WhatsApp from their templates, email designed
CREATE OR REPLACE FUNCTION app.admission_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name,
         CASE WHEN ch.channel = 'email' THEN t.subject END, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('admission_otp', 'Admission: sign-in code', 'Your sign-in code for {{school}} admissions',
       '{{otp}} is your code to sign in to {{school}} admissions. It is valid for {{minutes}} minutes. Do not share it.',
       '["otp","school","minutes"]'),
      ('admission_received', 'Admission: form submitted', 'Registration form submitted for {{name}}',
       'Dear parent, the registration form of {{name}} for {{class}} at {{school}} is submitted. Pay the registration fee of Rs {{amount}} to complete the registration.',
       '["name","class","school","amount"]'),
      ('admission_registered', 'Admission: registration complete', 'Registration {{number}}: {{name}}',
       'Dear parent, {{name}} is registered for {{class}} at {{school}}. Registration no {{number}}. The form and the receipt are in the admission portal.',
       '["name","class","school","number"]'),
      ('admission_correction', 'Admission: correction asked', 'Please correct the registration form of {{name}}',
       'Dear parent, {{school}} asks you to correct the registration form {{number}} of {{name}} by {{due}}: {{remark}}. Sign in to the admission portal to correct it.',
       '["name","school","number","due","remark"]'),
      ('admission_schedule', 'Admission: test / interview', '{{stage}} for {{name}} on {{when}}',
       'Dear parent, the {{stage}} of {{name}} (registration {{number}}) is on {{when}} at {{venue}}. Download the admit card from the admission portal.',
       '["name","number","stage","when","venue"]'),
      ('admission_result', 'Admission: result', 'Admission result of {{name}}',
       'Dear parent, the admission result of {{name}} (registration {{number}}) at {{school}}: {{result}}. Details are in the admission portal.',
       '["name","number","school","result"]'),
      ('admission_offer', 'Admission: offer and fee', 'Admission offer for {{name}}: pay by {{due}}',
       'Dear parent, {{name}} is offered admission to {{class}} at {{school}}. Pay the admission fee of Rs {{amount}} by {{due}} in the admission portal or at the school.',
       '["name","class","school","amount","due"]'),
      ('admission_fee_paid', 'Admission: fee received', 'Admission fee received: {{name}}',
       'Dear parent, the admission fee of Rs {{amount}} for {{name}} is received (receipt {{receipt}}). Admission no {{admission_no}}.',
       '["name","amount","receipt","admission_no"]'),
      ('admission_admitted', 'Admission: admitted', '{{name}} is admitted to {{class}}',
       'Dear parent, {{name}} is admitted to {{class}} {{section}} at {{school}}. Admission no {{admission_no}}. Sign in to the parent app with this mobile number.',
       '["name","class","section","school","admission_no"]'),
      ('admission_cancelled', 'Admission: cancelled', 'Registration {{number}} of {{name}} is cancelled',
       'Dear parent, the registration {{number}} of {{name}} at {{school}} is cancelled. {{note}}',
       '["name","number","school","note"]'),
      ('admission_message', 'Admission: message from the school', '{{subject}}',
       '{{message}}', '["subject","message","name"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- one designed admission email (when the school's email template of that notice is on)
CREATE OR REPLACE FUNCTION app.admission_mail(p_code TEXT, p_to TEXT, p_vars JSONB, p_title TEXT, p_intro TEXT,
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
  PERFORM app.admission_seed_templates(app.current_school_id());
  SELECT id, subject INTO t FROM comms_templates
   WHERE school_id = app.current_school_id() AND code = p_code AND channel = 'email' AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_subject := COALESCE(t.subject, p_title);
  FOR k, v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    v_subject := replace(v_subject, '{{' || k || '}}', COALESCE(v, ''));
  END LOOP;
  INSERT INTO comms_messages (school_id, template_id, channel, recipient_address, subject, body, format, status, variables, attachments)
  VALUES (app.current_school_id(), t.id, 'email', lower(btrim(p_to)), left(v_subject, 200),
          app.school_mail_html('Admissions', p_title, p_intro, p_box, p_rows, p_note), 'html', 'queued',
          COALESCE(p_vars, '{}'::jsonb), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN v_id;
END
$$;

-- a notice to a candidate: the designed email always (when its template is on), SMS and WhatsApp when
-- the school has a ready template for them; returns how many went
CREATE OR REPLACE FUNCTION app.admission_notify(p_code TEXT, p_mobile TEXT, p_email TEXT, p_vars JSONB,
                                                p_title TEXT, p_intro TEXT, p_box TEXT, p_rows JSONB, p_note TEXT,
                                                p_attachments JSONB DEFAULT '[]'::jsonb)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.admission_seed_templates(app.current_school_id());
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

-- the sign-in code to the candidate's addresses, by the channels the school chose
CREATE OR REPLACE FUNCTION app.admission_otp_send(p_mobile TEXT, p_email TEXT, p_code TEXT, p_minutes INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_vars JSONB;
  v_school TEXT;
  v_ch TEXT[];
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.admission_seed_templates(app.current_school_id());
  SELECT name INTO v_school FROM schools WHERE id = app.current_school_id();
  SELECT COALESCE((SELECT signin_channels FROM admission_settings WHERE school_id = app.current_school_id()),
                  ARRAY['email', 'sms', 'whatsapp']) INTO v_ch;
  v_vars := jsonb_build_object('otp', p_code, 'minutes', p_minutes::text, 'school', v_school);
  IF 'email' = ANY(v_ch) AND p_email IS NOT NULL THEN
    IF app.admission_mail('admission_otp', p_email, v_vars, 'Your sign-in code',
         'Use this code to sign in to the admission portal of ' || v_school || '.', p_code, '[]'::jsonb,
         'The code works for ' || p_minutes::text || ' minutes. Do not share it with anyone. If you did not ask for it, ignore this email.') IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END IF;
  IF COALESCE(p_mobile, '') ~ '^[6-9][0-9]{9}$' THEN
    IF 'sms' = ANY(v_ch) AND app.send_template('admission_otp', 'sms', p_mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
    IF 'whatsapp' = ANY(v_ch) AND app.send_template('admission_otp', 'whatsapp', p_mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END IF;
  RETURN v_n;
END
$$;

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.application.enter', 'admissions', 'Register a walk-in parent: fill the registration form for them at the school desk', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'admissions.application.enter' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
