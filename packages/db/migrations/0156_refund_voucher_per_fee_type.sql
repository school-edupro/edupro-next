-- Refunds raised together (a withdrawal's, over school and hostel receipts) share a voucher number only
-- within one fee type: the school part takes an RF/ number, the hostel part an HR/ number.
CREATE OR REPLACE FUNCTION app.apply_fee_refund_lines(p_refund_id bigint, p_paid boolean DEFAULT true)
 RETURNS numeric
 LANGUAGE plpgsql
AS $$
DECLARE
  v_r    fee_refunds%ROWTYPE;
  v_p    fee_payments%ROWTYPE;
  l      JSONB;
  v_amt  NUMERIC;
  v_left NUMERIC;
  v_take NUMERIC;
  v_free NUMERIC;
  a RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_r FROM fee_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.refund_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.status <> 'approved' THEN
    RAISE EXCEPTION 'fees.refund_not_approved' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('status', v_r.status)::TEXT;
  END IF;

  IF v_r.kind = 'opening_advance' THEN
    PERFORM app.assert_year_open(v_r.academic_year_id, 'fees');
    IF app.opening_advance_left(v_r.student_id, v_r.academic_year_id) < v_r.amount THEN
      RAISE EXCEPTION 'fees.refund_exceeds_advance' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('available', app.opening_advance_left(v_r.student_id, v_r.academic_year_id))::TEXT;
    END IF;
    v_left := v_r.amount;
    FOR a IN
      SELECT d.id, -(d.net - d.paid) AS credit FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
       WHERE d.student_id = v_r.student_id AND d.academic_year_id = v_r.academic_year_id AND h.kind = 'opening_balance'
         AND d.ledger = 'school' AND d.status IN ('pending', 'partial') AND d.net < 0 ORDER BY d.id FOR UPDATE OF d
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_left, a.credit);
      UPDATE fee_demands SET gross = gross + v_take, net = net + v_take, updated_at = now() WHERE id = a.id;
      v_left := v_left - v_take;
    END LOOP;
    -- the profile keeps the same figure, so a later bill run does not bring the advance back
    UPDATE student_fee_profiles SET opening_balance = opening_balance + v_r.amount, updated_at = now()
     WHERE student_id = v_r.student_id AND academic_year_id = v_r.academic_year_id;
  ELSIF v_r.lines IS NULL THEN
    RETURN app.apply_fee_refund(p_refund_id, p_paid);
  ELSE
    SELECT * INTO v_p FROM fee_payments WHERE id = v_r.payment_id FOR UPDATE;
    IF v_p.amount - v_p.refunded < v_r.amount THEN
      RAISE EXCEPTION 'fees.refund_exceeds_receipt' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('available', v_p.amount - v_p.refunded, 'requested', v_r.amount)::TEXT;
    END IF;
    PERFORM app.assert_year_open(v_p.academic_year_id, 'fees');
    FOR l IN SELECT * FROM jsonb_array_elements(v_r.lines) LOOP
      v_amt := (l ->> 'amount')::numeric;
      CONTINUE WHEN v_amt IS NULL OR v_amt <= 0;
      IF l ->> 'part' = 'advance' THEN
        v_free := v_p.amount - v_p.refunded - v_p.late_fee
                  - COALESCE((SELECT sum(amount) FROM fee_payment_allocations WHERE payment_id = v_p.id), 0);
        IF v_free < v_amt THEN
          RAISE EXCEPTION 'fees.refund_line_exceeds' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('part', 'advance', 'available', v_free)::TEXT;
        END IF;
        v_p.refunded := v_p.refunded + v_amt;   -- counted so a second advance line sees less
      ELSIF l ->> 'part' = 'late_fee' THEN
        IF v_p.late_fee < v_amt THEN
          RAISE EXCEPTION 'fees.refund_line_exceeds' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('part', 'late_fee', 'available', v_p.late_fee)::TEXT;
        END IF;
        v_left := v_amt;
        FOR a IN SELECT id, amount FROM fee_late_fee_postings WHERE payment_id = v_p.id ORDER BY due_on DESC, id DESC FOR UPDATE LOOP
          EXIT WHEN v_left <= 0;
          v_take := LEAST(v_left, a.amount);
          IF v_take >= a.amount THEN DELETE FROM fee_late_fee_postings WHERE id = a.id;
          ELSE UPDATE fee_late_fee_postings SET amount = amount - v_take WHERE id = a.id;
          END IF;
          v_left := v_left - v_take;
        END LOOP;
        UPDATE fee_payments SET late_fee = late_fee - v_amt WHERE id = v_p.id;
        v_p.late_fee := v_p.late_fee - v_amt;
        v_p.refunded := v_p.refunded + v_amt;
      ELSE
        v_left := v_amt;
        FOR a IN
          SELECT id, amount FROM fee_payment_allocations
           WHERE payment_id = v_p.id AND demand_id = (l ->> 'demandId')::bigint ORDER BY id DESC FOR UPDATE
        LOOP
          EXIT WHEN v_left <= 0;
          v_take := LEAST(v_left, a.amount);
          IF v_take >= a.amount THEN DELETE FROM fee_payment_allocations WHERE id = a.id;
          ELSE UPDATE fee_payment_allocations SET amount = amount - v_take WHERE id = a.id;
          END IF;
          v_left := v_left - v_take;
        END LOOP;
        IF v_left > 0 THEN
          RAISE EXCEPTION 'fees.refund_line_exceeds' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('part', 'fee', 'demandId', l ->> 'demandId', 'short', v_left)::TEXT;
        END IF;
        IF v_r.fee_action = 'cancel' THEN
          -- given back and not asked again: the line shrinks by the amount
          UPDATE fee_demands SET paid = paid - v_amt, discount = discount + v_amt, net = net - v_amt,
                 status = CASE WHEN paid - v_amt >= net - v_amt THEN 'paid' WHEN paid - v_amt > 0 THEN 'partial' ELSE 'pending' END::fee_demand_status,
                 updated_at = now()
           WHERE id = (l ->> 'demandId')::bigint;
        ELSE
          UPDATE fee_demands SET paid = paid - v_amt,
                 status = CASE WHEN paid - v_amt <= 0 THEN 'pending' WHEN paid - v_amt < net THEN 'partial' ELSE 'paid' END::fee_demand_status,
                 updated_at = now()
           WHERE id = (l ->> 'demandId')::bigint;
        END IF;
        v_p.refunded := v_p.refunded + v_amt;
      END IF;
    END LOOP;
    UPDATE fee_payments SET refunded = refunded + v_r.amount,
           status = CASE WHEN refunded + v_r.amount >= amount THEN 'refunded' ELSE 'partly_refunded' END
     WHERE id = v_r.payment_id;
  END IF;

  -- refunds raised together share one voucher number
  IF v_r.voucher_no IS NULL THEN
    UPDATE fee_refunds SET voucher_no = COALESCE(
             (SELECT o.voucher_no FROM fee_refunds o WHERE v_r.batch_id IS NOT NULL AND o.batch_id = v_r.batch_id AND o.voucher_no IS NOT NULL
                 AND split_part(o.voucher_no, '/', 1) = CASE WHEN (SELECT p.ledger::text FROM fee_payments p WHERE p.id = v_r.payment_id) = 'hostel' THEN 'HR' ELSE 'RF' END
               LIMIT 1),
             app.next_refund_voucher_no(CURRENT_DATE, COALESCE((SELECT p.ledger::text FROM fee_payments p WHERE p.id = v_r.payment_id), 'school')))
     WHERE id = p_refund_id;
  END IF;
  IF p_paid THEN
    UPDATE fee_refunds SET status = 'paid', paid_on = COALESCE(paid_on, CURRENT_DATE) WHERE id = p_refund_id;
  END IF;
  RETURN v_r.amount;
END
$$;

