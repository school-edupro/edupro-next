-- Admission approvers (docs/design/50): the people a process level names — by person, designation or
-- role — decide there without the "decide registrations" permission; being named is the access (they
-- see only the registrations waiting at their level). A level for "anyone" names nobody, so it still
-- takes those who hold the permission.
CREATE OR REPLACE FUNCTION app.admission_level_users(p_level JSONB)
RETURNS SETOF BIGINT LANGUAGE sql STABLE AS $$
  WITH deciders AS (
    SELECT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.school_id = app.current_school_id() AND rp.permission_code = 'admissions.application.decide'
       AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
  ), people AS (
    SELECT d.user_id FROM deciders d WHERE p_level ->> 'by' = 'anyone'
    UNION
    SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE p_level ->> 'by' = 'role' AND ur.school_id = app.current_school_id() AND r.code = p_level ->> 'roleCode'
       AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
    UNION
    SELECT e.user_id FROM employees e
     WHERE p_level ->> 'by' = 'designation' AND lower(e.designation) = lower(p_level ->> 'designation')
       AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL
    UNION
    SELECT e.user_id FROM employees e
     WHERE p_level ->> 'by' = 'employees'
       AND e.id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_level -> 'employeeIds', '[]'::jsonb)))
       AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL
  )
  SELECT DISTINCT p.user_id FROM people p JOIN users u ON u.id = p.user_id WHERE u.deleted_at IS NULL
$$;
