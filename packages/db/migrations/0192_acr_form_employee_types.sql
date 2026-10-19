-- 0192: a self-appraisal form may name the employee types it is for (docs/design/32-employee-acr.md):
-- Class Four, Teaching Contract… from Staff setup → Employee types. An employee's type is the name on
-- the record (profile.staff_type). The most specific active self form wins: for their side naming their
-- type, for all staff naming their type, for their side, for all staff; ties by the order on the tab.
ALTER TABLE acr_forms ADD COLUMN employee_type_ids BIGINT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION app.acr_self_form(p_group TEXT, p_employee BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT f.id
    FROM acr_forms f JOIN employees e ON e.id = p_employee
   WHERE f.school_id = e.school_id AND f.part = 'self' AND f.active
     AND f.staff_group IN (p_group, 'both')
     AND (cardinality(f.employee_type_ids) = 0
          OR EXISTS (SELECT 1 FROM employee_types t
                      WHERE t.id = ANY(f.employee_type_ids) AND t.school_id = e.school_id
                        AND lower(t.name) = lower(COALESCE(e.profile->>'staff_type', ''))))
   ORDER BY (cardinality(f.employee_type_ids) > 0) DESC, (f.staff_group = p_group) DESC, f.sort_order, f.id
   LIMIT 1
$$;

-- the ACR side of an employee for a year, as a cycle start decides it: the department or the employee
-- type's group; contract staff in a department for both are teaching when they have classes that year
CREATE OR REPLACE FUNCTION app.acr_staff_group(p_employee BIGINT, p_year BIGINT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN s.side = 'teaching'
                OR (s.side = 'both' AND EXISTS (SELECT 1 FROM teacher_assignments ta
                                                 WHERE ta.employee_id = p_employee AND ta.academic_year_id = p_year))
              THEN 'teaching' ELSE 'non_teaching' END
    FROM (SELECT app.employee_staff_side(e.department, e.employee_type) AS side FROM employees e WHERE e.id = p_employee) s
$$;
