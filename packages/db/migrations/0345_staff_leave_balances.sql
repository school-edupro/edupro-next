-- 0345: staff leave balances — the monthly ledger's rules, shared by the API and the nightly job
-- (docs/design/85, phase B). Nothing lapses month to month: only in the session-end month (the month before
-- the policy's session start) is the balance kept up to the carry-forward cap or lapsed (the earlier
-- module's month-close job lapsed every month — fixed). A month opens at the effective closing of the month
-- before (its closing once closed, else what it would close at). Credits come in the policy's credit months,
-- for the 3 / 6 / 12 months before, pro rata from the day of joining.

-- the carry-forward rule and session of an employee's leave type: the first policy by priority, else the type
CREATE OR REPLACE FUNCTION app.staff_leave_rule(p_emp BIGINT, p_type BIGINT,
  OUT session_start INT, OUT carry BOOLEAN, OUT cap NUMERIC, OUT policy_id BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p.session_start_month, 4),
         COALESCE(p.carry_forward, t.carry_forward),
         CASE WHEN COALESCE(p.carry_forward, t.carry_forward)
              THEN LEAST(CASE WHEN p.carry_forward IS TRUE THEN p.carry_cap END, t.carry_cap) END,
         p.id
    FROM staff_leave_types t
    LEFT JOIN LATERAL (SELECT x.* FROM staff_leave_policies x
                        WHERE x.leave_type_id = t.id AND x.status = 'active'
                          AND app.staff_in_scope(x.scope, x.scope_values, p_emp)
                        ORDER BY x.priority, x.id LIMIT 1) p ON true
   WHERE t.id = p_type
$$;

CREATE OR REPLACE FUNCTION app.staff_leave_session_end(p_month DATE, p_start INT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT extract(month FROM p_month)::int = ((p_start + 10) % 12) + 1 $$;

-- what a month closes at: never below 0; at the session end kept up to the cap or lapsed
CREATE OR REPLACE FUNCTION app.staff_leave_close_figures(p_row staff_leave_balances,
  OUT closing NUMERIC, OUT lapsed NUMERIC)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_raw NUMERIC; r RECORD;
BEGIN
  v_raw := GREATEST(0, p_row.opening + p_row.credited + p_row.correction - p_row.held);
  SELECT * INTO r FROM app.staff_leave_rule(p_row.employee_id, p_row.leave_type_id);
  IF NOT app.staff_leave_session_end(p_row.month, r.session_start) THEN
    closing := v_raw; lapsed := 0;
  ELSIF NOT COALESCE(r.carry, false) THEN
    closing := 0; lapsed := v_raw;
  ELSIF r.cap IS NOT NULL THEN
    closing := LEAST(v_raw, r.cap); lapsed := v_raw - LEAST(v_raw, r.cap);
  ELSE
    closing := v_raw; lapsed := 0;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.staff_leave_effective_closing(p_row staff_leave_balances) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_row.closed THEN p_row.closing ELSE (app.staff_leave_close_figures(p_row)).closing END
$$;

-- the month's row of an employee's leave type, opened (at the effective closing of the month before) if missing
CREATE OR REPLACE FUNCTION app.staff_leave_balance_row(p_emp BIGINT, p_type BIGINT, p_month DATE)
RETURNS staff_leave_balances LANGUAGE plpgsql AS $$
DECLARE v_row staff_leave_balances; v_prev staff_leave_balances; v_open NUMERIC := 0;
BEGIN
  SELECT * INTO v_row FROM staff_leave_balances
   WHERE employee_id = p_emp AND leave_type_id = p_type AND month = p_month;
  IF FOUND THEN RETURN v_row; END IF;
  SELECT * INTO v_prev FROM staff_leave_balances
   WHERE employee_id = p_emp AND leave_type_id = p_type AND month < p_month ORDER BY month DESC LIMIT 1;
  IF FOUND THEN v_open := app.staff_leave_effective_closing(v_prev); END IF;
  INSERT INTO staff_leave_balances (school_id, employee_id, leave_type_id, month, opening, trail)
  VALUES ((SELECT school_id FROM employees WHERE id = p_emp), p_emp, p_type, p_month, v_open,
          ARRAY[to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'DD-MM-YYYY') || ' opened with ' || v_open::text
                || CASE WHEN v_prev.id IS NULL THEN '' ELSE ' carried from ' || to_char(v_prev.month, 'Mon YYYY') END])
  ON CONFLICT (employee_id, leave_type_id, month) DO NOTHING;
  SELECT * INTO v_row FROM staff_leave_balances
   WHERE employee_id = p_emp AND leave_type_id = p_type AND month = p_month;
  RETURN v_row;
END $$;

-- after a change in a month, the later open months (not set by an import) open again at the new figure
CREATE OR REPLACE FUNCTION app.staff_leave_resync(p_emp BIGINT, p_type BIGINT, p_from DATE) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_prev staff_leave_balances; v_row staff_leave_balances; v_open NUMERIC;
BEGIN
  SELECT * INTO v_prev FROM staff_leave_balances
   WHERE employee_id = p_emp AND leave_type_id = p_type AND month = p_from;
  IF NOT FOUND THEN RETURN; END IF;
  FOR v_row IN SELECT * FROM staff_leave_balances
                WHERE employee_id = p_emp AND leave_type_id = p_type AND month > p_from ORDER BY month LOOP
    IF v_row.closed OR v_row.imported THEN EXIT; END IF;
    v_open := app.staff_leave_effective_closing(v_prev);
    IF v_open <> v_row.opening THEN
      UPDATE staff_leave_balances SET opening = v_open, updated_at = now(),
             trail = trail || (to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'DD-MM-YYYY') || ' opening now ' || v_open::text
                               || ' (' || to_char(v_prev.month, 'Mon YYYY') || ' changed)')
       WHERE id = v_row.id RETURNING * INTO v_row;
    END IF;
    v_prev := v_row;
  END LOOP;
