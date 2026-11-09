-- 0349: staff attendance — the engine (docs/design/85, phase C), shared by the API and the nightly job.
-- The earlier engine's rules, kept, with its faults fixed: a worked day on a weekly off or holiday keeps its
-- punches (it was overwritten), a shift's half-day action charges half a day (it charged a full day), a
-- deduction for late marks or missing punches does not wipe the worked day, the late marks left at a
-- month's end lapse visibly (they stayed pending for ever), a locked month is never written.

-- ---- the timing of an employee's day ---------------------------------------------------------------------
-- the shift (the latest posting covering the day, else the default shift, else the first shift); then a
-- special timing for the employee and day wins over everything, a bus-duty shift and a posting of one day
-- keep the shift's own hours, else the department's timing; otherwise the shift's
CREATE OR REPLACE FUNCTION app.staff_timing(p_emp BIGINT, p_day DATE,
  OUT shift_id BIGINT, OUT shift_code TEXT, OUT shift_kind TEXT, OUT starts_at TIME, OUT ends_at TIME,
  OUT grace INT, OUT present_hours NUMERIC, OUT half_day_hours NUMERIC, OUT total_hours NUMERIC,
  OUT overtime BOOLEAN, OUT overtime_limit NUMERIC, OUT bus_duty BOOLEAN, OUT single_punch TEXT,
  OUT late_over INT, OUT late_action TEXT, OUT late_type BIGINT,
  OUT early_over INT, OUT early_action TEXT, OUT early_type BIGINT, OUT timing_source TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_sid BIGINT; v_one BOOLEAN := false; s staff_shifts; t staff_timings; v_school BIGINT; v_dept TEXT;
BEGIN
  SELECT e.school_id, e.department INTO v_school, v_dept FROM employees e WHERE e.id = p_emp;
  SELECT x.shift_id, x.from_date = x.to_date INTO v_sid, v_one FROM staff_shift_postings x
    JOIN staff_shifts h ON h.id = x.shift_id AND h.status = 'active'
   WHERE x.employee_id = p_emp AND x.status = 'active' AND x.from_date <= p_day AND (x.to_date IS NULL OR x.to_date >= p_day)
   ORDER BY x.from_date DESC, x.id DESC LIMIT 1;
  IF v_sid IS NULL THEN
    SELECT h.id INTO v_sid FROM staff_leave_settings st JOIN staff_shifts h ON h.id = st.default_shift_id AND h.status = 'active'
     WHERE st.school_id = v_school;
    v_one := false;
  END IF;
  IF v_sid IS NULL THEN
    SELECT h.id INTO v_sid FROM staff_shifts h WHERE h.school_id = v_school AND h.status = 'active' ORDER BY h.id LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN RETURN; END IF;
  SELECT * INTO s FROM staff_shifts WHERE id = v_sid;
  shift_id := s.id; shift_code := s.code; shift_kind := s.kind; starts_at := s.starts_at; ends_at := s.ends_at;
  grace := s.grace_minutes; present_hours := s.present_hours; half_day_hours := s.half_day_hours;
  total_hours := s.total_hours; overtime := s.overtime; overtime_limit := s.overtime_limit; bus_duty := s.bus_duty;
  single_punch := s.single_punch; late_over := s.late_over_minutes; late_action := s.late_action;
  late_type := s.late_leave_type_id; early_over := s.early_over_minutes; early_action := s.early_action;
  early_type := s.early_leave_type_id; timing_source := 'SHIFT';
  SELECT * INTO t FROM staff_timings x WHERE x.kind = 'special' AND x.status = 'active' AND x.employee_id = p_emp
     AND x.from_date <= p_day AND x.to_date >= p_day ORDER BY x.from_date DESC, x.id DESC LIMIT 1;
  IF t.id IS NULL THEN
    IF s.bus_duty THEN timing_source := 'BUS'; RETURN; END IF;
    IF v_one THEN timing_source := 'POSTING_DAY'; RETURN; END IF;
    SELECT * INTO t FROM staff_timings x WHERE x.kind = 'department' AND x.status = 'active' AND x.school_id = v_school
       AND lower(x.department) = lower(COALESCE(v_dept, '')) ORDER BY x.id DESC LIMIT 1;
    IF t.id IS NULL THEN RETURN; END IF;
    timing_source := 'DEPARTMENT';
  ELSE
    timing_source := CASE WHEN s.bus_duty THEN 'BUS_SPECIAL' ELSE 'SPECIAL' END;
  END IF;
  starts_at := t.starts_at; ends_at := t.ends_at; grace := t.grace_minutes; present_hours := t.present_hours;
  half_day_hours := t.half_day_hours; late_over := t.late_over_minutes; late_action := t.late_action;
  late_type := t.late_leave_type_id; early_over := t.early_over_minutes; early_action := t.early_action;
  early_type := t.early_leave_type_id;
END $$;

CREATE OR REPLACE FUNCTION app.staff_month_locked(p_school BIGINT, p_day DATE) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM staff_month_locks WHERE school_id = p_school AND locked AND month = date_trunc('month', p_day)::date)
$$;

