-- Staff attendance (docs/design/85, "the corrections log"): the register's Attendance Corrections list every
-- change a person made to a day. Until now a day's first write (no earlier version) left no history, so a
-- hand correction of a day not worked out yet was missing; it is kept now. The system's own first writes (the
-- nightly run, no person) still are not.
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
    -- a person's first write of a day (a hand correction of a day not worked out yet, leave on a day to
    -- come) is kept in the history too: the corrections log shows every change a person made
    IF app.current_user_id() IS NOT NULL THEN
      INSERT INTO staff_attendance_history (school_id, employee_id, day, before, after, reason, changed_by)
      VALUES (p_new.school_id, p_new.employee_id, p_new.day, NULL, to_jsonb(p_new) - 'trace', p_reason, app.current_user_id());
    END IF;
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
