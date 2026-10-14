-- 0134: hostel fee by months and by its own calendar.
--  * A hosteller can stay part of the session: hostel_from / hostel_to on the fee profile (the first and
--    last month, NULL = from the start / to the end). Hostel heads are charged only in those months, by
--    whole months. They change through the fee change approval, like the hosteller flag itself.
--  * The hostel may have its own calendar for a session (fee_hostel_calendars, mode 'own'): its own pay
--    plan, last dates and late fee (by slab, per day or none), with a row per month for dates and slabs
--    (fee_hostel_period_rules). Mode 'school', or no row, keeps hostel on the school's dates as before.
--  * A pupil may be given an own hostel pay plan through approval (student_fee_profiles.hostel_pay_plan),
--    for example monthly where the hostel goes by quarter.
ALTER TABLE student_fee_profiles
  ADD COLUMN hostel_from DATE CHECK (hostel_from IS NULL OR extract(day FROM hostel_from) = 1),
  ADD COLUMN hostel_to   DATE CHECK (hostel_to IS NULL OR extract(day FROM hostel_to) = 1),
  ADD COLUMN hostel_pay_plan TEXT CHECK (hostel_pay_plan IS NULL OR hostel_pay_plan IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  ADD CONSTRAINT student_fee_profiles_hostel_span CHECK (hostel_from IS NULL OR hostel_to IS NULL OR hostel_from <= hostel_to);

CREATE TABLE fee_hostel_calendars (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  mode             TEXT NOT NULL DEFAULT 'school' CHECK (mode IN ('school', 'own')),
  pay_plan         TEXT CHECK (pay_plan IS NULL OR pay_plan IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  late_mode        TEXT NOT NULL DEFAULT 'slab' CHECK (late_mode IN ('slab', 'daywise', 'none')),
  late_per_day     NUMERIC(12, 2) CHECK (late_per_day IS NULL OR late_per_day >= 0),
  late_max         NUMERIC(12, 2) CHECK (late_max IS NULL OR late_max >= 0),   -- 0 or empty = no limit
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  UNIQUE (academic_year_id)
);
CALL app.apply_tenant_rls('fee_hostel_calendars');
CREATE TRIGGER fee_hostel_calendars_audit AFTER INSERT OR UPDATE OR DELETE ON fee_hostel_calendars FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE fee_hostel_period_rules (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  period_id          BIGINT NOT NULL REFERENCES fee_periods(id) ON DELETE CASCADE,
  due_on             DATE,                       -- NULL = the month's own last date
  late_fee_amount    NUMERIC(12, 2) CHECK (late_fee_amount IS NULL OR late_fee_amount >= 0),
  late_slab_1_on     DATE,
  late_slab_1_amount NUMERIC(12, 2),
  late_slab_2_on     DATE,
  late_slab_2_amount NUMERIC(12, 2),
  late_slab_3_on     DATE,
  late_slab_3_amount NUMERIC(12, 2),
  late_per_day       NUMERIC(12, 2) CHECK (late_per_day IS NULL OR late_per_day >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  UNIQUE (period_id)
);
CALL app.apply_tenant_rls('fee_hostel_period_rules');
CREATE TRIGGER fee_hostel_period_rules_audit AFTER INSERT OR UPDATE OR DELETE ON fee_hostel_period_rules FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- is the month in the pupil's hostel stay (both ends counted; an open end runs to the session's edge)
CREATE OR REPLACE FUNCTION app.fee_in_hostel(p_from date, p_to date, p_month date) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from IS NULL OR p_month >= p_from) AND (p_to IS NULL OR p_month <= p_to)
$$;

-- the hostel pay plan of a pupil: own (approved), else the hostel calendar's (when it has its own),
-- else the pupil's school pay plan
CREATE OR REPLACE FUNCTION app.fee_hostel_plan(p_student_id bigint, p_academic_year_id bigint, p_school_plan text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT hostel_pay_plan FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id),
    (SELECT pay_plan FROM fee_hostel_calendars WHERE academic_year_id = p_academic_year_id AND mode = 'own'),
    p_school_plan)
$$;

-- the last date of a hostel month: under the hostel's own calendar, that of the first month of its
-- instalment in the hostel calendar (else that month's own date); otherwise as the school's
CREATE OR REPLACE FUNCTION app.fee_hostel_due_on(p_period_id bigint, p_class_id bigint, p_default date, p_plan text) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM fee_hostel_calendars hc JOIN fee_periods me ON me.academic_year_id = hc.academic_year_id
                  WHERE me.id = p_period_id AND hc.mode = 'own') THEN
      (SELECT COALESCE(hr.due_on, a.due_on)
         FROM fee_periods me
        CROSS JOIN (SELECT CASE p_plan WHEN 'quarterly' THEN 3 WHEN 'half_yearly' THEN 6 WHEN 'yearly' THEN 12 ELSE 1 END AS n) n
         JOIN fee_periods a ON a.academic_year_id = me.academic_year_id AND a.sequence = ((me.sequence - 1) / n.n) * n.n + 1
         LEFT JOIN fee_hostel_period_rules hr ON hr.period_id = a.id
        WHERE me.id = p_period_id)
    ELSE app.fee_due_on_plan(p_period_id, p_class_id, p_default, p_plan)
  END
