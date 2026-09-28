-- Sprint 14 (Phase 3): adjustments, misc and hostel; exams start; assistant v0.
-- The fee engine gains the ledger dimension (hostel demands and receipts on the same tables and procedures),
-- adjustments (waiver, receipt reversal, cheque bounce with charge) decided with step-up MFA, category and
-- discount changes through the workflow, misc receipts for students, employees and vendors, a nightly
-- reconciliation of online receipts against settlements; exam masters (types, exams per year and class,
-- subjects with max marks and locks, grade scales and bands); the assistant's conversations and audit.

-- ---------------------------------------------------------------------------
-- Ledger dimension on demands; hostellers; receipt statuses
-- ---------------------------------------------------------------------------
ALTER TABLE fee_demands ADD COLUMN ledger ledger_type NOT NULL DEFAULT 'school';
UPDATE fee_demands d SET ledger = h.ledger FROM fee_heads h WHERE h.id = d.head_id AND h.ledger <> 'school';
CREATE INDEX fee_demands_by_ledger ON fee_demands (student_id, academic_year_id, ledger);

ALTER TABLE student_fee_profiles ADD COLUMN hosteller BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_status_check;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_status_check
  CHECK (status IN ('posted', 'partly_refunded', 'refunded', 'bounced', 'reversed'));
ALTER TABLE fee_payments ADD COLUMN reversed_at TIMESTAMPTZ, ADD COLUMN reversal_reason TEXT;

-- ---------------------------------------------------------------------------
-- app.generate_fee_demand: as Sprint 8/11, plus the ledger of every row and hostel heads for hostellers only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.generate_fee_demand(p_student_id BIGINT, p_academic_year_id BIGINT)
RETURNS TABLE (o_run_id BIGINT, o_rows INT, o_total NUMERIC)
LANGUAGE plpgsql AS $$
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
      v_disc := 0;
      IF v_discount.id IS NOT NULL AND (v_discount.head_id IS NULL OR v_discount.head_id = r.head_id) THEN
        v_disc := CASE WHEN v_discount.percent IS NOT NULL THEN round(v_gross * v_discount.percent / 100, 2) ELSE LEAST(v_gross, v_discount.amount) END;
      END IF;
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, r.head_id, v_gross, v_disc, v_net, p.due_on, 'structure', v_run_id, r.head_ledger)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;   -- a paid row keeps its amounts
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;

  -- 3. transport rows
  IF v_profile.transport_slab_id IS NOT NULL AND NOT v_profile.transport_disabled AND v_transport_head IS NOT NULL
     AND (v_discount.id IS NULL OR v_transport_for_discounted OR v_discount.applies_to_transport) THEN
    FOR p IN SELECT * FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LOOP
      SELECT monthly_amount INTO v_gross FROM transport_slabs WHERE id = v_profile.transport_slab_id;
      v_disc := 0;
      IF v_discount.id IS NOT NULL AND v_discount.applies_to_transport THEN
        v_disc := CASE WHEN v_discount.percent IS NOT NULL THEN round(v_gross * v_discount.percent / 100, 2) ELSE LEAST(v_gross, v_discount.amount) END;
      END IF;
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, v_transport_head, v_gross, v_disc, v_net, p.due_on, 'transport', v_run_id, 'school')
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
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_opb_head, v_profile.opening_balance, 0, v_profile.opening_balance, v_first_period.due_on, 'opening_balance', v_run_id, 'school')
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

