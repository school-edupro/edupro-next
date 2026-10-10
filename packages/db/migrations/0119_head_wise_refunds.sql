-- 0119: refunds by fee head, refund of an opening advance, refund vouchers and approval by levels.
-- A refund names the fee lines of the receipt it gives back (and, optionally, the receipt's advance and
-- late fee) and says what becomes of the fee: 'due' (asked again: a wrong or double payment) or 'cancel'
-- (not asked again: transport stopped, pupil leaving). A refund of kind 'opening_advance' has no receipt:
-- it gives back credit carried from last year. An approved refund gets a voucher number of its own.
ALTER TABLE fee_refunds
  ALTER COLUMN payment_id DROP NOT NULL,
  ADD COLUMN student_id BIGINT REFERENCES students(id),
  ADD COLUMN academic_year_id BIGINT REFERENCES academic_years(id),
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt', 'opening_advance')),
  ADD COLUMN lines JSONB,        -- [{ part: 'fee' | 'advance' | 'late_fee', demandId?, head?, period?, amount }]; null = whole receipt, newest first
  ADD COLUMN fee_action TEXT NOT NULL DEFAULT 'due' CHECK (fee_action IN ('due', 'cancel')),
  ADD COLUMN voucher_no TEXT,
  ADD COLUMN batch_id UUID,      -- refunds raised together (a withdrawal): one approval, one voucher number
  ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN withdrawal_id BIGINT,
  ADD CONSTRAINT fee_refunds_target CHECK ((kind = 'receipt' AND payment_id IS NOT NULL) OR (kind = 'opening_advance' AND student_id IS NOT NULL AND academic_year_id IS NOT NULL));
CREATE INDEX fee_refunds_batch ON fee_refunds (batch_id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX fee_refunds_open_advance ON fee_refunds (student_id, academic_year_id)
  WHERE kind = 'opening_advance' AND status IN ('requested', 'approved');

CREATE TABLE fee_refund_sequences (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  financial_year_id BIGINT NOT NULL REFERENCES financial_years(id),
  next_no           BIGINT NOT NULL DEFAULT 1,
  UNIQUE (school_id, financial_year_id)
);
CALL app.apply_tenant_rls('fee_refund_sequences');

-- The voucher number of a refund: RF/<financial year>/000001, one series per financial year.
CREATE OR REPLACE FUNCTION app.next_refund_voucher_no(p_on date DEFAULT CURRENT_DATE)
 RETURNS text
 LANGUAGE plpgsql
AS $$
DECLARE
  v_fy   BIGINT;
  v_code TEXT;
  v_no   BIGINT;
BEGIN
  PERFORM app.assert_context();
  v_fy := app.financial_year_for(p_on);
  IF v_fy IS NULL THEN RAISE EXCEPTION 'fees.no_financial_year' USING ERRCODE = 'P0001'; END IF;
  SELECT code INTO v_code FROM financial_years WHERE id = v_fy;
  INSERT INTO fee_refund_sequences (school_id, financial_year_id) VALUES (app.current_school_id(), v_fy)
  ON CONFLICT (school_id, financial_year_id) DO NOTHING;
  UPDATE fee_refund_sequences SET next_no = next_no + 1
   WHERE school_id = app.current_school_id() AND financial_year_id = v_fy RETURNING next_no - 1 INTO v_no;
  RETURN 'RF/' || v_code || '/' || lpad(v_no::text, 6, '0');
END
$$;

-- What can still be given back of last year's advance: the opening line while it is not yet used up.
CREATE OR REPLACE FUNCTION app.opening_advance_left(p_student_id bigint, p_academic_year_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $$
  SELECT COALESCE(sum(GREATEST(-(d.net - d.paid), 0)), 0)
    FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
   WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id
     AND h.kind = 'opening_balance' AND d.ledger = 'school' AND d.status IN ('pending', 'partial') AND d.net < 0
$$;

-- Applies an approved refund that names its lines (or an opening advance). A refund without lines keeps
-- the older rule (app.apply_fee_refund: advance, then the newest instalments, then late fee).
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
             app.next_refund_voucher_no())
     WHERE id = p_refund_id;
  END IF;
  IF p_paid THEN
    UPDATE fee_refunds SET status = 'paid', paid_on = COALESCE(paid_on, CURRENT_DATE) WHERE id = p_refund_id;
  END IF;
  RETURN v_r.amount;
END
$$;
