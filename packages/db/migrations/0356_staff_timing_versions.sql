-- 0356: department timings by date, and a log of every timing change (docs/design/85, timings).
-- A department timing is a version: it applies from its from_date (empty: from the start) to its to_date
-- (empty: until changed). A change from a date ends the version the day before and starts a new one, so a
-- future timing can be set in advance and a past day is always measured by the hours it had. Versions of
-- one department may not overlap. Every add, change, end and removal of a timing is logged with the fields
-- old and new, by whom and when, whatever made it (a dialog, the bulk edit, the Excel sheet).

DROP INDEX IF EXISTS staff_timings_department;

CREATE OR REPLACE FUNCTION app.staff_timing_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_clash staff_timings;
BEGIN
  IF NEW.kind = 'department' AND NEW.from_date IS NOT NULL AND NEW.to_date IS NOT NULL AND NEW.to_date < NEW.from_date THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'the timing ends before it starts';
  END IF;
  IF NEW.kind = 'department' AND NEW.status = 'active' THEN
    SELECT * INTO v_clash FROM staff_timings x
     WHERE x.kind = 'department' AND x.status = 'active' AND x.school_id = NEW.school_id AND x.id <> COALESCE(NEW.id, 0)
       AND lower(x.department) = lower(NEW.department)
       AND daterange(COALESCE(x.from_date, '-infinity'), COALESCE(x.to_date, 'infinity'), '[]')
           && daterange(COALESCE(NEW.from_date, '-infinity'), COALESCE(NEW.to_date, 'infinity'), '[]')
     LIMIT 1;
    IF v_clash.id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s already has a timing %s: change that one, or start this one after it ends',
                         NEW.department,
                         CASE WHEN v_clash.from_date IS NULL AND v_clash.to_date IS NULL THEN 'with no end date'
                              ELSE concat_ws(' ', 'from ' || to_char(v_clash.from_date, 'DD-MM-YYYY'),
                                             'to ' || to_char(v_clash.to_date, 'DD-MM-YYYY')) END);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_timings_dates BEFORE INSERT OR UPDATE ON staff_timings
  FOR EACH ROW EXECUTE FUNCTION app.staff_timing_dates();

-- the timing of an employee's day: as 0349, the department timing now the version covering the day
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
       AND lower(x.department) = lower(COALESCE(v_dept, ''))
       AND (x.from_date IS NULL OR x.from_date <= p_day) AND (x.to_date IS NULL OR x.to_date >= p_day)
     ORDER BY x.from_date DESC NULLS LAST, x.id DESC LIMIT 1;
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

-- ---- the change log --------------------------------------------------------------------------------------
CREATE TABLE staff_timing_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  timing_id   BIGINT NOT NULL,
  kind        TEXT NOT NULL,
  -- department name, or the employee "Name (CODE)" as it was
  subject     TEXT NOT NULL,
  department  TEXT,
  employee_id BIGINT,
  action      TEXT NOT NULL CHECK (action IN ('added', 'changed', 'ended', 'removed')),
  from_date   DATE,
  to_date     DATE,
  -- [{"field": "Start time", "old": "08:00", "new": "07:30"}, …]
  changes     JSONB NOT NULL DEFAULT '[]',
  changed_by  BIGINT REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_timing_log');
CREATE INDEX staff_timing_log_timing ON staff_timing_log (timing_id, changed_at DESC);
CREATE INDEX staff_timing_log_when ON staff_timing_log (school_id, changed_at DESC);

CREATE OR REPLACE FUNCTION app.staff_timing_log_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_changes JSONB := '[]';
  v_action TEXT;
  v_subject TEXT;
  v_dept TEXT;
  f RECORD;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('Department', to_jsonb(OLD.department), to_jsonb(NEW.department)),
      ('Effective from', to_jsonb(to_char(OLD.from_date, 'DD-MM-YYYY')), to_jsonb(to_char(NEW.from_date, 'DD-MM-YYYY'))),
      ('Effective to', to_jsonb(to_char(OLD.to_date, 'DD-MM-YYYY')), to_jsonb(to_char(NEW.to_date, 'DD-MM-YYYY'))),
      ('Start time', to_jsonb(to_char(OLD.starts_at, 'HH24:MI')), to_jsonb(to_char(NEW.starts_at, 'HH24:MI'))),
      ('End time', to_jsonb(to_char(OLD.ends_at, 'HH24:MI')), to_jsonb(to_char(NEW.ends_at, 'HH24:MI'))),
      ('Grace minutes', to_jsonb(OLD.grace_minutes), to_jsonb(NEW.grace_minutes)),
      ('Present hours', to_jsonb(OLD.present_hours), to_jsonb(NEW.present_hours)),
      ('Half-day hours', to_jsonb(OLD.half_day_hours), to_jsonb(NEW.half_day_hours)),
      ('Late by more than (min)', to_jsonb(OLD.late_over_minutes), to_jsonb(NEW.late_over_minutes)),
      ('Late: then', to_jsonb(OLD.late_action), to_jsonb(NEW.late_action)),
      ('Late: leave type', to_jsonb((SELECT code FROM staff_leave_types WHERE id = OLD.late_leave_type_id)),
                           to_jsonb((SELECT code FROM staff_leave_types WHERE id = NEW.late_leave_type_id))),
      ('Left early by more than (min)', to_jsonb(OLD.early_over_minutes), to_jsonb(NEW.early_over_minutes)),
      ('Early: then', to_jsonb(OLD.early_action), to_jsonb(NEW.early_action)),
      ('Early: leave type', to_jsonb((SELECT code FROM staff_leave_types WHERE id = OLD.early_leave_type_id)),
                            to_jsonb((SELECT code FROM staff_leave_types WHERE id = NEW.early_leave_type_id))),
      ('Remark', to_jsonb(OLD.note), to_jsonb(NEW.note))
    ) AS v(field, o, n)
  LOOP
    IF TG_OP = 'INSERT' THEN
      IF f.n IS NOT NULL AND f.n <> 'null'::jsonb THEN
        v_changes := v_changes || jsonb_build_object('field', f.field, 'old', NULL, 'new', f.n);
      END IF;
    ELSIF f.o IS DISTINCT FROM f.n THEN
      v_changes := v_changes || jsonb_build_object('field', f.field, 'old', f.o, 'new', f.n);
    END IF;
  END LOOP;
  IF TG_OP = 'INSERT' THEN v_action := 'added';
  ELSIF OLD.status = 'active' AND NEW.status <> 'active' THEN v_action := 'removed';
  ELSIF jsonb_array_length(v_changes) = 0 THEN RETURN NEW;
  ELSIF jsonb_array_length(v_changes) = 1 AND v_changes -> 0 ->> 'field' = 'Effective to' THEN v_action := 'ended';
  ELSE v_action := 'changed';
  END IF;
  SELECT e.display_name || ' (' || e.employee_code || ')', e.department INTO v_subject, v_dept
    FROM employees e WHERE e.id = NEW.employee_id;
  INSERT INTO staff_timing_log (school_id, timing_id, kind, subject, department, employee_id, action, from_date, to_date,
                                changes, changed_by)
  VALUES (NEW.school_id, NEW.id, NEW.kind, COALESCE(v_subject, NEW.department, ''), COALESCE(NEW.department, v_dept),
          NEW.employee_id, v_action, NEW.from_date, NEW.to_date, v_changes, app.current_user_id());
  RETURN NEW;
END $$;
CREATE TRIGGER staff_timings_log AFTER INSERT OR UPDATE ON staff_timings
  FOR EACH ROW EXECUTE FUNCTION app.staff_timing_log_write();
