-- 0066: a visitor who registered on their own phone and was never let in is closed the next day, so the
-- gate's waiting list starts clean each morning (run with the appointment tick, every five minutes).
CREATE OR REPLACE FUNCTION app.visitor_tick() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
BEGIN
  PERFORM app.assert_context();
  UPDATE visitor_log SET state = 'cancelled'
   WHERE state = 'waiting' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date < (now() AT TIME ZONE 'Asia/Kolkata')::date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;
