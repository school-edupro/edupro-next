-- 0360: a credit's ledger line read "credited 6.0000000000000000" (the half-day rounding divides a numeric, so
-- the value kept sixteen decimal places when written into the trail). The value is now trimmed (6, 2.5); the
-- function is otherwise 0352's.
CREATE OR REPLACE FUNCTION app.staff_leave_credit(p_month DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_n INT := 0; v_credits INT; v_span INT; v_per NUMERIC; v_from DATE; v_to DATE;
        v_start DATE; v_factor NUMERIC; v_value NUMERIC; v_row staff_leave_balances; v_lost NUMERIC; v_days INT;
        v_note TEXT;
BEGIN
  FOR r IN
    SELECT e.id AS emp, e.joined_on, t.id AS type_id, t.code, p.*
      FROM employees e
      CROSS JOIN staff_leave_types t
      JOIN LATERAL (SELECT x.annual_days, x.accrues, COALESCE(x.credit, NULLIF(t.credit, 'none')) AS freq,
                           x.credit_months, x.days_per_credit, x.pro_rata, x.by_attendance
                      FROM staff_leave_policies x
                     WHERE x.leave_type_id = t.id AND x.status = 'active'
                       AND app.staff_in_scope(x.scope, x.scope_values, e.id)
                     ORDER BY x.priority, x.id LIMIT 1) p ON true
     WHERE e.deleted_at IS NULL AND e.status = 'active' AND t.status = 'active'
       AND t.keeps_balance AND NOT t.loss_of_pay
  LOOP
    CONTINUE WHEN NOT r.accrues OR r.freq IS NULL
              OR NOT (extract(month FROM p_month)::int = ANY(r.credit_months));
    v_credits := CASE r.freq WHEN 'Q' THEN 4 WHEN 'H' THEN 2 ELSE 1 END;
    v_span := 12 / v_credits;
    v_per := COALESCE(r.days_per_credit, r.annual_days / v_credits);
    v_from := (p_month - make_interval(months => v_span))::date;
    v_to := p_month - 1;
    v_factor := 1;
    v_start := v_from;
    v_note := '';
    IF r.pro_rata AND r.joined_on IS NOT NULL AND r.joined_on > v_from THEN
      v_start := LEAST(r.joined_on, v_to + 1);
      v_factor := GREATEST(0, (v_to - v_start + 1))::numeric / (v_to - v_from + 1);
      v_note := ' (pro rata from joining)';
    END IF;
    IF r.by_attendance AND v_start <= v_to THEN
      SELECT COALESCE(sum(CASE WHEN a.day_type IN ('A', 'HOLD') THEN 1
                               WHEN a.day_type = 'HD' THEN 0.5
                               WHEN a.day_type = 'LV' AND lt.loss_of_pay THEN COALESCE(a.leave_portion, 1)
                               ELSE 0 END), 0)
        INTO v_lost
        FROM staff_attendance_days a LEFT JOIN staff_leave_types lt ON lt.id = a.leave_type_id
       WHERE a.employee_id = r.emp AND a.day BETWEEN v_start AND v_to;
      v_days := v_to - v_start + 1;
      v_factor := v_factor * GREATEST(0, v_days - v_lost) / v_days;
      v_note := v_note || ' (by attendance: ' || trim(to_char(v_days - v_lost, 'FM999990.0')) || ' of ' || v_days || ' days)';
    END IF;
    v_value := trim_scale(round(v_per * v_factor * 2) / 2);   -- to the half day, written as 6 or 2.5
    v_row := app.staff_leave_balance_row(r.emp, r.type_id, p_month);
    CONTINUE WHEN v_row.credited = v_value AND EXISTS (SELECT 1 FROM unnest(v_row.trail) l WHERE l LIKE '% credited %');
    UPDATE staff_leave_balances SET credited = v_value, updated_at = now(),
           trail = trail || (to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'DD-MM-YYYY') || ' credited ' || v_value::text
                             || ' for ' || to_char(v_from, 'Mon YYYY') || ' to ' || to_char(v_to, 'Mon YYYY') || v_note)
     WHERE id = v_row.id;
    PERFORM app.staff_leave_resync(r.emp, r.type_id, p_month);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
