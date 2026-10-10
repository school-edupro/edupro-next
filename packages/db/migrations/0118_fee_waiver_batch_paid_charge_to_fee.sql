-- 0118: (1) several fee lines are waived in one request: the lines of one request share a batch and
-- one approval through the levels of Fee setup -> Approval levels. (2) A late fee or a bounce charge
-- that was already paid can, on approval, be adjusted in fee: the money is taken off the charge and set
-- against the pupil's oldest unpaid fee; what finds no due stays on the receipt as advance.
ALTER TABLE fee_adjustments
  ADD COLUMN batch_id UUID,
  ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id);
CREATE INDEX fee_adjustments_batch ON fee_adjustments (batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE fee_change_requests DROP CONSTRAINT fee_change_requests_kind_check;
ALTER TABLE fee_change_requests
  ADD CONSTRAINT fee_change_requests_kind_check
  CHECK (kind IN ('late_fee', 'transfer', 'date_change', 'late_fee_to_fee', 'bounce_to_fee'));
-- bounce_to_fee: the paid charge line. No foreign key: a settled line may be rebuilt by a later bill run.
ALTER TABLE fee_change_requests ADD COLUMN demand_id BIGINT;

-- Sets what a receipt still holds free against the pupil's unpaid fee, the oldest instalment first.
CREATE OR REPLACE FUNCTION app.allocate_free_to_dues(p_payment_id bigint, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $$
DECLARE
  pay    fee_payments%ROWTYPE;
  v_left NUMERIC := p_amount;
  v_take NUMERIC;
  g RECORD;
BEGIN
  SELECT * INTO pay FROM fee_payments WHERE id = p_payment_id;
  FOR g IN
    SELECT due_on, sum(net - paid) AS balance FROM fee_demands
     WHERE student_id = pay.student_id AND academic_year_id = pay.academic_year_id AND ledger = pay.ledger AND status IN ('pending', 'partial')
     GROUP BY due_on HAVING sum(net - paid) > 0 ORDER BY due_on
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := app.allocate_to_instalment(p_payment_id, pay.student_id, pay.academic_year_id, g.due_on, LEAST(v_left, g.balance));
    v_left := v_left - v_take;
  END LOOP;
  RETURN p_amount - v_left;
END
$$;

-- Late fee collected on a receipt, adjusted in fee. The instalment's late fee is fixed at what stays
-- collected, so it is not asked again. Returns what went to fee (the rest is advance on the receipt).
CREATE OR REPLACE FUNCTION app.paid_late_fee_to_fee(p_payment_id bigint, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $$
DECLARE
  pay    fee_payments%ROWTYPE;
  v_left NUMERIC := p_amount;
  v_take NUMERIC;
  v_keep NUMERIC;
  r RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO pay FROM fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.receipt_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_year_open(pay.academic_year_id, 'fees');
  IF pay.status <> 'posted' THEN RAISE EXCEPTION 'fees.receipt_not_open' USING ERRCODE = 'P0001'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > pay.late_fee THEN
    RAISE EXCEPTION 'fees.exceeds_late_fee' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('lateFee', pay.late_fee)::TEXT;
  END IF;
  FOR r IN SELECT * FROM fee_late_fee_postings WHERE payment_id = p_payment_id ORDER BY due_on DESC, id DESC LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, r.amount);
    IF v_take >= r.amount THEN DELETE FROM fee_late_fee_postings WHERE id = r.id;
    ELSE UPDATE fee_late_fee_postings SET amount = amount - v_take WHERE id = r.id;
    END IF;
    v_left := v_left - v_take;
    IF r.period_id IS NOT NULL THEN
      v_keep := app.late_fee_posted(pay.student_id, pay.academic_year_id, r.due_on, r.ledger);
      UPDATE fee_late_fee_overrides SET revoked_at = now(), revoked_by = app.current_user_id()
       WHERE student_id = pay.student_id AND academic_year_id = pay.academic_year_id AND period_id = r.period_id AND ledger = r.ledger AND revoked_at IS NULL;
      INSERT INTO fee_late_fee_overrides (school_id, student_id, academic_year_id, period_id, ledger, amount, reason, created_by, request_id)
      VALUES (app.current_school_id(), pay.student_id, pay.academic_year_id, r.period_id, r.ledger, v_keep,
              'Late fee adjusted in fee (receipt ' || COALESCE(pay.receipt_no, pay.id::text) || ')', app.current_user_id(), app.current_request_id());
    END IF;
  END LOOP;
  UPDATE fee_payments SET late_fee = late_fee - (p_amount - v_left) WHERE id = p_payment_id;
  RETURN app.allocate_free_to_dues(p_payment_id, p_amount - v_left);
END
$$;

-- A paid charge line (a bounce charge), adjusted in fee: the line is waived by the amount and the money
-- that paid it goes to the oldest unpaid fee from the same receipts. Returns what went to fee.
CREATE OR REPLACE FUNCTION app.paid_charge_to_fee(p_demand_id bigint, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $$
DECLARE
  d       fee_demands%ROWTYPE;
  v_left  NUMERIC := p_amount;
  v_take  NUMERIC;
  v_moved NUMERIC := 0;
  a RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO d FROM fee_demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.demand_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_year_open(d.academic_year_id, 'fees');
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > d.paid THEN
    RAISE EXCEPTION 'fees.exceeds_paid' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('paid', d.paid)::TEXT;
  END IF;
  -- the line first: so the money freed below cannot come back to it
  UPDATE fee_demands SET paid = paid - p_amount, discount = discount + p_amount, net = net - p_amount,
         status = CASE WHEN paid - p_amount >= net - p_amount THEN 'paid' WHEN paid - p_amount > 0 THEN 'partial' ELSE 'pending' END::fee_demand_status,
         updated_at = now()
   WHERE id = p_demand_id;
  FOR a IN SELECT * FROM fee_payment_allocations WHERE demand_id = p_demand_id ORDER BY id DESC LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, a.amount);
    IF v_take >= a.amount THEN DELETE FROM fee_payment_allocations WHERE id = a.id;
    ELSE UPDATE fee_payment_allocations SET amount = amount - v_take WHERE id = a.id;
    END IF;
    v_left := v_left - v_take;
    v_moved := v_moved + app.allocate_free_to_dues(a.payment_id, v_take);
  END LOOP;
  RETURN v_moved;
END
$$;
