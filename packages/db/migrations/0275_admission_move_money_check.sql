-- Moving a registration (docs/design/64): the money is checked again when the move is accepted. A fee
-- part the first school took, or a receipt it reversed, after the move was asked would not match what
-- the other school carries over: the first school then withdraws the move and sends it again. Each
-- receipt is closed for what is left of it (less any refund already paid).
CREATE OR REPLACE FUNCTION app.admission_move_close(p_move BIGINT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  m        admission_moves%ROWTYPE;
  v_from   TEXT;
  v_school TEXT;
  v_no     TEXT;
  v_note   TEXT;
  v_paid   NUMERIC;
BEGIN
  SELECT * INTO m FROM admission_moves
   WHERE id = p_move AND to_school_id = app.current_school_id() AND status = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'move % is not accepted by this school', p_move;
  END IF;
  SELECT status::text INTO v_from FROM applications
   WHERE id = m.from_application_id AND school_id = m.from_school_id FOR UPDATE;
  IF v_from IS NULL OR v_from IN ('draft', 'admitted', 'cancelled', 'withdrawn') THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(x.amount - COALESCE((SELECT sum(f.amount) FROM admission_refunds f
                                             WHERE f.receipt_id = x.id AND f.status = 'paid'), 0)), 0)
    INTO v_paid
    FROM misc_receipts x
   WHERE x.school_id = m.from_school_id AND x.application_id = m.from_application_id AND x.status = 'posted';
  IF round(v_paid, 2) <> round(COALESCE((m.snapshot #>> '{paid,total}')::numeric, 0), 2) THEN
    RETURN 'money_changed';
  END IF;
  SELECT name INTO v_school FROM schools WHERE id = m.to_school_id;
  SELECT application_no INTO v_no FROM applications WHERE id = m.to_application_id;
  v_note := left(format('Moved to %s%s: %s', v_school,
                        CASE WHEN v_no IS NOT NULL THEN format(' (registration %s)', v_no) ELSE '' END, m.reason), 500);
  UPDATE applications SET status = 'cancelled', cancelled_at = now(), cancel_reason = v_note, wait_rank = NULL, updated_at = now()
   WHERE id = m.from_application_id;
  UPDATE admission_corrections SET status = 'cancelled' WHERE application_id = m.from_application_id AND status = 'open';
  INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
  VALUES (m.from_school_id, m.from_application_id, v_from::application_status, 'cancelled', v_note, app.current_user_id());
  INSERT INTO admission_refunds (school_id, application_id, receipt_id, paid_amount, amount, reason, status,
                                 requested_by, decided_by, decided_at, decision_note, mode, reference, paid_on, paid_by)
  SELECT m.from_school_id, m.from_application_id, x.id, x.amount, x.amount - x.back,
         left(format('Moved to %s: %s', v_school, m.reason), 500), 'paid',
         m.requested_by, app.current_user_id(), now(), format('Accepted by %s', v_school), 'transfer',
         format('Move %s to %s', m.id, v_school), (now() AT TIME ZONE 'Asia/Kolkata')::date, app.current_user_id()
    FROM (SELECT r.id, r.amount, COALESCE((SELECT sum(f.amount) FROM admission_refunds f
                                            WHERE f.receipt_id = r.id AND f.status = 'paid'), 0) AS back
            FROM misc_receipts r
           WHERE r.school_id = m.from_school_id AND r.application_id = m.from_application_id AND r.status = 'posted') x
   WHERE x.amount - x.back > 0;
  RETURN v_from;
END
$$;
