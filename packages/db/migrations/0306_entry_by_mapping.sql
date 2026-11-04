-- docs/design/71 (4 Nov 2026): who enters what.
--   * An Indicator assignment may narrow its areas (0301) to single indicators: `indicator_ids` (none:
--     every indicator of the areas; the areas none: every area).
--   * A Remarks assignment names the remark categories the teacher writes in the section:
--     `remark_category_ids` (at least one).
--   * app.sync_teacher_scopes: the Subject Teacher role is held, and scoped, while the person has a subject
--     teacher, Indicator or Remarks assignment; the sections of all four teaching kinds are its scopes (an
--     Indicator-only teacher reached no section since 0304).
ALTER TABLE teacher_assignments
  ADD COLUMN indicator_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN remark_category_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT teacher_assignments_indicators
    CHECK (kind = 'indicator' OR cardinality(indicator_ids) = 0),
  ADD CONSTRAINT teacher_assignments_remark_categories
    CHECK ((kind::text = 'remarks') = (cardinality(remark_category_ids) > 0));

CREATE OR REPLACE FUNCTION app.sync_teacher_scopes(p_employee_id BIGINT, p_academic_year_id BIGINT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id BIGINT;
  v_role_code TEXT;
  v_kinds TEXT[];
  v_role_id BIGINT;
  v_user_role_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  SELECT user_id INTO v_user_id FROM employees WHERE id = p_employee_id AND deleted_at IS NULL;
  IF v_user_id IS NULL THEN RETURN; END IF;   -- no login yet: synced when the login is made (0304)

  FOREACH v_role_code IN ARRAY ARRAY['class_teacher', 'subject_teacher', 'academic_coordinator'] LOOP
    v_kinds := CASE v_role_code
                 WHEN 'class_teacher' THEN ARRAY['class_teacher']
                 WHEN 'subject_teacher' THEN ARRAY['subject_teacher', 'indicator', 'remarks']
                 ELSE ARRAY['coordinator'] END;
    SELECT id INTO v_role_id FROM roles WHERE school_id IS NULL AND code = v_role_code;

    IF EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = p_employee_id AND ta.academic_year_id = p_academic_year_id
                  AND ta.kind::text = ANY(v_kinds) AND ta.valid_to IS NULL) THEN
      SELECT id INTO v_user_role_id FROM user_roles WHERE user_id = v_user_id AND role_id = v_role_id AND revoked_at IS NULL AND school_id = app.current_school_id() LIMIT 1;
      IF v_user_role_id IS NULL THEN
        INSERT INTO user_roles (school_id, user_id, role_id, granted_by, reason, created_by, updated_by)
        VALUES (app.current_school_id(), v_user_id, v_role_id, app.current_user_id(), 'teacher assignment sync', app.current_user_id(), app.current_user_id())
        RETURNING id INTO v_user_role_id;
      END IF;
      -- coordinators see the whole school; the teaching roles are scoped to the sections they teach in
      IF v_role_code <> 'academic_coordinator' THEN
        DELETE FROM user_role_scopes WHERE user_role_id = v_user_role_id AND scope_type = 'class_section';
        INSERT INTO user_role_scopes (school_id, user_role_id, scope_type, scope_id, created_by)
        SELECT DISTINCT app.current_school_id(), v_user_role_id, 'class_section'::scope_type, ta.class_section_id, app.current_user_id()
          FROM teacher_assignments ta
         WHERE ta.employee_id = p_employee_id AND ta.academic_year_id = p_academic_year_id AND ta.valid_to IS NULL
           AND ta.kind::text IN ('class_teacher', 'subject_teacher', 'indicator', 'remarks');
      END IF;
    ELSE
      UPDATE user_roles SET revoked_at = now(), updated_at = now(), updated_by = app.current_user_id()
       WHERE user_id = v_user_id AND role_id = v_role_id AND revoked_at IS NULL AND reason = 'teacher assignment sync' AND school_id = app.current_school_id();
    END IF;
  END LOOP;
END
$$;

-- Indicator-only teachers (schools in use, active years) take the Subject Teacher role and their sections
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.school_id, e.id AS employee_id, ta.academic_year_id
      FROM employees e
      JOIN schools sc ON sc.id = e.school_id AND sc.status = 'active'
      JOIN teacher_assignments ta ON ta.employee_id = e.id AND ta.valid_to IS NULL AND ta.kind = 'indicator'
      JOIN academic_years y ON y.id = ta.academic_year_id AND y.status = 'active'
     WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL
     GROUP BY e.school_id, e.id, ta.academic_year_id, y.start_date
     ORDER BY e.school_id, e.id, y.start_date
  LOOP
    PERFORM set_config('app.school_id', r.school_id::text, true);
    PERFORM app.sync_teacher_scopes(r.employee_id, r.academic_year_id);
  END LOOP;
  PERFORM set_config('app.school_id', '', true);
END $$;
