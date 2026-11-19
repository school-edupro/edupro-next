-- 0403: help-desk notifications reach the mobile app's phones (docs/design/89, phase D).
--  * The help-desk's push (a reply to a query, an escalation) went to every device through the school's own
--    Firebase project: the phones of the mobile app (the EduPro project) got nothing, and without a school Firebase
--    nobody did. As PushService.send does: phones are marked `app = 'mobile'` (the workers send them through the
--    EduPro project) and get the push whether or not the school has its own Firebase; browsers only when it does.
--  * A school that switched push off, or turned the "queries" kind off, sends none; a person who switched the
--    "queries" kind off on their phone (preference `push.off`) is left out.

CREATE OR REPLACE FUNCTION app.helpdesk_notify(p_query BIGINT, p_subject TEXT, p_html TEXT, p_emails TEXT[], p_user_ids BIGINT[], p_push_title TEXT, p_push_body TEXT, p_link TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT := 0;
  v_id BIGINT;
  v_addr TEXT;
  v_on BOOLEAN;
  v_web BOOLEAN;
  r RECORD;
BEGIN
  FOR v_addr IN SELECT DISTINCT lower(btrim(a)) FROM unnest(COALESCE(p_emails, '{}')) AS a WHERE btrim(a) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' LOOP
    INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables)
    VALUES (app.current_school_id(), 'email', v_addr, left(p_subject, 200), p_html, 'html', 'queued', jsonb_build_object('helpdesk_query', p_query))
    RETURNING id INTO v_id;
    PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
      'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
    v_n := v_n + 1;
  END LOOP;
  IF p_push_title IS NULL THEN
    RETURN v_n;
  END IF;
  -- push is on unless the school switched it off; browsers need the school's own Firebase, phones do not
  SELECT COALESCE(bool_and(p.active), true), COALESCE(bool_or(p.active AND p.secret IS NOT NULL), false)
    INTO v_on, v_web FROM comms_providers p WHERE p.channel = 'push' AND p.provider = 'fcm';
  IF NOT v_on OR NOT COALESCE((SELECT 'queries' = ANY (s.push_events) FROM comms_settings s LIMIT 1), true) THEN
    RETURN v_n;
  END IF;
  FOR r IN
    SELECT d.user_id, d.token, d.app FROM push_devices d
     WHERE d.user_id = ANY (COALESCE(p_user_ids, '{}')) AND d.revoked_at IS NULL
       AND (d.app = 'mobile' OR v_web)
       AND NOT EXISTS (SELECT 1 FROM user_preferences u
                        WHERE u.user_id = d.user_id AND u.pref_key = 'push.off' AND u.value ? 'queries')
  LOOP
    INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, subject, body, status, variables)
    VALUES (app.current_school_id(), 'push', r.user_id, r.token, left(p_push_title, 200), left(p_push_body, 1000), 'queued',
            jsonb_build_object('link', p_link, 'event', 'queries', 'helpdesk_query', p_query)
              || CASE WHEN r.app = 'mobile' THEN jsonb_build_object('app', 'mobile') ELSE '{}'::jsonb END)
    RETURNING id INTO v_id;
    PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
      'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;
