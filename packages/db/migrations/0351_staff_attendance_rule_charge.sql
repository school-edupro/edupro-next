-- 0351: the shift's late / early rule charges its leave whenever it fires on the minutes — a day already a
-- half day by its hours too (it charged only when it made the day worse) (docs/design/85, phase C).
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
    -- the rule fires on the minutes: the day becomes no better than its action, and the action's leave is
    -- charged (half a day for HD or a named type, a day for A) — a day already a half day by its hours too
    IF NOT tm.bus_duty AND tm.late_action <> 'none' AND tm.late_over IS NOT NULL AND v_late >= tm.late_over THEN
      v_target := CASE tm.late_action WHEN 'A' THEN 'A' ELSE 'HD' END;
      v_rule := 'late';
      IF v_target = 'A' OR v_type = 'P' THEN v_type := v_target; END IF;
      v_charge := CASE WHEN v_target = 'A' THEN 1 ELSE 0.5 END;
      v_charge_type := CASE WHEN tm.late_action = 'leave' THEN tm.late_type END;
    END IF;
    IF tm.early_action <> 'none' AND tm.early_over IS NOT NULL AND v_out IS NOT NULL AND v_early >= tm.early_over THEN
      v_target := CASE tm.early_action WHEN 'A' THEN 'A' ELSE 'HD' END;
      v_rule := COALESCE(v_rule || ' and early', 'early');
      IF v_target = 'A' OR v_type = 'P' THEN v_type := v_target; END IF;
      v_charge := GREATEST(v_charge, CASE WHEN v_target = 'A' THEN 1 ELSE 0.5 END);
      v_charge_type := COALESCE(v_charge_type, CASE WHEN tm.early_action = 'leave' THEN tm.early_type END);
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
