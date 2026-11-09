-- 0347: a month's balance read without opening it (docs/design/85): the row when it exists, else what it
-- would open at (the effective closing of the month before) — so looking at balances writes nothing.
CREATE OR REPLACE FUNCTION app.staff_leave_balance_peek(p_emp BIGINT, p_type BIGINT, p_month DATE)
RETURNS staff_leave_balances LANGUAGE plpgsql STABLE AS $$
DECLARE v_row staff_leave_balances; v_prev staff_leave_balances;
BEGIN
  SELECT * INTO v_row FROM staff_leave_balances
   WHERE employee_id = p_emp AND leave_type_id = p_type AND month = p_month;
  IF FOUND THEN RETURN v_row; END IF;
  SELECT * INTO v_prev FROM staff_leave_balances
   WHERE employee_id = p_emp AND leave_type_id = p_type AND month < p_month ORDER BY month DESC LIMIT 1;
  v_row.employee_id := p_emp;
  v_row.leave_type_id := p_type;
  v_row.month := p_month;
  v_row.opening := CASE WHEN v_prev.id IS NULL THEN 0 ELSE app.staff_leave_effective_closing(v_prev) END;
  v_row.credited := 0; v_row.held := 0; v_row.correction := 0; v_row.lapsed := 0;
  v_row.closed := false; v_row.imported := false; v_row.trail := '{}';
  RETURN v_row;
END $$;
