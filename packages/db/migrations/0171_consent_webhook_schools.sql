-- Consent form webhooks (0170): the workers ask which schools have deliveries due, then deliver inside
-- each school's tenant (nothing else crosses schools).
CREATE OR REPLACE FUNCTION app.consent_webhook_schools() RETURNS TABLE (o_school_id BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT school_id FROM consent_webhook_deliveries WHERE status = 'pending' AND next_at <= now()
$$;
REVOKE ALL ON FUNCTION app.consent_webhook_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consent_webhook_schools() TO edupro_app;
