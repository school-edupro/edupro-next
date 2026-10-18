-- Consent forms: the messages of a published form and of its reminder, on SMS, WhatsApp and email, ready
-- for every school (the school edits the wording, adds its DLT ids and WhatsApp names under
-- Communication > Templates). Publish and "Remind" pick them by default.
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
       '["form","number","decision","note","school"]'),
      ('consent_form_new', 'Consent form: please answer', '{{form_title}}: please answer',
       '{{school}} asks you to answer the form "{{form_title}}"{{closes_on}}. Please answer it in the EduPro app or here: {{link}}',
       '["school","form_title","closes_on","link"]'),
      ('consent_form_reminder', 'Consent form: reminder', 'Reminder: {{form_title}}',
       'Reminder: the form "{{form_title}}" of {{school}} still waits for your answer{{closes_on}}. Answer it in the EduPro app or here: {{link}}',
       '["school","form_title","closes_on","link"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.consent_seed_templates(id) FROM schools;
