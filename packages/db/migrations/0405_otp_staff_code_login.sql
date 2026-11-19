-- 0405: say plainly when a sign-in is tried with a staff (employee) code.
--  * The code-only sign-in takes a mobile number, an e-mail or a child's admission number (app.otp_find_user). Staff
--    who typed their employee code (E003) got "No account was found …"; an employee code cannot sign in on its own
--    (every school numbers its staff the same way).
--  * Read-only: whether the login (no "@", fewer than 10 digits) is the employee code of someone in an active school.
--    The API uses it only where the school shows codes on screen (it then already answers plainly).

CREATE OR REPLACE FUNCTION app.otp_login_is_staff_code(p_login text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT position('@' IN p_login) = 0
     AND length(regexp_replace(p_login, '\D', '', 'g')) < 10
     AND EXISTS (SELECT 1 FROM employees e JOIN schools s ON s.id = e.school_id
                  WHERE upper(btrim(e.employee_code)) = upper(btrim(p_login))
                    AND e.deleted_at IS NULL AND s.status = 'active')
$$;
REVOKE EXECUTE ON FUNCTION app.otp_login_is_staff_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_login_is_staff_code(text) TO edupro_app;
