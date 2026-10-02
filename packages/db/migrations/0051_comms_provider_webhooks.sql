-- Provider webhooks (communication v2): Meta calls one URL for every school, so the school is found
-- from the WhatsApp phone number id (and the subscription check from the verify token) without a
-- tenant context. Only the app secret needed to check the signature is returned.
CREATE OR REPLACE FUNCTION app.comms_meta_provider(p_phone_number_id TEXT)
RETURNS TABLE (school_id BIGINT, secret TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, app AS $$
  SELECT p.school_id, p.secret FROM comms_providers p
   WHERE p.channel = 'whatsapp' AND p.provider = 'meta_whatsapp' AND p.config->>'phoneNumberId' = p_phone_number_id
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.comms_meta_provider(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.comms_meta_provider(TEXT) TO edupro_app;

CREATE OR REPLACE FUNCTION app.comms_meta_verify_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, app AS $$
  SELECT EXISTS (SELECT 1 FROM comms_providers p WHERE p.provider = 'meta_whatsapp' AND p.config->>'verifyToken' = p_token AND length(p_token) >= 16)
$$;
REVOKE ALL ON FUNCTION app.comms_meta_verify_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.comms_meta_verify_token(TEXT) TO edupro_app;
