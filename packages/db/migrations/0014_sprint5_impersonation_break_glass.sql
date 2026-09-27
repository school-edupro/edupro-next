-- 0014_sprint5_impersonation_break_glass.sql
-- Sprint 5: impersonation sessions (S5-02) and break-glass access (S5-03). Both are time-boxed, carry a
-- mandatory reason, and are visible to auditors.

CREATE TABLE impersonation_sessions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  actor_user_id   BIGINT NOT NULL REFERENCES users(id),
  target_user_id  BIGINT NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  ended_by        BIGINT,
  request_id      UUID,
  CHECK (actor_user_id <> target_user_id),
  CHECK (expires_at > started_at)
);
CREATE INDEX impersonation_sessions_active ON impersonation_sessions (school_id, expires_at) WHERE ended_at IS NULL;

CREATE TABLE break_glass_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  user_id         BIGINT NOT NULL REFERENCES users(id),
  role_id         BIGINT NOT NULL REFERENCES roles(id),
  user_role_id    BIGINT NOT NULL REFERENCES user_roles(id),
  reason          TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  report_sent_at  TIMESTAMPTZ,
  request_id      UUID,
  CHECK (expires_at <= started_at + interval '4 hours')
);
CREATE INDEX break_glass_events_open ON break_glass_events (expires_at) WHERE revoked_at IS NULL;

CALL app.apply_tenant_rls('impersonation_sessions');
CALL app.apply_tenant_rls('break_glass_events');

-- The guard validates an impersonation token before any tenant context exists (SECURITY DEFINER, ids only).
CREATE OR REPLACE FUNCTION app.impersonation_check(p_id BIGINT)
RETURNS TABLE (o_school_id BIGINT, o_actor_user_id BIGINT, o_target_user_id BIGINT, o_actor_name TEXT, o_expires_at TIMESTAMPTZ, o_ended_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, app AS $$
  SELECT s.school_id, s.actor_user_id, s.target_user_id, u.display_name, s.expires_at, s.ended_at
    FROM impersonation_sessions s JOIN users u ON u.id = s.actor_user_id
   WHERE s.id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION app.impersonation_check(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.impersonation_check(BIGINT) TO edupro_app;

-- Maintenance: revoke expired break-glass grants across schools and hand the rows to the reporter.
CREATE OR REPLACE FUNCTION app.expire_break_glass(p_limit INT DEFAULT 100)
RETURNS TABLE (o_event_id BIGINT, o_school_id BIGINT, o_user_id BIGINT, o_user_name TEXT, o_role_name TEXT, o_reason TEXT, o_started_at TIMESTAMPTZ, o_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT e.id FROM break_glass_events e
     WHERE e.revoked_at IS NULL AND e.expires_at <= now()
     ORDER BY e.expires_at LIMIT GREATEST(1, LEAST(p_limit, 500))
     FOR UPDATE SKIP LOCKED
  ),
  ev AS (
    UPDATE break_glass_events e SET revoked_at = now() FROM picked WHERE e.id = picked.id
    RETURNING e.id, e.school_id, e.user_id, e.role_id, e.user_role_id, e.reason, e.started_at, e.expires_at
  ),
  ur AS (
    UPDATE user_roles r SET revoked_at = now(), updated_at = now()
     WHERE r.id IN (SELECT ev.user_role_id FROM ev) AND r.revoked_at IS NULL
    RETURNING r.id
  )
  SELECT ev.id, ev.school_id, ev.user_id, u.display_name, ro.name, ev.reason, ev.started_at, ev.expires_at
    FROM ev JOIN users u ON u.id = ev.user_id JOIN roles ro ON ro.id = ev.role_id;
END
$$;
REVOKE EXECUTE ON FUNCTION app.expire_break_glass(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_break_glass(INT) TO edupro_app;

-- Permissions: a security view for alerts and break-glass listings.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.security.view', 'platform', 'View security alerts, impersonation and break-glass activity', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.security.view' FROM roles r
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'auditor', 'support_engineer')
ON CONFLICT DO NOTHING;

-- Mark the impersonated sessions in login_events too (method already exists: 'impersonation').
