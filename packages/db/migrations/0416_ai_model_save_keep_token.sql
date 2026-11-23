-- 0416: saving the AI model's settings with the token box left empty keeps the saved token (docs/design/101). 0415's
-- upsert put the empty token into the new row first, which the NOT NULL check refused before the existing row was
-- found: an existing row is now updated, a first save inserted.
CREATE OR REPLACE FUNCTION app.ai_model_save(p_url text, p_token text, p_token_last4 text, p_reply_field text,
                                             p_timeout_seconds int, p_on boolean)
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
    INSERT INTO ai_model_settings (id, url, token, token_last4, reply_field, timeout_seconds, is_on, updated_by, updated_at)
    VALUES (1, p_url, p_token, p_token_last4, p_reply_field, p_timeout_seconds, p_on, app.current_user_id(), now());
    RETURN;
  END IF;
  -- a changed address, token or reply field forgets the last test
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
    test_note = CASE WHEN v_forget THEN NULL ELSE test_note END
  WHERE id = 1;
END
$$;
