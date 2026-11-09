-- 0346: a school's leave set-up, when first opened, also gets the leave message templates (docs/design/85).
CREATE OR REPLACE FUNCTION app.staff_leave_seed_all(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.staff_leave_seed(p_school);
  PERFORM app.staff_leave_seed_templates(p_school);
END $$;
