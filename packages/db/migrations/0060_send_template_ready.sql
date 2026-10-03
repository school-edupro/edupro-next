-- 0060: a template message goes out on a channel only when the channel can carry it: SMS needs the DLT
-- template id, WhatsApp the approved template name (email needs nothing more). Without them the provider
-- would refuse the message, so it is not queued at all and the set-up screen shows the channel as not ready.
CREATE OR REPLACE FUNCTION app.send_template(p_code TEXT, p_channel TEXT, p_address TEXT, p_vars JSONB, p_user BIGINT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  t RECORD;
  v_body TEXT;
  v_subject TEXT;
  v_id BIGINT;
  k TEXT;
  v TEXT;
BEGIN
  IF p_address IS NULL OR btrim(p_address) = '' THEN RETURN NULL; END IF;
  SELECT id, subject, body, format INTO t FROM comms_templates
   WHERE school_id = app.current_school_id() AND code = p_code AND channel = p_channel::comms_channel AND status = 'active' AND deleted_at IS NULL
     AND (p_channel <> 'sms' OR COALESCE(btrim(dlt_template_id), '') <> '')
     AND (p_channel <> 'whatsapp' OR COALESCE(btrim(wa_template_name), '') <> '');
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_body := t.body;
  v_subject := t.subject;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    IF t.format = 'html' THEN
      v := replace(replace(replace(v, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    END IF;
    v_body := replace(v_body, '{{' || k || '}}', COALESCE(v, ''));
    v_subject := replace(v_subject, '{{' || k || '}}', COALESCE(v, ''));
  END LOOP;
  INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, format, status, variables)
  VALUES (app.current_school_id(), t.id, p_channel::comms_channel, p_user, btrim(p_address), left(v_subject, 200),
          btrim(regexp_replace(v_body, '\s{2,}', ' ', 'g')), t.format, 'queued', COALESCE(p_vars, '{}'::jsonb))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN v_id;
END
$$;
