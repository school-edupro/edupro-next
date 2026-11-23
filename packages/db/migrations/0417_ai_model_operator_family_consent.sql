-- 0417: the AI model for parents and students (docs/design/102, phase B).
--  * Who runs the model (an organisation's name), shown to families in their consent; when it changes, consents given
--    before count no more (operator_changed_at) and families are asked again.
--  * app.ai_model_get() and app.ai_model_save(…) take the name (both replaced: their columns and inputs change).
--  * app.ai_model_family(): only what the family side needs — on, the name, when it changed (never the token).
--  * The consent purpose ai.model in every school: worded with the name at read time ({operator}), shown to families
--    only while their school has the model's help on for parents or students.

ALTER TABLE ai_model_settings
  ADD COLUMN operator TEXT CHECK (operator IS NULL OR length(operator) BETWEEN 2 AND 120),
  ADD COLUMN operator_changed_at TIMESTAMPTZ;

DROP FUNCTION app.ai_model_get();
CREATE FUNCTION app.ai_model_get()
RETURNS TABLE (url text, token text, token_last4 text, reply_field text, timeout_seconds int, is_on boolean,
               updated_by_name text, updated_at timestamptz, tested_at timestamptz, test_ok boolean, test_note text,
               operator text, operator_changed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT s.url, s.token, s.token_last4, s.reply_field, s.timeout_seconds, s.is_on,
         (SELECT u.display_name FROM users u WHERE u.id = s.updated_by), s.updated_at, s.tested_at, s.test_ok, s.test_note,
         s.operator, s.operator_changed_at
    FROM ai_model_settings s WHERE s.id = 1
$$;

DROP FUNCTION app.ai_model_save(text, text, text, text, int, boolean);
-- Saves the settings. p_token NULL keeps the saved token (an error when there is none yet). A changed address, token
-- or reply field forgets the last test; a changed name of who runs the model asks families again.
CREATE FUNCTION app.ai_model_save(p_url text, p_token text, p_token_last4 text, p_reply_field text,
                                  p_timeout_seconds int, p_on boolean, p_operator text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_was ai_model_settings%ROWTYPE;
  v_forget boolean;
BEGIN
  SELECT * INTO v_was FROM ai_model_settings WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    IF p_token IS NULL THEN
      RAISE EXCEPTION 'ai_model: the token is needed the first time' USING ERRCODE = '22023';
    END IF;
    INSERT INTO ai_model_settings (id, url, token, token_last4, reply_field, timeout_seconds, is_on, updated_by,
                                   updated_at, operator, operator_changed_at)
    VALUES (1, p_url, p_token, p_token_last4, p_reply_field, p_timeout_seconds, p_on, app.current_user_id(), now(),
            p_operator, CASE WHEN p_operator IS NULL THEN NULL ELSE now() END);
    RETURN;
  END IF;
  v_forget := p_token IS NOT NULL OR p_url <> v_was.url OR p_reply_field IS DISTINCT FROM v_was.reply_field;
  UPDATE ai_model_settings SET
    url = p_url,
    token = COALESCE(p_token, token),
    token_last4 = CASE WHEN p_token IS NULL THEN token_last4 ELSE p_token_last4 END,
    reply_field = p_reply_field,
    timeout_seconds = p_timeout_seconds,
    is_on = p_on,
    updated_by = app.current_user_id(),
    updated_at = now(),
    tested_at = CASE WHEN v_forget THEN NULL ELSE tested_at END,
    test_ok = CASE WHEN v_forget THEN NULL ELSE test_ok END,
    test_note = CASE WHEN v_forget THEN NULL ELSE test_note END,
    operator = p_operator,
    operator_changed_at = CASE WHEN p_operator IS DISTINCT FROM v_was.operator THEN now() ELSE operator_changed_at END
  WHERE id = 1;
END
$$;

-- What the family side needs: on, who runs it, when that last changed.
CREATE FUNCTION app.ai_model_family()
RETURNS TABLE (is_on boolean, operator text, operator_changed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT s.is_on, s.operator, s.operator_changed_at FROM ai_model_settings s WHERE s.id = 1
$$;

REVOKE ALL ON FUNCTION app.ai_model_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_model_save(text, text, text, text, int, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_model_family() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_model_get() TO edupro_app;
GRANT EXECUTE ON FUNCTION app.ai_model_save(text, text, text, text, int, boolean, text) TO edupro_app;
GRANT EXECUTE ON FUNCTION app.ai_model_family() TO edupro_app;

-- The consent purpose in every school (new schools get it with the others when the consents are first read).
INSERT INTO consent_purposes (school_id, code, name, description, channel, is_required, sort_order)
SELECT s.id, 'ai.model', 'AI model''s help in the assistant',
       'When the school assistant cannot answer with its own rules, it may send my question and only the records the answer needs (my child''s attendance, homework, fees and notices; phone numbers, e-mails and addresses hidden) to an AI model run by {operator}, which writes the answer.',
       NULL, false, 6
  FROM schools s
ON CONFLICT (school_id, code) DO NOTHING;