$$;

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
  SELECT * INTO v_first_period FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LIMIT 1;

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
       AND fs.fee_group = v_profile.fee_group
       AND fs.student_type IN ('all', v_profile.student_type)
       -- a class and group that has a structure for the pupil's own type (old / new) uses only that one;
       -- "all students" serves the classes that keep a single structure
       AND (fs.student_type = v_profile.student_type OR NOT EXISTS (
             SELECT 1 FROM fee_structures o
              WHERE o.academic_year_id = fs.academic_year_id AND o.class_id = fs.class_id AND o.fee_group = fs.fee_group
                AND o.student_type = v_profile.student_type))
       AND h.kind IN ('regular', 'misc')
       AND (h.ledger = 'school' OR (h.ledger = 'hostel' AND v_profile.hosteller))
  LOOP
    FOR p IN
      SELECT * FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id
         AND (r.head_ledger <> 'hostel' OR app.fee_in_hostel(v_profile.hostel_from, v_profile.hostel_to, make_date(fp.year, fp.month, 1)))
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

CREATE OR REPLACE FUNCTION app.late_fee(p_student_id bigint, p_academic_year_id bigint, p_due_on date, p_as_of date DEFAULT CURRENT_DATE, p_ledger ledger_type DEFAULT 'school'::ledger_type)
 RETURNS TABLE(o_amount numeric, o_mode text, o_days integer, o_overridden boolean, o_reason text, o_period_id bigint)
 LANGUAGE plpgsql
 STABLE
AS $$
DECLARE
  v_net         NUMERIC;
  v_paid_now    NUMERIC;
  v_paid_by_due NUMERIC;
  v_settled_on  DATE;
  v_end         DATE;
  v_anchor      fee_periods%ROWTYPE;
  v_ov          fee_late_fee_overrides%ROWTYPE;
  v_mode        TEXT;
  v_per_day     NUMERIC;
  v_class_id    BIGINT;
  v_rule        fee_period_class_rules%ROWTYPE;
  v_class       fee_class_charges%ROWTYPE;
  v_hostel      fee_hostel_calendars%ROWTYPE;
  v_hrule       fee_hostel_period_rules%ROWTYPE;
  v_own_hostel  BOOLEAN := false;
