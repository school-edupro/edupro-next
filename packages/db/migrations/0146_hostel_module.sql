-- Hostel module H1 (docs/design/25-hostel-module.md): hostels, blocks, room types, rooms, beds, wardens and
-- bed allotments with history. The room type names a hostel fee group; the fee engine charges each month's
-- hostel heads by the group of the bed held that month, so a transfer re-prices from the transfer month
-- and paid months stay as they were.

CREATE TABLE hostels (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,12}$'),
  gender      TEXT NOT NULL DEFAULT 'mixed' CHECK (gender IN ('boys', 'girls', 'mixed')),
  address     TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('hostels');

CREATE TABLE hostel_blocks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  hostel_id   BIGINT NOT NULL REFERENCES hostels(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  floors      INT NOT NULL DEFAULT 1 CHECK (floors BETWEEN 1 AND 40),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hostel_id, name)
);
CALL app.apply_tenant_rls('hostel_blocks');

CREATE TABLE hostel_room_types (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  seater      INT NOT NULL CHECK (seater BETWEEN 1 AND 40),
  ac          BOOLEAN NOT NULL DEFAULT false,
  -- the hostel fee group (Fee structures) a pupil in this room type pays by; NULL = the pupil's own group
  fee_group   TEXT CHECK (fee_group IS NULL OR fee_group ~ '^[a-z_]{1,30}$'),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('hostel_room_types');

CREATE TABLE hostel_rooms (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  hostel_id     BIGINT NOT NULL REFERENCES hostels(id),
  block_id      BIGINT REFERENCES hostel_blocks(id),
  floor         INT NOT NULL DEFAULT 0 CHECK (floor BETWEEN 0 AND 40),
  room_no       TEXT NOT NULL CHECK (length(btrim(room_no)) BETWEEN 1 AND 20),
  room_type_id  BIGINT NOT NULL REFERENCES hostel_room_types(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'closed')),
  remarks       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hostel_id, room_no)
);
CALL app.apply_tenant_rls('hostel_rooms');

CREATE TABLE hostel_beds (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  room_id     BIGINT NOT NULL REFERENCES hostel_rooms(id),
  label       TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 10),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, label)
);
CALL app.apply_tenant_rls('hostel_beds');

CREATE TABLE hostel_wardens (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  hostel_id    BIGINT NOT NULL REFERENCES hostels(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  is_head      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  UNIQUE (hostel_id, employee_id)
);
CALL app.apply_tenant_rls('hostel_wardens');

-- One row per stay on a bed: allotted from a date, ended (transfer or vacate) on a date. A transfer ends
-- the old row the day before the new one starts.
CREATE TABLE hostel_allotments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  bed_id        BIGINT NOT NULL REFERENCES hostel_beds(id),
  from_date     DATE NOT NULL,
  to_date       DATE,
  kind          TEXT NOT NULL DEFAULT 'allot' CHECK (kind IN ('allot', 'transfer')),
  remarks       TEXT,
  end_reason    TEXT CHECK (end_reason IS NULL OR end_reason IN ('transfer', 'vacate', 'withdrawn')),
  end_remarks   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  ended_at      TIMESTAMPTZ,
  ended_by      BIGINT,
  CHECK (to_date IS NULL OR to_date >= from_date)
);
CREATE UNIQUE INDEX hostel_allotments_open_bed ON hostel_allotments (bed_id) WHERE to_date IS NULL;
CREATE UNIQUE INDEX hostel_allotments_open_student ON hostel_allotments (student_id) WHERE to_date IS NULL;
CREATE INDEX hostel_allotments_student ON hostel_allotments (student_id, from_date DESC);
CALL app.apply_tenant_rls('hostel_allotments');

-- the hostel fee group set by hand (no bed yet, or a room type without a group)
ALTER TABLE student_fee_profiles
  ADD COLUMN hostel_fee_group TEXT CHECK (hostel_fee_group IS NULL OR hostel_fee_group ~ '^[a-z_]{1,30}$');

