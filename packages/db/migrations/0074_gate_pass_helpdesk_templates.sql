-- SMS and WhatsApp for gate passes and the helpdesk, on the same footing as appointments (0059/0060):
-- each message is a template the school edits under Communication → Templates, and it goes out on a
-- channel only when that template is ready (SMS: DLT template id, WhatsApp: approved template name).
-- Emails for these modules keep their built-in design (card with details, QR and PDF where it applies).

CREATE OR REPLACE FUNCTION app.gate_pass_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name, NULL, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('gate_pass_to_approve', 'Gate pass: waiting for your approval',
       'Gate pass for {{who}} ({{kind}}, {{date}} {{time}}) is waiting for your approval as {{level}}. Open EduPro to decide. - {{school}}',
       '["who","kind","date","time","level","school"]'),
      ('gate_pass_approved', 'Gate pass: approved',
       'Gate pass {{number}} for {{who}} ({{kind}}, {{date}} {{time}}) is approved. Pass code {{code}}. - {{school}}',
       '["number","who","kind","date","time","code","school"]'),
      ('gate_pass_rejected', 'Gate pass: not approved',
       'The gate pass for {{who}} ({{kind}}, {{date}}) was not approved. {{reason}} - {{school}}',
       '["who","kind","date","reason","school"]'),
      ('gate_pass_handed_over', 'Gate pass: child handed over',
       '{{who}} was handed over to {{escort}} at the front desk at {{time}} against gate pass {{number}}. - {{school}}',
       '["who","escort","time","number","school"]'),
      ('gate_pass_out', 'Gate pass: left the school gate',
       '{{who}} left the school gate at {{time}} against gate pass {{number}}. - {{school}}',
       '["who","time","number","school"]'),
      ('gate_pass_in', 'Gate pass: came in at the gate',
       '{{who}} came in at the school gate at {{time}} against gate pass {{number}}. - {{school}}',
       '["who","time","number","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION app.helpdesk_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name, NULL, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('helpdesk_new', 'Helpdesk: new query with you',
       'New {{desk}} {{number}}: {{subject}} is with you. Answer by {{due}}. - {{school}}',
       '["desk","number","subject","due","school"]'),
      ('helpdesk_assigned', 'Helpdesk: query assigned to you',
       '{{number}}: {{subject}} is assigned to you. Answer by {{due}}. - {{school}}',
       '["number","subject","due","school"]'),
      ('helpdesk_reply', 'Helpdesk: new reply',
       'There is a new reply on {{number}}: {{subject}}. Open EduPro to read it. - {{school}}',
       '["number","subject","school"]'),
      ('helpdesk_resolved', 'Helpdesk: query resolved',
       'Your query {{number}}: {{subject}} is resolved. Open EduPro to read the answer and rate it. - {{school}}',
       '["number","subject","school"]'),
      ('helpdesk_reopened', 'Helpdesk: query reopened',
       '{{number}}: {{subject}} was reopened and is with you again. - {{school}}',
       '["number","subject","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- a module's templates exist from its first message on (and show in its set-up from the first read)
CREATE OR REPLACE FUNCTION app.module_seed_templates(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code LIKE 'gate\_pass\_%' THEN PERFORM app.gate_pass_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'helpdesk\_%' THEN PERFORM app.helpdesk_seed_templates(app.current_school_id());
  END IF;
END
$$;

-- one template on SMS and WhatsApp to a list of mobile numbers (10 digits; anything else is skipped)
CREATE OR REPLACE FUNCTION app.template_to_mobiles(p_code TEXT, p_mobiles TEXT[], p_vars JSONB) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT := 0;
  m TEXT;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.module_seed_templates(p_code);
  FOR m IN SELECT DISTINCT right(regexp_replace(x, '\D', '', 'g'), 10) FROM unnest(COALESCE(p_mobiles, '{}')) AS x
            WHERE right(regexp_replace(x, '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$' LOOP
    IF app.send_template(p_code, 'sms', m, p_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
    IF app.send_template(p_code, 'whatsapp', m, p_vars) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END
$$;

-- the same to people by their sign-in: the mobile on the employee or guardian record, else on the user
CREATE OR REPLACE FUNCTION app.template_to_users(p_code TEXT, p_users BIGINT[], p_vars JSONB) RETURNS INT LANGUAGE sql AS $$
  SELECT app.template_to_mobiles(p_code, ARRAY(
    SELECT COALESCE(
             (SELECT e.mobile FROM employees e WHERE e.user_id = u.id AND e.school_id = app.current_school_id() AND e.deleted_at IS NULL AND e.mobile IS NOT NULL LIMIT 1),
             (SELECT g.mobile FROM guardians g WHERE g.user_id = u.id AND g.school_id = app.current_school_id() AND g.mobile IS NOT NULL LIMIT 1),
             u.mobile)
      FROM users u WHERE u.id = ANY (COALESCE(p_users, '{}'))), p_vars)
$$;
