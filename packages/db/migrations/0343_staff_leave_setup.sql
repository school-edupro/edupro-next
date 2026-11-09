-- 0343: staff leave and attendance — the set-up (docs/design/85, phase A). The process of the school's
-- earlier leave module, kept: leave types, leave policies by scope (entitlement, credits in the session's
-- credit months, carry forward, sandwich), weekly-off rules, holiday scope for staff, shifts, shift postings,
-- department and special timings, who approves (day bands x up to 3 levels, by scope and leave type; and the
-- regularisation chain), and the settings. Masters are kept from year to year (no copy per financial year).

-- ---- permissions and the office role ---------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('leave.setup.view', 'leave', 'See the staff leave and attendance set-up'),
  ('leave.setup.manage', 'leave',
   'Change the staff leave types, leave policies, weekly offs, shifts, timings, who approves and the settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'leave_office', 'Leave & attendance office', 'module', true,
   'Keeps staff leave and attendance: the set-up, the leave register, balances and the attendance register')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('leave.setup.view'), ('leave.setup.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'leave_office')
ON CONFLICT DO NOTHING;

-- ---- scope: who a policy, a weekly off, a holiday or an approval rule is for ------------------------------
-- all staff, or the listed departments / designations / employee types (their names or codes, as on the
-- employee) / employees (their employee codes)
CREATE OR REPLACE FUNCTION app.staff_in_scope(p_scope TEXT, p_values TEXT[], p_employee BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT p_scope = 'all' OR EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = p_employee
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(p_values, '{}'::text[])) v
                    WHERE CASE p_scope
                            WHEN 'department' THEN lower(btrim(v)) = lower(btrim(COALESCE(e.department, '')))
                                 OR EXISTS (SELECT 1 FROM departments d WHERE d.school_id = e.school_id
                                              AND lower(d.code) = lower(btrim(v)) AND lower(d.name) = lower(COALESCE(e.department, '')))
                            WHEN 'designation' THEN lower(btrim(v)) = lower(btrim(COALESCE(e.designation, '')))
                                 OR EXISTS (SELECT 1 FROM designations d WHERE d.school_id = e.school_id
                                              AND lower(d.code) = lower(btrim(v)) AND lower(d.name) = lower(COALESCE(e.designation, '')))
                            WHEN 'employee_type' THEN lower(btrim(v)) = lower(COALESCE(e.employee_type::text, ''))
                                 OR EXISTS (SELECT 1 FROM employee_types t WHERE t.school_id = e.school_id
                                              AND lower(t.name) = lower(btrim(v)) AND t.code = e.employee_type::text)
                            WHEN 'employee' THEN lower(btrim(v)) = lower(COALESCE(e.employee_code, ''))
                            ELSE false
                          END))
$$;

