-- 0098: fee set-up, second pass (asked by the school's accounts office, October 2026).
--   1. A fee head can print under a combined name ("Composite fee") on the bill and the receipt, and is
--      marked when it counts for the income-tax certificate.
--   2. A class can have its own last date, late fee and cheque-bounce charge; the school calendar stays
--      the default.
--   3. Payment modes become a master: which modes the counter offers and which fields each one demands.
--   4. A pupil can hold several discounts, each for a run of months; on one head they add up and are
--      capped at the head's fee. The discount on the fee profile stays and counts with them.

ALTER TABLE fee_heads
  ADD COLUMN print_group     TEXT,
  ADD COLUMN tax_certificate BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Class rules
-- ---------------------------------------------------------------------------
CREATE TABLE fee_period_class_rules (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  period_id          BIGINT NOT NULL REFERENCES fee_periods(id) ON DELETE CASCADE,
  class_id           BIGINT NOT NULL REFERENCES classes(id),
  due_on             DATE,                       -- NULL = the school's last date
  late_fee_amount    NUMERIC(12, 2) CHECK (late_fee_amount IS NULL OR late_fee_amount >= 0),   -- NULL = the school's late fee and slabs
  late_slab_1_on     DATE,
  late_slab_1_amount NUMERIC(12, 2),
  late_slab_2_on     DATE,
  late_slab_2_amount NUMERIC(12, 2),
  late_slab_3_on     DATE,
  late_slab_3_amount NUMERIC(12, 2),
  late_per_day       NUMERIC(12, 2) CHECK (late_per_day IS NULL OR late_per_day >= 0),         -- day-wise mode
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  UNIQUE (period_id, class_id)
);
CALL app.apply_tenant_rls('fee_period_class_rules');

CREATE TABLE fee_class_charges (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  class_id         BIGINT NOT NULL REFERENCES classes(id),
  bounce_charge    NUMERIC(12, 2) NOT NULL CHECK (bounce_charge >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  UNIQUE (academic_year_id, class_id)
);
CALL app.apply_tenant_rls('fee_class_charges');

CREATE OR REPLACE FUNCTION app.fee_due_on(p_period_id BIGINT, p_class_id BIGINT, p_default DATE) RETURNS DATE
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT due_on FROM fee_period_class_rules WHERE period_id = p_period_id AND class_id = p_class_id), p_default)
$$;

