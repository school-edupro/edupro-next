-- 0155/0156 rebuilt app.apply_fee_refund_lines from its 0119 text and lost the 0120 change: a refund asked
-- by amount only (no fee lines) again gets its voucher number.
DO $do$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef('app.apply_fee_refund_lines'::regproc) INTO v_src;
  IF position('RETURN app.apply_fee_refund(p_refund_id, p_paid);' IN v_src) = 0 THEN
    RAISE EXCEPTION 'apply_fee_refund_lines does not have the 0119 early return';
  END IF;
  EXECUTE replace(v_src, 'RETURN app.apply_fee_refund(p_refund_id, p_paid);', 'PERFORM app.apply_fee_refund(p_refund_id, false);');
END
$do$;