-- the scope's values as one key (for the one-active-rule indexes)
CREATE OR REPLACE FUNCTION app.scope_key(p_values TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT lower(array_to_string(p_values, ',')) $$;

-- ---- leave types -----------------------------------------------------------------------------------------
CREATE TABLE staff_leave_types (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  code            TEXT NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  paid            BOOLEAN NOT NULL DEFAULT true,
  -- loss of pay: no balance, the last step of the automatic deduction, a half day always allowed
  loss_of_pay     BOOLEAN NOT NULL DEFAULT false,
  -- a balance is credited, checked and held; off (on duty, maternity): only the type's limits apply
  keeps_balance   BOOLEAN NOT NULL DEFAULT true,
  -- on duty, work from home: the day counts as present
  counts_present  BOOLEAN NOT NULL DEFAULT false,
  half_day        BOOLEAN NOT NULL DEFAULT false,
  auto_approve    BOOLEAN NOT NULL DEFAULT false,
  document_needed BOOLEAN NOT NULL DEFAULT false,
  -- may not touch a day of a different leave type (a working day between them)
  gap_from_other  BOOLEAN NOT NULL DEFAULT false,
  -- may be applied for days still to come
  advance_allowed BOOLEAN NOT NULL DEFAULT true,
  min_days        NUMERIC(6,2) CHECK (min_days IS NULL OR min_days BETWEEN 0 AND 999.99),
  max_days        NUMERIC(6,2) CHECK (max_days IS NULL OR max_days BETWEEN 0 AND 999.99),
  -- a type without a balance: the most days in a calendar month
  max_per_month   NUMERIC(6,2) CHECK (max_per_month IS NULL OR max_per_month BETWEEN 0 AND 999.99),
  -- the order of the automatic deduction (late marks, missing punches, absent with no application):
  -- lowest first; loss of pay last
  deduct_order    INT CHECK (deduct_order IS NULL OR deduct_order BETWEEN 1 AND 9999),
  -- how a policy credits it unless the policy says: quarterly, half-yearly, yearly, or not credited
  credit          TEXT NOT NULL DEFAULT 'Y' CHECK (credit IN ('Q', 'H', 'Y', 'none')),
  carry_forward   BOOLEAN NOT NULL DEFAULT false,
  carry_cap       NUMERIC(7,2) CHECK (carry_cap IS NULL OR carry_cap BETWEEN 0 AND 9999.99),
  for_male        BOOLEAN NOT NULL DEFAULT true,
  for_female      BOOLEAN NOT NULL DEFAULT true,
  -- half-pay leave: the pay %, for payroll (the payroll feed shows it)
  pay_percent     NUMERIC(5,2) CHECK (pay_percent IS NULL OR pay_percent BETWEEN 0 AND 100),
  sort_order      INT NOT NULL DEFAULT 100,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('staff_leave_types');
CREATE TRIGGER staff_leave_types_audit AFTER INSERT OR UPDATE OR DELETE ON staff_leave_types
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the rules across columns, told plainly (the grid and the uploads show the message)
CREATE OR REPLACE FUNCTION app.staff_leave_type_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paid AND NEW.loss_of_pay THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a loss-of-pay type is not paid: set Paid to no';
  END IF;
  IF NEW.loss_of_pay THEN
    -- loss of pay keeps no balance, carries nothing and has no pay %
    NEW.keeps_balance := false;
    NEW.half_day := true;
    IF NEW.carry_forward OR NEW.carry_cap IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a loss-of-pay type carries nothing forward';
    END IF;
    IF NEW.pay_percent IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a loss-of-pay type has no pay %';
    END IF;
  ELSIF NOT NEW.keeps_balance AND NEW.deduct_order IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'a type without a balance cannot be taken automatically: clear the deduction order';
  END IF;
  IF NEW.carry_cap IS NOT NULL AND NOT NEW.carry_forward THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a carry-forward cap needs Carry forward = yes';
  END IF;
  IF NEW.min_days IS NOT NULL AND NEW.max_days IS NOT NULL AND NEW.max_days < NEW.min_days THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'the most days in one application is less than the fewest';
  END IF;
  IF NOT (NEW.for_male OR NEW.for_female) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a leave type is for men, women or both';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER staff_leave_types_rules BEFORE INSERT OR UPDATE ON staff_leave_types
  FOR EACH ROW EXECUTE FUNCTION app.staff_leave_type_rules();

-- ---- leave policies --------------------------------------------------------------------------------------
-- one leave type for one scope; the policy of a type for an employee is the first by priority (lowest
-- number) whose scope takes them in
CREATE TABLE staff_leave_policies (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  name                TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  leave_type_id       BIGINT NOT NULL REFERENCES staff_leave_types(id),
  -- the rule book it follows (Shops and Establishment Act …): a note only
  framework           TEXT CHECK (framework IS NULL OR length(framework) <= 100),
  scope               TEXT NOT NULL DEFAULT 'all'
                        CHECK (scope IN ('all', 'department', 'designation', 'employee_type', 'employee')),
  scope_values        TEXT[] NOT NULL DEFAULT '{}',
  priority            INT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 9999),
  annual_days         NUMERIC(7,2) NOT NULL CHECK (annual_days BETWEEN 0 AND 9999.99),
  -- credited in the credit months of the session; off: never credited (opening balances only)
  accrues             BOOLEAN NOT NULL DEFAULT true,
  -- quarterly / half-yearly / yearly; empty: the leave type's
  credit              TEXT CHECK (credit IS NULL OR credit IN ('Q', 'H', 'Y')),
  session_start_month INT NOT NULL DEFAULT 4 CHECK (session_start_month BETWEEN 1 AND 12),
  -- the months credited (1-12); worked out from the session start when left empty
  credit_months       INT[] NOT NULL DEFAULT '{}',
  -- days a credit; empty: the annual days shared evenly over the credits
  days_per_credit     NUMERIC(7,2) CHECK (days_per_credit IS NULL OR days_per_credit BETWEEN 0 AND 9999.99),
  -- a new joiner is credited for the part of the period after joining
  pro_rata            BOOLEAN NOT NULL DEFAULT true,
  -- empty: the leave type's carry forward and cap (the lower cap wins when both have one)
  carry_forward       BOOLEAN,
  carry_cap           NUMERIC(7,2) CHECK (carry_cap IS NULL OR carry_cap BETWEEN 0 AND 9999.99),
  min_days            NUMERIC(6,2) CHECK (min_days IS NULL OR min_days BETWEEN 0 AND 999.99),
  max_days            NUMERIC(6,2) CHECK (max_days IS NULL OR max_days BETWEEN 0 AND 999.99),
  -- sandwich: weekly offs / declared holidays / optional holidays between leave days are charged
  sandwich_weekoff    BOOLEAN NOT NULL DEFAULT false,
  sandwich_holiday    BOOLEAN NOT NULL DEFAULT false,
  sandwich_optional   BOOLEAN NOT NULL DEFAULT false,
  -- encashment: information for payroll
  encash              BOOLEAN NOT NULL DEFAULT false,
  encash_min_days     NUMERIC(7,2),
  encash_on_exit      BOOLEAN NOT NULL DEFAULT false,
  encash_on_exit_days NUMERIC(7,2),
  encash_yearly       BOOLEAN NOT NULL DEFAULT false,
  encash_yearly_days  NUMERIC(7,2),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by          BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_leave_policies');
CREATE TRIGGER staff_leave_policies_audit AFTER INSERT OR UPDATE OR DELETE ON staff_leave_policies
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
-- one active policy per leave type and scope
CREATE UNIQUE INDEX staff_leave_policies_one ON staff_leave_policies
  (school_id, leave_type_id, scope, (app.scope_key(scope_values)))
  WHERE status = 'active';
-- the masters' upload matches a policy on its name
CREATE UNIQUE INDEX staff_leave_policies_name ON staff_leave_policies (school_id, name);

CREATE OR REPLACE FUNCTION app.staff_leave_policy_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type staff_leave_types; v_credit TEXT; v_n INT; v_step INT; v_m INT;
BEGIN
  SELECT * INTO v_type FROM staff_leave_types WHERE id = NEW.leave_type_id;
  IF v_type.loss_of_pay OR NOT v_type.keeps_balance THEN
    IF NEW.accrues AND NEW.annual_days > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s keeps no balance: a policy for it only sets limits (Credited = no, annual days 0)', v_type.code);
    END IF;
  END IF;
  NEW.scope_values := ARRAY(SELECT btrim(v) FROM unnest(NEW.scope_values) v WHERE btrim(v) <> '');
  IF NEW.scope <> 'all' AND cardinality(NEW.scope_values) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'name the departments, designations, employee types or employees the policy is for';
  END IF;
  IF NEW.scope = 'all' THEN NEW.scope_values := '{}'; END IF;
  IF NEW.carry_cap IS NOT NULL AND NEW.carry_forward IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a carry-forward cap needs Carry forward = yes';
  END IF;
  IF NEW.min_days IS NOT NULL AND NEW.max_days IS NOT NULL AND NEW.max_days < NEW.min_days THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'the most days in one application is less than the fewest';
  END IF;
  IF NOT NEW.encash THEN NEW.encash_min_days := NULL; END IF;
  IF NOT NEW.encash_on_exit THEN NEW.encash_on_exit_days := NULL; END IF;
  IF NOT NEW.encash_yearly THEN NEW.encash_yearly_days := NULL; END IF;
  IF NOT NEW.accrues THEN
    NEW.credit := NULL; NEW.credit_months := '{}'; NEW.days_per_credit := NULL;
  ELSE
    v_credit := COALESCE(NEW.credit, NULLIF(v_type.credit, 'none'));
    IF v_credit IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s is not credited by its type: pick quarterly, half-yearly or yearly on the policy', v_type.code);
    END IF;
    v_n := CASE v_credit WHEN 'Q' THEN 4 WHEN 'H' THEN 2 ELSE 1 END;
    IF cardinality(NEW.credit_months) = 0 THEN
      -- the session start, then every 12 / n months: April + half-yearly = April and October
      v_step := 12 / v_n;
      NEW.credit_months := ARRAY(SELECT ((NEW.session_start_month - 1 + k * v_step) % 12) + 1
                                   FROM generate_series(0, v_n - 1) k ORDER BY 1);
    ELSE
      FOREACH v_m IN ARRAY NEW.credit_months LOOP
        IF v_m NOT BETWEEN 1 AND 12 THEN
          RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a credit month is a number from 1 to 12';
        END IF;
      END LOOP;
      NEW.credit_months := ARRAY(SELECT DISTINCT m FROM unnest(NEW.credit_months) m ORDER BY 1);
      IF cardinality(NEW.credit_months) <> v_n THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = format('%s credit needs %s credit month(s); %s given',
                           CASE v_credit WHEN 'Q' THEN 'quarterly' WHEN 'H' THEN 'half-yearly' ELSE 'yearly' END,
                           v_n, cardinality(NEW.credit_months));
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER staff_leave_policies_rules BEFORE INSERT OR UPDATE ON staff_leave_policies
  FOR EACH ROW EXECUTE FUNCTION app.staff_leave_policy_rules();

-- ---- weekly offs -----------------------------------------------------------------------------------------
-- a day is a weekly off when any active rule that takes the employee in makes it one
CREATE TABLE staff_weekoff_rules (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  scope        TEXT NOT NULL DEFAULT 'all'
                 CHECK (scope IN ('all', 'department', 'designation', 'employee_type', 'employee')),
  scope_values TEXT[] NOT NULL DEFAULT '{}',
  -- weekly: these weekdays (1 Monday … 7 Sunday), in these weeks of the month (empty: every week);
  -- dates: the listed dates (a rotating off)
  kind         TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('weekly', 'dates')),
  weekdays     INT[] NOT NULL DEFAULT '{}',
  week_numbers INT[] NOT NULL DEFAULT '{}',
  dates        DATE[] NOT NULL DEFAULT '{}',
  priority     INT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 999),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('staff_weekoff_rules');
CREATE TRIGGER staff_weekoff_rules_audit AFTER INSERT OR UPDATE OR DELETE ON staff_weekoff_rules
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE OR REPLACE FUNCTION app.staff_weekoff_rules_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.scope_values := ARRAY(SELECT btrim(v) FROM unnest(NEW.scope_values) v WHERE btrim(v) <> '');
  IF NEW.scope = 'all' THEN NEW.scope_values := '{}';
  ELSIF cardinality(NEW.scope_values) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'name who the weekly off is for';
  END IF;
  IF NEW.kind = 'weekly' THEN
    IF cardinality(NEW.weekdays) = 0 OR EXISTS (SELECT 1 FROM unnest(NEW.weekdays) d WHERE d NOT BETWEEN 1 AND 7) THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'weekdays are numbers 1 (Monday) to 7 (Sunday)';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW.week_numbers) w WHERE w NOT BETWEEN 1 AND 5) THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'weeks of the month are 1 to 5 (2,4 = the 2nd and 4th)';
    END IF;
    NEW.weekdays := ARRAY(SELECT DISTINCT d FROM unnest(NEW.weekdays) d ORDER BY 1);
    NEW.week_numbers := ARRAY(SELECT DISTINCT w FROM unnest(NEW.week_numbers) w ORDER BY 1);
    NEW.dates := '{}';
  ELSE
    IF cardinality(NEW.dates) = 0 OR cardinality(NEW.dates) > 366 THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'list the dates of the weekly off (up to 366)';
    END IF;
    NEW.dates := ARRAY(SELECT DISTINCT d FROM unnest(NEW.dates) d ORDER BY 1);
    NEW.weekdays := '{}'; NEW.week_numbers := '{}';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_weekoff_rules_check BEFORE INSERT OR UPDATE ON staff_weekoff_rules
  FOR EACH ROW EXECUTE FUNCTION app.staff_weekoff_rules_check();

