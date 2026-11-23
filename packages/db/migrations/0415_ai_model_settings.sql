-- 0415: an LLM of our own for all schools (docs/design/101, phase A).
--  * One row for the server: the model's address, its Bearer token (encrypted by the API with encryptField, never
--    returned to a screen: its last 4 characters are kept to show), where the answer sits in its reply, a time limit,
--    on / off, who changed it, the last test.
--  * Reached only through the SECURITY DEFINER functions below (forced row-level security, only the migrator's
--    policy). The API decides who may read and change it: the right platform.ai_model.manage, in no role — Mobilise
--    gives it first (scripts/ai/ai-model-admin.mjs), then only its holders may pass it on.

CREATE TABLE ai_model_settings (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url              TEXT NOT NULL CHECK (url ~ '^https?://[^\s@/]+' AND length(url) <= 500),
  token            TEXT NOT NULL CHECK (token LIKE 'v1:%'),
  token_last4      TEXT NOT NULL CHECK (length(token_last4) <= 4),
  reply_field      TEXT CHECK (reply_field IS NULL OR reply_field ~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+|\[[0-9]{1,3}\])*$'),
  timeout_seconds  INT NOT NULL DEFAULT 30 CHECK (timeout_seconds BETWEEN 5 AND 120),
  is_on            BOOLEAN NOT NULL DEFAULT false,
  updated_by       BIGINT REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  tested_at        TIMESTAMPTZ,
  test_ok          BOOLEAN,
  test_note        TEXT CHECK (test_note IS NULL OR length(test_note) <= 300)
);
ALTER TABLE ai_model_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_model_settings_migrator ON ai_model_settings FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- The settings as stored (the token still encrypted), with the name of who changed them; no row: nothing set up.
CREATE OR REPLACE FUNCTION app.ai_model_get()
RETURNS TABLE (url text, token text, token_last4 text, reply_field text, timeout_seconds int, is_on boolean,
               updated_by_name text, updated_at timestamptz, tested_at timestamptz, test_ok boolean, test_note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT s.url, s.token, s.token_last4, s.reply_field, s.timeout_seconds, s.is_on,
         (SELECT u.display_name FROM users u WHERE u.id = s.updated_by), s.updated_at, s.tested_at, s.test_ok, s.test_note
    FROM ai_model_settings s WHERE s.id = 1
$$;

-- Saves the settings. p_token NULL keeps the saved token (an error when there is none yet). A changed address or
-- token forgets the last test.
CREATE OR REPLACE FUNCTION app.ai_model_save(p_url text, p_token text, p_token_last4 text, p_reply_field text,
                                             p_timeout_seconds int, p_on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_was ai_model_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_was FROM ai_model_settings WHERE id = 1;
  IF p_token IS NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'ai_model: the token is needed the first time' USING ERRCODE = '22023';
  END IF;
  INSERT INTO ai_model_settings AS s (id, url, token, token_last4, reply_field, timeout_seconds, is_on, updated_by, updated_at)
  VALUES (1, p_url, p_token, p_token_last4, p_reply_field, p_timeout_seconds, p_on, app.current_user_id(), now())
  ON CONFLICT (id) DO UPDATE SET
    url = EXCLUDED.url,
    token = COALESCE(p_token, s.token),
    token_last4 = CASE WHEN p_token IS NULL THEN s.token_last4 ELSE EXCLUDED.token_last4 END,
    reply_field = EXCLUDED.reply_field,
    timeout_seconds = EXCLUDED.timeout_seconds,
    is_on = EXCLUDED.is_on,
    updated_by = EXCLUDED.updated_by,
    updated_at = now(),
    tested_at = CASE WHEN p_token IS NOT NULL OR EXCLUDED.url <> s.url OR EXCLUDED.reply_field IS DISTINCT FROM s.reply_field
                     THEN NULL ELSE s.tested_at END,
    test_ok = CASE WHEN p_token IS NOT NULL OR EXCLUDED.url <> s.url OR EXCLUDED.reply_field IS DISTINCT FROM s.reply_field
                   THEN NULL ELSE s.test_ok END,
    test_note = CASE WHEN p_token IS NOT NULL OR EXCLUDED.url <> s.url OR EXCLUDED.reply_field IS DISTINCT FROM s.reply_field
                     THEN NULL ELSE s.test_note END;
END
$$;

-- The last test's result (kept to show on the form).
CREATE OR REPLACE FUNCTION app.ai_model_tested(p_ok boolean, p_note text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  UPDATE ai_model_settings SET tested_at = now(), test_ok = p_ok, test_note = left(p_note, 300) WHERE id = 1
$$;

REVOKE ALL ON FUNCTION app.ai_model_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_model_save(text, text, text, text, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_model_tested(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_model_get() TO edupro_app;
GRANT EXECUTE ON FUNCTION app.ai_model_save(text, text, text, text, int, boolean) TO edupro_app;
GRANT EXECUTE ON FUNCTION app.ai_model_tested(boolean, text) TO edupro_app;

-- The right: in no role. Mobilise gives it (scripts/ai/ai-model-admin.mjs); then only its holders pass it on.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.ai_model.manage', 'platform', 'Set the AI model (LLM) every school uses: its address, token and test', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;