-- The hostel fee group of a month: the room type of the latest stay that touches the month.
CREATE OR REPLACE FUNCTION app.hostel_fee_group_on(p_student BIGINT, p_month DATE, p_default TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT t.fee_group
      FROM hostel_allotments a
      JOIN hostel_beds b ON b.id = a.bed_id
      JOIN hostel_rooms r ON r.id = b.room_id
      JOIN hostel_room_types t ON t.id = r.room_type_id
     WHERE a.student_id = p_student
       AND a.from_date <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       AND (a.to_date IS NULL OR a.to_date >= date_trunc('month', p_month)::date)
       AND t.fee_group IS NOT NULL
     ORDER BY a.from_date DESC, a.id DESC
     LIMIT 1), p_default)
$$;

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('hostel.room.view', 'hostel', 'See hostels, rooms, beds, occupancy and who stays where', false),
  ('hostel.setup.manage', 'hostel', 'Set up hostels, blocks, room types, rooms, beds and wardens', false),
  ('hostel.allot.manage', 'hostel', 'Allot, transfer and vacate hostel beds (changes the hostel fee)', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'warden', 'Warden', 'module', true,
   'Hostel: rooms and pupils of the hostels the warden is assigned to; roll-call, leave, visitors and complaints')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN (VALUES ('group_admin', 'hostel.room.view'), ('group_admin', 'hostel.setup.manage'), ('group_admin', 'hostel.allot.manage'),
               ('school_admin', 'hostel.room.view'), ('school_admin', 'hostel.setup.manage'), ('school_admin', 'hostel.allot.manage'),
               ('warden', 'hostel.room.view'), ('accountant', 'hostel.room.view')) AS p(role, code) ON p.role = r.code
 WHERE r.school_id IS NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.generate_fee_demand(p_student_id bigint, p_academic_year_id bigint)
 RETURNS TABLE(o_run_id bigint, o_rows integer, o_total numeric)
 LANGUAGE plpgsql
