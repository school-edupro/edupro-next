-- 0120: a refund asked by amount only (no fee lines) also gets its voucher number. 0119 returned from
-- the older routine before the number was given.
DO $do$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef('app.apply_fee_refund_lines'::regproc) INTO v_src;
  IF position('RETURN app.apply_fee_refund(p_refund_id, p_paid);' IN v_src) = 0 THEN
    RAISE EXCEPTION 'apply_fee_refund_lines is not the 0119 version';
  END IF;
  EXECUTE replace(v_src, 'RETURN app.apply_fee_refund(p_refund_id, p_paid);', 'PERFORM app.apply_fee_refund(p_refund_id, false);');
END
$do$;