END $$;

-- close every open row of a month
CREATE OR REPLACE FUNCTION app.staff_leave_close_month(p_month DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_row staff_leave_balances; f RECORD; v_n INT := 0; v_raw NUMERIC;
BEGIN
  FOR v_row IN SELECT * FROM staff_leave_balances WHERE month = p_month AND NOT closed FOR UPDATE LOOP
    f := app.staff_leave_close_figures(v_row);
    v_raw := v_row.opening + v_row.credited + v_row.correction - v_row.held;
    UPDATE staff_leave_balances SET closing = f.closing, lapsed = f.lapsed, closed = true, updated_at = now(),
           trail = trail || (to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'DD-MM-YYYY') || ' closed at ' || f.closing::text
                             || CASE WHEN f.lapsed > 0 THEN ', ' || f.lapsed::text || ' lapsed (session end)' ELSE '' END
                             || CASE WHEN v_raw < 0 THEN ', overdrawn ' || (-v_raw)::text || ' set to 0' ELSE '' END)
     WHERE id = v_row.id;
    PERFORM app.staff_leave_resync(v_row.employee_id, v_row.leave_type_id, p_month);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- the credit of a month: for each active employee and leave type with a balance, the first policy by
-- priority that takes them in, credited, and has this month among its credit months; the credit for the
-- 3 / 6 / 12 months before, pro rata from the day of joining when the policy says so. Set, not added, so
-- a second run changes nothing.
CREATE OR REPLACE FUNCTION app.staff_leave_credit(p_month DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_n INT := 0; v_credits INT; v_span INT; v_per NUMERIC; v_from DATE; v_to DATE;
        v_start DATE; v_factor NUMERIC; v_value NUMERIC; v_row staff_leave_balances;
BEGIN
  FOR r IN
    SELECT e.id AS emp, e.joined_on, t.id AS type_id, t.code, p.*
      FROM employees e
      CROSS JOIN staff_leave_types t
      JOIN LATERAL (SELECT x.annual_days, x.accrues, COALESCE(x.credit, NULLIF(t.credit, 'none')) AS freq,
                           x.credit_months, x.days_per_credit, x.pro_rata
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
    IF r.pro_rata AND r.joined_on IS NOT NULL AND r.joined_on > v_from THEN
      v_start := LEAST(r.joined_on, v_to + 1);
      v_factor := GREATEST(0, (v_to - v_start + 1))::numeric / (v_to - v_from + 1);
    END IF;
    v_value := round(v_per * v_factor * 2) / 2;   -- to the half day
    v_row := app.staff_leave_balance_row(r.emp, r.type_id, p_month);
    CONTINUE WHEN v_row.credited = v_value AND EXISTS (SELECT 1 FROM unnest(v_row.trail) l WHERE l LIKE '% credited %');
    UPDATE staff_leave_balances SET credited = v_value, updated_at = now(),
           trail = trail || (to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'DD-MM-YYYY') || ' credited ' || v_value::text
                             || ' for ' || to_char(v_from, 'Mon YYYY') || ' to ' || to_char(v_to, 'Mon YYYY')
                             || CASE WHEN v_factor < 1 THEN ' (pro rata from joining)' ELSE '' END)
     WHERE id = v_row.id;
    PERFORM app.staff_leave_resync(r.emp, r.type_id, p_month);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- the nightly job: close every earlier month still open, open this month for every active employee and
-- leave type with a balance, credit this month. Safe to run every day (a missed night is caught up).
CREATE OR REPLACE FUNCTION app.staff_leave_month_end() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date; m DATE; v_n INT := 0;
        r RECORD;
BEGIN
  FOR m IN SELECT DISTINCT month FROM staff_leave_balances WHERE month < v_month AND NOT closed ORDER BY month LOOP
    v_n := v_n + app.staff_leave_close_month(m);
  END LOOP;
  FOR r IN SELECT e.id AS emp, t.id AS type_id FROM employees e CROSS JOIN staff_leave_types t
            WHERE e.deleted_at IS NULL AND e.status = 'active' AND t.status = 'active' AND t.keeps_balance AND NOT t.loss_of_pay
              AND NOT EXISTS (SELECT 1 FROM staff_leave_balances b WHERE b.employee_id = e.id AND b.leave_type_id = t.id AND b.month = v_month)
  LOOP
    PERFORM app.staff_leave_balance_row(r.emp, r.type_id, v_month);
    v_n := v_n + 1;
  END LOOP;
  v_n := v_n + app.staff_leave_credit(v_month);
  RETURN v_n;
END $$;

-- the morning list for each approver of the leave (and cancellations) waiting at their level, oldest first
CREATE OR REPLACE FUNCTION app.staff_leave_digest(p_url TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE u RECORD; v_n INT := 0; v_rows TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_leave_settings WHERE send_email) THEN RETURN 0; END IF;
  FOR u IN
    SELECT a.user_id, us.email, count(*)::int AS n,
           jsonb_agg(jsonb_build_object('no', r.number, 'who', e.display_name, 'type', t.code,
                                        'from', to_char(r.from_date, 'DD-MM-YYYY'), 'to', to_char(r.to_date, 'DD-MM-YYYY'),
                                        'what', CASE WHEN i.entity_type = 'staff_leave_cancel' THEN 'Cancellation' ELSE 'Leave' END,
                                        'days', ((now() AT TIME ZONE 'Asia/Kolkata')::date - (i.requested_at AT TIME ZONE 'Asia/Kolkata')::date))
                     ORDER BY i.requested_at) AS items
      FROM workflow_instances i
      JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
      CROSS JOIN LATERAL unnest(s.assignee_user_ids) a(user_id)
      JOIN staff_leave_requests r ON r.id = i.entity_id
      JOIN employees e ON e.id = r.employee_id
      JOIN staff_leave_types t ON t.id = r.leave_type_id
      JOIN users us ON us.id = a.user_id
     WHERE i.status = 'pending' AND i.entity_type IN ('staff_leave', 'staff_leave_cancel') AND us.email IS NOT NULL
     GROUP BY a.user_id, us.email
  LOOP
    SELECT string_agg(format('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s %s to %s</td><td align="right">%s</td></tr>',
                             replace(replace(i ->> 'no', '<', '&lt;'), '>', '&gt;'),
                             i ->> 'what',
                             replace(replace(i ->> 'who', '<', '&lt;'), '>', '&gt;'),
                             i ->> 'type', i ->> 'from', i ->> 'to',
                             CASE WHEN (i ->> 'days')::int >= 3 THEN '<strong style="color:#b42318">' || (i ->> 'days') || '</strong>'
                                  ELSE i ->> 'days' END), '')
      INTO v_rows FROM jsonb_array_elements(u.items) i;
    PERFORM app.queue_mail(
      u.email,
      format('Leave waiting for your approval: %s', u.n),
      format('<p>These leave requests wait for your decision (waiting 3 days or more in red).</p>'
             '<table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Leave no.</th><th align="left">For</th>'
             '<th align="left">Employee</th><th align="left">Leave</th><th align="right">Days waiting</th></tr>%s</table>'
             '<p><a href="%s/leave/approvals">Open the leave waiting for me</a></p>', v_rows, rtrim(p_url, '/')),
      '[]'::jsonb, jsonb_build_object('digest', 'staff_leave'), u.user_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
