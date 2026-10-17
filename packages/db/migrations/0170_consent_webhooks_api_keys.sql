-- Consent forms, part 4 (docs/design/28-consent-forms.md): connecting a form to other systems. A webhook
-- sends each event of the form's answers (submitted, changed, approved, not approved, fee paid) as JSON
-- signed with HMAC-SHA256; deliveries are kept, retried by the workers and can be sent again. An API key
-- opens one form to read its answers (and, with the wider scope, to approve or reject them). Set up only
-- by those holding engagement.consent_form.integrate (the school admin).

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('engagement.consent_form.integrate', 'engagement', 'Connect consent forms to other systems (webhooks and API keys)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'engagement.consent_form.integrate' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;

CREATE TABLE consent_webhooks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  form_id     BIGINT NOT NULL REFERENCES consent_forms(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  -- the signing secret, encrypted (field crypto); shown once when made
  secret      TEXT NOT NULL,
  events      TEXT[] NOT NULL DEFAULT ARRAY['submitted', 'changed', 'approved', 'rejected', 'paid'],
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX consent_webhooks_form ON consent_webhooks (form_id) WHERE deleted_at IS NULL;
CALL app.apply_tenant_rls('consent_webhooks');

CREATE TABLE consent_webhook_deliveries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  webhook_id    BIGINT NOT NULL REFERENCES consent_webhooks(id) ON DELETE CASCADE,
  response_id   BIGINT REFERENCES consent_form_responses(id) ON DELETE SET NULL,
  event         TEXT NOT NULL CHECK (event IN ('submitted', 'changed', 'approved', 'rejected', 'paid', 'test')),
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts      INT NOT NULL DEFAULT 0,
  next_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status   INT,
  last_error    TEXT,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consent_webhook_deliveries_due ON consent_webhook_deliveries (next_at) WHERE status = 'pending';
CREATE INDEX consent_webhook_deliveries_hook ON consent_webhook_deliveries (webhook_id, created_at DESC);
CALL app.apply_tenant_rls('consent_webhook_deliveries');

CREATE TABLE consent_api_keys (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  form_id       BIGINT NOT NULL REFERENCES consent_forms(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- the first characters, to recognise a key; the key itself only as a SHA-256 hash
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scope         TEXT NOT NULL CHECK (scope IN ('read', 'read_approve')),
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  uses          BIGINT NOT NULL DEFAULT 0,
  revoked_at    TIMESTAMPTZ,
  created_by    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consent_api_keys_form ON consent_api_keys (form_id);
CALL app.apply_tenant_rls('consent_api_keys');

-- an API key arrives without a school: its hash finds the school and form (nothing else is returned)
CREATE OR REPLACE FUNCTION app.consent_api_key_lookup(p_hash TEXT)
RETURNS TABLE (key_id BIGINT, school_id BIGINT, form_id BIGINT, scope TEXT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, school_id, form_id, scope, expires_at, revoked_at FROM consent_api_keys WHERE key_hash = p_hash
$$;
REVOKE ALL ON FUNCTION app.consent_api_key_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consent_api_key_lookup(TEXT) TO edupro_app;
