-- 0126: revoking a completed withdrawal, through the fee approval levels.
-- The pupil is active again in the same class, the logins come back, every month is charged again by
-- the class fee structure and calendar, a waiting refund of the withdrawal is closed, and a refund
-- already paid stays paid while the fee it cancelled becomes due again.
ALTER TABLE student_withdrawals
  ADD COLUMN revoke_status TEXT CHECK (revoke_status IS NULL OR revoke_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN revoke_reason TEXT,
  ADD COLUMN revoke_requested_by BIGINT,
  ADD COLUMN revoke_requested_at TIMESTAMPTZ,
  ADD COLUMN revoke_workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN revoked_by BIGINT,
  -- part-paid fee lines the completion cut to what was paid: [{ demandId, amount }], put back on a revoke
  ADD COLUMN fee_cut JSONB;

-- The fee a refund cancelled is asked again. p_for_revoke lets a withdrawal's own refund through.
DROP FUNCTION app.refund_fee_due_again(bigint);
CREATE OR REPLACE FUNCTION app.refund_fee_due_again(p_refund_id bigint, p_for_revoke boolean DEFAULT false)
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
  IF v_r.status <> 'paid' OR v_r.fee_action <> 'cancel' OR v_r.lines IS NULL
     OR (v_r.withdrawal_id IS NOT NULL AND NOT p_for_revoke) THEN
    RAISE EXCEPTION 'fees.refund_not_cancelling' USING ERRCODE = 'P0001';
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(v_r.lines) LOOP
    CONTINUE WHEN COALESCE(l ->> 'part', 'fee') <> 'fee' OR l ->> 'demandId' IS NULL;
    SELECT * INTO d FROM fee_demands WHERE id = (l ->> 'demandId')::bigint FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    PERFORM app.assert_year_open(d.academic_year_id, 'fees');
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

CREATE OR REPLACE FUNCTION app.revoke_withdrawal(p_withdrawal_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $$
DECLARE
  v_w       student_withdrawals%ROWTYPE;
  v_user_id BIGINT;
  v_amt     NUMERIC;
  r         RECORD;
  l         JSONB;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_w FROM student_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal.not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_w.status <> 'completed' THEN
    RAISE EXCEPTION 'withdrawal.not_completed' USING ERRCODE = 'P0001', DETAIL = 'only a completed withdrawal is revoked';
  END IF;
  IF v_w.academic_year_id IS NULL OR NOT EXISTS (SELECT 1 FROM academic_years WHERE id = v_w.academic_year_id AND status = 'active') THEN
    RAISE EXCEPTION 'withdrawal.revoke_other_session' USING ERRCODE = 'P0001', DETAIL = 'a withdrawal is revoked only in its own, current session';
  END IF;
  IF EXISTS (SELECT 1 FROM transfer_certificates t WHERE t.id = v_w.tc_id AND t.status = 'issued') THEN
    RAISE EXCEPTION 'withdrawal.tc_issued' USING ERRCODE = 'P0001', DETAIL = 'cancel the transfer certificate first';
  END IF;

  -- back in the same class and section; the roll number too, unless another pupil has taken it
  UPDATE enrolments e SET status = 'active', ended_on = NULL,
         roll_no = CASE WHEN EXISTS (SELECT 1 FROM enrolments o WHERE o.class_section_id = e.class_section_id AND o.roll_no = e.roll_no
                                        AND o.status = 'active' AND o.id <> e.id) THEN NULL ELSE e.roll_no END,
         updated_at = now(), updated_by = app.current_user_id()
   WHERE e.student_id = v_w.student_id AND e.academic_year_id = v_w.academic_year_id AND e.status = 'withdrawn';
  PERFORM set_config('app.status_reason', 'withdrawal revoked', true);
  UPDATE students SET status = 'active', left_on = NULL, updated_at = now(), updated_by = app.current_user_id()
   WHERE id = v_w.student_id
   RETURNING user_id INTO v_user_id;
  -- the logins come back
  IF v_user_id IS NOT NULL THEN
    UPDATE user_school_memberships SET status = 'active', updated_at = now(), updated_by = app.current_user_id()
     WHERE user_id = v_user_id AND school_id = app.current_school_id() AND person_type = 'student';
  END IF;
  UPDATE user_school_memberships m SET status = 'active', updated_at = now(), updated_by = app.current_user_id()
   WHERE m.school_id = app.current_school_id() AND m.person_type = 'guardian' AND m.status = 'inactive'
     AND m.user_id IN (SELECT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                        WHERE sg.student_id = v_w.student_id AND g.user_id IS NOT NULL);

  -- a refund of the withdrawal that still waits (or is a draft) is closed with its approval
  FOR r IN
    UPDATE fee_refunds SET status = 'rejected', decided_by = app.current_user_id(), decided_at = now(),
           decision_note = 'Closed: the withdrawal was revoked'
     WHERE withdrawal_id = p_withdrawal_id AND status IN ('draft', 'requested')
    RETURNING workflow_instance_id
  LOOP
    IF r.workflow_instance_id IS NOT NULL THEN
      UPDATE workflow_steps SET status = 'skipped' WHERE instance_id = r.workflow_instance_id AND status = 'pending';
      UPDATE workflow_instances SET status = 'cancelled', completed_at = now(), updated_at = now()
       WHERE id = r.workflow_instance_id AND status = 'pending';
    END IF;
  END LOOP;
  -- a refund already paid stays paid; the fee it cancelled is due again
  FOR r IN SELECT id FROM fee_refunds
            WHERE withdrawal_id = p_withdrawal_id AND status = 'paid' AND fee_action = 'cancel' AND lines IS NOT NULL AND kind = 'receipt'
  LOOP
    PERFORM app.refund_fee_due_again(r.id, true);
  END LOOP;
  -- part-paid lines the completion cut to what was paid get their fee back
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(v_w.fee_cut, '[]'::jsonb)) LOOP
    SELECT LEAST((l ->> 'amount')::numeric, GREATEST(d.discount, 0)) INTO v_amt FROM fee_demands d WHERE d.id = (l ->> 'demandId')::bigint;
    CONTINUE WHEN v_amt IS NULL OR v_amt <= 0;
    UPDATE fee_demands SET discount = discount - v_amt, net = net + v_amt,
           status = CASE WHEN paid >= net + v_amt THEN 'paid' WHEN paid > 0 THEN 'partial' ELSE 'pending' END::fee_demand_status,
           updated_at = now()
     WHERE id = (l ->> 'demandId')::bigint;
  END LOOP;
  -- every month is charged again by the class fee structure and calendar (the months that were taken off come back)
  PERFORM app.generate_fee_demand(v_w.student_id, v_w.academic_year_id);

  UPDATE student_withdrawals SET status = 'revoked', revoke_status = 'approved', revoked_at = now(), revoked_by = app.current_user_id(),
         updated_at = now(), updated_by = app.current_user_id()
   WHERE id = p_withdrawal_id;
END
$$;
