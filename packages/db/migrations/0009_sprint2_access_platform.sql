-- 0009_sprint2_access_platform.sql
-- Sprint 2: file lifecycle, extra permissions, invitation support, and helper indexes for access admin.

-- Files gain a lifecycle so an upload URL can be issued before the object exists.
CREATE TYPE file_status AS ENUM ('pending', 'ready', 'rejected');
ALTER TABLE files ADD COLUMN status file_status NOT NULL DEFAULT 'pending';
ALTER TABLE files ADD COLUMN storage_driver TEXT NOT NULL DEFAULT 'local';
CREATE INDEX files_pending_cleanup ON files (created_at) WHERE status = 'pending';

-- Memberships can be created ahead of the first login (invitation); the user row carries the invited
-- identity and is matched by One Auth subject or mobile at first sign-in.
ALTER TABLE users ADD COLUMN invited_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN invited_by BIGINT;
CREATE INDEX users_pending_by_mobile ON users (mobile) WHERE oneauth_sub LIKE 'pending:%';

-- Permissions introduced by Sprint 2 APIs (the API also syncs these from code at startup).
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.files.view',        'platform', 'Obtain download URLs for files', false),
  ('platform.campus.manage',     'platform', 'Create and edit campuses', false),
  ('access.user.search',         'access',   'Search users of the school', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('platform.files.view', 'platform.campus.manage', 'access.user.search')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.files.view' FROM roles r
WHERE r.school_id IS NULL AND r.code IN ('auditor', 'academic_coordinator', 'class_teacher', 'subject_teacher')
ON CONFLICT DO NOTHING;

-- Every staff template may delegate a role it holds (leave cover); the API checks that the role is held.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'access.delegation.create' FROM roles r
WHERE r.school_id IS NULL AND r.code IN ('academic_coordinator', 'class_teacher', 'subject_teacher')
ON CONFLICT DO NOTHING;

-- Segregation of duties (sod_rules seeded in 0004): the administrator templates grant roles, so they must
-- not also export the audit trail. The Auditor template keeps platform.audit.export. Without this the
-- permission guard refuses every access.assignment.manage call made by a school admin.
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id AND r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND rp.permission_code = 'platform.audit.export';

-- Assignment lookups by role (revocation checks) and delegation lookups by giver.
CREATE INDEX user_roles_by_role ON user_roles (school_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX delegations_by_giver ON delegations (school_id, from_user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Invitation: find-or-create a user by One Auth subject or mobile and add a membership in the current
-- school. Cross-tenant by nature (the person may already belong to another school), so this is the one
-- SECURITY DEFINER routine in the platform (ADR-006 point 2 exception, recorded here). It validates the
-- tenant context, touches only users and user_school_memberships, and returns ids only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.invite_user(
  p_oneauth_sub  TEXT,
  p_mobile       TEXT,
  p_email        TEXT,
  p_display_name TEXT,
  p_person_type  person_type
) RETURNS TABLE (o_user_id BIGINT, o_membership_id BIGINT, o_created_user BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_user_id  BIGINT;
  v_created  BOOLEAN := false;
  v_sub      TEXT;
  v_mid      BIGINT;
BEGIN
  PERFORM app.assert_context();
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'tenant.context_missing' USING ERRCODE = 'P0001', DETAIL = 'app.user_id is required';
  END IF;
  IF (p_oneauth_sub IS NULL OR p_oneauth_sub = '') AND (p_mobile IS NULL OR p_mobile = '') THEN
    RAISE EXCEPTION 'invite.identity_required' USING ERRCODE = 'P0001',
      DETAIL = 'oneauth_sub or mobile is required';
  END IF;

  IF p_oneauth_sub IS NOT NULL AND p_oneauth_sub <> '' THEN
    SELECT id INTO v_user_id FROM users WHERE oneauth_sub = p_oneauth_sub AND deleted_at IS NULL;
  END IF;
  IF v_user_id IS NULL AND p_mobile IS NOT NULL AND p_mobile <> '' THEN
    SELECT id INTO v_user_id FROM users
     WHERE mobile = p_mobile AND deleted_at IS NULL
     ORDER BY (oneauth_sub NOT LIKE 'pending:%') DESC, id
     LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    v_sub := COALESCE(NULLIF(p_oneauth_sub, ''), 'pending:' || p_mobile);
    INSERT INTO users (oneauth_sub, email, mobile, display_name, invited_at, invited_by, created_by)
    VALUES (v_sub, NULLIF(p_email, ''), NULLIF(p_mobile, ''), p_display_name, now(), app.current_user_id(), app.current_user_id())
    RETURNING id INTO v_user_id;
    v_created := true;
  END IF;

  INSERT INTO user_school_memberships (school_id, user_id, person_type, status, invited_by, created_by)
  VALUES (app.current_school_id(), v_user_id, p_person_type, 'active', app.current_user_id(), app.current_user_id())
  ON CONFLICT (school_id, user_id, person_type)
  DO UPDATE SET status = 'active', deleted_at = NULL, updated_at = now(), updated_by = app.current_user_id()
  RETURNING id INTO v_mid;

  RETURN QUERY SELECT v_user_id, v_mid, v_created;
END
$$;
REVOKE EXECUTE ON FUNCTION app.invite_user(TEXT, TEXT, TEXT, TEXT, person_type) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invite_user(TEXT, TEXT, TEXT, TEXT, person_type) TO edupro_app;

-- Claim a pending identity at first login: the user row created by invitation with 'pending:<mobile>'
-- receives the real One Auth subject. Also SECURITY DEFINER because it runs before any tenant context.
CREATE OR REPLACE FUNCTION app.claim_pending_identity(p_mobile TEXT, p_oneauth_sub TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF p_mobile IS NULL OR p_mobile = '' OR p_oneauth_sub IS NULL OR p_oneauth_sub = '' THEN
    RETURN NULL;
  END IF;
  UPDATE users SET oneauth_sub = p_oneauth_sub, updated_at = now()
   WHERE oneauth_sub = 'pending:' || p_mobile AND deleted_at IS NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION app.claim_pending_identity(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_pending_identity(TEXT, TEXT) TO edupro_app;
