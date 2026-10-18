-- Consent forms (docs/design/28-consent-forms.md): sharing one form with employees or roles. Those holding
-- engagement.consent_form.manage keep every form; anyone else sees only the forms shared with them, by
-- name (their login) or by a role they hold. A viewer reads the answers and the register, downloads
-- Excel / PDF, reminds those not yet answered and sees the analytics; an editor also changes, publishes,
-- closes and fills the form on behalf. Deleting, copying, connecting and sharing stay with the managers.

CREATE TABLE consent_form_shares (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  form_id     BIGINT NOT NULL REFERENCES consent_forms(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id),
  role_id     BIGINT REFERENCES roles(id),
  level       TEXT NOT NULL CHECK (level IN ('viewer', 'editor')),
  created_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (role_id IS NULL))
);
CREATE UNIQUE INDEX consent_form_shares_user ON consent_form_shares (form_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX consent_form_shares_role ON consent_form_shares (form_id, role_id) WHERE role_id IS NOT NULL;
CREATE INDEX consent_form_shares_by_user ON consent_form_shares (user_id) WHERE user_id IS NOT NULL;
CALL app.apply_tenant_rls('consent_form_shares');