-- is that day a weekly off for the employee?
CREATE OR REPLACE FUNCTION app.staff_is_weekoff(p_employee BIGINT, p_day DATE) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_weekoff_rules r
     WHERE r.status = 'active' AND r.school_id = (SELECT school_id FROM employees WHERE id = p_employee)
       AND app.staff_in_scope(r.scope, r.scope_values, p_employee)
       AND CASE r.kind
             WHEN 'dates' THEN p_day = ANY(r.dates)
             ELSE extract(isodow FROM p_day)::int = ANY(r.weekdays)
                  AND (cardinality(r.week_numbers) = 0
                       OR ((extract(day FROM p_day)::int - 1) / 7 + 1) = ANY(r.week_numbers))
           END)
$$;

-- ---- holidays: optional ones, and which staff a holiday is for -------------------------------------------
ALTER TABLE holidays
  -- an optional (restricted) holiday: not a day off by itself; leave on it is charged unless the policy's
  -- sandwich takes optional holidays in
  ADD COLUMN optional           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN staff_scope        TEXT NOT NULL DEFAULT 'all'
                                  CHECK (staff_scope IN ('all', 'department', 'designation', 'employee_type', 'employee')),
  ADD COLUMN staff_scope_values TEXT[] NOT NULL DEFAULT '{}';

