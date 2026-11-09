-- 0350: the nightly run marks weekly offs and holidays over the absence look-back as well (a holiday last
-- month was left blank: the absent marking skips it and only this and next month were marked), and looks for
-- missing punches over the last week (a missed night was never caught) (docs/design/85, phase C).
CREATE OR REPLACE FUNCTION app.staff_attendance_nightly() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_month DATE; v_n INT := 0; s staff_leave_settings;
BEGIN
  SELECT * INTO s FROM staff_leave_settings WHERE school_id = app.current_school_id();
  IF s.school_id IS NULL THEN RETURN 0; END IF;
  v_month := date_trunc('month', v_today)::date;
  v_n := v_n + app.staff_attendance_sync(5000);
  v_n := v_n + app.staff_attendance_recompute(v_today - s.recheck_days, v_today - 1);
  v_n := v_n + app.staff_mark_offdays(LEAST(v_month, v_today - s.absent_lookback_days), (v_month + interval '2 months')::date - 1);
  v_n := v_n + app.staff_mark_absent(s.absent_lookback_days);
  v_n := v_n + app.staff_late_marks((v_month - interval '1 month')::date);
  v_n := v_n + app.staff_missing_detect(v_today - 7, v_today - 1);
  v_n := v_n + app.staff_lop_sweep(NULL);
  v_n := v_n + app.staff_month_deduct('late', (v_month - interval '1 month')::date);
  v_n := v_n + app.staff_month_deduct('missing', (v_month - interval '1 month')::date);
  RETURN v_n;
END $$;
