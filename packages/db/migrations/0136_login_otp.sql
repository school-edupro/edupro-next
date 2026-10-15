-- 0136: sign-in with a one-time code sent by email.
--  * Each school chooses how its users sign in (school setting 'auth.login_mode'):
--      'oneauth'      One Auth only (as before; the default),
--      'oneauth_otp'  One Auth, then a 6-digit code mailed to the user,
--      'otp'          the mailed code alone (email or mobile number, then the code).
--    A user of several schools follows the strictest: a code is asked when any of the schools asks it, and
--    the code alone signs in only when every school allows it.
--  * 'auth.otp_on_screen' (default false): the code is also shown on the sign-in screen, for the rollout
--    while staff and parent emails are being corrected. Every code shown on screen is recorded.
--  * "Remember this device" for 30 days: a random token kept in a cookie of that browser; only its hash
--    is stored here.
--  * The codes and devices are reached only through the functions below (SECURITY DEFINER): the tables
--    have row-level security on and no policy, so the application role cannot read them directly.
ALTER TYPE login_method ADD VALUE IF NOT EXISTS 'otp';

CREATE TABLE auth_otp_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT NOT NULL REFERENCES users(id),
  school_id       BIGINT REFERENCES schools(id),
  purpose         TEXT NOT NULL CHECK (purpose IN ('login', 'second_factor')),
  app             TEXT NOT NULL CHECK (app IN ('admin', 'teacher', 'parent')),
  code_hash       TEXT NOT NULL,
  sent_to         TEXT,                        -- the email the code went to (null: no email on record)
  shown_on_screen BOOLEAN NOT NULL DEFAULT false,
  attempts        INT NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_otp_challenges_user ON auth_otp_challenges (user_id, created_at DESC);
CREATE INDEX auth_otp_challenges_school ON auth_otp_challenges (school_id, created_at DESC);
ALTER TABLE auth_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_otp_challenges FORCE ROW LEVEL SECURITY;

