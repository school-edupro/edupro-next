-- Fee fixes (16 Oct 2026):
-- 1. A bounced cheque's charge goes to the fee month in which the cheque bounced (it went to the last month
--    already due, e.g. December for a quarterly plan due in October). Charges of the same month and fee
--    type stay on one line; the screens name each bounced receipt from the bounce records. Charges already
--    raised move to the month of their date where that month has no charge line of the same head.
-- 2. Refund vouchers get one series per fee type, as the receipts do: school RF/ (as before), hostel HR/.

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
    -- the fee month in which the cheque bounced; else the last month already due
    SELECT id INTO v_period FROM fee_periods WHERE academic_year_id = v_p.academic_year_id
       AND year = extract(year FROM CURRENT_DATE)::int AND month = extract(month FROM CURRENT_DATE)::int
     ORDER BY sequence LIMIT 1;
    IF v_period IS NULL THEN
      SELECT id INTO v_period FROM fee_periods WHERE academic_year_id = v_p.academic_year_id AND due_on <= CURRENT_DATE ORDER BY sequence DESC LIMIT 1;
    END IF;
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


UPDATE fee_demands d SET period_id = m.id, updated_at = now()
  FROM fee_periods m
 WHERE d.source = 'bounce_charge' AND m.academic_year_id = d.academic_year_id
   AND m.year = extract(year FROM d.due_on)::int AND m.month = extract(month FROM d.due_on)::int
   AND m.id <> d.period_id
   AND NOT EXISTS (SELECT 1 FROM fee_demands x WHERE x.student_id = d.student_id AND x.academic_year_id = d.academic_year_id
                    AND x.period_id = m.id AND x.head_id = d.head_id);

-- ---- refund vouchers by fee type ----------------------------------------------------------------------
ALTER TABLE fee_refund_sequences ADD COLUMN ledger TEXT NOT NULL DEFAULT 'school' CHECK (ledger IN ('school', 'hostel'));
ALTER TABLE fee_refund_sequences DROP CONSTRAINT fee_refund_sequences_school_id_financial_year_id_key;
ALTER TABLE fee_refund_sequences ADD CONSTRAINT fee_refund_sequences_fy_ledger_key UNIQUE (school_id, financial_year_id, ledger);

DROP FUNCTION IF EXISTS app.next_refund_voucher_no(date);
CREATE OR REPLACE FUNCTION app.next_refund_voucher_no(p_on date DEFAULT CURRENT_DATE, p_ledger text DEFAULT 'school')
 RETURNS text
 LANGUAGE plpgsql
AS $$
DECLARE
  v_fy     BIGINT;
  v_code   TEXT;
  v_no     BIGINT;
  v_ledger TEXT := CASE WHEN p_ledger = 'hostel' THEN 'hostel' ELSE 'school' END;
BEGIN
  PERFORM app.assert_context();
  v_fy := app.financial_year_for(p_on);
  IF v_fy IS NULL THEN RAISE EXCEPTION 'fees.no_financial_year' USING ERRCODE = 'P0001'; END IF;
  SELECT code INTO v_code FROM financial_years WHERE id = v_fy;
  INSERT INTO fee_refund_sequences (school_id, financial_year_id, ledger) VALUES (app.current_school_id(), v_fy, v_ledger)
  ON CONFLICT (school_id, financial_year_id, ledger) DO NOTHING;
  UPDATE fee_refund_sequences SET next_no = next_no + 1
   WHERE school_id = app.current_school_id() AND financial_year_id = v_fy AND ledger = v_ledger RETURNING next_no - 1 INTO v_no;
  RETURN CASE WHEN v_ledger = 'hostel' THEN 'HR/' ELSE 'RF/' END || v_code || '/' || lpad(v_no::text, 6, '0');
END
$$;

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
             (SELECT o.voucher_no FROM fee_refunds o WHERE v_r.batch_id IS NOT NULL AND o.batch_id = v_r.batch_id AND o.voucher_no IS NOT NULL LIMIT 1),
             app.next_refund_voucher_no(CURRENT_DATE, COALESCE((SELECT p.ledger::text FROM fee_payments p WHERE p.id = v_r.payment_id), 'school')))
     WHERE id = p_refund_id;
  END IF;
  IF p_paid THEN
    UPDATE fee_refunds SET status = 'paid', paid_on = COALESCE(paid_on, CURRENT_DATE) WHERE id = p_refund_id;
  END IF;
  RETURN v_r.amount;
END
$$;