-- ---------------------------------------------------------------------------
-- Allocation and posting per ledger: a receipt on the hostel ledger settles hostel demands only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.allocate_to_instalment(p_payment_id BIGINT, p_student_id BIGINT, p_academic_year_id BIGINT, p_due_on DATE, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_left   NUMERIC := p_amount;
  v_take   NUMERIC;
  v_ledger ledger_type;
  d RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN 0; END IF;
  SELECT ledger INTO v_ledger FROM fee_payments WHERE id = p_payment_id;
  FOR d IN
    SELECT id, net, paid FROM fee_demands
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = v_ledger
       AND status IN ('pending', 'partial') AND net > paid
     ORDER BY id FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, d.net - d.paid);
    INSERT INTO fee_payment_allocations (school_id, payment_id, demand_id, amount) VALUES (app.current_school_id(), p_payment_id, d.id, v_take);
    UPDATE fee_demands SET paid = paid + v_take, status = CASE WHEN paid + v_take >= net THEN 'paid' ELSE 'partial' END::fee_demand_status, updated_at = now() WHERE id = d.id;
    v_left := v_left - v_take;
  END LOOP;
  IF (SELECT COALESCE(sum(net - paid), 0) FROM fee_demands
       WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = v_ledger AND status IN ('pending', 'partial', 'paid')) <= 0 THEN
    UPDATE fee_demands SET paid = net, status = 'paid', updated_at = now()
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = v_ledger AND status IN ('pending', 'partial');
  END IF;
  RETURN p_amount - v_left;
END
$$;

CREATE OR REPLACE FUNCTION app.allocate_fee_payment(p_payment_id BIGINT) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_p     fee_payments%ROWTYPE;
  v_left  NUMERIC;
  g RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_p FROM fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.payment_not_found' USING ERRCODE = 'P0002'; END IF;
  v_left := v_p.amount - v_p.late_fee;
  FOR g IN
    SELECT due_on, sum(net - paid) AS balance FROM fee_demands
     WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND ledger = v_p.ledger AND status IN ('pending', 'partial')
     GROUP BY due_on HAVING sum(net - paid) > 0 ORDER BY due_on
  LOOP
    EXIT WHEN v_left <= 0;
    v_left := v_left - app.allocate_to_instalment(p_payment_id, v_p.student_id, v_p.academic_year_id, g.due_on, LEAST(v_left, g.balance));
  END LOOP;
  RETURN v_left;
END
$$;

