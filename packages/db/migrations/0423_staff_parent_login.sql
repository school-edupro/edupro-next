-- 0423: a staff member who is also a parent here sees their child with their staff login (one app, one sign-in).
-- The father's, mother's or guardian's section of the student's record says "School staff: Yes" and the employee
-- code (office-only fields). Until now that was only noted: the parent record kept its own login (or none), so the
-- staff login showed staff screens only. Now:
--  * joining a parent record to the staff member's login ties the record to that login and gives it the parent
--    membership and role here, so the app lists Staff and Parent of the child, and the family website opens with
--    the same sign-in;
--  * the office's save of the student's record joins it by itself when the record has no login of its own (or
--    already has the staff login); a record with a separate login is joined only when the office presses Use staff
--    login (that login then stops seeing the children of this record);
--  * Undo puts back the login the record had before (or none) and closes what the join opened;
--  * a staff member who gets a login later is joined to the records naming them that have no login;
--  * the record keeps which staff member it was joined to, the login it had before, and when and by whom.

ALTER TABLE guardians
  ADD COLUMN staff_employee_id   BIGINT REFERENCES employees(id),
  ADD COLUMN staff_prior_user_id BIGINT REFERENCES users(id),
  ADD COLUMN staff_joined_at     TIMESTAMPTZ,
  ADD COLUMN staff_joined_by     BIGINT;

COMMENT ON COLUMN guardians.staff_employee_id IS 'the staff member (School staff: Yes, employee code) whose login this parent record was joined to; NULL when not joined';
COMMENT ON COLUMN guardians.staff_prior_user_id IS 'the login the record had before it was joined to the staff login (NULL: none); Undo puts it back';
COMMENT ON COLUMN guardians.staff_joined_at IS 'when the record was joined to the staff login';
COMMENT ON COLUMN guardians.staff_joined_by IS 'who joined it (the office user, or NULL when the staff member''s new login joined it)';

CREATE INDEX guardians_staff_employee ON guardians (school_id, staff_employee_id) WHERE staff_employee_id IS NOT NULL;

-- Opens a login as a parent in a school: the guardian membership (kept on its first record) and the parent role.
CREATE OR REPLACE FUNCTION app.parent_login_open(p_school BIGINT, p_user BIGINT, p_guardian BIGINT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_role bigint;
BEGIN
  INSERT INTO user_school_memberships (school_id, user_id, person_type, person_ref_id, status)
  VALUES (p_school, p_user, 'guardian', p_guardian, 'active')
  ON CONFLICT (school_id, user_id, person_type)
  DO UPDATE SET status = 'active', deleted_at = NULL,
                person_ref_id = COALESCE(user_school_memberships.person_ref_id, EXCLUDED.person_ref_id),
                updated_at = now();
  SELECT id INTO v_role FROM roles WHERE school_id IS NULL AND code = 'parent';
  IF v_role IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM user_roles WHERE school_id = p_school AND user_id = p_user AND role_id = v_role AND revoked_at IS NULL) THEN
    INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES (p_school, p_user, v_role, p_reason);
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.parent_login_open(BIGINT, BIGINT, BIGINT, TEXT) FROM PUBLIC;

