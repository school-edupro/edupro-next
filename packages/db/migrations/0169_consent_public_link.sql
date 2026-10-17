-- Consent forms, part 3 (docs/design/28-consent-forms.md): the public link and QR. Outsiders (alumni,
-- visitors) answer with their name, mobile or email, proved by a one-time code; families without the
-- app answer for a child with the admission number and a code sent to the mobile the school has on file.
-- The same code later lets them see, change (until the edit date) or print the answer.

ALTER TABLE consent_forms ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX consent_forms_public_token ON consent_forms (public_token) WHERE public_token IS NOT NULL;

ALTER TABLE consent_form_responses
  ALTER COLUMN signed_by DROP NOT NULL,
  -- answered on the public link (a family without the app, or an outsider)
  ADD COLUMN via_link BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN public_name TEXT,
  ADD COLUMN public_mobile TEXT,
  ADD COLUMN public_email TEXT;
CREATE INDEX consent_form_responses_public ON consent_form_responses (form_id, public_mobile, public_email) WHERE respondent = 'public';

-- one-time codes of the public link: to an outsider's mobile or email, or to a pupil's family mobile
CREATE TABLE consent_otps (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  form_id     BIGINT NOT NULL REFERENCES consent_forms(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('outsider', 'family')),
  -- the outsider's mobile or email; for a family, the admission number asked
  address     TEXT NOT NULL,
  student_id  BIGINT REFERENCES students(id),
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consent_otps_live ON consent_otps (form_id, mode, address) WHERE consumed_at IS NULL;
CALL app.apply_tenant_rls('consent_otps');

-- the code and the decision told on the public link (the school edits the wording and adds its DLT ids
-- and WhatsApp names under Communication > Templates; a channel is used only while its template is active)
CREATE OR REPLACE FUNCTION app.consent_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name,
         CASE WHEN ch.channel = 'email' THEN t.subject END, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('consent_otp', 'Consent form: one-time code', 'Your code for {{school}}',
       '{{otp}} is your one-time code for the form "{{form}}" of {{school}}. It is valid for {{minutes}} minutes. Do not share it.',
       '["otp","form","school","minutes"]'),
      ('consent_decision', 'Consent form: decision', '{{form}}: your answer {{number}}',
       'Your answer {{number}} to "{{form}}" is {{decision}}. {{note}} - {{school}}',
       '["form","number","decision","note","school"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.consent_seed_templates(id) FROM schools;
