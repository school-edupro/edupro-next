-- 0181: which documents an employee must have (docs/design/30-employee-master.md): the side of the staff
-- they are on — teaching or non-teaching — from their department (Staff setup), else from the staff
-- group of their employee type; contract staff in a department for both count as neither (only the
-- documents required for all apply to them).
CREATE OR REPLACE FUNCTION app.employee_staff_side(p_department TEXT, p_type employee_type) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE COALESCE((SELECT d.staff_group FROM departments d
                         WHERE lower(d.name) = lower(trim(p_department)) AND d.status = 'active' LIMIT 1), 'both')
           WHEN 'teaching' THEN 'teaching'
           WHEN 'non_teaching' THEN 'non_teaching'
           ELSE CASE WHEN p_type = 'non_teaching' THEN 'non_teaching'
                     WHEN p_type IN ('teaching', 'visiting') THEN 'teaching'
                     ELSE 'both' END
         END
$$;

-- the document types an employee needs, with how many of each are on file (not expired)
CREATE OR REPLACE FUNCTION app.employee_documents_due(p_employee BIGINT)
RETURNS TABLE (type_id BIGINT, required BOOLEAN, on_file INT, valid INT)
LANGUAGE sql STABLE AS $$
  SELECT t.id,
         t.required_for = 'all' OR t.required_for = app.employee_staff_side(e.department, e.employee_type),
         (SELECT count(*)::int FROM employee_documents d WHERE d.employee_id = e.id AND d.type_id = t.id AND d.deleted_at IS NULL),
         (SELECT count(*)::int FROM employee_documents d WHERE d.employee_id = e.id AND d.type_id = t.id AND d.deleted_at IS NULL
             AND (d.expires_on IS NULL OR d.expires_on >= CURRENT_DATE))
    FROM employees e JOIN employee_document_types t ON t.school_id = e.school_id AND t.status = 'active'
   WHERE e.id = p_employee
$$;
