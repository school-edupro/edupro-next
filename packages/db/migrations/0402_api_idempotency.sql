-- 0402: idempotency keys for writes the mobile app keeps and sends again (docs/design/89 §5.6, phase C).
--  * A phone with no network keeps a write (a class's attendance, a check-in) and sends it when back online, with an
--    `Idempotency-Key` header. A write whose answer was lost is sent again with the same key: the API then answers
--    with the first answer instead of doing it twice.
--  * One row a person and key: the route and a hash of the request (the same key with another request is refused),
--    and, once done, the answer's status and body. A row without an answer is a request still running.
--  * Kept 2 days. Reached only through the SECURITY DEFINER functions below (forced row-level security, only the
--    migrator's policy).

CREATE TABLE api_idempotency (
  user_id       BIGINT NOT NULL REFERENCES users(id),
  key           TEXT NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{8,100}$'),
  route         TEXT NOT NULL,
  school_id     BIGINT REFERENCES schools(id),
  request_hash  TEXT NOT NULL,
  status        INT,
  body          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at       TIMESTAMPTZ,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX api_idempotency_created ON api_idempotency (created_at);
ALTER TABLE api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY api_idempotency_migrator ON api_idempotency FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- A request with a key arrives. Answers what to do:
--   'new'      no earlier request: go ahead (a row is taken for it)
--   'replay'   done before with the same request: answer p_status / p_body as then
--   'running'  the same request is still running (two sends at once): try again shortly
--   'mismatch' the key was used for another request
CREATE OR REPLACE FUNCTION app.idempotency_begin(p_user_id bigint, p_key text, p_route text, p_school_id bigint,
  p_request_hash text, OUT outcome text, OUT status int, OUT body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  r api_idempotency%ROWTYPE;
BEGIN
  -- old keys go
  DELETE FROM api_idempotency WHERE created_at < now() - interval '2 days';
  -- a request that died half-way (no answer after 10 minutes) frees its key
  DELETE FROM api_idempotency i
   WHERE i.user_id = p_user_id AND i.key = p_key AND i.status IS NULL AND i.created_at < now() - interval '10 minutes';
  INSERT INTO api_idempotency (user_id, key, route, school_id, request_hash)
  VALUES (p_user_id, p_key, p_route, p_school_id, p_request_hash)
  ON CONFLICT (user_id, key) DO NOTHING;
  IF FOUND THEN
    outcome := 'new';
    RETURN;
  END IF;
  SELECT * INTO r FROM api_idempotency i WHERE i.user_id = p_user_id AND i.key = p_key;
  IF r.route <> p_route OR r.request_hash <> p_request_hash OR r.school_id IS DISTINCT FROM p_school_id THEN
    outcome := 'mismatch';
  ELSIF r.status IS NULL THEN
    outcome := 'running';
  ELSE
    outcome := 'replay';
    status := r.status;
    body := r.body;
  END IF;
END
$$;

-- The request succeeded: keep its answer for a repeat.
CREATE OR REPLACE FUNCTION app.idempotency_done(p_user_id bigint, p_key text, p_status int, p_body jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  UPDATE api_idempotency SET status = p_status, body = p_body, done_at = now()
   WHERE user_id = p_user_id AND key = p_key AND status IS NULL;
$$;

-- The request failed: free the key, so the same write may be sent again.
CREATE OR REPLACE FUNCTION app.idempotency_abandon(p_user_id bigint, p_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  DELETE FROM api_idempotency WHERE user_id = p_user_id AND key = p_key AND status IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION app.idempotency_begin(bigint, text, text, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.idempotency_done(bigint, text, int, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.idempotency_abandon(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.idempotency_begin(bigint, text, text, bigint, text) TO edupro_app;
GRANT EXECUTE ON FUNCTION app.idempotency_done(bigint, text, int, jsonb) TO edupro_app;
GRANT EXECUTE ON FUNCTION app.idempotency_abandon(bigint, text) TO edupro_app;