-- app.late_fee reads every ledger's rows sharing a due date; hostel instalments share the school's rule.
CREATE OR REPLACE FUNCTION app.post_receipt(
  p_student_id       BIGINT,
  p_academic_year_id BIGINT,
  p_amount           NUMERIC,
  p_received_on      DATE,
  p_mode             TEXT,
  p_reference        TEXT DEFAULT NULL,
  p_remarks          TEXT DEFAULT NULL,
  p_instrument_no    TEXT DEFAULT NULL,
  p_instrument_date  DATE DEFAULT NULL,
  p_bank_name        TEXT DEFAULT NULL,
  p_intent_id        BIGINT DEFAULT NULL,
  p_ledger           ledger_type DEFAULT 'school',
  p_collect_late_fee BOOLEAN DEFAULT true,
  p_strict_year      BOOLEAN DEFAULT true
) RETURNS TABLE (o_payment_id BIGINT, o_receipt_no TEXT, o_principal NUMERIC, o_late_fee NUMERIC, o_advance NUMERIC, o_instalments INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_payment_id BIGINT;
  v_fy         BIGINT;
  v_left       NUMERIC := p_amount;
  v_lf         NUMERIC;
  v_take       NUMERIC;
  v_principal  NUMERIC := 0;
  v_late       NUMERIC := 0;
  v_n          INT := 0;
  g  RECORD;
  lf RECORD;
BEGIN
  PERFORM app.assert_context();
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'fees.amount_invalid' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('amount', p_amount)::TEXT;
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card') THEN
    RAISE EXCEPTION 'fees.mode_invalid' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mode', p_mode)::TEXT;
  END IF;
  IF p_mode IN ('cheque', 'dd') AND NULLIF(btrim(COALESCE(p_instrument_no, '')), '') IS NULL THEN
    RAISE EXCEPTION 'fees.instrument_required' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mode', p_mode)::TEXT;
  END IF;
  PERFORM 1 FROM students WHERE id = p_student_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fees.student_not_found' USING ERRCODE = 'P0002', DETAIL = jsonb_build_object('student_id', p_student_id)::TEXT;
  END IF;
  PERFORM app.assert_year_open(p_academic_year_id, 'fees');

  v_fy := app.financial_year_for(p_received_on);
  IF v_fy IS NULL AND NOT p_strict_year THEN v_fy := app.financial_year_for(CURRENT_DATE); END IF;
  IF v_fy IS NULL THEN
    RAISE EXCEPTION 'fees.no_financial_year' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('received_on', p_received_on)::TEXT;
  END IF;

  INSERT INTO fee_payments (school_id, student_id, academic_year_id, intent_id, amount, received_on, mode, reference, remarks, received_by,
                            ledger, financial_year_id, instrument_no, instrument_date, bank_name, request_id)
  VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p_intent_id, p_amount, p_received_on, p_mode, p_reference, p_remarks, app.current_user_id(),
          p_ledger, v_fy, NULLIF(btrim(COALESCE(p_instrument_no, '')), ''), p_instrument_date, NULLIF(btrim(COALESCE(p_bank_name, '')), ''), app.current_request_id())
  RETURNING id INTO v_payment_id;
  UPDATE fee_payments SET receipt_no = app.next_receipt_no(p_ledger, v_fy) WHERE id = v_payment_id;

  FOR g IN
    SELECT due_on, sum(net - paid) AS balance FROM fee_demands
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND ledger = p_ledger AND status IN ('pending', 'partial', 'paid')
     GROUP BY due_on ORDER BY due_on
  LOOP
    EXIT WHEN v_left <= 0;
    v_lf := 0;
    IF p_collect_late_fee AND p_ledger = 'school' THEN
      SELECT * INTO lf FROM app.late_fee(p_student_id, p_academic_year_id, g.due_on, p_received_on);
      v_lf := GREATEST(COALESCE(lf.o_amount, 0) - app.late_fee_posted(p_student_id, p_academic_year_id, g.due_on), 0);
    END IF;
    CONTINUE WHEN g.balance <= 0 AND v_lf <= 0;

    IF g.balance > 0 THEN
      v_take := app.allocate_to_instalment(v_payment_id, p_student_id, p_academic_year_id, g.due_on, LEAST(v_left, g.balance));
      v_left := v_left - v_take;
      v_principal := v_principal + v_take;
      IF v_take > 0 THEN v_n := v_n + 1; END IF;
      IF v_take < g.balance THEN EXIT; END IF;
    END IF;

    IF v_lf > 0 AND v_left > 0 THEN
      v_take := LEAST(v_left, v_lf);
      INSERT INTO fee_late_fee_postings (school_id, payment_id, student_id, academic_year_id, due_on, period_id, amount, mode, days)
      VALUES (app.current_school_id(), v_payment_id, p_student_id, p_academic_year_id, g.due_on, lf.o_period_id, v_take, COALESCE(lf.o_mode, 'daywise'), COALESCE(lf.o_days, 0));
      v_left := v_left - v_take;
      v_late := v_late + v_take;
      IF g.balance <= 0 THEN v_n := v_n + 1; END IF;
    END IF;
  END LOOP;

  UPDATE fee_payments SET late_fee = v_late WHERE id = v_payment_id;
  RETURN QUERY SELECT v_payment_id, (SELECT receipt_no FROM fee_payments WHERE id = v_payment_id), v_principal, v_late, v_left, v_n;
END
$$;

