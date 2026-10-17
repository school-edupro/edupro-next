-- Consent forms: a signature drawn on the screen is kept as a small PNG beside its response (like the
-- visitor photos), so the register shows "Signed" and the response's PDF copy carries the drawing.
CREATE TABLE consent_form_signatures (
  response_id  BIGINT NOT NULL REFERENCES consent_form_responses(id) ON DELETE CASCADE,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  field_key    TEXT NOT NULL,
  png          BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (response_id, field_key)
);
CALL app.apply_tenant_rls('consent_form_signatures');
