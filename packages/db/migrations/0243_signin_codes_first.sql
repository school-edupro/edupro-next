-- Admission duplicates and sign-in codes, part 3 of docs/design/41: sign-in codes that arrive.
-- A code goes by its own "urgent" queue, picked from the outbox before anything else, so it never waits
-- behind bulk messages; each code message carries its expiry and the worker cancels it instead of
-- sending it late. A school may also show the code on screen while email / SMS is being set up (testing);
-- every code shown is recorded on the code itself.

ALTER TABLE comms_messages ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE admission_settings ADD COLUMN otp_on_screen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_otps ADD COLUMN shown_on_screen BOOLEAN NOT NULL DEFAULT false;

-- the outbox hands over urgent jobs (sign-in codes) first
CREATE OR REPLACE FUNCTION app.claim_outbox_batch(p_limit INT DEFAULT 100, p_lock_seconds INT DEFAULT 60)
RETURNS SETOF jobs_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM jobs_outbox o
     WHERE o.status = 'pending' AND o.available_at <= now()
       AND (o.locked_until IS NULL OR o.locked_until < now())
     ORDER BY (o.queue = 'urgent') DESC, o.available_at, o.id
     LIMIT GREATEST(1, LEAST(p_limit, 1000))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE jobs_outbox o SET locked_until = now() + make_interval(secs => GREATEST(5, p_lock_seconds))
    FROM picked WHERE o.id = picked.id
  RETURNING o.*;
END
$$;

-- a message of a sign-in code: urgent, and not worth sending after the code has expired
CREATE OR REPLACE FUNCTION app.mark_code_message(p_message BIGINT, p_minutes INT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_message IS NULL THEN RETURN; END IF;
  UPDATE comms_messages SET expires_at = now() + make_interval(mins => p_minutes) WHERE id = p_message;
  UPDATE jobs_outbox SET queue = 'urgent'
   WHERE status = 'pending' AND queue = 'notifications' AND payload -> 'payload' ->> 'messageId' = p_message::text;
END
$$;

CREATE OR REPLACE FUNCTION app.admission_otp_send(p_mobile TEXT, p_email TEXT, p_code TEXT, p_minutes INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_vars JSONB;
  v_school TEXT;
  v_ch TEXT[];
  v_id BIGINT;
  v_n INT := 0;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.admission_seed_templates(app.current_school_id());
  SELECT name INTO v_school FROM schools WHERE id = app.current_school_id();
  SELECT COALESCE((SELECT signin_channels FROM admission_settings WHERE school_id = app.current_school_id()),
                  ARRAY['email', 'sms', 'whatsapp']) INTO v_ch;
  v_vars := jsonb_build_object('otp', p_code, 'minutes', p_minutes::text, 'school', v_school);
  IF 'email' = ANY(v_ch) AND p_email IS NOT NULL THEN
    v_id := app.admission_mail('admission_otp', p_email, v_vars, 'Your sign-in code',
         'Use this code to sign in to the admission portal of ' || v_school || '.', p_code, '[]'::jsonb,
         'The code works for ' || p_minutes::text || ' minutes. Do not share it with anyone. If you did not ask for it, ignore this email.');
    IF v_id IS NOT NULL THEN
      PERFORM app.mark_code_message(v_id, p_minutes);
      v_n := v_n + 1;
    END IF;
  END IF;
  IF COALESCE(p_mobile, '') ~ '^[6-9][0-9]{9}$' THEN
    IF 'sms' = ANY(v_ch) THEN
      v_id := app.send_template('admission_otp', 'sms', p_mobile, v_vars);
      IF v_id IS NOT NULL THEN PERFORM app.mark_code_message(v_id, p_minutes); v_n := v_n + 1; END IF;
    END IF;
    IF 'whatsapp' = ANY(v_ch) THEN
      v_id := app.send_template('admission_otp', 'whatsapp', p_mobile, v_vars);
      IF v_id IS NOT NULL THEN PERFORM app.mark_code_message(v_id, p_minutes); v_n := v_n + 1; END IF;
    END IF;
  END IF;
  RETURN v_n;
END
$$;
