-- 0144: "Remember this device" is the school's choice (setting auth.otp_remember, off by default): off means
-- the code is asked at every sign-in and devices remembered before no longer count. A user of several
-- schools may be remembered only when every school that asks a code allows it.
DROP FUNCTION app.login_policy(bigint);
CREATE OR REPLACE FUNCTION app.login_policy(p_user_id bigint)
RETURNS TABLE (otp_required boolean, otp_only boolean, on_screen boolean, school_id bigint, remember boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  WITH m AS (
    SELECT s.id, s.name,
           COALESCE(app.school_setting_of(s.id, 'auth.login_mode') #>> '{}', 'oneauth') AS mode,
           COALESCE((app.school_setting_of(s.id, 'auth.otp_on_screen') #>> '{}')::boolean, false) AS screen,
           COALESCE((app.school_setting_of(s.id, 'auth.otp_remember') #>> '{}')::boolean, false) AS remember
      FROM user_school_memberships um JOIN schools s ON s.id = um.school_id
     WHERE um.user_id = p_user_id AND um.status = 'active' AND um.deleted_at IS NULL AND s.status = 'active'
  )
  SELECT COALESCE(bool_or(mode IN ('oneauth_otp', 'otp')), false),
         COALESCE(bool_and(mode = 'otp'), false),
         COALESCE(bool_and(screen) FILTER (WHERE mode IN ('oneauth_otp', 'otp')), false),
         (SELECT id FROM m WHERE mode IN ('oneauth_otp', 'otp') ORDER BY name LIMIT 1),
         COALESCE(bool_and(remember) FILTER (WHERE mode IN ('oneauth_otp', 'otp')), false)
    FROM m
$$;
REVOKE EXECUTE ON FUNCTION app.login_policy(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.login_policy(bigint) TO edupro_app;