AS $$
DECLARE
  v_class_id BIGINT;
  v_year academic_years%ROWTYPE;
  v_student students%ROWTYPE;
  v_profile student_fee_profiles%ROWTYPE;
  v_discount fee_discounts%ROWTYPE;
  v_transport_for_discounted BOOLEAN;
  v_transport_head BIGINT;
  v_opb_head BIGINT;
  v_opb_hostel_head BIGINT;
  v_prev_late_head BIGINT;
  v_prev_late_hostel_head BIGINT;
  v_hostel_default TEXT;
  v_hostel_groups TEXT[];
  v_run_id BIGINT;
  v_first_period fee_periods%ROWTYPE;
  v_rows INT := 0;
  v_total NUMERIC := 0;
  r RECORD;
  p RECORD;
  v_gross NUMERIC;
  v_disc NUMERIC;
  v_net NUMERIC;
  v_sum NUMERIC;
  v_delta NUMERIC;
  v_last_id BIGINT;
  v_due DATE;
  v_plan TEXT;
  v_hostel_plan TEXT;
  v_type TEXT;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.assert_year_open(p_academic_year_id, 'fees');
  SELECT * INTO v_year FROM academic_years WHERE id = p_academic_year_id;
  SELECT * INTO v_student FROM students WHERE id = p_student_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fees.student_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student.status <> 'active' THEN
    RAISE EXCEPTION 'fees.student_inactive' USING ERRCODE = 'P0001', DETAIL = 'withdrawn or inactive students get no demand';
  END IF;
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id AND e.status = 'active'
   ORDER BY e.id DESC LIMIT 1;
  IF v_class_id IS NULL THEN
    RAISE EXCEPTION 'fees.not_enrolled' USING ERRCODE = 'P0001', DETAIL = 'the student has no active enrolment in this year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fee_periods WHERE academic_year_id = p_academic_year_id) THEN
    RAISE EXCEPTION 'fees.no_periods' USING ERRCODE = 'P0001', DETAIL = 'define the fee periods of the year first';
  END IF;

  SELECT * INTO v_profile FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  IF NOT FOUND THEN
    v_profile.fee_group := 'general';
    v_profile.student_type := CASE WHEN v_student.admitted_on IS NOT NULL AND v_student.admitted_on >= v_year.start_date THEN 'new' ELSE 'old' END;
    v_profile.transport_slab_id := NULL;
    v_profile.transport_disabled := false;
    v_profile.discount_id := NULL;
    v_profile.opening_balance := 0;
    v_profile.opening_hostel := 0;
    v_profile.opening_late_fee := 0;
    v_profile.opening_late_hostel := 0;
    v_profile.hosteller := false;
  END IF;
  -- old or new is decided by the system: admitted in this session = new, admitted before it = old
  v_type := CASE WHEN v_student.admitted_on IS NOT NULL AND v_student.admitted_on >= v_year.start_date THEN 'new' ELSE 'old' END;
  IF v_profile.student_type IS DISTINCT FROM v_type THEN
    UPDATE student_fee_profiles SET student_type = v_type, updated_at = now()
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND student_type <> v_type;
    v_profile.student_type := v_type;
  END IF;
  -- the pay plan: the pupil's own (given through approval), else the class's, else the school's
  v_plan := app.fee_pay_plan(p_student_id, p_academic_year_id, v_class_id);
  -- hostel instalments: the pupil's own hostel plan, else the hostel calendar's, else the pupil's pay plan
  v_hostel_plan := app.fee_hostel_plan(p_student_id, p_academic_year_id, v_plan);
  IF v_profile.discount_id IS NOT NULL THEN
    SELECT * INTO v_discount FROM fee_discounts WHERE id = v_profile.discount_id AND status = 'active';
  END IF;
  v_transport_for_discounted := COALESCE((app.setting('fees.transport_for_discounted'))::text::boolean, false);
  SELECT id INTO v_transport_head FROM fee_heads WHERE kind = 'transport' AND deleted_at IS NULL AND status = 'active' ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_opb_head FROM fee_heads WHERE kind = 'opening_balance' AND deleted_at IS NULL ORDER BY (ledger = 'school') DESC, sort_order, id LIMIT 1;
  SELECT id INTO v_opb_hostel_head FROM fee_heads WHERE kind = 'opening_balance' AND ledger = 'hostel' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_prev_late_head FROM fee_heads WHERE kind = 'late_fee' AND code = 'PREVLATE' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_prev_late_hostel_head FROM fee_heads WHERE kind = 'late_fee' AND code = 'PREVLATEH' AND deleted_at IS NULL LIMIT 1;
  SELECT * INTO v_first_period FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LIMIT 1;
  -- the hostel fee group of each month: the room type of the bed the pupil holds that month (Hostel ->
  -- Allotment), else the profile's hostel fee group, else the school fee group (as before the module)
  v_hostel_default := COALESCE(v_profile.hostel_fee_group, v_profile.fee_group);
  SELECT COALESCE(array_agg(DISTINCT app.hostel_fee_group_on(p_student_id, make_date(fp.year, fp.month, 1), v_hostel_default)), ARRAY[v_hostel_default])
    INTO v_hostel_groups FROM fee_periods fp WHERE fp.academic_year_id = p_academic_year_id;

  INSERT INTO fee_demand_runs (school_id, academic_year_id, student_id, rows, total, ran_by, request_id)
  VALUES (app.current_school_id(), p_academic_year_id, p_student_id, 0, 0, app.current_user_id(), app.current_request_id())
  RETURNING id INTO v_run_id;

  -- 1. drop unpaid rows of the year so the run is repeatable; paid or partly paid rows stay as they are
  DELETE FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND paid = 0 AND status IN ('pending', 'cancelled')
     -- a line a waiver or a bounce points at is kept; it is refreshed in place below
     AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE a.demand_id = fee_demands.id OR a.charge_demand_id = fee_demands.id);

  -- 2. structure rows: school-ledger heads for everyone, hostel-ledger heads in the months the pupil
  --    stays in the hostel (the whole session for a hosteller with no from / to month)
  FOR r IN
    SELECT fs.*, h.kind AS head_kind, h.ledger AS head_ledger, h.is_optional AS head_optional
      FROM fee_structures fs JOIN fee_heads h ON h.id = fs.head_id AND h.deleted_at IS NULL AND h.status = 'active'
     WHERE fs.academic_year_id = p_academic_year_id AND fs.class_id = v_class_id
       -- school heads by the school fee group; hostel heads by the hostel fee groups of the session
       AND ((h.ledger <> 'hostel' AND fs.fee_group = v_profile.fee_group)
         OR (h.ledger = 'hostel' AND fs.fee_group = ANY (v_hostel_groups)))
       AND fs.student_type IN ('all', v_profile.student_type)
       -- a class and group that has a structure for the pupil's own type (old / new) uses only that one;
       -- "all students" serves the classes that keep a single structure
       AND (fs.student_type = v_profile.student_type OR NOT EXISTS (
             SELECT 1 FROM fee_structures o
              WHERE o.academic_year_id = fs.academic_year_id AND o.class_id = fs.class_id AND o.fee_group = fs.fee_group
                AND o.student_type = v_profile.student_type))
       AND h.kind IN ('regular', 'misc')
       AND (h.ledger <> 'hostel' OR v_profile.hosteller)
  LOOP
    FOR p IN
      SELECT * FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id
         AND (r.head_ledger <> 'hostel' OR app.fee_in_hostel(v_profile.hostel_from, v_profile.hostel_to, make_date(fp.year, fp.month, 1)))
         -- a hostel head is charged in a month by the group of that month only (a transfer re-prices from its month)
         AND (r.head_ledger <> 'hostel' OR r.fee_group = app.hostel_fee_group_on(p_student_id, make_date(fp.year, fp.month, 1), v_hostel_default))
         AND CASE
               -- an optional head is charged only in the months the pupil has opted in for
               WHEN r.head_optional AND NOT EXISTS (
                      SELECT 1 FROM student_fee_optional_heads oh
                       WHERE oh.student_id = p_student_id AND oh.academic_year_id = p_academic_year_id AND oh.head_id = r.head_id
                         AND oh.status = 'active' AND fp.sequence BETWEEN oh.from_seq AND oh.to_seq) THEN false
               WHEN r.amounts IS NOT NULL THEN COALESCE(r.amounts[fp.sequence], 0) > 0
               WHEN r.periods IS NOT NULL THEN fp.sequence = ANY (r.periods)
               WHEN r.frequency = 'monthly' THEN true
               WHEN r.frequency = 'quarterly' THEN fp.sequence IN (1, 4, 7, 10)
               WHEN r.frequency = 'half_yearly' THEN fp.sequence IN (1, 7)
               ELSE fp.sequence = 1
             END
       ORDER BY fp.sequence
    LOOP
      v_gross := CASE WHEN r.amounts IS NOT NULL THEN r.amounts[p.sequence] ELSE r.amount END;
      v_disc := app.fee_discount_for(p_student_id, p_academic_year_id, r.head_id, p.sequence, v_gross, false);
      v_due := CASE WHEN r.head_ledger = 'hostel' THEN app.fee_hostel_due_on(p.id, v_class_id, p.due_on, v_hostel_plan)
                    ELSE app.fee_due_on_plan(p.id, v_class_id, p.due_on, v_plan) END;
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, r.head_id, v_gross, v_disc, v_net, v_due, 'structure', v_run_id, r.head_ledger)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO UPDATE SET gross = EXCLUDED.gross, discount = EXCLUDED.discount, net = EXCLUDED.net, due_on = EXCLUDED.due_on, run_id = EXCLUDED.run_id, updated_at = now()
        WHERE fee_demands.paid = 0 AND fee_demands.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE (a.demand_id = fee_demands.id OR a.charge_demand_id = fee_demands.id) AND a.status = 'approved');   -- a paid or waived line keeps its amounts
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;

  -- 3. transport rows
  IF v_profile.transport_slab_id IS NOT NULL AND NOT v_profile.transport_disabled AND v_transport_head IS NOT NULL THEN
    FOR p IN SELECT * FROM fee_periods WHERE academic_year_id = p_academic_year_id AND transport_charged ORDER BY sequence LOOP
      SELECT CASE WHEN EXISTS (SELECT 1 FROM student_transport x WHERE x.student_id = p_student_id AND x.academic_year_id = p_academic_year_id AND x.status <> 'cancelled')
                 THEN (SELECT x.monthly_amount FROM student_transport x
                        WHERE x.student_id = p_student_id AND x.academic_year_id = p_academic_year_id AND x.status <> 'cancelled'
                          AND make_date(p.year, p.month, 1) BETWEEN x.from_month AND x.to_month ORDER BY x.id DESC LIMIT 1)
                 ELSE (SELECT monthly_amount FROM transport_slabs WHERE id = v_profile.transport_slab_id) END INTO v_gross;
      IF v_gross IS NULL THEN CONTINUE; END IF;
      -- a pupil on a discount rides only when the school allows it or one of the month's discounts covers transport
      IF NOT v_transport_for_discounted
         AND app.fee_discount_count(p_student_id, p_academic_year_id, p.sequence, false) > 0
         AND app.fee_discount_count(p_student_id, p_academic_year_id, p.sequence, true) = 0 THEN CONTINUE; END IF;
      v_disc := app.fee_discount_for(p_student_id, p_academic_year_id, v_transport_head, p.sequence, v_gross, true);
      v_due := app.fee_due_on_plan(p.id, v_class_id, p.due_on, v_plan);
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, v_transport_head, v_gross, v_disc, v_net, v_due, 'transport', v_run_id, 'school')
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO UPDATE SET gross = EXCLUDED.gross, discount = EXCLUDED.discount, net = EXCLUDED.net, due_on = EXCLUDED.due_on, run_id = EXCLUDED.run_id, updated_at = now()
        WHERE fee_demands.paid = 0 AND fee_demands.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE (a.demand_id = fee_demands.id OR a.charge_demand_id = fee_demands.id) AND a.status = 'approved');
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END IF;

  -- 4. opening balance (a credit reduces the first period; a due adds to it)
  IF v_profile.opening_balance <> 0 THEN
    IF v_opb_head IS NULL THEN
      RAISE EXCEPTION 'fees.no_opening_balance_head' USING ERRCODE = 'P0001', DETAIL = 'create a fee head of kind opening_balance';
    END IF;
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_opb_head, v_profile.opening_balance, 0, v_profile.opening_balance, app.fee_due_on(v_first_period.id, v_class_id, v_first_period.due_on), 'opening_balance', v_run_id, 'school')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;

  -- 4b. carried from the year before: hostel dues on the hostel ledger, and the unpaid late fine
  IF v_profile.opening_hostel <> 0 AND v_opb_hostel_head IS NOT NULL THEN
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_opb_hostel_head, v_profile.opening_hostel, 0, v_profile.opening_hostel, app.fee_hostel_due_on(v_first_period.id, v_class_id, v_first_period.due_on, v_hostel_plan), 'opening_balance', v_run_id, 'hostel')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;
  IF v_profile.opening_late_fee > 0 AND v_prev_late_head IS NOT NULL THEN
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_prev_late_head, v_profile.opening_late_fee, 0, v_profile.opening_late_fee, app.fee_due_on(v_first_period.id, v_class_id, v_first_period.due_on), 'opening_balance', v_run_id, 'school')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;
  -- last year's unpaid hostel late fine: on the hostel bill (0145)
  IF v_profile.opening_late_hostel > 0 AND v_prev_late_hostel_head IS NOT NULL THEN
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_prev_late_hostel_head, v_profile.opening_late_hostel, 0, v_profile.opening_late_hostel, app.fee_hostel_due_on(v_first_period.id, v_class_id, v_first_period.due_on, v_hostel_plan), 'opening_balance', v_run_id, 'hostel')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;

  -- 5. rounding reconcile: whole rupees per period and ledger, difference on the last row generated in this run
  FOR p IN SELECT fp.id, l.ledger FROM fee_periods fp CROSS JOIN (SELECT unnest(enum_range(NULL::ledger_type)) AS ledger) l WHERE fp.academic_year_id = p_academic_year_id ORDER BY fp.sequence LOOP
    SELECT COALESCE(sum(net), 0) INTO v_sum FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = p.id AND run_id = v_run_id AND ledger = p.ledger;
    v_delta := round(v_sum) - v_sum;
    IF v_delta <> 0 THEN
      SELECT id INTO v_last_id FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = p.id AND run_id = v_run_id AND ledger = p.ledger ORDER BY id DESC LIMIT 1;
      UPDATE fee_demands SET net = net + v_delta, discount = discount - v_delta WHERE id = v_last_id;
    END IF;
  END LOOP;

  SELECT COALESCE(sum(net), 0) INTO v_total FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  UPDATE fee_demand_runs SET rows = v_rows, total = v_total WHERE id = v_run_id;
  RETURN QUERY SELECT v_run_id, v_rows, v_total;
END
$$;