-- write a day (insert or change), keeping the earlier version in the history when it changes
CREATE OR REPLACE FUNCTION app.staff_day_write(p_new staff_attendance_days, p_reason TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_old staff_attendance_days;
BEGIN
  SELECT * INTO v_old FROM staff_attendance_days WHERE employee_id = p_new.employee_id AND day = p_new.day FOR UPDATE;
  IF v_old.id IS NULL THEN
    INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, leave_type_id, leave_portion, shift_id, in_at, out_at,
                                       worked_hours, ot_hours, late_minutes, early_minutes, manual, source, trace, remark, updated_by)
    VALUES (p_new.school_id, p_new.employee_id, p_new.day, p_new.day_type, p_new.leave_type_id, p_new.leave_portion, p_new.shift_id,
            p_new.in_at, p_new.out_at, p_new.worked_hours, COALESCE(p_new.ot_hours, 0), COALESCE(p_new.late_minutes, 0),
            COALESCE(p_new.early_minutes, 0), COALESCE(p_new.manual, false), p_new.source, COALESCE(p_new.trace, '{}'),
            p_new.remark, app.current_user_id());
    RETURN 'written';
  END IF;
  IF v_old.day_type = p_new.day_type AND v_old.leave_type_id IS NOT DISTINCT FROM p_new.leave_type_id
     AND v_old.leave_portion IS NOT DISTINCT FROM p_new.leave_portion AND v_old.in_at IS NOT DISTINCT FROM p_new.in_at
     AND v_old.out_at IS NOT DISTINCT FROM p_new.out_at AND v_old.worked_hours IS NOT DISTINCT FROM p_new.worked_hours
     AND v_old.late_minutes = COALESCE(p_new.late_minutes, 0) AND v_old.early_minutes = COALESCE(p_new.early_minutes, 0)
     AND v_old.manual = COALESCE(p_new.manual, false) AND v_old.source = p_new.source
     AND v_old.remark IS NOT DISTINCT FROM p_new.remark THEN
    RETURN 'unchanged';
  END IF;
  INSERT INTO staff_attendance_history (school_id, employee_id, day, before, after, reason, changed_by)
  VALUES (v_old.school_id, v_old.employee_id, v_old.day, to_jsonb(v_old) - 'trace', to_jsonb(p_new) - 'trace', p_reason, app.current_user_id());
  UPDATE staff_attendance_days SET day_type = p_new.day_type, leave_type_id = p_new.leave_type_id, leave_portion = p_new.leave_portion,
         shift_id = p_new.shift_id, in_at = p_new.in_at, out_at = p_new.out_at, worked_hours = p_new.worked_hours,
         ot_hours = COALESCE(p_new.ot_hours, 0), late_minutes = COALESCE(p_new.late_minutes, 0),
         early_minutes = COALESCE(p_new.early_minutes, 0), manual = COALESCE(p_new.manual, false), source = p_new.source,
         trace = COALESCE(p_new.trace, '{}'), remark = p_new.remark, updated_by = app.current_user_id(), updated_at = now()
   WHERE id = v_old.id;
  RETURN 'written';
END $$;

-- ---- a day worked out from its punches -------------------------------------------------------------------
-- the punches of the day (a night shift: 13:00 to 13:00 the next day); IN the first, OUT the last one at least
-- the double-tap gap after it; worked hours (whole minutes); grace given back always (and the late minutes,
-- up to the late rule's, when the setting says) from the present / half-day hours; P / HD / A by hours, one
-- punch the shift's rule; the late and early rule only makes P or HD worse and charges leave (half a day
-- for HD or the named type, a day for A); a weekly off or holiday worked keeps its punches. Leave, salary
-- hold and a day set by a person are not touched; a locked month is not written.
CREATE OR REPLACE FUNCTION app.staff_day_compute(p_emp BIGINT, p_day DATE) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  tm RECORD; v_school BIGINT; v_row staff_attendance_days; v_gap INT; v_reduce BOOLEAN;
  v_from TIMESTAMPTZ; v_to TIMESTAMPTZ; v_in TIMESTAMPTZ; v_out TIMESTAMPTZ; v_n INT;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_worked NUMERIC; v_present NUMERIC; v_half NUMERIC; v_total NUMERIC;
  v_after INT := 0; v_late INT := 0; v_early INT := 0; v_forgive INT := 0; v_type TEXT; v_ot NUMERIC := 0;
  v_off TEXT; v_rule TEXT; v_charge NUMERIC := 0; v_charge_type BIGINT; v_target TEXT; v_new staff_attendance_days;
  v_out_res TEXT; v_remark TEXT;
