-- A teacher's login reached the whole school (4 Nov 2026: E012, a Computer Science teacher of VI and IX,
-- was offered every class's papers in the teacher app's Marks). 0176 gives teaching staff the Subject
-- Teacher role when their login is made, with no section scope, and a role with no scope reaches every
-- section; the sections come from Teacher assignments (0016 app.sync_teacher_scopes), but assignments made
-- before the login were never synced to it. Now:
--   * making the login syncs the assignments the person already holds (below);
--   * the API reads a Class Teacher / Subject Teacher role with no section scope as no section
--     (AccessService.scopesFor), so a login with no assignment yet sees no class;
--   * logins made so far whose assignments were never synced are synced once (the end of this file).

CREATE OR REPLACE FUNCTION app.employee_create_login(p_employee BIGINT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  e       record;
  v_uid   bigint;
  v_role  bigint;
  v_ids   bigint[];
  v_digit text;
  v_year  bigint;
BEGIN
  SELECT id, school_id, user_id, email, mobile, display_name, employee_type INTO e
    FROM employees WHERE id = p_employee AND school_id = app.current_school_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'employee.not_found'; END IF;
  IF e.user_id IS NOT NULL THEN RETURN e.user_id; END IF;
  v_digit := right(regexp_replace(COALESCE(e.mobile, ''), '\D', '', 'g'), 10);
  IF e.email IS NULL AND length(v_digit) < 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'employee.no_contact';
  END IF;

  IF e.email IS NOT NULL THEN
    SELECT id INTO v_uid FROM users WHERE deleted_at IS NULL AND lower(email) = lower(e.email) ORDER BY id LIMIT 1;
  END IF;
  IF v_uid IS NULL AND length(v_digit) = 10 THEN
    SELECT array_agg(id) INTO v_ids FROM users
     WHERE deleted_at IS NULL AND right(regexp_replace(COALESCE(mobile, ''), '\D', '', 'g'), 10) = v_digit;
    IF cardinality(v_ids) = 1 THEN v_uid := v_ids[1]; END IF;
  END IF;
  IF v_uid IS NULL THEN
    INSERT INTO users (oneauth_sub, email, mobile, display_name)
    VALUES ('employee:' || e.school_id || ':' || e.id, e.email, NULLIF(v_digit, ''), e.display_name)
    RETURNING id INTO v_uid;
  END IF;

  INSERT INTO user_school_memberships (school_id, user_id, person_type, person_ref_id, status)
  VALUES (e.school_id, v_uid, 'employee', e.id, 'active')
  ON CONFLICT (school_id, user_id, person_type)
  DO UPDATE SET status = 'active', deleted_at = NULL, person_ref_id = EXCLUDED.person_ref_id, updated_at = now();

  IF e.employee_type <> 'non_teaching' THEN
    SELECT id INTO v_role FROM roles WHERE school_id IS NULL AND code = 'subject_teacher';
    IF v_role IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM user_roles WHERE school_id = e.school_id AND user_id = v_uid AND role_id = v_role AND revoked_at IS NULL) THEN
      INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES (e.school_id, v_uid, v_role, 'employee onboarded');
    END IF;
  END IF;
  UPDATE employees SET user_id = v_uid, updated_at = now() WHERE id = e.id;
  -- the teaching the person already holds becomes their roles and sections now (Teacher assignments made
  -- before the login had no user to give them to); the newest active year last, as the API syncs it
  FOR v_year IN
    SELECT ta.academic_year_id FROM teacher_assignments ta JOIN academic_years y ON y.id = ta.academic_year_id
     WHERE ta.employee_id = e.id AND ta.valid_to IS NULL AND y.status = 'active'
     GROUP BY ta.academic_year_id, y.start_date ORDER BY y.start_date
  LOOP
    PERFORM app.sync_teacher_scopes(e.id, v_year);
  END LOOP;
  RETURN v_uid;
END
$$;
REVOKE ALL ON FUNCTION app.employee_create_login(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.employee_create_login(BIGINT) TO edupro_app;

-- logins made so far (schools in use): a teacher role with no section scope, or an assignment kind with no
-- role, while the person holds assignments in an active year
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.school_id, e.id AS employee_id, ta.academic_year_id
      FROM employees e
      JOIN schools sc ON sc.id = e.school_id AND sc.status = 'active'
      JOIN teacher_assignments ta ON ta.employee_id = e.id AND ta.valid_to IS NULL
      JOIN academic_years y ON y.id = ta.academic_year_id AND y.status = 'active'
     WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
                     WHERE ur.user_id = e.user_id AND ur.school_id = e.school_id AND ur.revoked_at IS NULL
                       AND ro.school_id IS NULL AND ro.code IN ('class_teacher', 'subject_teacher')
                       AND NOT EXISTS (SELECT 1 FROM user_role_scopes s
                                        WHERE s.user_role_id = ur.id AND s.scope_type = 'class_section'))
            OR ta.kind <> 'indicator' AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
                            WHERE ur.user_id = e.user_id AND ur.school_id = e.school_id AND ur.revoked_at IS NULL
                              AND ro.school_id IS NULL
                              AND ro.code = CASE ta.kind WHEN 'coordinator' THEN 'academic_coordinator' ELSE ta.kind::text END))
     GROUP BY e.school_id, e.id, ta.academic_year_id, y.start_date
     ORDER BY e.school_id, e.id, y.start_date
  LOOP
    PERFORM set_config('app.school_id', r.school_id::text, true);
    PERFORM app.sync_teacher_scopes(r.employee_id, r.academic_year_id);
  END LOOP;
  PERFORM set_config('app.school_id', '', true);
END $$;
