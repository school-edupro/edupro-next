-- 0348: staff attendance — the data (docs/design/85, phase C). The school's earlier engine, kept: punches
-- from every source into one queue, one day a row worked out from them (with how it was worked out and its
-- history), late marks and missing punches counted each month into leave, attendance corrections
-- (regularisation) through their own approvers, and the monthly runs recorded so each happens once.

-- ---- punches: from the devices (pushed), the central device database (pulled), Excel, by hand ----------
CREATE TABLE staff_punches (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  -- found by the biometric id or the employee code; empty while nobody has the code
  employee_id BIGINT REFERENCES employees(id),
  code        TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  punched_at  TIMESTAMPTZ NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('device', 'central', 'import', 'manual')),
  device      TEXT NOT NULL DEFAULT '' CHECK (length(device) <= 60),
  ref         TEXT CHECK (ref IS NULL OR length(ref) <= 60),
  -- worked into the day yet
  read        BOOLEAN NOT NULL DEFAULT false,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, source, device, code, punched_at)
);
CALL app.apply_tenant_rls('staff_punches');
CREATE INDEX staff_punches_unread ON staff_punches (school_id, punched_at) WHERE NOT read;
CREATE INDEX staff_punches_emp ON staff_punches (employee_id, punched_at);
CREATE INDEX staff_punches_unknown ON staff_punches (school_id, code) WHERE employee_id IS NULL;

-- a punch a device pushes (and the school recorded) joins the queue
CREATE OR REPLACE FUNCTION app.staff_punch_from_device() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outcome = 'recorded' THEN
    INSERT INTO staff_punches (school_id, employee_id, code, punched_at, source, device, ref)
    VALUES (NEW.school_id, NEW.employee_id, NEW.biometric_id, NEW.punched_at, 'device', NEW.device_id::text, NEW.id::text)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER punch_logs_to_staff AFTER INSERT ON punch_logs
  FOR EACH ROW EXECUTE FUNCTION app.staff_punch_from_device();

-- ---- the day ---------------------------------------------------------------------------------------------
CREATE TABLE staff_attendance_days (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  employee_id    BIGINT NOT NULL REFERENCES employees(id),
  day            DATE NOT NULL,
  -- present, half day, absent, weekly off, holiday, leave, salary hold
  day_type       TEXT NOT NULL CHECK (day_type IN ('P', 'HD', 'A', 'WO', 'H', 'LV', 'HOLD')),
  -- a day of leave: its type, and half (0.5) or whole
  leave_type_id  BIGINT REFERENCES staff_leave_types(id),
  leave_portion  NUMERIC(3,2) CHECK (leave_portion IS NULL OR leave_portion IN (0.5, 1)),
  shift_id       BIGINT REFERENCES staff_shifts(id),
  in_at          TIMESTAMPTZ,
  out_at         TIMESTAMPTZ,
  worked_hours   NUMERIC(5,2),
  ot_hours       NUMERIC(5,2) NOT NULL DEFAULT 0,
  late_minutes   INT NOT NULL DEFAULT 0,
  early_minutes  INT NOT NULL DEFAULT 0,
  -- set by a person (a correction, an upload, an approved regularisation): the punches no longer change it
  manual         BOOLEAN NOT NULL DEFAULT false,
  source         TEXT NOT NULL CHECK (source IN ('punches', 'manual', 'bulk', 'regularisation', 'weekoff', 'holiday', 'absent', 'leave')),
  -- how the day was worked out (shown as a sentence)
  trace          JSONB NOT NULL DEFAULT '{}',
  remark         TEXT CHECK (remark IS NULL OR length(remark) <= 300),
  updated_by     BIGINT REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day)
);
CALL app.apply_tenant_rls('staff_attendance_days');
CREATE INDEX staff_attendance_days_month ON staff_attendance_days (school_id, day);

-- every change of a day, with the earlier version and why
CREATE TABLE staff_attendance_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  day         DATE NOT NULL,
  before      JSONB,
  after       JSONB,
  reason      TEXT,
  changed_by  BIGINT REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_attendance_history');
CREATE INDEX staff_attendance_history_day ON staff_attendance_history (employee_id, day, changed_at DESC);

-- ---- late marks and missing punches ----------------------------------------------------------------------
-- pending: counts towards the month's deduction; used: turned into leave; waived: cleared by the office or a
-- correction; lapsed: fewer than the number for a day of leave left at the month's end
CREATE TABLE staff_late_marks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  day          DATE NOT NULL,
  in_at        TIMESTAMPTZ NOT NULL,
  starts_at    TIME NOT NULL,
  grace        INT NOT NULL,
  late_minutes INT NOT NULL CHECK (late_minutes > 0),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'waived', 'lapsed')),
  request_id   BIGINT REFERENCES staff_leave_requests(id),
  reason       TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day)
);
CALL app.apply_tenant_rls('staff_late_marks');
CREATE INDEX staff_late_marks_month ON staff_late_marks (school_id, day);

CREATE TABLE staff_missing_punches (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  day         DATE NOT NULL,
  missing     TEXT NOT NULL CHECK (missing IN ('in', 'out')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'retired', 'lapsed')),
  request_id  BIGINT REFERENCES staff_leave_requests(id),
  reason      TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  mailed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day)
);
CALL app.apply_tenant_rls('staff_missing_punches');
CREATE INDEX staff_missing_punches_month ON staff_missing_punches (school_id, day);

-- ---- attendance corrections asked by the employee (regularisation) ---------------------------------------
CREATE TABLE staff_regularisations (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  employee_id          BIGINT NOT NULL REFERENCES employees(id),
  day                  DATE NOT NULL,
  in_time              TIME,
  out_time             TIME,
  day_type             TEXT CHECK (day_type IS NULL OR day_type IN ('P', 'HD', 'A', 'WO', 'H')),
  reason               TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  document_file_id     BIGINT REFERENCES files(id),
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  decided_at           TIMESTAMPTZ,
  decided_by           BIGINT REFERENCES users(id),
  decision_note        TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_by           BIGINT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (in_time IS NOT NULL OR out_time IS NOT NULL OR day_type IS NOT NULL)
);
CALL app.apply_tenant_rls('staff_regularisations');
CREATE TRIGGER staff_regularisations_audit AFTER INSERT OR UPDATE OR DELETE ON staff_regularisations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
-- one live correction a day
CREATE UNIQUE INDEX staff_regularisations_live ON staff_regularisations (employee_id, day)
  WHERE status IN ('pending', 'approved');

-- ---- the monthly runs (each once a month: late-mark and missing-punch deductions) ------------------------
CREATE TABLE staff_attendance_runs (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  kind      TEXT NOT NULL CHECK (kind IN ('late', 'missing')),
  month     DATE NOT NULL,
  result    INT NOT NULL DEFAULT 0,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, kind, month)
);
CALL app.apply_tenant_rls('staff_attendance_runs');

-- the central device database's read mark (the last row id read) for this school
ALTER TABLE staff_leave_settings ADD COLUMN punch_watermark TEXT;