-- is that day a declared (not optional) holiday for the employee?
CREATE OR REPLACE FUNCTION app.staff_is_holiday(p_employee BIGINT, p_day DATE, p_optional BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM holidays h
     WHERE h.school_id = (SELECT school_id FROM employees WHERE id = p_employee)
       AND h.kind IN ('holiday', 'vacation') AND h.applies_to IN ('everyone', 'employees')
       AND h.optional = p_optional AND p_day BETWEEN h.starts_on AND h.ends_on
       AND app.staff_in_scope(h.staff_scope, h.staff_scope_values, p_employee))
$$;

-- ---- shifts ----------------------------------------------------------------------------------------------
CREATE TABLE staff_shifts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  code            TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  kind            TEXT NOT NULL DEFAULT 'day' CHECK (kind IN ('day', 'night')),
  starts_at       TIME NOT NULL,
  ends_at         TIME NOT NULL,
  grace_minutes   INT NOT NULL DEFAULT 5 CHECK (grace_minutes BETWEEN 0 AND 240),
  present_hours   NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (present_hours BETWEEN 0 AND 24),
  half_day_hours  NUMERIC(4,2) NOT NULL DEFAULT 4.5 CHECK (half_day_hours BETWEEN 0 AND 24),
  total_hours     NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (total_hours BETWEEN 0 AND 24),
  overtime        BOOLEAN NOT NULL DEFAULT false,
  overtime_limit  NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (overtime_limit BETWEEN 0 AND 24),
  -- bus duty: no late marking
  bus_duty        BOOLEAN NOT NULL DEFAULT false,
  -- a day with one punch only
  single_punch    TEXT NOT NULL DEFAULT 'A' CHECK (single_punch IN ('A', 'HD', 'P')),
  -- late in by at least these minutes (after the grace) / out early by at least these: the day becomes
  -- a half day, absent, or half a day of that leave type
  late_over_minutes  INT CHECK (late_over_minutes IS NULL OR late_over_minutes BETWEEN 1 AND 720),
  late_action        TEXT NOT NULL DEFAULT 'none' CHECK (late_action IN ('none', 'HD', 'A', 'leave')),
  late_leave_type_id BIGINT REFERENCES staff_leave_types(id),
  early_over_minutes INT CHECK (early_over_minutes IS NULL OR early_over_minutes BETWEEN 1 AND 720),
  early_action       TEXT NOT NULL DEFAULT 'none' CHECK (early_action IN ('none', 'HD', 'A', 'leave')),
  early_leave_type_id BIGINT REFERENCES staff_leave_types(id),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('staff_shifts');