-- ---------------------------------------------------------------------------
-- 3. Payment modes
-- ---------------------------------------------------------------------------
CREATE TABLE fee_payment_modes (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  code                 TEXT NOT NULL CHECK (code IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card')),
  label                TEXT NOT NULL,
  at_counter           BOOLEAN NOT NULL DEFAULT true,
  need_reference       BOOLEAN NOT NULL DEFAULT false,
  need_instrument_no   BOOLEAN NOT NULL DEFAULT false,
  need_instrument_date BOOLEAN NOT NULL DEFAULT false,
  need_bank            BOOLEAN NOT NULL DEFAULT false,
  sort_order           INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('fee_payment_modes');

-- The seven modes with today's rule (a cheque or draft needs its number); the school tightens from there.
CREATE OR REPLACE FUNCTION app.fee_seed_payment_modes() RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO fee_payment_modes (school_id, code, label, at_counter, need_instrument_no, sort_order)
  SELECT app.current_school_id(), m.code, m.label, m.at_counter, m.need_no, m.ord
    FROM (VALUES ('cash', 'Cash', true, false, 1), ('cheque', 'Cheque', true, true, 2), ('dd', 'Demand draft', true, true, 3),
                 ('upi', 'UPI', true, false, 4), ('card', 'Card', true, false, 5), ('bank', 'Bank transfer', true, false, 6),
                 ('online', 'Online (payment gateway)', false, false, 7)) AS m(code, label, at_counter, need_no, ord)
  ON CONFLICT (school_id, code) DO NOTHING
$$;

-- ---------------------------------------------------------------------------
-- 4. Several discounts per pupil, by month
-- ---------------------------------------------------------------------------
CREATE TABLE student_fee_discounts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  student_id       BIGINT NOT NULL REFERENCES students(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  discount_id      BIGINT NOT NULL REFERENCES fee_discounts(id),
  from_seq         INT NOT NULL DEFAULT 1 CHECK (from_seq BETWEEN 1 AND 12),    -- fee period sequence, 1 = first month of the year
  to_seq           INT NOT NULL DEFAULT 12 CHECK (to_seq BETWEEN 1 AND 12),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  change_id        BIGINT REFERENCES fee_profile_changes(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  removed_at       TIMESTAMPTZ,
  removed_by       BIGINT,
  CHECK (from_seq <= to_seq)
);
CREATE INDEX student_fee_discounts_by_student ON student_fee_discounts (student_id, academic_year_id) WHERE status = 'active';
CALL app.apply_tenant_rls('student_fee_discounts');
CREATE TRIGGER student_fee_discounts_audit AFTER INSERT OR UPDATE OR DELETE ON student_fee_discounts FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- The pupil's discounts that touch one month: the profile's own (whole year) and the dated ones.
CREATE OR REPLACE FUNCTION app.fee_discounts_in(p_student_id BIGINT, p_academic_year_id BIGINT, p_seq INT)
RETURNS SETOF fee_discounts LANGUAGE sql STABLE AS $$
  SELECT d.* FROM fee_discounts d
   WHERE d.status = 'active' AND d.id IN (
     SELECT pr.discount_id FROM student_fee_profiles pr
      WHERE pr.student_id = p_student_id AND pr.academic_year_id = p_academic_year_id AND pr.discount_id IS NOT NULL
     UNION
     SELECT s.discount_id FROM student_fee_discounts s
      WHERE s.student_id = p_student_id AND s.academic_year_id = p_academic_year_id AND s.status = 'active'
        AND p_seq BETWEEN s.from_seq AND s.to_seq)
$$;

CREATE OR REPLACE FUNCTION app.fee_discount_count(p_student_id BIGINT, p_academic_year_id BIGINT, p_seq INT, p_transport_only BOOLEAN)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM app.fee_discounts_in(p_student_id, p_academic_year_id, p_seq) d
   WHERE NOT p_transport_only OR d.applies_to_transport
$$;

-- What comes off one head in one month: every discount that applies, added up, never more than the fee.
CREATE OR REPLACE FUNCTION app.fee_discount_for(p_student_id BIGINT, p_academic_year_id BIGINT, p_head_id BIGINT, p_seq INT, p_gross NUMERIC, p_transport BOOLEAN)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT LEAST(p_gross, COALESCE(sum(CASE WHEN d.percent IS NOT NULL THEN round(p_gross * d.percent / 100, 2) ELSE LEAST(p_gross, d.amount) END), 0))
    FROM app.fee_discounts_in(p_student_id, p_academic_year_id, p_seq) d
   WHERE CASE WHEN p_transport THEN d.applies_to_transport ELSE (d.head_id IS NULL OR d.head_id = p_head_id) END
$$;

-- ---------------------------------------------------------------------------
-- app.generate_fee_demand: as 0024 and 0077, with the class's last date and every discount of the month
-- ---------------------------------------------------------------------------

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
    v_profile.hosteller := false;
  END IF;
  IF v_profile.discount_id IS NOT NULL THEN
    SELECT * INTO v_discount FROM fee_discounts WHERE id = v_profile.discount_id AND status = 'active';
  END IF;
  v_transport_for_discounted := COALESCE((app.setting('fees.transport_for_discounted'))::text::boolean, false);
  SELECT id INTO v_transport_head FROM fee_heads WHERE kind = 'transport' AND deleted_at IS NULL AND status = 'active' ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_opb_head FROM fee_heads WHERE kind = 'opening_balance' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1;
  SELECT * INTO v_first_period FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LIMIT 1;

  INSERT INTO fee_demand_runs (school_id, academic_year_id, student_id, rows, total, ran_by, request_id)
  VALUES (app.current_school_id(), p_academic_year_id, p_student_id, 0, 0, app.current_user_id(), app.current_request_id())
  RETURNING id INTO v_run_id;

  -- 1. drop unpaid rows of the year so the run is repeatable; paid or partly paid rows stay as they are
  DELETE FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND paid = 0 AND status IN ('pending', 'cancelled');

  -- 2. structure rows: school-ledger heads for everyone, hostel-ledger heads for hostellers (Sprint 14)
  FOR r IN
    SELECT fs.*, h.kind AS head_kind, h.ledger AS head_ledger
      FROM fee_structures fs JOIN fee_heads h ON h.id = fs.head_id AND h.deleted_at IS NULL AND h.status = 'active'
     WHERE fs.academic_year_id = p_academic_year_id AND fs.class_id = v_class_id
       AND fs.fee_group = v_profile.fee_group
       AND fs.student_type IN ('all', v_profile.student_type)
       AND h.kind IN ('regular', 'misc')
       AND (h.ledger = 'school' OR (h.ledger = 'hostel' AND v_profile.hosteller))
  LOOP
    FOR p IN
      SELECT * FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id
         AND CASE
               WHEN r.periods IS NOT NULL THEN fp.sequence = ANY (r.periods)
               WHEN r.frequency = 'monthly' THEN true
               WHEN r.frequency = 'quarterly' THEN fp.sequence IN (1, 4, 7, 10)
               WHEN r.frequency = 'half_yearly' THEN fp.sequence IN (1, 7)
               ELSE fp.sequence = 1
             END
       ORDER BY fp.sequence
    LOOP
      v_gross := r.amount;
      v_disc := app.fee_discount_for(p_student_id, p_academic_year_id, r.head_id, p.sequence, v_gross, false);
      v_due := app.fee_due_on(p.id, v_class_id, p.due_on);
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, r.head_id, v_gross, v_disc, v_net, v_due, 'structure', v_run_id, r.head_ledger)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;   -- a paid row keeps its amounts
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;

  -- 3. transport rows
  IF v_profile.transport_slab_id IS NOT NULL AND NOT v_profile.transport_disabled AND v_transport_head IS NOT NULL THEN
    FOR p IN SELECT * FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LOOP
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
      v_due := app.fee_due_on(p.id, v_class_id, p.due_on);
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, v_transport_head, v_gross, v_disc, v_net, v_due, 'transport', v_run_id, 'school')
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
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

-- app.late_fee: as 0025, with the class's own late fee where one is set
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
BEGIN
  PERFORM app.assert_context();
  SELECT COALESCE(sum(net), 0), COALESCE(sum(paid), 0) INTO v_net, v_paid_now
    FROM fee_demands
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = p_ledger
     AND status IN ('pending', 'partial', 'paid');
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id
   ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1;
  -- a class with its own last dates: the instalment is known by the pupil's own rows, not the school calendar
  IF v_class_id IS NOT NULL AND EXISTS (
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
  IF v_anchor.id IS NOT NULL AND v_class_id IS NOT NULL THEN
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

  v_mode := COALESCE(app.setting('fees.late_fee_mode') #>> '{}', 'daywise');
  IF v_mode = 'slab' THEN
    o_amount := CASE
      WHEN v_anchor.late_slab_3_on IS NOT NULL AND v_end > v_anchor.late_slab_3_on THEN COALESCE(v_anchor.late_slab_3_amount, 0)
      WHEN v_anchor.late_slab_2_on IS NOT NULL AND v_end > v_anchor.late_slab_2_on THEN COALESCE(v_anchor.late_slab_2_amount, 0)
      WHEN v_anchor.late_slab_1_on IS NOT NULL AND v_end > v_anchor.late_slab_1_on THEN COALESCE(v_anchor.late_slab_1_amount, 0)
      ELSE COALESCE(v_anchor.late_fee_amount, 0)
    END;
  ELSE
    v_mode := 'daywise';
    v_per_day := COALESCE(v_rule.late_per_day, (app.setting('fees.late_fee_per_day') #>> '{}')::numeric, 0);
    o_amount := round(o_days * v_per_day, 2);
  END IF;
  o_mode := v_mode;
  RETURN NEXT;
END
$$;
