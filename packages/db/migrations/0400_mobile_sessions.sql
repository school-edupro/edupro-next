-- 0400: the mobile app's sessions (docs/design/89, phase A).
--  * One row a signed-in phone: the hash of its refresh token (rotated at every refresh; the one before is kept,
--    so a stolen token played again signs that phone out), the device, how it signed in, when last used. Unused
--    for 60 days, or signed out (by the person, or by the school for a lost phone), it ends.
--  * One-time codes that hand a signed-in phone over to a web page inside the app (60 seconds, used once).
--  * Both are reached only through the SECURITY DEFINER functions below: forced row-level security and only the
--    migrator's policy (the application role cannot read them directly).
--  * The one-time sign-in codes and remembered devices also know the app 'mobile'.

ALTER TABLE auth_otp_challenges DROP CONSTRAINT IF EXISTS auth_otp_challenges_app_check;
ALTER TABLE auth_otp_challenges
  ADD CONSTRAINT auth_otp_challenges_app_check CHECK (app IN ('admin', 'teacher', 'parent', 'mobile'));
ALTER TABLE auth_trusted_devices DROP CONSTRAINT IF EXISTS auth_trusted_devices_app_check;
ALTER TABLE auth_trusted_devices
  ADD CONSTRAINT auth_trusted_devices_app_check CHECK (app IN ('admin', 'teacher', 'parent', 'mobile'));

CREATE TABLE mobile_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        BIGINT NOT NULL REFERENCES users(id),
  device_id      TEXT NOT NULL CHECK (device_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  device_name    TEXT,
  platform       TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  app_version    TEXT,
  method         TEXT NOT NULL CHECK (method IN ('otp', 'oneauth')),
  mfa            BOOLEAN NOT NULL DEFAULT false,
  refresh_hash   TEXT NOT NULL UNIQUE,
  previous_hash  TEXT,
  rotated_at     TIMESTAMPTZ,
  idle_days      INT NOT NULL DEFAULT 60 CHECK (idle_days BETWEEN 1 AND 365),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     BIGINT REFERENCES users(id),
  revoked_reason TEXT
);
CREATE INDEX mobile_sessions_user ON mobile_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX mobile_sessions_previous ON mobile_sessions (previous_hash) WHERE previous_hash IS NOT NULL;
ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_sessions_migrator ON mobile_sessions FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

