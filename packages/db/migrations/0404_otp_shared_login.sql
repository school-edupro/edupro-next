-- 0404: say plainly when a sign-in's mobile number or e-mail belongs to more than one person.
--  * Code-only sign-in (app.otp_find_user) needs the login to lead to exactly one account; a mobile number entered for
--    several people (a staff member and parents, or two families) leads to more than one, and the sign-in was refused
--    with the same words as an unknown login ("No account was found …"), which sent people to the office for the
--    wrong reason.
--  * This counts, read-only and by the same rules as app.otp_find_user, the accounts a login leads to: the active
--    logins with that e-mail or mobile number, and the logins already linked to guardian records with it in schools
--    that sign families in by code (a guardian without a login adds one only when nothing else matched). The API uses
--    it only where the school shows codes on screen (it then already answers plainly, see OtpService.startLogin).

CREATE OR REPLACE FUNCTION app.otp_login_matches(p_login text)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  WITH v AS (
    SELECT btrim(p_login) AS login,
           right(regexp_replace(p_login, '\D', '', 'g'), 10) AS digits,
           length(regexp_replace(p_login, '\D', '', 'g')) >= 10 AS mobile,
           position('@' IN p_login) > 0 AS mail
  ),
  accounts AS (
    SELECT u.id FROM users u, v
     WHERE u.deleted_at IS NULL AND u.status = 'active'
       AND ((v.mail AND lower(u.email) = lower(v.login))
         OR (v.mobile AND right(regexp_replace(COALESCE(u.mobile, ''), '\D', '', 'g'), 10) = v.digits))
    UNION
    SELECT gd.user_id FROM guardians gd, v
     WHERE gd.deleted_at IS NULL AND gd.status = 'active' AND gd.user_id IS NOT NULL
       AND app.school_setting_of(gd.school_id, 'auth.login_mode') #>> '{}' = 'otp'
       AND ((v.mail AND lower(gd.email) = lower(v.login))
         OR (v.mobile AND right(regexp_replace(COALESCE(gd.mobile, ''), '\D', '', 'g'), 10) = v.digits))
  )
  SELECT count(*)::int FROM accounts
$$;
REVOKE EXECUTE ON FUNCTION app.otp_login_matches(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_login_matches(text) TO edupro_app;
