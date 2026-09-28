-- Sprint 14 close-out: the gaps carried out of Sprint 14 (docs/sprints/sprint-14.md).
--   1. Refund approval is a step-up (MFA) action like adjustment approval.
--   2. The late fee has a ledger dimension: hostel instalments carry a late fee under the school's rule,
--      computed, posted and overridden per ledger, so a hostel receipt never collects the school's late fee
--      and the other way round.

-- ---------------------------------------------------------------------------
-- 1. Refund approval needs a recent multi-factor sign-in
-- ---------------------------------------------------------------------------
UPDATE permissions
   SET requires_mfa = true, description = 'Approve, reject and pay out refunds (step-up MFA)'
 WHERE code = 'fees.refund.approve';

-- ---------------------------------------------------------------------------
-- 2. Ledger on late fee postings and overrides
-- ---------------------------------------------------------------------------
ALTER TABLE fee_late_fee_postings ADD COLUMN ledger ledger_type NOT NULL DEFAULT 'school';
UPDATE fee_late_fee_postings lp SET ledger = p.ledger FROM fee_payments p WHERE p.id = lp.payment_id AND p.ledger <> 'school';
DROP INDEX fee_late_fee_postings_by_instalment;
CREATE INDEX fee_late_fee_postings_by_instalment ON fee_late_fee_postings (student_id, academic_year_id, ledger, due_on);

ALTER TABLE fee_late_fee_overrides ADD COLUMN ledger ledger_type NOT NULL DEFAULT 'school';
DROP INDEX fee_late_fee_overrides_active;
CREATE UNIQUE INDEX fee_late_fee_overrides_active ON fee_late_fee_overrides (student_id, academic_year_id, period_id, ledger) WHERE revoked_at IS NULL;

-- Late fee already posted for an instalment of a student on one ledger
DROP FUNCTION app.late_fee_posted(BIGINT, BIGINT, DATE);
CREATE OR REPLACE FUNCTION app.late_fee_posted(p_student_id BIGINT, p_academic_year_id BIGINT, p_due_on DATE, p_ledger ledger_type DEFAULT 'school') RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(amount), 0) FROM fee_late_fee_postings
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = p_ledger
$$;

-- app.late_fee as Sprint 12, restricted to the rows of one ledger sharing a due date. The rule (mode, per-day
-- amount, slabs on the anchor period) is the school's; only the base and the override are per ledger.
DROP FUNCTION app.late_fee(BIGINT, BIGINT, DATE, DATE);
CREATE OR REPLACE FUNCTION app.late_fee(p_student_id BIGINT, p_academic_year_id BIGINT, p_due_on DATE, p_as_of DATE DEFAULT CURRENT_DATE, p_ledger ledger_type DEFAULT 'school')
RETURNS TABLE (o_amount NUMERIC, o_mode TEXT, o_days INT, o_overridden BOOLEAN, o_reason TEXT, o_period_id BIGINT)
LANGUAGE plpgsql STABLE AS $$
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
BEGIN
  PERFORM app.assert_context();
  SELECT COALESCE(sum(net), 0), COALESCE(sum(paid), 0) INTO v_net, v_paid_now
    FROM fee_demands
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = p_ledger
     AND status IN ('pending', 'partial', 'paid');
  SELECT fp.* INTO v_anchor FROM fee_periods fp
   WHERE fp.academic_year_id = p_academic_year_id AND fp.due_on = p_due_on ORDER BY fp.sequence LIMIT 1;
  IF v_anchor.id IS NULL THEN
    SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
     ORDER BY fp.sequence LIMIT 1;
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
    v_per_day := COALESCE((app.setting('fees.late_fee_per_day') #>> '{}')::numeric, 0);
    o_amount := round(o_days * v_per_day, 2);
  END IF;
  o_mode := v_mode;
  RETURN NEXT;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. app.post_receipt as Sprint 14, collecting the late fee on every ledger
-- ---------------------------------------------------------------------------
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
    IF p_collect_late_fee THEN
      SELECT * INTO lf FROM app.late_fee(p_student_id, p_academic_year_id, g.due_on, p_received_on, p_ledger);
      v_lf := GREATEST(COALESCE(lf.o_amount, 0) - app.late_fee_posted(p_student_id, p_academic_year_id, g.due_on, p_ledger), 0);
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
      INSERT INTO fee_late_fee_postings (school_id, payment_id, student_id, academic_year_id, due_on, period_id, amount, mode, days, ledger)
      VALUES (app.current_school_id(), v_payment_id, p_student_id, p_academic_year_id, g.due_on, lf.o_period_id, v_take, COALESCE(lf.o_mode, 'daywise'), COALESCE(lf.o_days, 0), p_ledger);
      v_left := v_left - v_take;
      v_late := v_late + v_take;
      IF g.balance <= 0 THEN v_n := v_n + 1; END IF;
    END IF;
  END LOOP;

  UPDATE fee_payments SET late_fee = v_late WHERE id = v_payment_id;
  RETURN QUERY SELECT v_payment_id, (SELECT receipt_no FROM fee_payments WHERE id = v_payment_id), v_principal, v_late, v_left, v_n;
END
$$;