-- ---------------------------------------------------------------------------
-- Adjustments: waiver of a demand row, reversal of a receipt, cheque bounce with charge
-- ---------------------------------------------------------------------------
CREATE TYPE fee_adjustment_kind AS ENUM ('waiver', 'reversal', 'bounce');
CREATE TABLE fee_adjustments (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  student_id       BIGINT NOT NULL REFERENCES students(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  kind             fee_adjustment_kind NOT NULL,
  demand_id        BIGINT REFERENCES fee_demands(id),        -- waiver
  payment_id       BIGINT REFERENCES fee_payments(id),       -- reversal, bounce
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  charge           NUMERIC(12, 2) NOT NULL DEFAULT 0,         -- bounce charge added to the demand
  reason           TEXT NOT NULL,
  status           workflow_status NOT NULL DEFAULT 'pending',
  requested_by     BIGINT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       BIGINT,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  charge_demand_id BIGINT REFERENCES fee_demands(id),
  request_id       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'waiver' AND demand_id IS NOT NULL) OR (kind <> 'waiver' AND payment_id IS NOT NULL))
);
CREATE INDEX fee_adjustments_by_student ON fee_adjustments (student_id, academic_year_id);
CREATE UNIQUE INDEX fee_adjustments_open_payment ON fee_adjustments (payment_id) WHERE status = 'pending' AND payment_id IS NOT NULL;
CREATE UNIQUE INDEX fee_adjustments_open_demand ON fee_adjustments (demand_id) WHERE status = 'pending' AND demand_id IS NOT NULL;
CREATE TRIGGER fee_adjustments_set_updated_at BEFORE UPDATE ON fee_adjustments FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER fee_adjustments_audit AFTER INSERT OR UPDATE OR DELETE ON fee_adjustments FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- A waiver raises the discount of one demand row; never below what is already paid.
CREATE OR REPLACE FUNCTION app.waive_demand(p_demand_id BIGINT, p_amount NUMERIC) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  d fee_demands%ROWTYPE;
  v_take NUMERIC;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO d FROM fee_demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.demand_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_year_open(d.academic_year_id, 'fees');
  v_take := LEAST(p_amount, GREATEST(d.net - d.paid, 0));
  IF v_take <= 0 THEN
    RAISE EXCEPTION 'fees.nothing_to_waive' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('balance', d.net - d.paid)::TEXT;
  END IF;
  UPDATE fee_demands SET discount = discount + v_take, net = net - v_take,
         status = CASE WHEN paid >= net - v_take THEN 'paid' WHEN paid > 0 THEN 'partial' ELSE status END::fee_demand_status, updated_at = now()
   WHERE id = p_demand_id;
  RETURN v_take;
END
$$;

