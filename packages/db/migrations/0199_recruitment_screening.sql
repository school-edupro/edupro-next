-- 0199: recruitment, part 3 (docs/design/34-recruitment.md): screening. Each application goes through the
-- stages its vacancy ticked, in order; each stage keeps when it is held, where, the panel, the marks and the
-- result (pass moves the candidate on, fail ends the application, hold keeps it waiting); passing the last
-- stage selects. The office may add a walk-in candidate. Notices to candidates go through the school's
-- templates, as the school sets in Recruitment set-up.

ALTER TABLE job_applications
  ADD COLUMN source         TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'office')),
  ADD COLUMN decision_note  TEXT,
  ADD COLUMN decided_at     TIMESTAMPTZ;

-- the stage the candidate is at, for an application received before screening existed
UPDATE job_applications a SET current_stage_id = v.stage_ids[1]
  FROM vacancies v WHERE v.id = a.vacancy_id AND a.current_stage_id IS NULL AND cardinality(v.stage_ids) > 0;

CREATE TABLE application_stage_results (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  application_id    BIGINT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  stage_id          BIGINT NOT NULL REFERENCES recruitment_stages(id),
  scheduled_at      TIMESTAMPTZ,
  venue             TEXT,
  panel             TEXT,
  marks             NUMERIC(7,2),
  max_marks         NUMERIC(7,2),
  result            TEXT CHECK (result IN ('pass', 'fail', 'hold')),
  remarks           TEXT,
  recorded_by       BIGINT,
  recorded_by_name  TEXT,
  recorded_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, stage_id),
  CHECK (marks IS NULL OR marks >= 0),
  CHECK (marks IS NULL OR max_marks IS NULL OR marks <= max_marks)
);
CALL app.apply_tenant_rls('application_stage_results');

CREATE TABLE job_application_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  application_id  BIGINT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  what            TEXT NOT NULL,
  note            TEXT,
  by_name         TEXT,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_application_events_app ON job_application_events (application_id, at);
CALL app.apply_tenant_rls('job_application_events');

-- which notices go to candidates, and how
CREATE TABLE recruitment_settings (
  school_id          BIGINT PRIMARY KEY REFERENCES schools(id),
  notify_applied     BOOLEAN NOT NULL DEFAULT true,
  notify_scheduled   BOOLEAN NOT NULL DEFAULT true,
  notify_selected    BOOLEAN NOT NULL DEFAULT true,
  notify_rejected    BOOLEAN NOT NULL DEFAULT false,
  by_sms             BOOLEAN NOT NULL DEFAULT true,
  by_whatsapp        BOOLEAN NOT NULL DEFAULT false,
  by_email           BOOLEAN NOT NULL DEFAULT true,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('recruitment_settings');

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
       '["name","post","school","number"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- a notice to the candidate of one application, by the channels the school set, when that notice is on
CREATE OR REPLACE FUNCTION app.recruitment_notify(p_application BIGINT, p_event TEXT, p_extra JSONB DEFAULT '{}')
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  a RECORD;
  s RECORD;
  v_on BOOLEAN;
  v_vars JSONB;
  v_n INT := 0;
  v_code TEXT := 'recruitment_' || p_event;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO recruitment_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM recruitment_settings WHERE school_id = app.current_school_id();
  v_on := CASE p_event WHEN 'applied' THEN s.notify_applied WHEN 'scheduled' THEN s.notify_scheduled
                       WHEN 'selected' THEN s.notify_selected WHEN 'not_selected' THEN s.notify_rejected ELSE false END;
  IF NOT v_on THEN RETURN 0; END IF;
  SELECT ja.number, v.title AS post, sc.name AS school,
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
  v_vars := jsonb_build_object('name', a.name, 'number', a.number, 'post', a.post, 'school', a.school) || COALESCE(p_extra, '{}');
  IF s.by_sms AND app.send_template(v_code, 'sms', a.mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.by_whatsapp AND app.send_template(v_code, 'whatsapp', a.mobile, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  IF s.by_email AND app.send_template(v_code, 'email', a.email, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  RETURN v_n;
END
$$;
