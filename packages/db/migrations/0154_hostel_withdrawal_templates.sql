-- Hostel withdrawal (docs/design/27-hostel-withdrawal.md): the message to the parent when the pupil has left
-- the hostel, by SMS / WhatsApp once the school makes the template ready (seeded on first use, like the
-- other hostel templates).
CREATE OR REPLACE FUNCTION app.hostel_withdrawal_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, 'hostel_withdrawn_parent', ch.channel::comms_channel, 'Hostel withdrawal: told to the parent', NULL,
         '{{who}} has left {{hostel}} on {{date}}. The hostel fee is charged up to {{until}}. {{fee}} - {{school}}',
         '["who","hostel","date","until","fee","school"]'::jsonb, 'service'
    FROM (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION app.module_seed_templates(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code LIKE 'gate\_pass\_%' THEN PERFORM app.gate_pass_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'helpdesk\_%' THEN PERFORM app.helpdesk_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'clinic\_%' THEN PERFORM app.clinic_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'transport\_%' THEN PERFORM app.transport_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'hostel\_withdrawn\_%' THEN PERFORM app.hostel_withdrawal_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'hostel\_%' THEN PERFORM app.hostel_seed_templates(app.current_school_id());
  END IF;
END
$$;