-- Closes a login as a parent in a school once no parent record there is tied to it: the guardian membership, and the
-- parent role when a staff join gave it.
CREATE OR REPLACE FUNCTION app.parent_login_close_if_unused(p_school BIGINT, p_user BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF p_user IS NULL OR EXISTS (
       SELECT 1 FROM guardians WHERE school_id = p_school AND user_id = p_user AND deleted_at IS NULL) THEN
    RETURN;
  END IF;
  UPDATE user_school_memberships SET status = 'inactive', updated_at = now()
   WHERE school_id = p_school AND user_id = p_user AND person_type = 'guardian' AND status = 'active';
  UPDATE user_roles SET revoked_at = now(), revoked_by = app.current_user_id(), updated_at = now()
   WHERE school_id = p_school AND user_id = p_user AND reason = 'joined as a parent (staff)' AND revoked_at IS NULL;
END
$$;
REVOKE ALL ON FUNCTION app.parent_login_close_if_unused(BIGINT, BIGINT) FROM PUBLIC;

-- Undo a join (in the record's school): the login it had before (or none) comes back; the staff login closes as a
-- parent here when no other record is tied to it. 'undone', or 'not_joined'.
CREATE OR REPLACE FUNCTION app.guardian_staff_undo_in(p_guardian BIGINT, p_school BIGINT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  g record;
BEGIN
  SELECT id, school_id, user_id, staff_employee_id, staff_prior_user_id INTO g
    FROM guardians WHERE id = p_guardian AND school_id = p_school AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'guardian.not_found'; END IF;
  IF g.staff_employee_id IS NULL THEN RETURN 'not_joined'; END IF;
  UPDATE guardians
     SET user_id = g.staff_prior_user_id, staff_employee_id = NULL, staff_prior_user_id = NULL,
         staff_joined_at = NULL, staff_joined_by = NULL, updated_at = now()
   WHERE id = g.id;
  IF g.staff_prior_user_id IS NOT NULL THEN
    PERFORM app.parent_login_open(g.school_id, g.staff_prior_user_id, g.id, 'login put back (staff join undone)');
  END IF;
  IF g.user_id IS DISTINCT FROM g.staff_prior_user_id THEN
    PERFORM app.parent_login_close_if_unused(g.school_id, g.user_id);
  END IF;
  RETURN 'undone';
END
$$;
REVOKE ALL ON FUNCTION app.guardian_staff_undo_in(BIGINT, BIGINT) FROM PUBLIC;

-- Join a parent record to the login of the staff member it names (in the record's school). p_move: also when the
-- record has a separate login of its own (that login then stops seeing this record's children).
-- Returns joined | already | separate_login | staff_no_login | no_employee | no_code | not_staff.
CREATE OR REPLACE FUNCTION app.guardian_staff_join_in(p_guardian BIGINT, p_school BIGINT, p_move BOOLEAN, p_by BIGINT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  g      record;
  e      record;
  v_code text;
BEGIN
  SELECT id, school_id, user_id, staff_employee_id, profile INTO g
    FROM guardians WHERE id = p_guardian AND school_id = p_school AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'guardian.not_found'; END IF;
  IF COALESCE(g.profile->>'school_staff', '') <> 'Yes' THEN RETURN 'not_staff'; END IF;
  v_code := NULLIF(btrim(COALESCE(g.profile->>'staff_employee_id', '')), '');
  IF v_code IS NULL THEN RETURN 'no_code'; END IF;
  SELECT id, user_id INTO e FROM employees
   WHERE school_id = g.school_id AND lower(employee_code) = lower(v_code) AND deleted_at IS NULL AND status = 'active';
  IF NOT FOUND THEN RETURN 'no_employee'; END IF;
  IF e.user_id IS NULL THEN RETURN 'staff_no_login'; END IF;
  IF g.staff_employee_id = e.id AND g.user_id = e.user_id THEN
    PERFORM app.parent_login_open(g.school_id, e.user_id, g.id, 'joined as a parent (staff)');
    RETURN 'already';
  END IF;
  -- joined to someone else before (the code was changed): put that back first
  IF g.staff_employee_id IS NOT NULL THEN
    PERFORM app.guardian_staff_undo_in(g.id, g.school_id);
    SELECT id, school_id, user_id, staff_employee_id, profile INTO g FROM guardians WHERE id = g.id;
  END IF;
  IF g.user_id IS NOT NULL AND g.user_id <> e.user_id AND NOT p_move THEN RETURN 'separate_login'; END IF;
  UPDATE guardians
     SET staff_prior_user_id = g.user_id, user_id = e.user_id, staff_employee_id = e.id,
         staff_joined_at = now(), staff_joined_by = p_by, updated_at = now()
   WHERE id = g.id;
  PERFORM app.parent_login_open(g.school_id, e.user_id, g.id, 'joined as a parent (staff)');
  IF g.user_id IS NOT NULL AND g.user_id <> e.user_id THEN
    PERFORM app.parent_login_close_if_unused(g.school_id, g.user_id);
  END IF;
  RETURN 'joined';
END
$$;
REVOKE ALL ON FUNCTION app.guardian_staff_join_in(BIGINT, BIGINT, BOOLEAN, BIGINT) FROM PUBLIC;

-- The office's calls, in the current school.
CREATE OR REPLACE FUNCTION app.guardian_staff_join(p_guardian BIGINT, p_move BOOLEAN)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  SELECT app.guardian_staff_join_in(p_guardian, app.current_school_id(), p_move, app.current_user_id())
$$;
REVOKE ALL ON FUNCTION app.guardian_staff_join(BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_staff_join(BIGINT, BOOLEAN) TO edupro_app;

CREATE OR REPLACE FUNCTION app.guardian_staff_undo(p_guardian BIGINT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  SELECT app.guardian_staff_undo_in(p_guardian, app.current_school_id())
$$;
REVOKE ALL ON FUNCTION app.guardian_staff_undo(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_staff_undo(BIGINT) TO edupro_app;

-- After the office saves a student's record: the father's, mother's or guardian's record (by the sections saved)
-- follows its School staff fields: joined when they name a staff member with a login and the record has no other
-- login; joined to someone else put back first; no longer staff put back. One row per record looked at.
CREATE OR REPLACE FUNCTION app.student_staff_parents_sync(p_student BIGINT, p_relations TEXT[])
RETURNS TABLE (guardian_id BIGINT, relation TEXT, result TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_school bigint := app.current_school_id();
  r        record;
  v_res    text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (g.id) g.id, sg.relation::text AS relation, g.staff_employee_id, g.profile
      FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
      JOIN students s ON s.id = sg.student_id
     WHERE sg.student_id = p_student AND s.school_id = v_school AND g.school_id = v_school
       AND g.deleted_at IS NULL AND sg.relation::text = ANY (p_relations)
     ORDER BY g.id
  LOOP
    IF COALESCE(r.profile->>'school_staff', '') <> 'Yes' THEN
      v_res := CASE WHEN r.staff_employee_id IS NOT NULL THEN app.guardian_staff_undo_in(r.id, v_school) ELSE 'not_staff' END;
    ELSE
      v_res := app.guardian_staff_join_in(r.id, v_school, false, app.current_user_id());
      -- the code no longer names the staff member it was joined to: put back
      IF v_res IN ('no_code', 'no_employee', 'staff_no_login') AND r.staff_employee_id IS NOT NULL THEN
        PERFORM app.guardian_staff_undo_in(r.id, v_school);
        v_res := 'undone';
      END IF;
    END IF;
    guardian_id := r.id;
    relation := r.relation;
    result := v_res;
    RETURN NEXT;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app.student_staff_parents_sync(BIGINT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.student_staff_parents_sync(BIGINT, TEXT[]) TO edupro_app;

-- A staff member who gets a login: the records naming them (School staff: Yes and their code) that have no login of
-- their own are joined to it.
CREATE OR REPLACE FUNCTION app.employee_login_joins_parents()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_id bigint;
BEGIN
  FOR v_id IN
    SELECT g.id FROM guardians g
     WHERE g.school_id = NEW.school_id AND g.deleted_at IS NULL AND g.user_id IS NULL AND g.staff_employee_id IS NULL
       AND COALESCE(g.profile->>'school_staff', '') = 'Yes'
       AND lower(btrim(COALESCE(g.profile->>'staff_employee_id', ''))) = lower(NEW.employee_code)
  LOOP
    PERFORM app.guardian_staff_join_in(v_id, NEW.school_id, false, NULL);
  END LOOP;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.employee_login_joins_parents() FROM PUBLIC;

CREATE TRIGGER employees_login_joins_parents
  AFTER UPDATE OF user_id ON employees
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND OLD.user_id IS DISTINCT FROM NEW.user_id AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION app.employee_login_joins_parents();