-- A reversal (or a bounce) takes a receipt out of the ledger: allocations and late fee postings are removed,
-- the demand rows reopen, the receipt keeps its number with status reversed or bounced. A bounce adds the
-- charge as a misc demand row due today on the school ledger.
CREATE OR REPLACE FUNCTION app.reverse_fee_payment(p_payment_id BIGINT, p_status TEXT, p_reason TEXT, p_charge NUMERIC DEFAULT 0, p_charge_head_id BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_p fee_payments%ROWTYPE;
  v_charge_demand BIGINT;
  v_period BIGINT;
  a RECORD;
BEGIN
  PERFORM app.assert_context();
  IF p_status NOT IN ('reversed', 'bounced') THEN RAISE EXCEPTION 'fees.reversal_status_invalid' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_p FROM fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.payment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_p.status IN ('reversed', 'bounced') THEN
    RAISE EXCEPTION 'fees.already_reversed' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('status', v_p.status)::TEXT;
  END IF;
  IF v_p.refunded > 0 THEN
    RAISE EXCEPTION 'fees.reversal_after_refund' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('refunded', v_p.refunded)::TEXT;
  END IF;
  PERFORM app.assert_year_open(v_p.academic_year_id, 'fees');
  FOR a IN SELECT al.id, al.amount, al.demand_id FROM fee_payment_allocations al WHERE al.payment_id = v_p.id LOOP
    UPDATE fee_demands SET paid = paid - a.amount,
           status = CASE WHEN paid - a.amount <= 0 THEN 'pending' WHEN paid - a.amount < net THEN 'partial' ELSE 'paid' END::fee_demand_status,
           updated_at = now()
     WHERE id = a.demand_id;
    DELETE FROM fee_payment_allocations WHERE id = a.id;
  END LOOP;
  DELETE FROM fee_late_fee_postings WHERE payment_id = v_p.id;
  UPDATE fee_payments SET status = p_status, late_fee = 0, reversed_at = now(), reversal_reason = p_reason WHERE id = v_p.id;
  IF p_status = 'bounced' AND COALESCE(p_charge, 0) > 0 THEN
    IF p_charge_head_id IS NULL THEN
      RAISE EXCEPTION 'fees.no_bounce_head' USING ERRCODE = 'P0001', DETAIL = 'set fees.bounce_charge_head to a misc fee head';
    END IF;
    SELECT id INTO v_period FROM fee_periods WHERE academic_year_id = v_p.academic_year_id AND due_on <= CURRENT_DATE ORDER BY sequence DESC LIMIT 1;
    IF v_period IS NULL THEN
      SELECT id INTO v_period FROM fee_periods WHERE academic_year_id = v_p.academic_year_id ORDER BY sequence LIMIT 1;
    END IF;
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, ledger)
    VALUES (app.current_school_id(), v_p.student_id, v_p.academic_year_id, v_period, p_charge_head_id, p_charge, 0, p_charge, CURRENT_DATE, 'bounce_charge', 'school')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id)
      DO UPDATE SET gross = fee_demands.gross + EXCLUDED.gross, net = fee_demands.net + EXCLUDED.net, status = 'pending', updated_at = now()
    RETURNING id INTO v_charge_demand;
  END IF;
  RETURN v_charge_demand;
END
$$;

-- ---------------------------------------------------------------------------
-- Category and discount changes approved through the workflow
-- ---------------------------------------------------------------------------
CREATE TABLE fee_profile_changes (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  student_id           BIGINT NOT NULL REFERENCES students(id),
  academic_year_id     BIGINT NOT NULL REFERENCES academic_years(id),
  changes              JSONB NOT NULL,                       -- { feeGroup?, studentType?, discountId?, hosteller?, transportSlabId?, transportDisabled? }
  before               JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason               TEXT NOT NULL,
  status               workflow_status NOT NULL DEFAULT 'pending',
  requested_by         BIGINT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  regenerated_run_id   BIGINT REFERENCES fee_demand_runs(id),
  request_id           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fee_profile_changes_open ON fee_profile_changes (student_id, academic_year_id) WHERE status = 'pending';
CREATE TRIGGER fee_profile_changes_set_updated_at BEFORE UPDATE ON fee_profile_changes FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Misc receipts: students, employees, vendors and others, numbered on the misc ledger
-- ---------------------------------------------------------------------------
CREATE TYPE payer_kind AS ENUM ('student', 'employee', 'vendor', 'other');
CREATE TABLE misc_receipts (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  financial_year_id BIGINT NOT NULL REFERENCES financial_years(id),
  receipt_no        TEXT NOT NULL,
  payer_kind        payer_kind NOT NULL,
  student_id        BIGINT REFERENCES students(id),
  employee_id       BIGINT REFERENCES employees(id),
  payer_name        TEXT NOT NULL,
  payer_mobile      TEXT,
  head_id           BIGINT NOT NULL REFERENCES fee_heads(id),
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  received_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  mode              TEXT NOT NULL CHECK (mode IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card')),
  reference         TEXT,
  instrument_no     TEXT,
  bank_name         TEXT,
  remarks           TEXT,
  status            TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  received_by       BIGINT,
  request_id        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, receipt_no)
);
CREATE INDEX misc_receipts_by_date ON misc_receipts (school_id, received_on DESC);
CREATE TRIGGER misc_receipts_audit AFTER INSERT OR UPDATE OR DELETE ON misc_receipts FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Reconciliation: online receipts against settlement lines, one run per school and day
-- ---------------------------------------------------------------------------
CREATE TABLE payment_reconciliation_runs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  run_date          DATE NOT NULL,
  as_of             DATE NOT NULL,
  online_receipts   INT NOT NULL DEFAULT 0,
  online_amount     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  settled_receipts  INT NOT NULL DEFAULT 0,
  settled_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  unsettled_receipts INT NOT NULL DEFAULT 0,
  unsettled_amount  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  aged_unsettled    INT NOT NULL DEFAULT 0,                  -- online receipts older than 3 days without a settlement line
  unmatched_lines   INT NOT NULL DEFAULT 0,
  mismatched_lines  INT NOT NULL DEFAULT 0,
  succeeded_without_receipt INT NOT NULL DEFAULT 0,          -- intents succeeded with no fee_payments row (a handler failure)
  variance          NUMERIC(14, 2) NOT NULL DEFAULT 0,       -- settled amount minus matched receipt amount
  ran_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, run_date)
);