BEGIN
  PERFORM app.assert_context();
  SELECT COALESCE(sum(net), 0), COALESCE(sum(paid), 0) INTO v_net, v_paid_now
    FROM fee_demands
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = p_ledger
     AND status IN ('pending', 'partial', 'paid');
  -- a hostel instalment under the hostel's own calendar takes the hostel's dates, rule and amounts
  IF p_ledger = 'hostel' THEN
    SELECT * INTO v_hostel FROM fee_hostel_calendars WHERE academic_year_id = p_academic_year_id AND mode = 'own';
    v_own_hostel := FOUND;
  END IF;
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id
   ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1;
  IF v_own_hostel THEN
    -- the instalment is known by the pupil's own hostel rows
    SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = 'hostel'
     ORDER BY fp.sequence LIMIT 1;
    IF v_anchor.id IS NOT NULL THEN
      SELECT * INTO v_hrule FROM fee_hostel_period_rules WHERE period_id = v_anchor.id;
      v_anchor.late_fee_amount := v_hrule.late_fee_amount;
      v_anchor.late_slab_1_on := v_hrule.late_slab_1_on; v_anchor.late_slab_1_amount := v_hrule.late_slab_1_amount;
      v_anchor.late_slab_2_on := v_hrule.late_slab_2_on; v_anchor.late_slab_2_amount := v_hrule.late_slab_2_amount;
      v_anchor.late_slab_3_on := v_hrule.late_slab_3_on; v_anchor.late_slab_3_amount := v_hrule.late_slab_3_amount;
    END IF;
  -- a class with its own last dates: the instalment is known by the pupil's own rows, not the school calendar
  ELSIF v_class_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM fee_period_class_rules cr JOIN fee_periods fp ON fp.id = cr.period_id
        WHERE cr.class_id = v_class_id AND fp.academic_year_id = p_academic_year_id AND cr.due_on IS NOT NULL) THEN
    SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
     ORDER BY fp.sequence LIMIT 1;
  END IF;
  IF v_anchor.id IS NULL THEN
    SELECT fp.* INTO v_anchor FROM fee_periods fp
     WHERE fp.academic_year_id = p_academic_year_id AND fp.due_on = p_due_on ORDER BY fp.sequence LIMIT 1;
    IF v_anchor.id IS NULL THEN
      SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
       WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
       ORDER BY fp.sequence LIMIT 1;
    END IF;
  END IF;
  IF v_anchor.id IS NOT NULL AND v_class_id IS NOT NULL AND NOT v_own_hostel THEN
    SELECT * INTO v_rule FROM fee_period_class_rules WHERE period_id = v_anchor.id AND class_id = v_class_id;
    IF v_rule.late_fee_amount IS NOT NULL THEN
      v_anchor.late_fee_amount := v_rule.late_fee_amount;
      v_anchor.late_slab_1_on := v_rule.late_slab_1_on; v_anchor.late_slab_1_amount := v_rule.late_slab_1_amount;
      v_anchor.late_slab_2_on := v_rule.late_slab_2_on; v_anchor.late_slab_2_amount := v_rule.late_slab_2_amount;
      v_anchor.late_slab_3_on := v_rule.late_slab_3_on; v_anchor.late_slab_3_amount := v_rule.late_slab_3_amount;
    END IF;
  END IF;
  o_period_id := v_anchor.id;
  o_amount := 0; o_mode := 'none'; o_days := 0; o_overridden := false; o_reason := NULL;
  IF v_net <= 0 OR p_as_of <= p_due_on THEN RETURN NEXT; RETURN; END IF;

  SELECT COALESCE(sum(a.amount), 0) INTO v_paid_by_due
    FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
   WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
     AND p.received_on <= p_due_on;
  IF v_net - v_paid_by_due <= 0 THEN RETURN NEXT; RETURN; END IF;   -- settled on time

  v_end := p_as_of;
  IF v_net - v_paid_now <= 0 THEN
    SELECT max(p.received_on) INTO v_settled_on
      FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger;
    IF v_settled_on IS NOT NULL AND v_settled_on < v_end THEN v_end := v_settled_on; END IF;
  END IF;
  IF v_end <= p_due_on THEN RETURN NEXT; RETURN; END IF;
  o_days := v_end - p_due_on;

  IF v_anchor.id IS NOT NULL THEN
    SELECT * INTO v_ov FROM fee_late_fee_overrides
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = v_anchor.id AND ledger = p_ledger AND revoked_at IS NULL;
    IF FOUND THEN
      o_amount := v_ov.amount; o_mode := 'override'; o_overridden := true; o_reason := v_ov.reason;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_own_hostel THEN
    IF v_hostel.late_mode = 'none' THEN RETURN NEXT; RETURN; END IF;
    v_mode := v_hostel.late_mode;
    v_class.late_per_day := v_hostel.late_per_day;
    v_class.late_max := v_hostel.late_max;
    v_rule.late_per_day := v_hrule.late_per_day;
  ELSE
    IF v_class_id IS NOT NULL THEN
      SELECT * INTO v_class FROM fee_class_charges WHERE academic_year_id = p_academic_year_id AND class_id = v_class_id;
    END IF;
    v_mode := COALESCE(v_class.late_mode, app.setting('fees.late_fee_mode') #>> '{}', 'daywise');
  END IF;
  IF v_mode = 'slab' THEN
    o_amount := CASE
      WHEN v_anchor.late_slab_3_on IS NOT NULL AND v_end > v_anchor.late_slab_3_on THEN COALESCE(v_anchor.late_slab_3_amount, 0)
      WHEN v_anchor.late_slab_2_on IS NOT NULL AND v_end > v_anchor.late_slab_2_on THEN COALESCE(v_anchor.late_slab_2_amount, 0)
      WHEN v_anchor.late_slab_1_on IS NOT NULL AND v_end > v_anchor.late_slab_1_on THEN COALESCE(v_anchor.late_slab_1_amount, 0)
      ELSE COALESCE(v_anchor.late_fee_amount, 0)
    END;
  ELSE
    v_mode := 'daywise';
    v_per_day := CASE WHEN v_own_hostel THEN COALESCE(v_rule.late_per_day, v_class.late_per_day, 0)
                      ELSE COALESCE(v_rule.late_per_day, v_class.late_per_day, (app.setting('fees.late_fee_per_day') #>> '{}')::numeric, 0) END;
    o_amount := round(o_days * v_per_day, 2);
    IF v_class.late_max > 0 THEN o_amount := LEAST(o_amount, v_class.late_max); END IF;   -- 0 or empty = no limit
  END IF;
  o_mode := v_mode;
  RETURN NEXT;
END
$$;