BEGIN
  SELECT school_id INTO v_school FROM employees WHERE id = p_emp;
  IF app.staff_month_locked(v_school, p_day) THEN RETURN 'locked'; END IF;
  SELECT * INTO v_row FROM staff_attendance_days WHERE employee_id = p_emp AND day = p_day;
  IF v_row.id IS NOT NULL AND (v_row.manual OR v_row.day_type IN ('LV', 'HOLD')) THEN RETURN 'protected'; END IF;
  SELECT * INTO tm FROM app.staff_timing(p_emp, p_day);
  IF tm.shift_id IS NULL THEN RETURN 'no_shift'; END IF;
  SELECT punch_gap_minutes, late_reduces_hours INTO v_gap, v_reduce FROM staff_leave_settings WHERE school_id = v_school;
  v_gap := COALESCE(v_gap, 10);
  IF tm.shift_kind = 'night' THEN
    v_from := (p_day + time '13:00') AT TIME ZONE 'Asia/Kolkata';
  ELSE
    v_from := p_day::timestamp AT TIME ZONE 'Asia/Kolkata';
  END IF;
  v_to := v_from + interval '1 day';
  SELECT min(punched_at), count(*) INTO v_in, v_n FROM staff_punches
   WHERE employee_id = p_emp AND punched_at >= v_from AND punched_at < v_to;
  IF v_n = 0 THEN RETURN 'no_punch'; END IF;
  SELECT max(punched_at) INTO v_out FROM staff_punches
   WHERE employee_id = p_emp AND punched_at >= v_in + make_interval(mins => v_gap) AND punched_at < v_to;
  v_start := (p_day + tm.starts_at) AT TIME ZONE 'Asia/Kolkata';
  v_end := (p_day + tm.ends_at) AT TIME ZONE 'Asia/Kolkata';
  IF tm.shift_kind = 'night' AND tm.ends_at <= tm.starts_at THEN v_end := v_end + interval '1 day'; END IF;
  v_present := tm.present_hours; v_half := tm.half_day_hours; v_total := tm.total_hours;
  v_off := CASE WHEN v_row.day_type IN ('WO', 'H') THEN v_row.day_type
                WHEN app.staff_is_weekoff(p_emp, p_day) THEN 'WO'
                WHEN app.staff_is_holiday(p_emp, p_day, false) THEN 'H' END;
  IF tm.shift_kind = 'day' AND v_off IS NULL THEN
    v_after := GREATEST(0, floor(extract(epoch FROM v_in - v_start) / 60))::int;
    IF NOT tm.bus_duty THEN v_late := GREATEST(0, v_after - tm.grace); END IF;
    v_forgive := LEAST(v_after, tm.grace)
                 + CASE WHEN COALESCE(v_reduce, false) AND NOT tm.bus_duty THEN LEAST(v_late, COALESCE(tm.late_over, v_late)) ELSE 0 END;
    IF v_out IS NOT NULL THEN v_early := GREATEST(0, floor(extract(epoch FROM v_end - v_out) / 60))::int; END IF;
  END IF;
  IF v_out IS NOT NULL THEN
    v_worked := round(floor(extract(epoch FROM v_out - v_in) / 60) / 60.0, 2);
    IF v_forgive > 0 THEN
      v_present := GREATEST(0, v_present - v_forgive / 60.0);
      v_half := GREATEST(0, v_half - v_forgive / 60.0);
      v_total := GREATEST(0, v_total - v_forgive / 60.0);
    END IF;
    v_type := CASE WHEN v_worked >= v_present THEN 'P' WHEN v_worked >= v_half THEN 'HD' ELSE 'A' END;
    IF v_type = 'P' AND tm.overtime THEN
      v_ot := GREATEST(0, v_worked - v_total);
      IF tm.overtime_limit > 0 THEN v_ot := LEAST(v_ot, tm.overtime_limit); END IF;
    END IF;
  ELSE
    v_type := tm.single_punch;
  END IF;
  -- the late / early rule
  IF tm.shift_kind = 'day' AND v_off IS NULL AND v_type IN ('P', 'HD') THEN
    IF NOT tm.bus_duty AND tm.late_action <> 'none' AND tm.late_over IS NOT NULL AND v_late >= tm.late_over THEN
      v_target := CASE tm.late_action WHEN 'A' THEN 'A' ELSE 'HD' END;
      IF v_target = 'A' OR v_type = 'P' THEN
        v_rule := 'late'; v_type := v_target;
        v_charge := CASE WHEN v_target = 'A' THEN 1 ELSE 0.5 END;
        v_charge_type := CASE WHEN tm.late_action = 'leave' THEN tm.late_type END;
      END IF;
    END IF;
    IF tm.early_action <> 'none' AND tm.early_over IS NOT NULL AND v_out IS NOT NULL AND v_early >= tm.early_over THEN
      v_target := CASE tm.early_action WHEN 'A' THEN 'A' ELSE 'HD' END;
      IF (v_target = 'A' AND v_type <> 'A') OR (v_target = 'HD' AND v_type = 'P') THEN
        v_rule := COALESCE(v_rule || ' and early', 'early'); v_type := v_target;
        v_charge := GREATEST(v_charge, CASE WHEN v_target = 'A' THEN 1 ELSE 0.5 END);
        v_charge_type := COALESCE(v_charge_type, CASE WHEN tm.early_action = 'leave' THEN tm.early_type END);
      END IF;
    END IF;
    IF v_rule IS NOT NULL THEN v_ot := 0; END IF;
  END IF;
  v_remark := CASE
    WHEN v_off IS NOT NULL THEN CASE v_off WHEN 'WO' THEN 'Worked on a weekly off' ELSE 'Worked on a holiday' END
    WHEN v_rule IS NOT NULL THEN format('%s by %s min: %s by the shift rule', initcap(v_rule),
                                       CASE WHEN v_rule LIKE 'late%' THEN v_late ELSE v_early END,
                                       CASE v_type WHEN 'A' THEN 'absent' ELSE 'half day' END)
    WHEN v_out IS NULL THEN 'One punch only: no OUT'
  END;
  v_new.school_id := v_school; v_new.employee_id := p_emp; v_new.day := p_day;
  v_new.day_type := COALESCE(v_off, v_type); v_new.shift_id := tm.shift_id;
  v_new.in_at := v_in; v_new.out_at := v_out; v_new.worked_hours := v_worked; v_new.ot_hours := v_ot;
  v_new.late_minutes := v_late; v_new.early_minutes := v_early; v_new.manual := false;
  v_new.source := CASE WHEN v_off IS NOT NULL AND v_row.id IS NOT NULL THEN v_row.source ELSE 'punches' END;
  v_new.remark := v_remark;
  v_new.trace := jsonb_build_object(
    'timing', tm.timing_source, 'shift', tm.shift_code, 'kind', tm.shift_kind,
    'start', to_char(tm.starts_at, 'HH24:MI'), 'end', to_char(tm.ends_at, 'HH24:MI'), 'grace', tm.grace,
    'in', to_char(v_in AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
    'out', CASE WHEN v_out IS NOT NULL THEN to_char(v_out AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') END,
    'worked', v_worked, 'late', v_late, 'early', v_early, 'forgiven', v_forgive,
    'present', tm.present_hours, 'half', tm.half_day_hours, 'presentNow', round(v_present, 2), 'halfNow', round(v_half, 2),
    'singlePunch', CASE WHEN v_out IS NULL THEN tm.single_punch END, 'off', v_off, 'rule', v_rule, 'result', COALESCE(v_off, v_type));
  v_out_res := app.staff_day_write(v_new, 'punches');
  UPDATE staff_punches SET read = true WHERE employee_id = p_emp AND punched_at >= v_from AND punched_at < v_to AND NOT read;
  -- the rule's leave, once a day
  IF v_charge > 0 AND NOT EXISTS (SELECT 1 FROM staff_leave_requests r WHERE r.employee_id = p_emp AND r.source = 'auto_rule'
                                     AND r.from_date = p_day AND r.status IN ('pending', 'approved')) THEN
    PERFORM app.staff_leave_auto_deduct(p_emp, p_day, v_charge, 'auto_rule',
      format('%s by the shift rule', initcap(v_rule)), v_charge_type);
  END IF;
  RETURN v_out_res;
END $$;

-- ---- leave charged by the system -------------------------------------------------------------------------
-- a type named (the shift's rule) when it has the balance, else the deduction order: a type with a balance
-- needs enough of it this month, loss of pay always takes it; approved at once, held in this month. Nothing
-- when leave already covers the day or the month is locked.
CREATE OR REPLACE FUNCTION app.staff_leave_auto_deduct(p_emp BIGINT, p_day DATE, p_portion NUMERIC, p_source TEXT,
                                                       p_reason TEXT, p_type BIGINT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE t RECORD; v_school BIGINT; v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_month DATE;
        v_left NUMERIC; v_covered NUMERIC; v_session TEXT; v_num TEXT; v_id BIGINT; v_balance BOOLEAN;
BEGIN
  SELECT school_id INTO v_school FROM employees WHERE id = p_emp;
  IF app.staff_month_locked(v_school, p_day) THEN RETURN NULL; END IF;
  v_month := date_trunc('month', v_today)::date;
  SELECT COALESCE(sum(portion), 0), min(session) INTO v_covered, v_session FROM staff_leave_days
   WHERE employee_id = p_emp AND day = p_day AND status IN ('pending', 'approved');
  IF v_covered + p_portion > 1 THEN RETURN NULL; END IF;
  v_session := CASE WHEN p_portion < 1 THEN CASE WHEN v_session = 'first' THEN 'second' ELSE 'first' END END;
  FOR t IN SELECT x.id, x.code, x.keeps_balance, x.loss_of_pay FROM staff_leave_types x
            WHERE x.school_id = v_school AND x.status = 'active'
              AND (x.id = p_type OR (x.deduct_order IS NOT NULL AND (x.keeps_balance OR x.loss_of_pay)))
            ORDER BY (x.id = p_type) DESC NULLS LAST, x.deduct_order NULLS LAST, x.id LOOP
    v_balance := t.keeps_balance AND NOT t.loss_of_pay;
    IF v_balance THEN
      SELECT (b.opening + b.credited + b.correction - b.held) INTO v_left FROM app.staff_leave_balance_row(p_emp, t.id, v_month) b;
      CONTINUE WHEN v_left < p_portion;
    END IF;
    v_num := app.staff_leave_number(v_today);
    INSERT INTO staff_leave_requests (school_id, number, employee_id, leave_type_id, from_date, to_date, days, half_day, session,
                                      reason, status, source, held_month, note, decided_at, decision_note)
    VALUES (v_school, v_num, p_emp, t.id, p_day, p_day, p_portion, p_portion < 1, v_session, left(p_reason, 1000), 'approved',
            p_source, CASE WHEN v_balance THEN v_month END, 'charged by the system', now(), left(p_reason, 500))
    RETURNING id INTO v_id;
    INSERT INTO staff_leave_days (school_id, request_id, employee_id, day, portion, session, kind, status)
    VALUES (v_school, v_id, p_emp, p_day, p_portion, v_session, 'work', 'approved');
    IF v_balance THEN
      UPDATE staff_leave_balances SET held = held + p_portion, updated_at = now(),
             trail = trail || (to_char(v_today, 'DD-MM-YYYY') || ' held ' || p_portion::text || ' — ' || v_num || ' (' || left(p_reason, 80) || ')')
       WHERE employee_id = p_emp AND leave_type_id = t.id AND month = v_month;
      PERFORM app.staff_leave_resync(p_emp, t.id, v_month);
    END IF;
    RETURN v_id;
  END LOOP;
  RETURN NULL;
END $$;

-- ---- leave on the register --------------------------------------------------------------------------------
-- an approved leave's days show as leave (its type, a whole or half day), the punches kept; the system's
-- deductions for late marks, missing punches and the shift's rule leave the worked day as it is
CREATE OR REPLACE FUNCTION app.staff_attendance_apply_leave(p_request BIGINT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE d RECORD; v_old staff_attendance_days; v_new staff_attendance_days; v_n INT := 0;
BEGIN
  FOR d IN SELECT x.day, x.portion, r.school_id, r.employee_id, r.leave_type_id, r.number, t.code
             FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id JOIN staff_leave_types t ON t.id = r.leave_type_id
            WHERE x.request_id = p_request AND x.status = 'approved' AND r.source NOT IN ('auto_late', 'auto_missing', 'auto_rule')
  LOOP
    CONTINUE WHEN app.staff_month_locked(d.school_id, d.day);
    SELECT * INTO v_old FROM staff_attendance_days WHERE employee_id = d.employee_id AND day = d.day;
    v_new := v_old;
    v_new.school_id := d.school_id; v_new.employee_id := d.employee_id; v_new.day := d.day;
    v_new.day_type := 'LV'; v_new.leave_type_id := d.leave_type_id; v_new.leave_portion := d.portion;
    v_new.manual := false; v_new.source := 'leave';
    v_new.remark := format('%s %s%s', d.code, d.number, CASE WHEN d.portion < 1 THEN ' (half day)' ELSE '' END);
    PERFORM app.staff_day_write(v_new, 'leave ' || d.number);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- days no longer on leave (cancelled, cut): another approved leave on the day shows instead, else the day is
-- worked out again from its punches (none: the nightly marking decides)
CREATE OR REPLACE FUNCTION app.staff_attendance_remove_leave(p_emp BIGINT, p_days DATE[]) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_day DATE; v_row staff_attendance_days; v_other BIGINT; v_n INT := 0;
BEGIN
  FOREACH v_day IN ARRAY p_days LOOP
    SELECT * INTO v_row FROM staff_attendance_days WHERE employee_id = p_emp AND day = v_day;
    CONTINUE WHEN v_row.id IS NULL OR v_row.day_type <> 'LV' OR v_row.manual
                  OR app.staff_month_locked(v_row.school_id, v_day);
    SELECT x.request_id INTO v_other FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id
     WHERE x.employee_id = p_emp AND x.day = v_day AND x.status = 'approved' AND r.source NOT IN ('auto_late', 'auto_missing', 'auto_rule')
     ORDER BY x.id DESC LIMIT 1;
    IF v_other IS NOT NULL THEN
      PERFORM app.staff_attendance_apply_leave(v_other);
    ELSE
      INSERT INTO staff_attendance_history (school_id, employee_id, day, before, after, reason, changed_by)
      VALUES (v_row.school_id, p_emp, v_day, to_jsonb(v_row) - 'trace', NULL, 'leave taken off', app.current_user_id());
      DELETE FROM staff_attendance_days WHERE id = v_row.id;
      PERFORM app.staff_day_compute(p_emp, v_day);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- ---- the queue -------------------------------------------------------------------------------------------
-- punches matched to employees (the biometric id first, then the employee code), then each employee-day with
-- punches not yet read worked out (and the day before for a night shift)
CREATE OR REPLACE FUNCTION app.staff_attendance_sync(p_limit INT DEFAULT 2000) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  UPDATE staff_punches p SET employee_id = (
           SELECT e.id FROM employees e
            WHERE e.school_id = p.school_id AND e.deleted_at IS NULL AND e.status = 'active'
              AND (e.biometric_id = p.code OR upper(e.employee_code) = upper(p.code))
            ORDER BY (e.biometric_id = p.code) DESC NULLS LAST, e.id LIMIT 1)
   WHERE p.employee_id IS NULL AND p.school_id = app.current_school_id();
  FOR r IN SELECT DISTINCT p.employee_id AS emp, (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date AS d
             FROM staff_punches p WHERE NOT p.read AND p.employee_id IS NOT NULL ORDER BY 2, 1 LIMIT p_limit LOOP
    IF (SELECT t.shift_kind FROM app.staff_timing(r.emp, r.d - 1) t) = 'night' THEN
      PERFORM app.staff_day_compute(r.emp, r.d - 1);
    END IF;
    PERFORM app.staff_day_compute(r.emp, r.d);
    UPDATE staff_punches SET read = true
     WHERE employee_id = r.emp AND NOT read AND (punched_at AT TIME ZONE 'Asia/Kolkata')::date = r.d;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- the days of a range worked out again (after a rule, a shift or a timing changed)
CREATE OR REPLACE FUNCTION app.staff_attendance_recompute(p_from DATE, p_to DATE, p_emp BIGINT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_n INT;
BEGIN
  UPDATE staff_punches p SET read = false
   WHERE p.employee_id IS NOT NULL AND (p_emp IS NULL OR p.employee_id = p_emp)
     AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from - 1 AND p_to
     AND NOT app.staff_month_locked(p.school_id, (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date);
  v_n := app.staff_attendance_sync(100000);
  RETURN v_n;
END $$;

-- ---- the nightly marking ---------------------------------------------------------------------------------
-- weekly offs and holidays of a range: on empty days, and on absences the marking made (a worked day keeps
-- its punches; a day set by a person stays)
CREATE OR REPLACE FUNCTION app.staff_mark_offdays(p_from DATE, p_to DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_n INT := 0; v_new staff_attendance_days; v_old staff_attendance_days; v_name TEXT;
BEGIN
  FOR r IN SELECT e.id AS emp, e.school_id, d::date AS day,
                  CASE WHEN app.staff_is_weekoff(e.id, d::date) THEN 'WO' WHEN app.staff_is_holiday(e.id, d::date, false) THEN 'H' END AS kind
             FROM employees e CROSS JOIN generate_series(p_from, p_to, interval '1 day') d
            WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.school_id = app.current_school_id()
              AND (e.joined_on IS NULL OR d::date >= e.joined_on) LOOP
    CONTINUE WHEN r.kind IS NULL OR app.staff_month_locked(r.school_id, r.day);
    SELECT * INTO v_old FROM staff_attendance_days WHERE employee_id = r.emp AND day = r.day;
    CONTINUE WHEN v_old.id IS NOT NULL AND NOT (v_old.day_type = 'A' AND v_old.source = 'absent' AND NOT v_old.manual);
    IF r.kind = 'H' THEN
      SELECT h.name INTO v_name FROM holidays h WHERE h.school_id = r.school_id AND r.day BETWEEN h.starts_on AND h.ends_on
         AND h.kind IN ('holiday', 'vacation') AND NOT h.optional ORDER BY h.id LIMIT 1;
    END IF;
    v_new := NULL;
    v_new.school_id := r.school_id; v_new.employee_id := r.emp; v_new.day := r.day; v_new.day_type := r.kind;
    v_new.source := CASE r.kind WHEN 'WO' THEN 'weekoff' ELSE 'holiday' END;
    v_new.remark := CASE r.kind WHEN 'WO' THEN 'Weekly off' ELSE COALESCE(v_name, 'Holiday') END;
    PERFORM app.staff_day_write(v_new, 'marked ' || lower(v_new.remark));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- absent: a past day (yesterday back so many days) with nothing on it — no punch, not off, no leave, no
-- correction asked — after joining and in an open month
CREATE OR REPLACE FUNCTION app.staff_mark_absent(p_days INT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_n INT := 0; v_new staff_attendance_days; v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR r IN SELECT e.id AS emp, e.school_id, d::date AS day
             FROM employees e CROSS JOIN generate_series(v_today - p_days, v_today - 1, interval '1 day') d
            WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.school_id = app.current_school_id()
              AND (e.joined_on IS NULL OR d::date >= e.joined_on)
              AND NOT EXISTS (SELECT 1 FROM staff_attendance_days a WHERE a.employee_id = e.id AND a.day = d::date)
              AND NOT EXISTS (SELECT 1 FROM staff_leave_days x WHERE x.employee_id = e.id AND x.day = d::date AND x.status IN ('pending', 'approved'))
              AND NOT EXISTS (SELECT 1 FROM staff_regularisations g WHERE g.employee_id = e.id AND g.day = d::date AND g.status = 'pending')
              AND NOT EXISTS (SELECT 1 FROM staff_punches p WHERE p.employee_id = e.id
                                AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = d::date) LOOP
    CONTINUE WHEN app.staff_month_locked(r.school_id, r.day) OR app.staff_is_weekoff(r.emp, r.day)
                  OR app.staff_is_holiday(r.emp, r.day, false);
    v_new := NULL;
    v_new.school_id := r.school_id; v_new.employee_id := r.emp; v_new.day := r.day; v_new.day_type := 'A';
    v_new.source := 'absent'; v_new.remark := 'No punch recorded';
    PERFORM app.staff_day_write(v_new, 'marked absent');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- late marks: a day in late (after the start and grace) from the count-from date; a mark whose day is no
-- longer late (corrected) is waived
CREATE OR REPLACE FUNCTION app.staff_late_marks(p_from DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_floor DATE; v_n INT;
BEGIN
  SELECT GREATEST(p_from, COALESCE(exceptions_from, p_from)) INTO v_floor FROM staff_leave_settings WHERE school_id = app.current_school_id();
  v_floor := COALESCE(v_floor, p_from);
  INSERT INTO staff_late_marks (school_id, employee_id, day, in_at, starts_at, grace, late_minutes)
  SELECT a.school_id, a.employee_id, a.day, a.in_at, (a.trace ->> 'start')::time, COALESCE((a.trace ->> 'grace')::int, 0), a.late_minutes
    FROM staff_attendance_days a
   WHERE a.school_id = app.current_school_id() AND a.day >= v_floor AND a.late_minutes > 0 AND a.in_at IS NOT NULL
     AND a.day_type IN ('P', 'HD', 'A') AND a.trace ? 'start'
  ON CONFLICT (employee_id, day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE staff_late_marks m SET status = 'waived', reason = 'No longer late (the day was corrected)'
    FROM staff_attendance_days a
   WHERE a.employee_id = m.employee_id AND a.day = m.day AND m.status = 'pending' AND a.late_minutes = 0;
  RETURN v_n;
END $$;

-- missing punches: a working day with an IN and no OUT; the employee is e-mailed once (and the copy list)
CREATE OR REPLACE FUNCTION app.staff_missing_detect(p_from DATE, p_to DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_floor DATE; v_n INT := 0; r RECORD; v_cc TEXT; v_mail BOOLEAN; v_count INT;
BEGIN
  SELECT GREATEST(p_from, COALESCE(exceptions_from, p_from)), missing_punch_cc, send_email INTO v_floor, v_cc, v_mail
    FROM staff_leave_settings WHERE school_id = app.current_school_id();
  v_floor := COALESCE(v_floor, p_from);
  FOR r IN INSERT INTO staff_missing_punches (school_id, employee_id, day, missing)
           SELECT a.school_id, a.employee_id, a.day, CASE WHEN a.in_at IS NULL THEN 'in' ELSE 'out' END
             FROM staff_attendance_days a
            WHERE a.school_id = app.current_school_id() AND a.day BETWEEN v_floor AND p_to AND a.day_type IN ('P', 'HD', 'A')
              AND (a.in_at IS NULL) <> (a.out_at IS NULL) AND NOT a.manual
           ON CONFLICT (employee_id, day) DO NOTHING
           RETURNING id, employee_id, day LOOP
    v_n := v_n + 1;
    CONTINUE WHEN NOT COALESCE(v_mail, false);
    SELECT count(*)::int INTO v_count FROM staff_missing_punches
     WHERE employee_id = r.employee_id AND date_trunc('month', day) = date_trunc('month', r.day) AND status IN ('pending', 'used');
    PERFORM app.queue_mail(u.email,
              format('Missing punch on %s', to_char(r.day, 'DD-MM-YYYY')),
              format('<p>Dear %s, your attendance on %s has an IN punch but no OUT punch. If you were at work, ask for an attendance correction in EduPro. This is your missing punch number %s this month.</p>',
                     replace(replace(e.display_name, '<', '&lt;'), '>', '&gt;'), to_char(r.day, 'DD-MM-YYYY'), v_count),
              '[]'::jsonb, jsonb_build_object('kind', 'missing_punch', 'cc', COALESCE(v_cc, '')), u.id)
      FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.id = r.employee_id AND u.email IS NOT NULL;
    UPDATE staff_missing_punches SET mailed_at = now() WHERE id = r.id;
  END LOOP;
  RETURN v_n;
END $$;

-- ---- the monthly deductions ------------------------------------------------------------------------------
-- every so many late marks (or missing punches) of a month = a day of leave by the deduction order, charged
-- on the first day of each group; the marks left over lapse (shown, not kept for ever). Missing punches whose
-- day now has both punches, was set by a person or is leave / off are retired first. Once a month.
CREATE OR REPLACE FUNCTION app.staff_month_deduct(p_kind TEXT, p_month DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_school BIGINT := app.current_school_id(); v_per INT; e RECORD; m RECORD; v_ids BIGINT[]; v_days DATE[];
        v_req BIGINT; v_n INT := 0; v_i INT; v_day DATE; v_end DATE := (p_month + interval '1 month')::date - 1;
BEGIN
  IF EXISTS (SELECT 1 FROM staff_attendance_runs WHERE school_id = v_school AND kind = p_kind AND month = p_month) THEN RETURN 0; END IF;
  SELECT CASE p_kind WHEN 'late' THEN late_marks_per_leave ELSE missing_punches_per_leave END INTO v_per
    FROM staff_leave_settings WHERE school_id = v_school;
  v_per := COALESCE(v_per, CASE p_kind WHEN 'late' THEN 3 ELSE 4 END);
  IF p_kind = 'missing' THEN
    UPDATE staff_missing_punches x SET status = 'retired',
           reason = CASE WHEN a.in_at IS NOT NULL AND a.out_at IS NOT NULL THEN 'Punch corrected'
                         WHEN a.manual THEN 'Day set by the office' ELSE 'Not a working day now' END
      FROM staff_attendance_days a
     WHERE a.employee_id = x.employee_id AND a.day = x.day AND x.status = 'pending' AND x.day BETWEEN p_month AND v_end
       AND ((a.in_at IS NOT NULL AND a.out_at IS NOT NULL) OR a.manual OR a.day_type IN ('LV', 'H', 'WO'));
  END IF;
  FOR e IN SELECT employee_id FROM (
             SELECT employee_id FROM staff_late_marks WHERE p_kind = 'late' AND school_id = v_school AND status = 'pending' AND day BETWEEN p_month AND v_end
             UNION SELECT employee_id FROM staff_missing_punches WHERE p_kind = 'missing' AND school_id = v_school AND status = 'pending' AND day BETWEEN p_month AND v_end) x LOOP
    IF p_kind = 'late' THEN
      SELECT array_agg(id ORDER BY day), array_agg(day ORDER BY day) INTO v_ids, v_days FROM staff_late_marks
       WHERE employee_id = e.employee_id AND status = 'pending' AND day BETWEEN p_month AND v_end;
    ELSE
      SELECT array_agg(id ORDER BY day), array_agg(day ORDER BY day) INTO v_ids, v_days FROM staff_missing_punches
       WHERE employee_id = e.employee_id AND status = 'pending' AND day BETWEEN p_month AND v_end;
    END IF;
    v_i := 1;
    WHILE v_i + v_per - 1 <= cardinality(v_ids) LOOP
      v_req := NULL;
      FOR k IN v_i .. v_i + v_per - 1 LOOP
        v_day := v_days[k];
        v_req := app.staff_leave_auto_deduct(e.employee_id, v_day, 1, CASE p_kind WHEN 'late' THEN 'auto_late' ELSE 'auto_missing' END,
                   format('%s %s in %s (%s)', v_per, CASE p_kind WHEN 'late' THEN 'late marks' ELSE 'missing punches' END,
                          to_char(p_month, 'Mon YYYY'),
                          array_to_string(ARRAY(SELECT to_char(x, 'DD-MM') FROM unnest(v_days[v_i:v_i + v_per - 1]) x), ', ')));
        EXIT WHEN v_req IS NOT NULL;
      END LOOP;
      IF p_kind = 'late' THEN
        UPDATE staff_late_marks SET status = CASE WHEN v_req IS NULL THEN 'lapsed' ELSE 'used' END, request_id = v_req,
               reason = CASE WHEN v_req IS NULL THEN 'No day could take the leave (covered or locked)' END
         WHERE id = ANY(v_ids[v_i:v_i + v_per - 1]);
      ELSE
        UPDATE staff_missing_punches SET status = CASE WHEN v_req IS NULL THEN 'lapsed' ELSE 'used' END, request_id = v_req,
               reason = CASE WHEN v_req IS NULL THEN 'No day could take the leave (covered or locked)' END
         WHERE id = ANY(v_ids[v_i:v_i + v_per - 1]);
      END IF;
      IF v_req IS NOT NULL THEN v_n := v_n + 1; END IF;
      v_i := v_i + v_per;
    END LOOP;
    IF v_i <= cardinality(v_ids) THEN
      IF p_kind = 'late' THEN
        UPDATE staff_late_marks SET status = 'lapsed', reason = format('Fewer than %s left at the month''s end', v_per)
         WHERE id = ANY(v_ids[v_i:cardinality(v_ids)]);
      ELSE
        UPDATE staff_missing_punches SET status = 'lapsed', reason = format('Fewer than %s left at the month''s end', v_per)
         WHERE id = ANY(v_ids[v_i:cardinality(v_ids)]);
      END IF;
    END IF;
  END LOOP;
  INSERT INTO staff_attendance_runs (school_id, kind, month, result) VALUES (v_school, p_kind, p_month, v_n);
  RETURN v_n;
END $$;

-- loss of pay for absence nobody explained: an absent day older than the setting's days (or every absent day
-- of a month being locked) with no leave and no correction asked is charged a day by the deduction order and
-- shows as that leave
CREATE OR REPLACE FUNCTION app.staff_lop_sweep(p_month DATE DEFAULT NULL) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_after INT; v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date; r RECORD; v_req BIGINT; v_n INT := 0;
BEGIN
  SELECT lop_after_days INTO v_after FROM staff_leave_settings WHERE school_id = app.current_school_id();
  v_after := COALESCE(v_after, 7);
  FOR r IN SELECT a.employee_id, a.day FROM staff_attendance_days a
            WHERE a.school_id = app.current_school_id() AND a.day_type = 'A'
              AND CASE WHEN p_month IS NOT NULL THEN a.day BETWEEN p_month AND (p_month + interval '1 month')::date - 1
                       ELSE a.day < v_today - v_after AND a.day >= v_today - 62 END
              AND NOT EXISTS (SELECT 1 FROM staff_leave_days x WHERE x.employee_id = a.employee_id AND x.day = a.day AND x.status IN ('pending', 'approved'))
              AND NOT EXISTS (SELECT 1 FROM staff_regularisations g WHERE g.employee_id = a.employee_id AND g.day = a.day AND g.status = 'pending')
            ORDER BY a.day LOOP
    v_req := app.staff_leave_auto_deduct(r.employee_id, r.day, 1, 'auto_absent',
               format('Absent on %s with no leave applied', to_char(r.day, 'DD-MM-YYYY')));
    IF v_req IS NOT NULL THEN
      PERFORM app.staff_attendance_apply_leave(v_req);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- the nightly run: off days marked (this month and the next), absences, a few days back worked out again
-- (punches that came late), late marks, missing punches (and their e-mails), loss of pay for unexplained
-- absence, and once a month last month's deductions
CREATE OR REPLACE FUNCTION app.staff_attendance_nightly() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_month DATE; v_n INT := 0; s staff_leave_settings;
BEGIN
  SELECT * INTO s FROM staff_leave_settings WHERE school_id = app.current_school_id();
  IF s.school_id IS NULL THEN RETURN 0; END IF;
  v_month := date_trunc('month', v_today)::date;
  v_n := v_n + app.staff_attendance_sync(5000);
  v_n := v_n + app.staff_attendance_recompute(v_today - s.recheck_days, v_today - 1);
  v_n := v_n + app.staff_mark_offdays(v_month, (v_month + interval '2 months')::date - 1);
  v_n := v_n + app.staff_mark_absent(s.absent_lookback_days);
  v_n := v_n + app.staff_late_marks((v_month - interval '1 month')::date);
  v_n := v_n + app.staff_missing_detect(v_today - 3, v_today - 1);
  v_n := v_n + app.staff_lop_sweep(NULL);
  v_n := v_n + app.staff_month_deduct('late', (v_month - interval '1 month')::date);
  v_n := v_n + app.staff_month_deduct('missing', (v_month - interval '1 month')::date);
  RETURN v_n;
END $$;