CREATE OR REPLACE FUNCTION app.reconcile_payments(p_as_of DATE DEFAULT CURRENT_DATE) RETURNS payment_reconciliation_runs
LANGUAGE plpgsql AS $$
DECLARE
  r payment_reconciliation_runs%ROWTYPE;
BEGIN
  PERFORM app.assert_context();
  SELECT count(*)::int, COALESCE(sum(amount), 0),
         count(*) FILTER (WHERE settlement_line_id IS NOT NULL)::int, COALESCE(sum(amount) FILTER (WHERE settlement_line_id IS NOT NULL), 0),
         count(*) FILTER (WHERE settlement_line_id IS NULL)::int, COALESCE(sum(amount) FILTER (WHERE settlement_line_id IS NULL), 0),
         count(*) FILTER (WHERE settlement_line_id IS NULL AND received_on < p_as_of - 3)::int
    INTO r.online_receipts, r.online_amount, r.settled_receipts, r.settled_amount, r.unsettled_receipts, r.unsettled_amount, r.aged_unsettled
    FROM fee_payments WHERE mode = 'online' AND status <> 'reversed' AND received_on <= p_as_of;
  SELECT count(*) FILTER (WHERE status = 'unmatched')::int, count(*) FILTER (WHERE status IN ('amount_mismatch', 'duplicate'))::int
    INTO r.unmatched_lines, r.mismatched_lines FROM payment_settlement_lines;
  SELECT count(*)::int INTO r.succeeded_without_receipt
    FROM payment_intents i WHERE i.purpose = 'fee_instalment' AND i.status = 'succeeded' AND NOT EXISTS (SELECT 1 FROM fee_payments p WHERE p.intent_id = i.id);
  SELECT COALESCE(sum(l.amount - p.amount), 0) INTO r.variance
    FROM payment_settlement_lines l JOIN fee_payments p ON p.settlement_line_id = l.id;
  INSERT INTO payment_reconciliation_runs (school_id, run_date, as_of, online_receipts, online_amount, settled_receipts, settled_amount, unsettled_receipts, unsettled_amount, aged_unsettled, unmatched_lines, mismatched_lines, succeeded_without_receipt, variance)
  VALUES (app.current_school_id(), p_as_of, p_as_of, r.online_receipts, r.online_amount, r.settled_receipts, r.settled_amount, r.unsettled_receipts, r.unsettled_amount, r.aged_unsettled, r.unmatched_lines, r.mismatched_lines, r.succeeded_without_receipt, r.variance)
  ON CONFLICT (school_id, run_date) DO UPDATE SET as_of = EXCLUDED.as_of, online_receipts = EXCLUDED.online_receipts, online_amount = EXCLUDED.online_amount,
    settled_receipts = EXCLUDED.settled_receipts, settled_amount = EXCLUDED.settled_amount, unsettled_receipts = EXCLUDED.unsettled_receipts, unsettled_amount = EXCLUDED.unsettled_amount,
    aged_unsettled = EXCLUDED.aged_unsettled, unmatched_lines = EXCLUDED.unmatched_lines, mismatched_lines = EXCLUDED.mismatched_lines,
    succeeded_without_receipt = EXCLUDED.succeeded_without_receipt, variance = EXCLUDED.variance, ran_at = now()
  RETURNING * INTO r;
  RETURN r;