CREATE TRIGGER staff_shifts_audit AFTER INSERT OR UPDATE OR DELETE ON staff_shifts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the thresholds, shared by shifts and timings
CREATE OR REPLACE FUNCTION app.staff_timing_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'staff_shifts' THEN
    IF NEW.starts_at = NEW.ends_at THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a shift starts and ends at different times';
    END IF;
    IF NEW.kind = 'day' AND NEW.ends_at < NEW.starts_at THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = 'a day shift ends after it starts (a shift past midnight is a night shift)';
    END IF;
  END IF;
  IF NEW.half_day_hours >= NEW.present_hours THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'the half-day hours are fewer than the present hours';
  END IF;
  IF NEW.late_action = 'leave' AND NEW.late_leave_type_id IS NULL
     OR NEW.early_action = 'leave' AND NEW.early_leave_type_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'name the leave type the late or early rule charges';
  END IF;
  IF NEW.late_action <> 'none' AND NEW.late_over_minutes IS NULL
     OR NEW.early_action <> 'none' AND NEW.early_over_minutes IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'give the minutes after which the late or early rule applies';
  END IF;
  IF NEW.late_action <> 'leave' THEN NEW.late_leave_type_id := NULL; END IF;
  IF NEW.early_action <> 'leave' THEN NEW.early_leave_type_id := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_shifts_rules BEFORE INSERT OR UPDATE ON staff_shifts
  FOR EACH ROW EXECUTE FUNCTION app.staff_timing_rules();

