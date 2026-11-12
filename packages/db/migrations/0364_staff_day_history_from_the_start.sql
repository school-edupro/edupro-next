-- 0364: a day's History starts with how it was first made (docs/design/85, "As built — the day's history").
-- Until now the system's first write of a day (worked out from the punches, the nightly weekly off / holiday /
-- absent marks) left no history, so a day never changed afterwards showed an empty History. It is kept now,
-- and the days already made get that first entry: the version before their first change, else the day as it
-- stands; when it was written, by whom (nobody for the system's) and why, as the system words it.
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
    -- the first write of a day is kept in its history, the system's too (worked out from the punches, the
    -- nightly marks): the day's History starts with how it was first made; the corrections log leaves the
    -- system's out
    INSERT INTO staff_attendance_history (school_id, employee_id, day, before, after, reason, changed_by)
    VALUES (p_new.school_id, p_new.employee_id, p_new.day, NULL, to_jsonb(p_new) - 'trace', p_reason, app.current_user_id());
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

INSERT INTO staff_attendance_history (school_id, employee_id, day, before, after, reason, changed_by, changed_at)
SELECT d.school_id, d.employee_id, d.day, NULL, v.v,
       CASE v.v->>'source'
         WHEN 'punches' THEN 'punches'
         WHEN 'absent' THEN 'marked absent'
         WHEN 'weekoff' THEN 'marked ' || lower(COALESCE(v.v->>'remark', 'weekly off'))
         WHEN 'holiday' THEN 'marked ' || lower(COALESCE(v.v->>'remark', 'holiday'))
         WHEN 'leave' THEN 'leave'
       END,
       CASE WHEN v.v->>'source' IN ('punches', 'absent', 'weekoff', 'holiday') THEN NULL
            ELSE (v.v->>'updated_by')::bigint END,
       -- before the first change it was replaced by (ordered by when, then id)
       CASE WHEN f.changed_at IS NULL THEN COALESCE((v.v->>'updated_at')::timestamptz, d.updated_at)
            ELSE LEAST(COALESCE((v.v->>'updated_at')::timestamptz, f.changed_at), f.changed_at - interval '1 millisecond')
       END
  FROM staff_attendance_days d
  LEFT JOIN LATERAL (
    SELECT h.before, h.changed_at FROM staff_attendance_history h
     WHERE h.employee_id = d.employee_id AND h.day = d.day ORDER BY h.changed_at, h.id LIMIT 1
  ) f ON true
  CROSS JOIN LATERAL (SELECT COALESCE(f.before, to_jsonb(d) - 'trace') AS v) v
 WHERE NOT EXISTS (
   SELECT 1 FROM staff_attendance_history x WHERE x.employee_id = d.employee_id AND x.day = d.day AND x.before IS NULL
 );