END
$$;

-- ---------------------------------------------------------------------------
-- Exams: types, exams per year and class, subjects with max marks and locks, grade scales and bands
-- (legacy exam_type, exam_master, exam_subject_master, exam_grade_master)
-- ---------------------------------------------------------------------------
CREATE TABLE exam_types (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  weightage   NUMERIC(5, 2),                                 -- share of the term when results roll up (Sprint 17)
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  legacy_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX exam_types_code ON exam_types (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE grade_scales (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      row_status NOT NULL DEFAULT 'active',
  legacy_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX grade_scales_code ON grade_scales (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE grade_bands (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  scale_id    BIGINT NOT NULL REFERENCES grade_scales(id) ON DELETE CASCADE,
  min_pct     NUMERIC(5, 2) NOT NULL CHECK (min_pct >= 0 AND min_pct <= 100),
  max_pct     NUMERIC(5, 2) NOT NULL CHECK (max_pct >= 0 AND max_pct <= 100),
  grade       TEXT NOT NULL,
  points      NUMERIC(4, 2),
  remark      TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  CHECK (max_pct >= min_pct)
);
CREATE INDEX grade_bands_by_scale ON grade_bands (scale_id, sort_order);

CREATE TABLE exams (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  exam_type_id     BIGINT NOT NULL REFERENCES exam_types(id),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  starts_on        DATE,
  ends_on          DATE,
  show_on_portal   BOOLEAN NOT NULL DEFAULT false,
  marks_locked     BOOLEAN NOT NULL DEFAULT false,
  status           row_status NOT NULL DEFAULT 'active',
  legacy_ref       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX exams_code ON exams (academic_year_id, code) WHERE deleted_at IS NULL;

CREATE TABLE exam_classes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  exam_id        BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id       BIGINT NOT NULL REFERENCES classes(id),
  grade_scale_id BIGINT REFERENCES grade_scales(id),
  UNIQUE (exam_id, class_id)
);

CREATE TABLE exam_subjects (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  exam_id       BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id      BIGINT NOT NULL REFERENCES classes(id),
  subject_id    BIGINT NOT NULL REFERENCES subjects(id),
  max_marks     NUMERIC(6, 2) NOT NULL CHECK (max_marks > 0),
  pass_marks    NUMERIC(6, 2) CHECK (pass_marks IS NULL OR (pass_marks >= 0 AND pass_marks <= max_marks)),
  weightage     NUMERIC(5, 2),
  is_elective   BOOLEAN NOT NULL DEFAULT false,
  exam_on       DATE,
  entry_locked  BOOLEAN NOT NULL DEFAULT false,
  locked_by     BIGINT,
  locked_at     TIMESTAMPTZ,
  legacy_ref    TEXT,
  UNIQUE (exam_id, class_id, subject_id)
);
CREATE INDEX exam_subjects_by_exam ON exam_subjects (exam_id, class_id);

CREATE TRIGGER exam_types_set_updated_at BEFORE UPDATE ON exam_types FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER grade_scales_set_updated_at BEFORE UPDATE ON grade_scales FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER exams_set_updated_at BEFORE UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Assistant: conversations, turns and the AI audit trail (prompts, tool calls, answers, refusals; PII masked)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_conversations (
  id               UUID PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  user_id          BIGINT NOT NULL REFERENCES users(id),
  academic_year_id BIGINT REFERENCES academic_years(id),
  surface          TEXT NOT NULL DEFAULT 'admin',            -- admin, teacher, parent
  language         TEXT NOT NULL DEFAULT 'en',
  title            TEXT,
  turns            INT NOT NULL DEFAULT 0,
  tokens           BIGINT NOT NULL DEFAULT 0,
  cost_paise       BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_by_user ON ai_conversations (school_id, user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,                           -- redacted
  refused         BOOLEAN NOT NULL DEFAULT false,
  citations       JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{ query, title, params, rows }]
  usage           JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_by_conversation ON ai_messages (conversation_id, id);

CREATE TABLE ai_audit (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  user_id         BIGINT,
  request_id      UUID,
  conversation_id UUID,
  kind            TEXT NOT NULL,                           -- prompt, tool, answer, refusal, error
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  text            TEXT NOT NULL,                           -- redacted
  redactions      INT NOT NULL DEFAULT 0,
  input_tokens    INT,
  output_tokens   INT,
  cost_paise      INT,
  citations       JSONB,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_audit_by_school_time ON ai_audit (school_id, at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
CALL app.apply_tenant_rls('fee_adjustments');
CALL app.apply_tenant_rls('fee_profile_changes');
CALL app.apply_tenant_rls('misc_receipts');
CALL app.apply_tenant_rls('payment_reconciliation_runs');
CALL app.apply_tenant_rls('exam_types');
CALL app.apply_tenant_rls('grade_scales');
CALL app.apply_tenant_rls('grade_bands');
CALL app.apply_tenant_rls('exams');
CALL app.apply_tenant_rls('exam_classes');
CALL app.apply_tenant_rls('exam_subjects');
CALL app.apply_tenant_rls('ai_conversations');
CALL app.apply_tenant_rls('ai_messages');
CALL app.apply_tenant_rls('ai_audit');

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.adjustment.request',  'fees',     'Request a waiver, a receipt reversal or a cheque bounce', false),
  ('fees.adjustment.approve',  'fees',     'Approve or reject fee adjustments (step-up MFA)', true),
  ('fees.profile_change.request', 'fees',  'Request a category, discount or hostel change for a student', false),
  ('fees.misc.post',           'fees',     'Post a misc receipt (students, employees, vendors, others)', false),
  ('fees.misc.view',           'fees',     'View misc receipts', false),
  ('payments.reconcile.view',  'payments', 'View the daily reconciliation of online receipts against settlements', false),
  ('payments.reconcile.run',   'payments', 'Run the reconciliation now', false),
  ('exams.master.view',        'exams',    'View exam types, exams, subjects and grade scales', false),
  ('exams.master.manage',      'exams',    'Maintain exam types, exams, subjects, locks and grade scales', false),
  ('insights.assistant.use',   'insights', 'Ask the assistant (answers come from the query catalogue with the caller''s permissions)', false),
  ('insights.assistant.audit', 'insights', 'Read the assistant audit trail and cost', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('fees.adjustment.request', 'fees.adjustment.approve', 'fees.profile_change.request', 'fees.misc.post', 'fees.misc.view',
                 'payments.reconcile.view', 'payments.reconcile.run', 'exams.master.view', 'exams.master.manage', 'insights.assistant.use', 'insights.assistant.audit')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('fees.adjustment.request', 'fees.profile_change.request', 'fees.misc.post', 'fees.misc.view', 'payments.reconcile.view', 'payments.reconcile.run', 'insights.assistant.use')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('exams.master.view', 'exams.master.manage', 'insights.assistant.use')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('exams.master.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('fees.misc.view', 'payments.reconcile.view', 'exams.master.view', 'insights.assistant.audit')
ON CONFLICT DO NOTHING;

-- families download their own receipts through the export centre (own exports only, enforced by the API)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'reports.export.view' FROM roles r WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
ON CONFLICT DO NOTHING;