-- which shift an employee works, from a day (to a day; empty: until changed); a later start wins an
-- overlap; a posting of one day changes that day only
CREATE TABLE staff_shift_postings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  shift_id    BIGINT NOT NULL REFERENCES staff_shifts(id),
  from_date   DATE NOT NULL,
  to_date     DATE CHECK (to_date IS NULL OR to_date >= from_date),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_shift_postings');
CREATE TRIGGER staff_shift_postings_audit AFTER INSERT OR UPDATE OR DELETE ON staff_shift_postings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE UNIQUE INDEX staff_shift_postings_one ON staff_shift_postings (employee_id, shift_id, from_date)
  WHERE status = 'active';
CREATE INDEX staff_shift_postings_emp ON staff_shift_postings (employee_id, from_date DESC) WHERE status = 'active';

-- department timing (a department's own hours) and special timing (an employee, for dates); a special
-- timing wins over everything, a department timing over the shift (not over a bus-duty shift or a posting
-- of one day)
CREATE TABLE staff_timings (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  kind               TEXT NOT NULL CHECK (kind IN ('department', 'special')),
  department         TEXT,
  employee_id        BIGINT REFERENCES employees(id),
  from_date          DATE,
  to_date            DATE,
  starts_at          TIME NOT NULL,
  ends_at            TIME NOT NULL,
  grace_minutes      INT NOT NULL DEFAULT 5 CHECK (grace_minutes BETWEEN 0 AND 240),
  present_hours      NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (present_hours BETWEEN 0 AND 24),
  half_day_hours     NUMERIC(4,2) NOT NULL DEFAULT 4.5 CHECK (half_day_hours BETWEEN 0 AND 24),
  late_over_minutes  INT CHECK (late_over_minutes IS NULL OR late_over_minutes BETWEEN 1 AND 720),
  late_action        TEXT NOT NULL DEFAULT 'none' CHECK (late_action IN ('none', 'HD', 'A', 'leave')),
  late_leave_type_id BIGINT REFERENCES staff_leave_types(id),
  early_over_minutes INT CHECK (early_over_minutes IS NULL OR early_over_minutes BETWEEN 1 AND 720),
  early_action       TEXT NOT NULL DEFAULT 'none' CHECK (early_action IN ('none', 'HD', 'A', 'leave')),
  early_leave_type_id BIGINT REFERENCES staff_leave_types(id),
  note               TEXT CHECK (note IS NULL OR length(note) <= 200),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by         BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'department' AND department IS NOT NULL AND employee_id IS NULL
         OR kind = 'special' AND employee_id IS NOT NULL AND from_date IS NOT NULL AND to_date IS NOT NULL
            AND to_date >= from_date)
);
CALL app.apply_tenant_rls('staff_timings');
CREATE TRIGGER staff_timings_audit AFTER INSERT OR UPDATE OR DELETE ON staff_timings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER staff_timings_rules BEFORE INSERT OR UPDATE ON staff_timings
  FOR EACH ROW EXECUTE FUNCTION app.staff_timing_rules();
