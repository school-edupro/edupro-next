-- 0176: a staff login made when an employee is onboarded (docs/design/30-employee-master.md). The person
-- signs in by a code to the mobile or email on the employee record. An account already holding the same
-- email (or, when only one does, the same mobile) is the same person: it is linked, not duplicated.
-- Teaching, contract and visiting staff get the Subject Teacher role; non-teaching staff only the staff
-- membership (the school admin gives roles in Access).
CREATE OR REPLACE FUNCTION app.employee_create_login(p_employee BIGINT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  e       record;
  v_uid   bigint;
  v_role  bigint;
  v_ids   bigint[];
  v_digit text;
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
  RETURN v_uid;
END
$$;
REVOKE ALL ON FUNCTION app.employee_create_login(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.employee_create_login(BIGINT) TO edupro_app;