CREATE TABLE mobile_web_handoffs (
  code_hash   TEXT PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES mobile_sessions(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  app         TEXT NOT NULL CHECK (app IN ('parent', 'teacher')),
  school_id   BIGINT REFERENCES schools(id),
  target      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mobile_web_handoffs_session ON mobile_web_handoffs (session_id);
ALTER TABLE mobile_web_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_web_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_web_handoffs_migrator ON mobile_web_handoffs FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- A phone signs in: its earlier session on the same device ends; the new one starts.
CREATE OR REPLACE FUNCTION app.mobile_session_start(p_user_id bigint, p_device_id text, p_device_name text,
  p_platform text, p_app_version text, p_method text, p_mfa boolean, p_refresh_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE mobile_sessions SET revoked_at = now(), revoked_reason = 'signed in again on this phone'
   WHERE user_id = p_user_id AND device_id = p_device_id AND revoked_at IS NULL;
  INSERT INTO mobile_sessions (user_id, device_id, device_name, platform, app_version, method, mfa, refresh_hash)
  VALUES (p_user_id, p_device_id, left(p_device_name, 100), p_platform, left(p_app_version, 40), p_method, p_mfa,
          p_refresh_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_session_start(bigint, text, text, text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_session_start(bigint, text, text, text, text, text, boolean, text) TO edupro_app;

-- A refresh: the token turns into a new one. outcome:
--   ok          rotated (session, user and mfa returned)
--   superseded  the token was rotated in the last 15 seconds (two refreshes at once): the app uses its newer token
--   reused      an older token played again after that: the phone is signed out (a stolen token)
--   expired     unused for longer than the session allows (signed out)
--   ended       signed out earlier
--   unknown     no such token
CREATE OR REPLACE FUNCTION app.mobile_session_refresh(p_old_hash text, p_new_hash text, p_device_id text,
  p_app_version text)
RETURNS TABLE (outcome text, session_id uuid, user_id bigint, mfa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE r mobile_sessions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM mobile_sessions m WHERE m.refresh_hash = p_old_hash FOR UPDATE;
  IF FOUND THEN
    IF r.revoked_at IS NOT NULL THEN
      RETURN QUERY SELECT 'ended'::text, r.id, r.user_id, r.mfa; RETURN;
    END IF;
    IF r.device_id <> p_device_id THEN
      RETURN QUERY SELECT 'unknown'::text, NULL::uuid, NULL::bigint, false; RETURN;
    END IF;
    IF r.last_used_at < now() - make_interval(days => r.idle_days) THEN
      UPDATE mobile_sessions SET revoked_at = now(), revoked_reason = 'unused too long' WHERE id = r.id;
      RETURN QUERY SELECT 'expired'::text, r.id, r.user_id, r.mfa; RETURN;
    END IF;
    UPDATE mobile_sessions
       SET previous_hash = refresh_hash, refresh_hash = p_new_hash, rotated_at = now(), last_used_at = now(),
           app_version = COALESCE(left(p_app_version, 40), app_version)
     WHERE id = r.id;
    RETURN QUERY SELECT 'ok'::text, r.id, r.user_id, r.mfa; RETURN;
  END IF;
  SELECT * INTO r FROM mobile_sessions m WHERE m.previous_hash = p_old_hash FOR UPDATE;
  IF FOUND THEN
    IF r.revoked_at IS NULL AND r.device_id = p_device_id AND r.rotated_at > now() - interval '15 seconds' THEN
      RETURN QUERY SELECT 'superseded'::text, r.id, r.user_id, r.mfa; RETURN;
    END IF;
    IF r.revoked_at IS NULL THEN
      UPDATE mobile_sessions SET revoked_at = now(), revoked_reason = 'an old sign-in token was used again'
       WHERE id = r.id;
    END IF;
    RETURN QUERY SELECT 'reused'::text, r.id, r.user_id, r.mfa; RETURN;
  END IF;
  RETURN QUERY SELECT 'unknown'::text, NULL::uuid, NULL::bigint, false;
END
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_session_refresh(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_session_refresh(text, text, text, text) TO edupro_app;

-- Is the session still open? (the access tokens name it; checked with a short cache)
CREATE OR REPLACE FUNCTION app.mobile_session_open(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT EXISTS (SELECT 1 FROM mobile_sessions
                  WHERE id = p_id AND revoked_at IS NULL AND last_used_at >= now() - make_interval(days => idle_days))
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_session_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_session_open(uuid) TO edupro_app;

-- A person's open phones (theirs only).
CREATE OR REPLACE FUNCTION app.mobile_sessions_of(p_user_id bigint)
RETURNS TABLE (id uuid, device_name text, platform text, app_version text, method text, created_at timestamptz,
               last_used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT m.id, m.device_name, m.platform, m.app_version, m.method, m.created_at, m.last_used_at
    FROM mobile_sessions m
   WHERE m.user_id = p_user_id AND m.revoked_at IS NULL
     AND m.last_used_at >= now() - make_interval(days => m.idle_days)
   ORDER BY m.last_used_at DESC
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_sessions_of(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_sessions_of(bigint) TO edupro_app;

-- A phone signed out: by its person (p_user_id the owner), or by someone else (p_by; the caller checks the right).
CREATE OR REPLACE FUNCTION app.mobile_session_revoke(p_id uuid, p_user_id bigint, p_by bigint, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  UPDATE mobile_sessions SET revoked_at = now(), revoked_by = p_by, revoked_reason = left(p_reason, 200)
   WHERE id = p_id AND user_id = p_user_id AND revoked_at IS NULL;
  RETURN FOUND;
END
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_session_revoke(uuid, bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_session_revoke(uuid, bigint, bigint, text) TO edupro_app;

-- A web page inside the app: a one-time code for the web app to turn into its own session.
CREATE OR REPLACE FUNCTION app.mobile_handoff_issue(p_code_hash text, p_session_id uuid, p_user_id bigint,
  p_app text, p_school_id bigint, p_target text, p_seconds int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mobile_sessions WHERE id = p_session_id AND user_id = p_user_id AND revoked_at IS NULL)
  THEN
    RAISE EXCEPTION 'mobile session not open' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO mobile_web_handoffs (code_hash, session_id, user_id, app, school_id, target, expires_at)
  VALUES (p_code_hash, p_session_id, p_user_id, p_app, p_school_id, left(p_target, 500),
          now() + make_interval(secs => p_seconds));
END
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_handoff_issue(text, uuid, bigint, text, bigint, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_handoff_issue(text, uuid, bigint, text, bigint, text, int) TO edupro_app;

-- The web app turns the code in (once, in time, the phone still signed in, for the app it was made for).
CREATE OR REPLACE FUNCTION app.mobile_handoff_redeem(p_code_hash text, p_app text)
RETURNS TABLE (user_id bigint, school_id bigint, target text, session_id uuid, mfa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE h mobile_web_handoffs%ROWTYPE;
BEGIN
  SELECT * INTO h FROM mobile_web_handoffs w WHERE w.code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND OR h.used_at IS NOT NULL OR h.expires_at < now() OR h.app <> p_app THEN
    RETURN;
  END IF;
  UPDATE mobile_web_handoffs SET used_at = now() WHERE code_hash = p_code_hash;
  RETURN QUERY
    SELECT h.user_id, h.school_id, h.target, h.session_id, m.mfa
      FROM mobile_sessions m
     WHERE m.id = h.session_id AND m.revoked_at IS NULL
       AND m.last_used_at >= now() - make_interval(days => m.idle_days);
END
$$;
REVOKE EXECUTE ON FUNCTION app.mobile_handoff_redeem(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mobile_handoff_redeem(text, text) TO edupro_app;
