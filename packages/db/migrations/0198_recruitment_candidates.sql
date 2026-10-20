-- 0198: recruitment, part 2 (docs/design/34-recruitment.md): candidates who sign in on the public careers page
-- with a code to their mobile or email, fill one application (reused for every vacancy they apply to),
-- upload documents and photos, and apply. Fields the employee master has are validated as the master
-- does; Aadhaar and PAN are encrypted. An application keeps what was submitted (a snapshot).

CREATE TABLE candidates (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  mobile         TEXT,
  email          CITEXT,
  name           TEXT,
  -- the application's answers and its rows (education, experience, training, children, references)
  profile        JSONB NOT NULL DEFAULT '{}',
  -- Aadhaar and PAN, encrypted as on the employee record
  secure         JSONB NOT NULL DEFAULT '{}',
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mobile IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX candidates_mobile ON candidates (school_id, mobile) WHERE mobile IS NOT NULL;
CREATE UNIQUE INDEX candidates_email ON candidates (school_id, email) WHERE email IS NOT NULL;
CALL app.apply_tenant_rls('candidates');

-- photos and documents the candidate uploaded (the file is theirs: files.owner_entity_* = candidate)
CREATE TABLE candidate_files (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  candidate_id  BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo', 'father_photo', 'mother_photo', 'address_proof',
                  'certificate', 'father_proof', 'mother_proof', 'high_school', 'resume', 'other')),
  file_id       BIGINT NOT NULL REFERENCES files(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX candidate_files_candidate ON candidate_files (candidate_id, kind);
CALL app.apply_tenant_rls('candidate_files');

CREATE TABLE job_applications (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  number          TEXT NOT NULL,
  vacancy_id      BIGINT NOT NULL REFERENCES vacancies(id),
  candidate_id    BIGINT NOT NULL REFERENCES candidates(id),
  -- where the candidate stands; the screening stages come in part 3
  status          TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'screening', 'selected', 'rejected', 'on_hold', 'withdrawn', 'joined')),
  current_stage_id BIGINT,
  -- what was submitted: the answers, the rows and the files (ids), and the encrypted IDs
  snapshot        JSONB NOT NULL,
  snapshot_secure JSONB NOT NULL DEFAULT '{}',
  -- an active employee with the same mobile or email when the application came in
  employee_match  JSONB,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  UNIQUE (vacancy_id, candidate_id)
);
CREATE INDEX job_applications_vacancy ON job_applications (vacancy_id, status);
CALL app.apply_tenant_rls('job_applications');

-- the sign-in code and later notices to candidates, as templates the school can edit (Communication)
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
       '["name","number","post","school"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- a code to a mobile (SMS and WhatsApp) or to an email, through the school's own providers
CREATE OR REPLACE FUNCTION app.recruitment_otp_send(p_channel TEXT, p_to TEXT, p_code TEXT, p_minutes INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_vars JSONB;
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.recruitment_seed_templates(app.current_school_id());
  v_vars := jsonb_build_object('otp', p_code, 'minutes', p_minutes::text,
                               'school', (SELECT name FROM schools WHERE id = app.current_school_id()));
  IF p_channel = 'email' THEN
    IF app.send_template('recruitment_otp', 'email', p_to, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  ELSE
    IF app.send_template('recruitment_otp', 'sms', p_to, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
    IF app.send_template('recruitment_otp', 'whatsapp', p_to, v_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END IF;
  RETURN v_n;
END
$$;
