-- 0139: a cheque bounce charge is raised on the ledger of the receipt that bounced.
--  * app.reverse_fee_payment put every bounce charge on the school ledger, so a bounced hostel receipt
--    showed its charge in the regular (school) fee. The charge now takes the receipt's ledger; the API
--    gives a hostel receipt the hostel bounce head (BOUNCEH, ledger hostel), so a school and a hostel
--    bounce in the same month stay two lines.
--  * Unpaid bounce charges already raised from hostel receipts move to the hostel ledger and head.
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
    -- the charge belongs to the fee the cheque was for (school or hostel)
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, ledger)
    VALUES (app.current_school_id(), v_p.student_id, v_p.academic_year_id, v_period, p_charge_head_id, p_charge, 0, p_charge, CURRENT_DATE, 'bounce_charge',
            CASE WHEN v_p.ledger = 'hostel' THEN 'hostel' ELSE 'school' END::ledger_type)
    ON CONFLICT (student_id, academic_year_id, period_id, head_id)
      DO UPDATE SET gross = fee_demands.gross + EXCLUDED.gross, net = fee_demands.net + EXCLUDED.net, status = 'pending', updated_at = now()
    RETURNING id INTO v_charge_demand;
  END IF;
  RETURN v_charge_demand;
END
$$;

-- the hostel bounce head of each school that has a bounced hostel receipt with an unpaid charge
INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order)
SELECT DISTINCT d.school_id, 'BOUNCEH', 'Cheque bounce charge (hostel)', 'misc'::fee_head_kind, 'hostel'::ledger_type, 901
  FROM fee_adjustments j JOIN fee_payments p ON p.id = j.payment_id JOIN fee_demands d ON d.id = j.charge_demand_id
 WHERE j.kind = 'bounce' AND p.ledger = 'hostel' AND d.ledger <> 'hostel' AND d.paid = 0
ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO NOTHING;

-- move those unpaid charges: a charge row of its own on the hostel head and ledger
UPDATE fee_demands d
   SET ledger = 'hostel', head_id = h.id, updated_at = now()
  FROM fee_adjustments j JOIN fee_payments p ON p.id = j.payment_id, fee_heads h
 WHERE j.charge_demand_id = d.id AND j.kind = 'bounce' AND p.ledger = 'hostel' AND d.ledger <> 'hostel' AND d.paid = 0
   AND d.net = j.charge
   AND h.school_id = d.school_id AND h.code = 'BOUNCEH' AND h.deleted_at IS NULL;