CREATE TABLE auth_trusted_devices (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  app          TEXT NOT NULL CHECK (app IN ('admin', 'teacher', 'parent')),
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_trusted_devices_user ON auth_trusted_devices (user_id);
ALTER TABLE auth_trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_trusted_devices FORCE ROW LEVEL SECURITY;

-- the value of a school's setting in force today, read without a tenant context
CREATE OR REPLACE FUNCTION app.school_setting_of(p_school bigint, p_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT value FROM school_settings
   WHERE school_id = p_school AND key = p_key AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
   ORDER BY valid_from DESC, id DESC LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION app.school_setting_of(bigint, text) FROM PUBLIC;

-- How a user signs in, over the user's active schools:
--   otp_required  a code is asked after One Auth (some school is 'oneauth_otp' or 'otp'),
--   otp_only      the code alone may sign in (every school is 'otp'),
--   on_screen     the code may be shown on screen (every school that asks a code allows it),
--   school_id     the school the code is sent for (the first, by name, that asks a code).
CREATE OR REPLACE FUNCTION app.login_policy(p_user_id bigint)
RETURNS TABLE (otp_required boolean, otp_only boolean, on_screen boolean, school_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  WITH m AS (
    SELECT s.id, s.name,
           COALESCE(app.school_setting_of(s.id, 'auth.login_mode') #>> '{}', 'oneauth') AS mode,
           COALESCE((app.school_setting_of(s.id, 'auth.otp_on_screen') #>> '{}')::boolean, false) AS screen
      FROM user_school_memberships um JOIN schools s ON s.id = um.school_id
     WHERE um.user_id = p_user_id AND um.status = 'active' AND um.deleted_at IS NULL AND s.status = 'active'
  )
  SELECT COALESCE(bool_or(mode IN ('oneauth_otp', 'otp')), false),
         COALESCE(bool_and(mode = 'otp'), false),
         COALESCE(bool_and(screen) FILTER (WHERE mode IN ('oneauth_otp', 'otp')), false),
         (SELECT id FROM m WHERE mode IN ('oneauth_otp', 'otp') ORDER BY name LIMIT 1)
    FROM m
$$;
REVOKE EXECUTE ON FUNCTION app.login_policy(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.login_policy(bigint) TO edupro_app;

-- Is the code-only sign-in offered on this installation at all (some school is 'otp')?
CREATE OR REPLACE FUNCTION app.otp_login_offered() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT EXISTS (SELECT 1 FROM schools s WHERE s.status = 'active' AND app.school_setting_of(s.id, 'auth.login_mode') #>> '{}' = 'otp')
$$;
REVOKE EXECUTE ON FUNCTION app.otp_login_offered() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_login_offered() TO edupro_app;

-- The one active user an email or a mobile number (last ten digits) names; nothing when none or several.
CREATE OR REPLACE FUNCTION app.otp_find_user(p_login text)
RETURNS TABLE (user_id bigint, sub text, email text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  WITH hit AS (
    SELECT u.id, u.oneauth_sub, u.email, u.display_name FROM users u
     WHERE u.deleted_at IS NULL AND u.status = 'active'
       AND ((position('@' IN p_login) > 0 AND lower(u.email) = lower(btrim(p_login)))
         OR (length(regexp_replace(p_login, '\D', '', 'g')) >= 10
             AND right(regexp_replace(COALESCE(u.mobile, ''), '\D', '', 'g'), 10) = right(regexp_replace(p_login, '\D', '', 'g'), 10)))
  )
  SELECT id, oneauth_sub, email, display_name FROM hit WHERE (SELECT count(*) FROM hit) = 1
$$;
REVOKE EXECUTE ON FUNCTION app.otp_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_find_user(text) TO edupro_app;

CREATE OR REPLACE FUNCTION app.otp_user(p_user_id bigint)
RETURNS TABLE (sub text, email text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT oneauth_sub, email, display_name FROM users WHERE id = p_user_id AND deleted_at IS NULL AND status = 'active'
$$;
REVOKE EXECUTE ON FUNCTION app.otp_user(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_user(bigint) TO edupro_app;

-- A new code: one every 30 seconds, five in 15 minutes; earlier open codes of the user are closed.
CREATE OR REPLACE FUNCTION app.otp_issue(p_user_id bigint, p_school_id bigint, p_purpose text, p_app text, p_code_hash text,
                                         p_sent_to text, p_on_screen boolean, p_ip text, p_user_agent text, p_minutes int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth_otp_challenges WHERE user_id = p_user_id AND created_at > now() - interval '30 seconds') THEN
    RAISE EXCEPTION 'auth.otp_wait' USING ERRCODE = 'P0001', DETAIL = 'a code was sent less than 30 seconds ago';
  END IF;
  IF (SELECT count(*) FROM auth_otp_challenges WHERE user_id = p_user_id AND created_at > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'auth.otp_too_many' USING ERRCODE = 'P0001', DETAIL = 'five codes in 15 minutes';
  END IF;
  UPDATE auth_otp_challenges SET consumed_at = now() WHERE user_id = p_user_id AND consumed_at IS NULL;
  INSERT INTO auth_otp_challenges (user_id, school_id, purpose, app, code_hash, sent_to, shown_on_screen, expires_at, ip, user_agent)
  VALUES (p_user_id, p_school_id, p_purpose, p_app, p_code_hash, p_sent_to, p_on_screen, now() + make_interval(mins => p_minutes), p_ip, left(p_user_agent, 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION app.otp_issue(bigint, bigint, text, text, text, text, boolean, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_issue(bigint, bigint, text, text, text, text, boolean, text, text, int) TO edupro_app;

-- Checks a code: ok (and used up), wrong, expired, locked (five wrong tries) or used. Unknown id = wrong.
CREATE OR REPLACE FUNCTION app.otp_check(p_id uuid, p_code_hash text, p_purpose text)
RETURNS TABLE (outcome text, user_id bigint, school_id bigint, app text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  c auth_otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM auth_otp_challenges WHERE id = p_id AND purpose = p_purpose FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'wrong'::text, NULL::bigint, NULL::bigint, NULL::text; RETURN; END IF;
  IF c.consumed_at IS NOT NULL THEN RETURN QUERY SELECT 'used'::text, c.user_id, c.school_id, c.app; RETURN; END IF;
  IF c.attempts >= 5 THEN RETURN QUERY SELECT 'locked'::text, c.user_id, c.school_id, c.app; RETURN; END IF;
  IF c.expires_at < now() THEN RETURN QUERY SELECT 'expired'::text, c.user_id, c.school_id, c.app; RETURN; END IF;
  IF c.code_hash <> p_code_hash THEN
    UPDATE auth_otp_challenges SET attempts = attempts + 1 WHERE id = p_id;
    RETURN QUERY SELECT CASE WHEN c.attempts + 1 >= 5 THEN 'locked' ELSE 'wrong' END, c.user_id, c.school_id, c.app;
    RETURN;
  END IF;
  UPDATE auth_otp_challenges SET consumed_at = now(), attempts = attempts + 1 WHERE id = p_id;
  RETURN QUERY SELECT 'ok'::text, c.user_id, c.school_id, c.app;
END
$$;
REVOKE EXECUTE ON FUNCTION app.otp_check(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_check(uuid, text, text) TO edupro_app;

CREATE OR REPLACE FUNCTION app.otp_trust_device(p_user_id bigint, p_app text, p_token_hash text, p_days int, p_user_agent text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  INSERT INTO auth_trusted_devices (user_id, app, token_hash, user_agent, expires_at)
  VALUES (p_user_id, p_app, p_token_hash, left(p_user_agent, 300), now() + make_interval(days => p_days))
$$;
REVOKE EXECUTE ON FUNCTION app.otp_trust_device(bigint, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_trust_device(bigint, text, text, int, text) TO edupro_app;

-- Is this browser remembered for the user and app? (marks it used)
CREATE OR REPLACE FUNCTION app.otp_device_ok(p_user_id bigint, p_app text, p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  UPDATE auth_trusted_devices SET last_used_at = now()
   WHERE user_id = p_user_id AND app = p_app AND token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now();
  RETURN FOUND;
END
$$;
REVOKE EXECUTE ON FUNCTION app.otp_device_ok(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_device_ok(bigint, text, text) TO edupro_app;

-- For the school's sign-in screen (System -> Sign-in): codes shown on screen and devices remembered, of the
-- school's members only; and forgetting every remembered device of the school's members.
CREATE OR REPLACE FUNCTION app.otp_screen_log(p_school_id bigint, p_limit int)
RETURNS TABLE (shown_at timestamptz, user_id bigint, display_name text, app text, purpose text, sent_to text, ip text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT c.created_at, c.user_id, u.display_name, c.app, c.purpose, c.sent_to, c.ip
    FROM auth_otp_challenges c JOIN users u ON u.id = c.user_id
   WHERE c.shown_on_screen AND c.school_id = p_school_id AND p_school_id = app.current_school_id()
   ORDER BY c.created_at DESC LIMIT p_limit
$$;
REVOKE EXECUTE ON FUNCTION app.otp_screen_log(bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_screen_log(bigint, int) TO edupro_app;

CREATE OR REPLACE FUNCTION app.otp_forget_devices(p_school_id bigint) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  n int;
BEGIN
  IF p_school_id IS DISTINCT FROM app.current_school_id() THEN RETURN 0; END IF;
  UPDATE auth_trusted_devices d SET revoked_at = now()
   WHERE d.revoked_at IS NULL
     AND d.user_id IN (SELECT um.user_id FROM user_school_memberships um WHERE um.school_id = p_school_id AND um.deleted_at IS NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE EXECUTE ON FUNCTION app.otp_forget_devices(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_forget_devices(bigint) TO edupro_app;