-- one department timing a department
CREATE UNIQUE INDEX staff_timings_department ON staff_timings (school_id, lower(department))
  WHERE kind = 'department' AND status = 'active';
CREATE INDEX staff_timings_special ON staff_timings (employee_id, from_date) WHERE kind = 'special' AND status = 'active';

-- ---- who approves ----------------------------------------------------------------------------------------
-- leave: for a scope and a leave type (empty: any type), three day bands (0-7, 7-30, 30-365 days; at a
-- boundary the lower band wins), each up to 3 levels; regularisation: one chain a scope. The levels are
-- the EduPro approval levels (named staff, the reporting manager, the HOD, a designation, a role, the
-- employee's L1/L2/L3 approver), worked out when the leave is applied.
CREATE TABLE staff_leave_approval_rules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  kind          TEXT NOT NULL CHECK (kind IN ('leave', 'regularisation')),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  scope         TEXT NOT NULL DEFAULT 'all'
                  CHECK (scope IN ('all', 'department', 'designation', 'employee_type', 'employee')),
  scope_values  TEXT[] NOT NULL DEFAULT '{}',
  leave_type_id BIGINT REFERENCES staff_leave_types(id),
  -- [{"from":0,"to":7,"levels":[{"name":"…","by":"manager"|"employees"|"hod"|"designation"|"role"|"approver_l1"…,
  --   "employeeIds":[],"designation":null,"roleCode":null,"slaHours":null}]}]; regularisation: one band 0-999
  bands         JSONB NOT NULL DEFAULT '[]',
  priority      INT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 9999),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_leave_approval_rules');
CREATE TRIGGER staff_leave_approval_rules_audit AFTER INSERT OR UPDATE OR DELETE ON staff_leave_approval_rules
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE UNIQUE INDEX staff_leave_approval_rules_one ON staff_leave_approval_rules
  (school_id, kind, scope, (app.scope_key(scope_values)), COALESCE(leave_type_id, 0))
  WHERE status = 'active';

