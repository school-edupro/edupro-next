-- 0357: the shift calendar — a colour for each shift (the calendar shows its code in it) and a log of every
-- shift posting change (who posted which shift to whom, for which days; who changed or removed it).

ALTER TABLE staff_shifts
  ADD COLUMN colour TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-fA-F]{6}$');

CREATE TABLE staff_shift_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  posting_id  BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  -- the employee "Name (CODE)" and the shift "CODE — Name" as they were
  subject     TEXT NOT NULL,
  department  TEXT,
  shift       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('added', 'changed', 'ended', 'removed')),
  from_date   DATE,
  to_date     DATE,
  changes     JSONB NOT NULL DEFAULT '[]',
  changed_by  BIGINT REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_shift_log');
CREATE INDEX staff_shift_log_emp ON staff_shift_log (employee_id, changed_at DESC);
CREATE INDEX staff_shift_log_when ON staff_shift_log (school_id, changed_at DESC);

CREATE OR REPLACE FUNCTION app.staff_shift_log_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_changes JSONB := '[]';
  v_action TEXT;
  v_subject TEXT;
  v_dept TEXT;
  v_shift TEXT;
  f RECORD;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('Shift', to_jsonb((SELECT code FROM staff_shifts WHERE id = OLD.shift_id)),
                to_jsonb((SELECT code FROM staff_shifts WHERE id = NEW.shift_id))),
      ('From', to_jsonb(to_char(OLD.from_date, 'DD-MM-YYYY')), to_jsonb(to_char(NEW.from_date, 'DD-MM-YYYY'))),
      ('To', to_jsonb(to_char(OLD.to_date, 'DD-MM-YYYY')), to_jsonb(to_char(NEW.to_date, 'DD-MM-YYYY')))
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
  ELSIF jsonb_array_length(v_changes) = 1 AND v_changes -> 0 ->> 'field' = 'To' THEN v_action := 'ended';
  ELSE v_action := 'changed';
  END IF;
  SELECT e.display_name || ' (' || e.employee_code || ')', e.department INTO v_subject, v_dept
    FROM employees e WHERE e.id = NEW.employee_id;
  SELECT s.code || ' — ' || s.name INTO v_shift FROM staff_shifts s WHERE s.id = NEW.shift_id;
  INSERT INTO staff_shift_log (school_id, posting_id, employee_id, subject, department, shift, action, from_date, to_date,
                               changes, changed_by)
  VALUES (NEW.school_id, NEW.id, NEW.employee_id, COALESCE(v_subject, ''), v_dept, COALESCE(v_shift, ''), v_action,
          NEW.from_date, NEW.to_date, v_changes, app.current_user_id());
  RETURN NEW;
END $$;
CREATE TRIGGER staff_shift_postings_log AFTER INSERT OR UPDATE ON staff_shift_postings
  FOR EACH ROW EXECUTE FUNCTION app.staff_shift_log_write();
