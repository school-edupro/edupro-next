-- 0058: a school that has no helpdesk set-up yet (a new school) gets the default settings and query types
-- for each desk the first time the helpdesk is used; the API calls this before reading heads.
CREATE OR REPLACE FUNCTION app.helpdesk_ensure_defaults() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.assert_context();
  INSERT INTO helpdesk_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'parent') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, x.route_to, x.ord, 'parent', CASE WHEN x.route_to = 'class_teacher' THEN 'class_teacher' ELSE 'role' END, 24
      FROM (VALUES ('academics', 'Academics and homework', 'class_teacher', 1), ('attendance', 'Attendance', 'class_teacher', 2),
                   ('fees', 'Fees and payments', 'accountant', 3), ('transport', 'Transport', 'school_admin', 4),
                   ('admin', 'Office and documents', 'school_admin', 5), ('other', 'Other', 'class_teacher', 9)) AS x(code, name, route_to, ord)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'staff') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, x.route_to, x.ord, 'staff', 'role', x.sla
      FROM (VALUES ('payroll', 'Salary and payroll', 'school_admin', 1, 48), ('hr', 'HR, leave balance and documents', 'school_admin', 2, 48),
                   ('it', 'IT, computer and login', 'school_admin', 3, 24), ('facilities', 'Facilities and maintenance', 'school_admin', 4, 48),
                   ('academic', 'Academic and timetable', 'academic_coordinator', 5, 48), ('other', 'Other', 'school_admin', 9, 48)) AS x(code, name, route_to, ord, sla)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM query_categories WHERE school_id = app.current_school_id() AND desk = 'provider') THEN
    INSERT INTO query_categories (school_id, code, name, route_to, sort_order, desk, owner_type, sla_hours)
    SELECT app.current_school_id(), x.code, x.name, 'erp_support', x.ord, 'provider', 'provider', NULL
      FROM (VALUES ('bug', 'Something is not working', 1), ('how_to', 'How do I…', 2), ('data_fix', 'Data correction', 3),
                   ('access', 'Login and access', 4), ('feature', 'New feature or change', 5), ('other', 'Other', 9)) AS x(code, name, ord)
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;