-- ---- settings --------------------------------------------------------------------------------------------
CREATE TABLE staff_leave_settings (
  school_id                BIGINT PRIMARY KEY REFERENCES schools(id),
  -- every this many late marks in a month (or missing punches) = one day of leave (CL, then EL … then LOP)
  late_marks_per_leave     INT NOT NULL DEFAULT 3 CHECK (late_marks_per_leave BETWEEN 1 AND 10),
  missing_punches_per_leave INT NOT NULL DEFAULT 4 CHECK (missing_punches_per_leave BETWEEN 1 AND 10),
  -- an absent day with no application nor correction after this many days becomes loss of pay
  lop_after_days           INT NOT NULL DEFAULT 7 CHECK (lop_after_days BETWEEN 0 AND 60),
  -- two punches closer than this are one (a double tap)
  punch_gap_minutes        INT NOT NULL DEFAULT 10 CHECK (punch_gap_minutes BETWEEN 1 AND 120),
  recheck_days             INT NOT NULL DEFAULT 10 CHECK (recheck_days BETWEEN 1 AND 60),
  absent_lookback_days     INT NOT NULL DEFAULT 31 CHECK (absent_lookback_days BETWEEN 1 AND 62),
  -- late marks and missing punches are counted from this day (a fresh start)
  exceptions_from          DATE,
  default_shift_id         BIGINT REFERENCES staff_shifts(id),
  -- late minutes past the grace lower the present / half-day hours of that day (up to the late rule's minutes)
  late_reduces_hours       BOOLEAN NOT NULL DEFAULT false,
  allow_time_edit          BOOLEAN NOT NULL DEFAULT true,
  allow_on_behalf          BOOLEAN NOT NULL DEFAULT true,
  -- the apply form's limits
  backdate_days            INT CHECK (backdate_days IS NULL OR backdate_days BETWEEN 0 AND 366),
  -- missing-punch e-mails go also to (comma-separated)
  missing_punch_cc         TEXT CHECK (missing_punch_cc IS NULL OR length(missing_punch_cc) <= 500),
  -- the central device database: this school's device serials (the connection itself is set on the server)
  device_serials           TEXT[] NOT NULL DEFAULT '{}',
  -- message channels for leave and attendance messages
  send_email               BOOLEAN NOT NULL DEFAULT true,
  send_whatsapp            BOOLEAN NOT NULL DEFAULT true,
  send_app                 BOOLEAN NOT NULL DEFAULT true,
  send_sms                 BOOLEAN NOT NULL DEFAULT false,
  updated_by               BIGINT REFERENCES users(id),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_leave_settings');
CREATE TRIGGER staff_leave_settings_audit AFTER INSERT OR UPDATE OR DELETE ON staff_leave_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the defaults a school starts with -------------------------------------------------------------------
-- the ten usual leave types, the general and bus-duty shifts, Sunday off and the settings; only into an
-- empty set-up (a school that has started keeps what it has)
CREATE OR REPLACE FUNCTION app.staff_leave_seed(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_leave_types WHERE school_id = p_school) THEN
    INSERT INTO staff_leave_types (school_id, code, name, paid, loss_of_pay, keeps_balance, counts_present, half_day,
                                   auto_approve, document_needed, gap_from_other, deduct_order, credit, carry_forward,
                                   for_male, for_female, sort_order)
    VALUES
      (p_school, 'CL', 'Casual leave', true, false, true, false, true, false, false, true, 1, 'H', false, true, true, 10),
      (p_school, 'EL', 'Earned leave', true, false, true, false, false, false, false, true, 2, 'H', true, true, true, 20),
      (p_school, 'SL', 'Sick leave', true, false, true, false, true, false, true, false, NULL, 'Y', false, true, true, 30),
      (p_school, 'HPL', 'Half pay leave', true, false, true, false, true, false, true, true, NULL, 'Y', true, true, true, 40),
      (p_school, 'CO', 'Compensatory off', true, false, true, false, true, false, false, false, NULL, 'none', false, true, true, 50),
      (p_school, 'OD', 'On duty', true, false, false, true, true, false, true, false, NULL, 'none', false, true, true, 60),
      (p_school, 'WFH', 'Work from home', true, false, false, true, true, false, false, false, NULL, 'none', false, true, true, 70),
      (p_school, 'ML', 'Maternity leave', true, false, false, false, false, false, true, false, NULL, 'none', false, false, true, 80),
      (p_school, 'PL', 'Paternity leave', true, false, false, false, false, false, true, false, NULL, 'none', false, true, false, 90),
      (p_school, 'LOP', 'Loss of pay', false, true, false, false, true, true, false, false, 999, 'none', false, true, true, 999);
    UPDATE staff_leave_types SET pay_percent = 50 WHERE school_id = p_school AND code = 'HPL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_shifts WHERE school_id = p_school) THEN
    INSERT INTO staff_shifts (school_id, code, name, starts_at, ends_at, grace_minutes, present_hours, half_day_hours,
                              total_hours, bus_duty)
    VALUES (p_school, 'GEN', 'General', '08:00', '15:30', 5, 7, 3.5, 7.5, false),
           (p_school, 'BUS', 'Bus duty', '06:30', '16:30', 30, 6, 3, 8, true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_weekoff_rules WHERE school_id = p_school) THEN
    INSERT INTO staff_weekoff_rules (school_id, name, scope, kind, weekdays)
    VALUES (p_school, 'Sunday weekly off', 'all', 'weekly', '{7}');
  END IF;
  INSERT INTO staff_leave_settings (school_id, default_shift_id)
  SELECT p_school, (SELECT id FROM staff_shifts WHERE school_id = p_school AND code = 'GEN')
  ON CONFLICT (school_id) DO NOTHING;
END $$;
