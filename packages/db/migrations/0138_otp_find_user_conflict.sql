-- 0138: app.otp_find_user as 0137, with the output column names (user_id ...) no longer clashing with the
-- table columns of the account it makes at a parent's first sign-in (the ON CONFLICT target).
CREATE OR REPLACE FUNCTION app.otp_find_user(p_login text)
RETURNS TABLE (user_id bigint, sub text, email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
#variable_conflict use_column
DECLARE
  v_login  text := btrim(p_login);
  v_digits text := right(regexp_replace(p_login, '\D', '', 'g'), 10);
  v_mobile boolean := length(regexp_replace(p_login, '\D', '', 'g')) >= 10;
  v_mail   boolean := position('@' IN p_login) > 0;
  v_ids    bigint[] := '{}';
  v_email  text;
  g        record;
  v_uid    bigint;
  v_role   bigint;
BEGIN
  -- 1. login accounts, as before
  SELECT COALESCE(array_agg(DISTINCT u.id), '{}') INTO v_ids FROM users u
   WHERE u.deleted_at IS NULL AND u.status = 'active'
     AND ((v_mail AND lower(u.email) = lower(v_login))
       OR (v_mobile AND right(regexp_replace(COALESCE(u.mobile, ''), '\D', '', 'g'), 10) = v_digits));

  -- 2. guardian records of the schools that sign in by code alone: the linked one first, then the primary
  FOR g IN
    SELECT gd.id, gd.school_id, gd.user_id, gd.email, gd.mobile,
           COALESCE(NULLIF(gd.display_name, ''), concat_ws(' ', gd.first_name, gd.last_name)) AS name
      FROM guardians gd
     WHERE gd.deleted_at IS NULL AND gd.status = 'active'
       AND app.school_setting_of(gd.school_id, 'auth.login_mode') #>> '{}' = 'otp'
       AND ((v_mail AND lower(gd.email) = lower(v_login))
         OR (v_mobile AND right(regexp_replace(COALESCE(gd.mobile, ''), '\D', '', 'g'), 10) = v_digits)
         OR (NOT v_mail AND NOT v_mobile AND gd.id = (
              SELECT sg.guardian_id FROM student_guardians sg JOIN students s ON s.id = sg.student_id
               WHERE upper(s.admission_no) = upper(v_login) AND s.school_id = gd.school_id AND s.deleted_at IS NULL
               ORDER BY sg.is_primary DESC, (sg.relation = 'father') DESC, sg.id LIMIT 1)))
     ORDER BY (gd.user_id IS NOT NULL) DESC,
              (SELECT bool_or(sg.is_primary) FROM student_guardians sg WHERE sg.guardian_id = gd.id) DESC NULLS LAST, gd.id
  LOOP
    v_uid := g.user_id;
    IF v_uid IS NULL THEN
      -- one account per login: a guardian sharing the contact with one already found adds none
      IF cardinality(v_ids) > 0 THEN CONTINUE; END IF;
      INSERT INTO users (oneauth_sub, email, mobile, display_name)
      VALUES ('guardian:' || g.school_id || ':' || g.id, NULLIF(g.email, ''), NULLIF(g.mobile, ''), g.name)
      RETURNING id INTO v_uid;
      INSERT INTO user_school_memberships (school_id, user_id, person_type, status)
      VALUES (g.school_id, v_uid, 'guardian', 'active')
      ON CONFLICT (school_id, user_id, person_type) DO UPDATE SET status = 'active', deleted_at = NULL, updated_at = now();
      SELECT id INTO v_role FROM roles WHERE school_id IS NULL AND code = 'parent';
      IF v_role IS NOT NULL THEN
        INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES (g.school_id, v_uid, v_role, 'first sign-in by code');
      END IF;
      UPDATE guardians SET user_id = v_uid, updated_at = now() WHERE id = g.id;
    END IF;
    IF NOT v_uid = ANY (v_ids) THEN v_ids := v_ids || v_uid; END IF;
    -- the school's email for this parent, when the match came from the guardian record
    IF v_email IS NULL AND g.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v_email := g.email; END IF;
  END LOOP;

  IF cardinality(v_ids) <> 1 THEN RETURN; END IF;
  RETURN QUERY
    SELECT u.id, u.oneauth_sub, COALESCE(v_email, u.email), u.display_name
      FROM users u WHERE u.id = v_ids[1] AND u.deleted_at IS NULL AND u.status = 'active';
END
$$;
REVOKE EXECUTE ON FUNCTION app.otp_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_find_user(text) TO edupro_app;
