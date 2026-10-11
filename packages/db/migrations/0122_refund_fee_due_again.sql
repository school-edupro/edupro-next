-- 0122: a refund approved with "the fee is cancelled" can be turned into "the fee stays due": the fee
-- lines it cancelled are asked again. For a refund sent with the wrong choice; the money side of the
-- refund (receipt, voucher) does not change.
CREATE OR REPLACE FUNCTION app.refund_fee_due_again(p_refund_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
AS $$
DECLARE
  v_r    fee_refunds%ROWTYPE;
  l      JSONB;
  v_amt  NUMERIC;
  v_back NUMERIC := 0;
  d      fee_demands%ROWTYPE;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_r FROM fee_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.refund_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.status <> 'paid' OR v_r.fee_action <> 'cancel' OR v_r.lines IS NULL OR v_r.withdrawal_id IS NOT NULL THEN
    RAISE EXCEPTION 'fees.refund_not_cancelling' USING ERRCODE = 'P0001';
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(v_r.lines) LOOP
    CONTINUE WHEN COALESCE(l ->> 'part', 'fee') <> 'fee' OR l ->> 'demandId' IS NULL;
    SELECT * INTO d FROM fee_demands WHERE id = (l ->> 'demandId')::bigint FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    PERFORM app.assert_year_open(d.academic_year_id, 'fees');
    -- no more than the line was reduced by
    v_amt := LEAST((l ->> 'amount')::numeric, GREATEST(d.discount, 0));
    CONTINUE WHEN v_amt <= 0;
    UPDATE fee_demands SET discount = discount - v_amt, net = net + v_amt,
           status = CASE WHEN paid >= net + v_amt THEN 'paid' WHEN paid > 0 THEN 'partial' ELSE 'pending' END::fee_demand_status,
           updated_at = now()
     WHERE id = d.id;
    v_back := v_back + v_amt;
  END LOOP;
  UPDATE fee_refunds SET fee_action = 'due' WHERE id = p_refund_id;
  RETURN v_back;
END
$$;
